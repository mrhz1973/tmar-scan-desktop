// SPDX-License-Identifier: AGPL-3.0-only
// Isolated shared-workspace G1 check using the existing synthetic rational STEP.
// Measures the selected face against its source; this is not a global G1 proof.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

assert.equal(process.env.SCANRULER_ISOLATED, '1', 'Explicit isolated-host guard required')
const appUrl = new URL(process.env.APP_URL ?? '')
assert.equal(appUrl.href, 'http://127.0.0.1:17527/', 'Only the designated local QA host is permitted')
const outputRoot = process.env.EDIT_SURFACE_QA_OUT
assert(outputRoot && isAbsolute(outputRoot), 'An absolute evidence folder is required')
const rel = relative(resolve(process.cwd()), resolve(outputRoot))
assert(rel && (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)), 'Evidence must be outside the checkout')

const inputPath = resolve(process.cwd(), 'plugins/tmar-edit-surface/evidence/refined-roundtrip/run-Zlk2YR/curved-rational.step')
const input = readFileSync(inputPath), inputHash = createHash('sha256').update(input).digest('hex')
mkdirSync(outputRoot, { recursive: true })
const out = mkdtempSync(join(outputRoot, 'workspace-g1-'))
process.env.SHOT_DIR = out
const report = {
  scope: 'synthetic rational STEP, isolated shared workspace, G1 pole edit, Apply and independent OCCT comparison',
  inputPath, inputHash, checks: [],
  limitation: 'Compares sampled positions and normals of the selected face to its own source boundary; does not prove global G1 across every adjacent face or continuously over all edge parameters.',
  verdict: 'INCOMPLETE',
}
const persist = () => writeFileSync(join(out, 'result.json'), JSON.stringify(report, null, 2))
const check = (value, message) => { assert(value, message); report.checks.push(message); persist(); console.log('PASS', message) }
persist()

const { OcctKernel } = await import('occt-wasm')
const { launchApp } = await import('../../../scripts/e2e-lib.mjs')
const kernel = await OcctKernel.init()
const sourceShape = kernel.importStep(input.toString('utf8'))
const sourceFaces = kernel.getSubShapes(sourceShape, 'face')
const sourceSolids = kernel.getSubShapes(sourceShape, 'solid')
let browser, page
try {
  assert(kernel.isValid(sourceShape) && sourceSolids.length === 1, 'Synthetic input must be one valid solid')
  const sourceBsplines = sourceFaces.flatMap((face, index) => kernel.surfaceType(face) === 'bspline' ? [index] : [])
  assert(sourceBsplines.length > 0, 'Synthetic input must contain a pre-existing B-spline face')
  report.source = { valid: kernel.isValid(sourceShape), solids: sourceSolids.length, faces: sourceFaces.length,
    bsplineFaceIndices: sourceBsplines, volume: kernel.getVolume(sourceShape) }
  check(true, 'Input STEP reimports as a valid solid with a pre-existing B-spline face')

  const app = await launchApp({ url: appUrl.href, width: 1440, height: 1000, agentDataOk: false,
    userDataDir: join(out, 'owned-browser-profile'), protocolTimeout: 120000 })
  browser = app.browser; page = app.page; report.consoleErrors = app.consoleErrors
  await page.evaluate(async step => {
    const { runCommand } = await import('/src/commands/registry.ts')
    const { useShell } = await import('/src/state/shellStore.ts')
    const { useReverse } = await import('/plugins/reverse/state/reStore.ts')
    const { reverseSession } = await import('/plugins/reverse/app/reSession.ts')
    const { sceneOf } = await import('/src/commands/host.ts')
    const { reSceneOf } = await import('/plugins/reverse/viewer/reScene.ts')
    const { useWorkspaceEditor } = await import('/src/plugins/workspaceEditors.ts')
    const history = await import('/src/state/historyStore.ts')
    useShell.getState().setWorkspace('reverse')
    for (let i = 0; !reverseSession() && i < 500; i++) await new Promise(resolve => setTimeout(resolve, 20))
    if (!reverseSession()) throw Error('CAD session unavailable')
    await reverseSession().startKernel(); await reverseSession().settled()
    await runCommand('reverse.import.step', { bytes: new TextEncoder().encode(step), name: 'synthetic-rational-g1.step' })
    await reverseSession().settled()
    const scene = sceneOf(), id = useReverse.getState().bodies[0]?.id
    if (!scene || !id || useReverse.getState().bodies.length !== 1) throw Error('Synthetic STEP import failed')
    const original = await runCommand('reverse.body.edit_source', { body: id })
    scene.fitToView()
    window.workspaceG1Qa = { runCommand, useReverse, reverseSession, scene, reScene: reSceneOf(scene),
      useWorkspaceEditor, history, id, historyBefore: history.useHistory.getState().past.length,
      sourceBefore: new TextDecoder().decode(original.file.bytes) }
  }, input.toString('utf8'))
  await page.waitForFunction(() => window.workspaceG1Qa.reScene.bodyMeshes.has(window.workspaceG1Qa.id), { timeout: 60000 })
  await page.waitForSelector('[data-test=feature-edit-surface]:enabled', { timeout: 60000 })
  await page.click('[data-test=feature-edit-surface]')
  await page.waitForSelector('[data-test=workspace-surface-parameters]', { timeout: 120000 })

  const face = await page.evaluate(() => {
    const faces = window.workspaceG1Qa.useWorkspaceEditor.getState().controller.getPanelState().faces
    return faces.find(item => item.kind === 'bspline' && item.enriched && !item.reason) ??
      faces.find(item => item.kind === 'bspline' && !item.reason) ?? null
  })
  assert(face, 'No editable pre-existing B-spline face was found')
  report.face = { index: face.index, kind: face.kind, converted: face.converted, enriched: face.enriched,
    trimLocks: face.trimLocks.length }
  await page.select('[data-test=surface-face]', String(face.index))
  await page.waitForFunction(() => {
    const state = window.workspaceG1Qa.useWorkspaceEditor.getState(), panel = state.controller?.getPanelState()
    return state.snapshot?.validation.kind === 'valid' && !panel?.calculating && !!panel?.net
  }, { timeout: 120000 })
  await page.select('[data-test=surface-continuity]', 'G1')
  await page.waitForFunction(() => {
    const state = window.workspaceG1Qa.useWorkspaceEditor.getState(), panel = state.controller?.getPanelState()
    return panel?.continuity === 'G1' && state.snapshot?.validation.kind === 'valid' && !panel?.calculating
  }, { timeout: 120000 })
  const before = await page.evaluate(() => {
    const q = window.workspaceG1Qa, controller = q.useWorkspaceEditor.getState().controller
    const panel = controller.getPanelState(), view = controller.getViewState()
    return { poles: panel.net.poles.map(point => [...point]), locked: [...view.locked], hidden: [...view.hiddenPoles],
      continuity: panel.continuity, volume: view.preview.volume }
  })
  assert.equal(before.continuity, 'G1')
  const candidates = before.poles.flatMap((point, index) => before.locked.includes(index) || before.hidden.includes(index) ? [] : [index])
  assert(candidates.length, 'No unprotected pole exists under G1')

  await page.select('[data-test=surface-selection-mode]', 'points')
  await page.select('[data-test=surface-drag-mode]', 'local')
  await page.click('[data-test=surface-axis-2]')
  const target = await page.evaluate(() => {
    const q = window.workspaceG1Qa, controller = q.useWorkspaceEditor.getState().controller, view = controller.getViewState()
    const canvas = q.scene.layerHost().canvas, rect = canvas.getBoundingClientRect(), camera = q.scene.layerHost().camera()
    const group = q.scene.layerHost().partGroup
    group.updateWorldMatrix(true, true); camera.updateMatrixWorld(true)
    const points = view.net.poles.map((pole, id) => {
      const p = group.position.clone().set(...pole).applyMatrix4(group.matrixWorld).project(camera)
      return { id, x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2, z: p.z }
    })
    const candidates = points.filter(p => !view.locked.includes(p.id) && !view.hiddenPoles.includes(p.id) && p.z >= -1 && p.z <= 1 &&
      p.x > rect.left + 12 && p.x < rect.right - 12 && p.y > rect.top + 12 && p.y < rect.bottom - 12 &&
      document.elementFromPoint(p.x, p.y) === canvas)
    candidates.forEach(p => { p.separation = Math.min(...points.filter(other => other.id !== p.id).map(other => Math.hypot(p.x - other.x, p.y - other.y))) })
    candidates.sort((a, b) => b.separation - a.separation)
    return candidates.find(p => p.separation > 8) ?? null
  })
  assert(target, 'No separately selectable, visible G1-free pole is available')
  report.target = target
  await page.mouse.click(target.x, target.y)
  await page.waitForFunction(id => window.workspaceG1Qa.useWorkspaceEditor.getState().controller.getPanelState().selected.includes(id),
    { timeout: 10000 }, target.id)
  await page.$eval('[data-test=surface-distance]', element => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, '0.05')
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.waitForSelector('[data-test=surface-move]:enabled', { timeout: 10000 })
  await page.click('[data-test=surface-move]')
  await page.waitForFunction(({ id, previous }) => {
    const state = window.workspaceG1Qa.useWorkspaceEditor.getState(), panel = state.controller?.getPanelState()
    return panel?.continuity === 'G1' && state.snapshot?.validation.kind === 'valid' && !panel?.calculating &&
      panel?.net?.poles[id]?.some((value, axis) => Math.abs(value - previous[axis]) > 1e-8)
  }, { timeout: 120000 }, { id: target.id, previous: before.poles[target.id] })
  report.movedPole = await page.evaluate(id => {
    const c = window.workspaceG1Qa.useWorkspaceEditor.getState().controller, p = c.getPanelState()
    return { continuity: p.continuity, after: [...p.net.poles[id]], volume: c.getViewState().preview.volume }
  }, target.id)
  check(report.movedPole.continuity === 'G1' && Math.hypot(...report.movedPole.after.map((v, i) => v - before.poles[target.id][i])) > 1e-8,
    'Shared workspace changes an unprotected pole under G1 and validates the CAD preview')
  await page.screenshot({ path: join(out, 'g1-preview.png') })
  await page.waitForSelector('[data-test=workspace-editor-apply]:enabled', { timeout: 120000 })
  await page.click('[data-test=workspace-editor-apply]')
  await page.waitForFunction(() => {
    const state = window.workspaceG1Qa.useWorkspaceEditor.getState()
    return state.phase === 'closed' || !!state.error
  }, { timeout: 120000 })
  const applied = await page.evaluate(async () => {
    const q = window.workspaceG1Qa, state = q.useWorkspaceEditor.getState(), project = q.useReverse.getState()
    const steps = []
    for (const body of project.bodies) {
      const value = await q.runCommand('reverse.body.edit_source', { body: body.id })
      steps.push({ id: body.id, text: new TextDecoder().decode(value.file.bytes) })
    }
    return { phase: state.phase, error: state.error ?? null, receipt: state.receipt, steps,
      historyDelta: q.history.useHistory.getState().past.length - q.historyBefore, originalId: q.id }
  })
  assert.equal(applied.phase, 'closed', `Apply failed: ${applied.error}`)
  assert.equal(applied.steps.length, 2, 'Apply should leave the source and one CAD copy in the isolated project')
  assert.equal(applied.receipt?.createdBodyIds?.length, 1)
  assert.equal(applied.historyDelta, 1)
  const originalStep = applied.steps.find(body => body.id === applied.originalId)?.text
  const copiedStep = applied.steps.find(body => applied.receipt.createdBodyIds.includes(body.id))?.text
  assert(originalStep && copiedStep, 'Cannot identify source and Apply-created CAD copy')
  writeFileSync(join(out, 'source-before.step'), input)
  writeFileSync(join(out, 'source-after.step'), originalStep)
  writeFileSync(join(out, 'g1-copy.step'), copiedStep)

  const beforeShape = kernel.importStep(input.toString('utf8'))
  const afterShape = kernel.importStep(copiedStep)
  const beforeFaces = kernel.getSubShapes(beforeShape, 'face'), afterFaces = kernel.getSubShapes(afterShape, 'face')
  const afterSolids = kernel.getSubShapes(afterShape, 'solid')
  const beforeBsplines = beforeFaces.filter(item => kernel.surfaceType(item) === 'bspline')
  const afterBsplines = afterFaces.filter(item => kernel.surfaceType(item) === 'bspline')
  try {
    assert(kernel.isValid(afterShape) && afterSolids.length === 1, 'Applied STEP is not a valid single solid')
    assert(beforeBsplines.length > 0 && afterBsplines.length === beforeBsplines.length, 'Apply changed B-spline face topology')
    const sampleBoundary = (face, u, v, count = 16) => {
      const points = []
      for (let i = 0; i <= count; i++) {
        const s = i / count
        points.push(kernel.pointOnSurface(face, u.uMin + (u.uMax - u.uMin) * s, v.vMin))
        points.push(kernel.pointOnSurface(face, u.uMin + (u.uMax - u.uMin) * s, v.vMax))
        points.push(kernel.pointOnSurface(face, u.uMin, v.vMin + (v.vMax - v.vMin) * s))
        points.push(kernel.pointOnSurface(face, u.uMax, v.vMin + (v.vMax - v.vMin) * s))
      }
      return points
    }
    const sourceFace = sourceFaces[face.index]
    assert(sourceFace && kernel.surfaceType(sourceFace) === 'bspline', 'Selected source face no longer matches the imported STEP')
    const sourceU = kernel.uvBounds(sourceFace)
    const targetBoundary = sampleBoundary(sourceFace, sourceU, sourceU)
    const matching = afterBsplines.map(face => {
      const bounds = kernel.uvBounds(face), points = sampleBoundary(face, bounds, bounds)
      if (['uMin', 'uMax', 'vMin', 'vMax'].some(key => Math.abs(bounds[key] - sourceU[key]) > 1e-9))
        return { face, maxPositionError: Infinity, minNormalDot: -1 }
      if (points.length !== targetBoundary.length) return { face, maxPositionError: Infinity, minNormalDot: -1 }
      const errors = points.map((point, index) => {
        const other = targetBoundary[index]
        return Math.hypot(point.x - other.x, point.y - other.y, point.z - other.z)
      })
      let minNormalDot = 1
      for (let i = 0; i <= 16; i++) {
        const s = i / 16
        for (const [u, v] of [
          [sourceU.uMin + (sourceU.uMax - sourceU.uMin) * s, sourceU.vMin],
          [sourceU.uMin + (sourceU.uMax - sourceU.uMin) * s, sourceU.vMax],
          [sourceU.uMin, sourceU.vMin + (sourceU.vMax - sourceU.vMin) * s],
          [sourceU.uMax, sourceU.vMin + (sourceU.vMax - sourceU.vMin) * s],
        ]) {
          const a = kernel.surfaceNormal(sourceFace, u, v), b = kernel.surfaceNormal(face, u, v)
          minNormalDot = Math.min(minNormalDot, a.x * b.x + a.y * b.y + a.z * b.z)
        }
      }
      return { face, maxPositionError: Math.max(...errors), minNormalDot }
    }).sort((a, b) => a.maxPositionError - b.maxPositionError)
    const result = matching[0]
    report.boundary = { samples: targetBoundary.length, maxPositionError: result.maxPositionError, minNormalDot: result.minNormalDot }
    check(result.maxPositionError <= 1e-6, 'Applied STEP preserves sampled boundary positions within 1e-6 mm')
    check(result.minNormalDot > 1 - 1e-8, 'Applied STEP preserves sampled boundary normals relative to the source face')
    report.copy = { valid: kernel.isValid(afterShape), solids: 1, faces: afterFaces.length,
      volume: kernel.getVolume(afterShape), sourceVolume: kernel.getVolume(beforeShape) }
    check(Math.abs(report.copy.volume - report.copy.sourceVolume) > 1e-7, 'Applied copy contains the requested interior pole deformation')
    report.verdict = 'PASS'
  } finally {
    beforeFaces.forEach(face => kernel.release(face)); afterFaces.forEach(face => kernel.release(face))
    afterSolids.forEach(solid => kernel.release(solid))
    kernel.release(beforeShape); kernel.release(afterShape)
  }
  check(app.consoleErrors.length === 0, 'No browser application errors')
} catch (error) {
  report.verdict = 'FAIL'; report.error = String(error?.stack ?? error)
  if (page) try { await page.screenshot({ path: join(out, 'failure.png') }) } catch {}
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  for (const face of sourceFaces) kernel.release(face)
  for (const solid of sourceSolids) kernel.release(solid)
  kernel.release(sourceShape)
  kernel[Symbol.dispose]()
  report.inputHashAfter = createHash('sha256').update(readFileSync(inputPath)).digest('hex')
  report.sourceUnchanged = report.inputHashAfter === inputHash
  if (!report.sourceUnchanged) { report.verdict = 'FAIL_SOURCE_CHANGED'; process.exitCode = 1 }
  persist(); console.log(JSON.stringify({ out, ...report }, null, 2))
}
