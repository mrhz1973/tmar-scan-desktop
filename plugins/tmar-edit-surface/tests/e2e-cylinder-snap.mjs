// SPDX-License-Identifier: AGPL-3.0-only
// Cylinder pole snapping through real shared-view pointer events, with synthetic references.
// Never targets an existing user browser, project, scan or CAD session.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

assert.equal(process.env.SCANRULER_ISOLATED, '1', 'Explicit isolated-host guard is required')
const dragMode = 'axis'
const url = new URL(process.env.APP_URL ?? '')
assert.equal(url.href, 'http://127.0.0.1:17723/', 'Only the designated isolated cylinder QA host is allowed')
const outputRoot = process.env.EDIT_SURFACE_QA_OUT
assert(outputRoot && isAbsolute(outputRoot), 'EDIT_SURFACE_QA_OUT must be an absolute folder')
const outputFromApp = relative(resolve(process.cwd()), resolve(outputRoot))
assert(outputFromApp && (outputFromApp === '..' || outputFromApp.startsWith('..' + sep) || isAbsolute(outputFromApp)),
  'Evidence and browser profile must be outside the app checkout')
mkdirSync(outputRoot, { recursive: true })
const out = mkdtempSync(join(outputRoot, 'cylinder-snap-'))
// e2e-lib otherwise creates its default screenshot directory in the checkout.
process.env.SHOT_DIR = out

const { OcctKernel } = await import('occt-wasm')
const { importStep, writeBinarySTL } = await import('meshstep')
const { launchApp, loadScan } = await import('../../../scripts/e2e-lib.mjs')
const kernel = await OcctKernel.init()
const cylinder = kernel.makeCylinder(10, 20)
// Nine exactly refined V rows place editable row 2 at z = 20/6.
// A broad slab gives an independently known target plane, including poles
// outside the cylinder skin. This tests pole snapping, not skin coincidence.
const targetZ = 20 / 6 + 2
const slab = kernel.makeBox(100, 100, 1)
const shifted = kernel.translate(slab, -50, -50, targetZ)
let source, reference
try {
  source = kernel.exportStep(cylinder)
  reference = kernel.exportStep(shifted)
} finally {
  kernel.release(shifted); kernel.release(slab); kernel.release(cylinder)
}
const scanMesh = importStep(reference, { surfaceDeviation: 0.02, maxEdge: 2 }).mesh
const scanPath = join(out, 'synthetic-reference.stl')
writeFileSync(scanPath, Buffer.from(writeBinarySTL(scanMesh)))
const report = { scope: 'real source-host UI and pointer events; synthetic cylinder and planar STL/CAD references; no real owner scan, physical input, EXE or macOS qualification', dragMode,
  url: url.href, cases: { scan: { verdict: 'NOT_RUN', checks: [] }, cad: { verdict: 'NOT_RUN', checks: [] } }, verdict: 'INCOMPLETE' }
const persist = () => writeFileSync(join(out, 'result.json'), JSON.stringify(report, null, 2))
const check = (result, item, name) => { assert(result, name); item.checks.push(name); persist(); console.log('PASS', item.kind, name) }

async function runCase(kind) {
  const item = report.cases[kind]
  item.kind = kind; item.verdict = 'RUNNING'; item.poles = {}; persist()
  let browser, page
  try {
    const launched = await launchApp({ url: url.href, width: 1440, height: 1000, agentDataOk: false,
      userDataDir: join(out, `owned-profile-${kind}`), protocolTimeout: 120000 })
    browser = launched.browser; page = launched.page; item.consoleErrors = launched.consoleErrors
    page.on('dialog', dialog => dialog.accept())
    if (kind === 'scan') await loadScan(page, scanPath, { inputSelector: '[data-test=slot-scan] input[type=file]', timeout: 120000 })
    await page.evaluate(async ({ sourceStep, referenceStep, useCad }) => {
      const { runCommand } = await import('/src/commands/registry.ts')
      const { useShell } = await import('/src/state/shellStore.ts')
      const { useReverse } = await import('/plugins/reverse/state/reStore.ts')
      const { reverseSession } = await import('/plugins/reverse/app/reSession.ts')
      const { sceneOf } = await import('/src/commands/host.ts')
      const { reSceneOf } = await import('/plugins/reverse/viewer/reScene.ts')
      const { useWorkspaceEditor } = await import('/src/plugins/workspaceEditors.ts')
      useShell.getState().setWorkspace('reverse')
      for (let i = 0; !reverseSession() && i < 500; i++) await new Promise(r => setTimeout(r, 20))
      if (!reverseSession()) throw Error('CAD session unavailable')
      await reverseSession().startKernel(); await reverseSession().settled()
      await runCommand('reverse.import.step', { bytes: new TextEncoder().encode(sourceStep), name: 'qa-source.step' })
      await reverseSession().settled()
      const sourceId = useReverse.getState().bodies[0]?.id
      if (!sourceId) throw Error('Source body unavailable')
      if (useCad) {
        await runCommand('reverse.import.step', { bytes: new TextEncoder().encode(referenceStep), name: 'qa-reference.step' })
        await reverseSession().settled()
      }
      useReverse.getState().clearSelection()
      useReverse.getState().setListSelection({ bodies: [], folders: [] })
      const scene = sceneOf()
      if (!scene) throw Error('Workspace scene unavailable')
      scene.fitToView()
      window.workspaceSnapQa = { useReverse, scene, reScene: reSceneOf(scene), useWorkspaceEditor, sourceId }
    }, { sourceStep: source, referenceStep: reference, useCad: kind === 'cad' })
    await page.waitForFunction(expected => {
      const q = window.workspaceSnapQa
      return q.useReverse.getState().bodies.length === expected && !q.useReverse.getState().building && q.reScene.bodyMeshes.has(q.sourceId)
    }, { timeout: 120000 }, kind === 'cad' ? 2 : 1)
    const sourceBefore = await page.evaluate(() => {
      const q = window.workspaceSnapQa
      q.geometryBefore = q.reScene.bodyMeshes.get(q.sourceId).geometry
      return { bodyId: q.sourceId, canvasCount: document.querySelectorAll('.viewport canvas').length }
    })
    await page.waitForSelector('[data-test=feature-edit-surface]:enabled', { timeout: 60000 })
    await page.click('[data-test=feature-edit-surface]')
    if (kind === 'cad') {
      await page.waitForSelector('[data-test=surface-source-body]', { timeout: 10000 })
      await page.select('[data-test=surface-source-body]', String(sourceBefore.bodyId))
      const button = await page.evaluateHandle(() => [...document.querySelectorAll('[role=dialog] button')].find(e => e.textContent === 'Continua'))
      assert(button.asElement(), 'Source-body confirmation button exists')
      await button.asElement().click()
    }
    await page.waitForSelector('[data-test=workspace-surface-parameters]', { timeout: 120000 })
    const boundBody = await page.evaluate(() => window.workspaceSnapQa.useWorkspaceEditor.getState().controller.source.bodyId)
    check(boundBody === sourceBefore.bodyId, item, 'editor is bound to the synthetic source body')
    const faceIndex = await page.evaluate(() => {
      const c = window.workspaceSnapQa.useWorkspaceEditor.getState().controller
      const candidate = c.getPanelState().faces.find(face => face.experimentalCylinder)
      if (!candidate) throw Error('Eligible synthetic cylinder not found')
      return candidate.index
    })
    item.faceIndex = faceIndex
    await page.evaluate(index => { window.workspaceSnapQa.faceIndex = index }, faceIndex)
    await page.select('[data-test=surface-face]', String(faceIndex))
    await page.waitForFunction(() => {
      const s = window.workspaceSnapQa.useWorkspaceEditor.getState(), p = s.controller?.getPanelState()
      return p?.face === window.workspaceSnapQa.faceIndex && !p.calculating && p.net?.nv === 9 && !!s.controller.getViewState().provisionalPreview
    }, { timeout: 120000 })
    await page.select('[data-test=surface-selection-mode]', 'points')
    await page.select('[data-test=surface-drag-mode]', dragMode)
    await page.click('[data-test=surface-axis-2]')
    await page.evaluate(() => window.workspaceSnapQa.scene.viewFrom('front'))
    await page.mouse.move(750, 500)
    for (let i = 0; i < (kind === 'cad' ? 2 : 7); i++) { await page.mouse.wheel({ deltaY: 200, deltaX: 0 }); await new Promise(r => setTimeout(r, 40)) }
    await new Promise(r => setTimeout(r, 300))
    if (!await page.$eval('[data-test=surface-snap]', el => el.checked)) await page.click('[data-test=surface-snap]')
    await page.$eval('[data-test=surface-snap-distance]', el => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '1')
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const target = await page.evaluate(() => {
      const q = window.workspaceSnapQa, c = q.useWorkspaceEditor.getState().controller
      const v = c.getViewState(), canvas = q.scene.layerHost().canvas, rect = canvas.getBoundingClientRect()
      const camera = q.scene.layerHost().camera(), group = q.scene.layerHost().partGroup
      group.updateWorldMatrix(true, true); camera.updateMatrixWorld(true)
      const locations = v.net.poles.map((pole, id) => {
        const p = group.position.clone().set(...pole).applyMatrix4(group.matrixWorld).project(camera)
        const x = rect.left + (p.x + 1) * rect.width / 2, y = rect.top + (1 - p.y) * rect.height / 2
        return { id, pole: [...pole], x, y, visible: p.z >= -1 && p.z <= 1 && document.elementFromPoint(x, y) === canvas }
      })
      const candidates = locations.filter(p => p.id === 3*v.net.nv+2 && p.visible && !v.locked.includes(p.id) && !v.hiddenPoles.includes(p.id) &&
        p.x > rect.left + 12 && p.x < rect.right - 12 && p.y > rect.top + 12 && p.y < rect.bottom - 12)
      candidates.forEach(p => { p.distance = Math.min(...locations.filter(other => other.id !== p.id).map(other => Math.hypot(p.x - other.x, p.y - other.y))) })
      candidates.sort((a, b) => b.distance - a.distance)
      return candidates[0] ?? null
    })
    assert(target && target.distance > 8, `No separately clickable editable pole: ${JSON.stringify(target)}`)
    item.poleIndex = target.id; item.start = target.pole
    check(Math.abs(target.pole[2] - 20/6) < 1e-4, item, 'known cylinder centre pole selected')
    const baseline = await page.evaluate(() => structuredClone(window.workspaceSnapQa.useWorkspaceEditor.getState().controller.getViewState().net))
    item.baseline = baseline
    const checkCoupling = async label => {
      const actual = await page.evaluate(() => structuredClone(window.workspaceSnapQa.useWorkspaceEditor.getState().controller.getViewState().net))
      const row = 2, nv = baseline.nv, centre = 3*nv+row
      const delta = actual.poles[centre].map((v,d) => v-baseline.poles[centre][d])
      // Independent algebraic oracle; do not invoke production periodic helpers.
      const weights = [1,3,5].map(u => baseline.weights[u*nv+row])
      const factors = new Map([[2*nv+row, weights[1]/(weights[0]+weights[1])],
        [centre,1], [4*nv+row,weights[1]/(weights[1]+weights[2])]])
      check(Math.hypot(...delta)>1e-5, item, `${label}: selected pole moved`)
      check(actual.poles.every((p,i) => p.every((v,d) => Math.abs(v-baseline.poles[i][d]-delta[d]*(factors.get(i)??0))<1e-7)),
        item, `${label}: adjacent poles follow rational coupling; all other poles stay unchanged`)
      check(JSON.stringify({...actual,poles:[]})===JSON.stringify({...baseline,poles:[]}), item, `${label}: net parameters and weights unchanged`)
    }
    const project = delta => page.evaluate(({ index, dz }) => {
      const q = window.workspaceSnapQa, c = q.useWorkspaceEditor.getState().controller, v = c.getViewState()
      const camera = q.scene.layerHost().camera(), group = q.scene.layerHost().partGroup, rect = q.scene.layerHost().canvas.getBoundingClientRect()
      group.updateWorldMatrix(true, true); camera.updateMatrixWorld(true)
      const pole = v.net.poles[index], projection = z => group.position.clone().set(pole[0], pole[1], z).applyMatrix4(group.matrixWorld).project(camera)
      const a = projection(pole[2]), b = projection(pole[2] + dz)
      const client = p => [rect.left + (p.x + 1) * rect.width / 2, rect.top + (1 - p.y) * rect.height / 2]
      return { from: client(a), to: client(b) }
    }, { index: target.id, dz: delta })
    const drag = async (label, alt, expectedFeedback) => {
      const positions = await project(1.5)
      assert(Math.hypot(positions.to[0] - positions.from[0], positions.to[1] - positions.from[1]) >= 4,
        'Drag exceeds the CSS-pixel threshold')
      await page.mouse.move(...positions.from)
      if (alt) await page.keyboard.down('Alt')
      await page.mouse.down()
      await page.waitForFunction(() => window.workspaceSnapQa.useWorkspaceEditor.getState().snapshot?.gesture === 'pole', { timeout: 10000 })
      await page.mouse.move(...positions.to, { steps: 8 })
      if (expectedFeedback) {
        await page.waitForFunction(label => {
          const el = document.querySelector('[data-test=surface-snap-feedback]')
          return !!el && getComputedStyle(el).display !== 'none' && el.textContent.includes(label)
        }, { timeout: 10000 }, expectedFeedback)
        await page.screenshot({ path: join(out, `${kind}-${label}.png`) })
      } else {
        check(await page.$eval('[data-test=surface-snap-feedback]', el => getComputedStyle(el).display === 'none'), item,
          `${label} hides snap feedback`)
      }
      await page.mouse.up()
      if (alt) await page.keyboard.up('Alt')
      await page.waitForFunction(() => {
        const s = window.workspaceSnapQa.useWorkspaceEditor.getState()
        return s.snapshot?.gesture === 'idle' && !s.controller?.getPanelState().calculating && !!s.controller?.getViewState().provisionalPreview
      }, { timeout: 120000 })
      await checkCoupling(label)
      const pole = await page.evaluate(i => [...window.workspaceSnapQa.useWorkspaceEditor.getState().controller.getViewState().net.poles[i]], target.id)
      item.poles[label] = pole; persist()
      return pole
    }
    const undo = async () => {
      await page.waitForSelector('[data-test=surface-undo]:enabled', { timeout: 120000 })
      await page.click('[data-test=surface-undo]')
      await page.waitForFunction(({ index, original }) => {
        const s = window.workspaceSnapQa.useWorkspaceEditor.getState(), p = s.controller?.getViewState().net?.poles[index]
        return s.snapshot?.gesture === 'idle' && !s.controller?.getPanelState().calculating &&
          p?.every((v, i) => Math.abs(v - original[i]) < 1e-7)
      }, { timeout: 120000 }, { index: target.id, original: target.pole })
      const restored = await page.evaluate(() => window.workspaceSnapQa.useWorkspaceEditor.getState().controller.getViewState().net.poles)
      check(restored.every((p,i) => p.every((v,d) => Math.abs(v-baseline.poles[i][d])<1e-7)), item, 'Undo restores the entire cylinder control net')
    }
    const snapped = await drag('snap', false, kind === 'scan' ? 'Scansione' : 'Corpo CAD')
    item.snappedPlaneDistanceMm = Math.abs(snapped[2]-targetZ)
    check(item.snappedPlaneDistanceMm < 0.005 && Math.hypot(snapped[0]-target.pole[0],snapped[1]-target.pole[1])<1e-5,
      item, 'snapped cylinder pole reaches reference plane within 0.005 mm')
    await undo()
    const alt = await drag('alt', true, null)
    check(Math.abs(alt[2] - (target.pole[2] + 1.5)) < 0.05, item, 'Alt preserves the unsnapped +1.5 mm motion')
    await undo()
    await page.click('[data-test=surface-snap]')
    assert.equal(await page.$eval('[data-test=surface-snap]', el => el.checked), false)
    const off = await drag('off', false, null)
    check(off.every((value,i)=>Math.abs(value-alt[i])<1e-5), item, 'disabled magnet and Alt have the same unsnapped result')
    check(await page.evaluate(() => {
      const q = window.workspaceSnapQa
      return q.reScene.bodyMeshes.get(q.sourceId).geometry === q.geometryBefore && document.querySelectorAll('.viewport canvas').length === 1
    }), item, 'the source geometry and shared canvas remain unchanged')
    check(item.consoleErrors.length === 0, item, 'no browser application errors')
    item.verdict = 'PASS'; persist()
  } catch (error) {
    item.verdict = 'FAIL'; item.error = String(error?.stack ?? error)
    if (page) try { await page.screenshot({ path: join(out, `${kind}-failure.png`) }) } catch { /* Keep the original error. */ }
    persist(); throw error
  } finally { if (browser) await browser.close() }
}

try {
  const kinds=process.env.SNAP_CASE ? [process.env.SNAP_CASE] : ['scan','cad']
  assert(kinds.every(kind=>kind==='scan'||kind==='cad'),'Unsupported snap case')
  for (const kind of kinds) {
    try { await runCase(kind) } catch (error) { report.error = String(error?.stack ?? error); process.exitCode = 1 }
  }
  report.verdict = Object.values(report.cases).some(item => item.verdict === 'FAIL') ? 'FAIL' : Object.values(report.cases).every(item => item.verdict === 'PASS') ? 'PASS' : 'INCOMPLETE'
} finally {
  kernel[Symbol.dispose]()
  persist()
  console.log(JSON.stringify({ out, ...report }, null, 2))
}
