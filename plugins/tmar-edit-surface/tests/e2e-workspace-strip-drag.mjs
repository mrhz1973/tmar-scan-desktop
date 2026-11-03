// SPDX-License-Identifier: AGPL-3.0-only
// Real shared-workspace edge dragging, only on a synthetic, open STEP sheet.
// Does not Apply, open user projects, reuse an existing profile, or start a server.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

assert.equal(process.env.SCANRULER_ISOLATED, '1', 'Explicit isolated-host guard required')
const url = new URL(process.env.APP_URL ?? '')
assert.equal(url.href, 'http://127.0.0.1:17527/', 'Only the designated isolated host is permitted')
const root = process.env.EDIT_SURFACE_QA_OUT
assert(root && isAbsolute(root), 'Evidence folder must be an absolute path')
const rel = relative(resolve(process.cwd()), resolve(root))
assert(rel && (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)), 'Evidence must be outside the checkout')
mkdirSync(root, { recursive: true })
const out = mkdtempSync(join(root, 'strip-drag-'))
process.env.SHOT_DIR = out // e2e-lib otherwise creates a folder inside the checkout.

const report = {
  scope: 'isolated real workspace; synthetic single-face STEP; pointer interactions',
  host: url.href,
  checks: [],
  notTested: ['Apply / host commit', 'user CAD sessions', 'other STEP topologies'],
  verdict: 'INCOMPLETE',
}
const persist = () => writeFileSync(join(out, 'result.json'), JSON.stringify(report, null, 2))
const check = (condition, description) => {
  assert(condition, description)
  report.checks.push(description)
  persist()
  console.log('PASS', description)
}
persist()

let kernel, browser, page
try {
  const { OcctKernel } = await import('occt-wasm')
  const { launchApp } = await import('../../../scripts/e2e-lib.mjs')
  kernel = await OcctKernel.init()
  const box = kernel.makeBox(20, 30, 10), faces = kernel.getSubShapes(box, 'face')
  let source
  try {
    const face = faces.find(item => Math.abs(kernel.getSurfaceArea(item) - 600) < 1e-7)
    assert(face, 'Synthetic 20 × 30 mm face unavailable')
    source = kernel.exportStep(face)
  } finally { faces.forEach(face => kernel.release(face)); kernel.release(box) }
  report.inputSha256 = createHash('sha256').update(source).digest('hex')
  writeFileSync(join(out, 'synthetic-sheet.step'), source)
  persist()

  const app = await launchApp({ url: url.href, width: 1440, height: 1000, agentDataOk: false,
    userDataDir: join(out, 'owned-browser-profile'), protocolTimeout: 120000 })
  browser = app.browser; page = app.page; report.consoleErrors = app.consoleErrors
  // The listener precedes the editor lease's capturing listener and records
  // the actual pointer ID, including non-mouse devices if the test is adapted.
  await page.evaluate(() => window.addEventListener('pointerdown', e => { window.stripQaPointer = e.pointerId }, true))
  await page.evaluate(async step => {
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
    await runCommand('reverse.import.step', { bytes: new TextEncoder().encode(step), name: 'synthetic-open-sheet.step' })
    await reverseSession().settled()
    const scene = sceneOf(), id = useReverse.getState().bodies[0]?.id
    if (!scene || !id || useReverse.getState().bodies.length !== 1) throw Error('Synthetic import failed')
    scene.fitToView()
    window.stripDragQa = { scene, reScene: reSceneOf(scene), useWorkspaceEditor, useReverse, id }
  }, source)
  await page.waitForFunction(() => {
    const q = window.stripDragQa
    return q.reScene.bodyMeshes.has(q.id) && !q.useReverse.getState().building
  }, { timeout: 120000 })
  await page.waitForSelector('[data-test=feature-edit-surface]:enabled', { timeout: 60000 })
  await page.click('[data-test=feature-edit-surface]')
  await page.waitForSelector('[data-test=workspace-surface-parameters]', { timeout: 120000 })
  await page.waitForFunction(() => document.querySelectorAll('[data-test=surface-face] option').length === 2, { timeout: 60000 })
  await page.select('[data-test=surface-face]', '0')
  await page.waitForFunction(() => {
    const s = window.stripDragQa.useWorkspaceEditor.getState(), p = s.controller?.getPanelState()
    return p?.canBeginStrip && s.snapshot?.validation?.kind === 'valid' && !p.calculating
  }, { timeout: 120000 })
  await page.click('[data-test=surface-strip-begin]')
  await page.waitForFunction(() => {
    const strip = window.stripDragQa.useWorkspaceEditor.getState().controller?.getPanelState().strip
    return strip && !strip.pending && strip.paths.length === 4
  }, { timeout: 120000 })
  check(true, 'Synthetic STEP imported and editor initialized on its single open face')

  // Pick a reachable boundary and project an outward displacement using the
  // actual shared view and part transform, never a reconstructed fake camera.
  const target = await page.evaluate(() => {
    const q = window.stripDragQa, state = q.useWorkspaceEditor.getState().controller.getViewState()
    const paths = state.strip.paths, group = q.scene.layerHost().partGroup
    const canvas = q.scene.layerHost().canvas, rect = canvas.getBoundingClientRect(), camera = q.scene.layerHost().camera()
    group.updateWorldMatrix(true, true); camera.updateMatrixWorld(true)
    const points = paths.flat(), low = [0, 1, 2].map(k => Math.min(...points.map(p => p[k])))
    const high = [0, 1, 2].map(k => Math.max(...points.map(p => p[k])))
    const center = low.map((v, i) => (v + high[i]) / 2)
    const screen = p => {
      const v = group.position.clone().set(...p).applyMatrix4(group.matrixWorld).project(camera)
      return [rect.left + (v.x + 1) * rect.width / 2, rect.top + (1 - v.y) * rect.height / 2, v.z]
    }
    const choices = []
    paths.forEach((path, edge) => {
      if (path.length < 2) return
      const a = path[0], b = path[path.length - 1]
      const midpoint = a.map((v, i) => (v + b[i]) / 2)
      const outward = midpoint.map((v, i) => v - center[i]), magnitude = Math.hypot(...outward)
      if (magnitude < 1e-6) return
      for (const t of [0.5, 0.35, 0.65]) {
        const anchor = a.map((v, i) => v + (b[i] - v) * t)
        const extended = anchor.map((v, i) => v + 5 * outward[i] / magnitude)
        const from = screen(anchor), to = screen(extended)
        const inside = p => p[0] > rect.left + 12 && p[0] < rect.right - 12 && p[1] > rect.top + 12 && p[1] < rect.bottom - 12 && p[2] >= -1 && p[2] <= 1
        if (inside(from) && inside(to) && document.elementFromPoint(from[0], from[1]) === canvas &&
            Math.hypot(to[0] - from[0], to[1] - from[1]) > 12)
          choices.push({ edge, from: from.slice(0, 2), to: to.slice(0, 2), anchor })
      }
    })
    return choices[0] ?? null
  })
  assert(target, 'No reachable boundary or outward drag in the actual camera view')
  report.target = target; persist()
  await page.screenshot({ path: join(out, 'before-drag.png') })
  const dragStart = async () => {
    await page.mouse.move(...target.from)
    await page.mouse.down()
    await page.waitForFunction(() => window.stripDragQa.useWorkspaceEditor.getState().snapshot?.gesture === 'strip', { timeout: 10000 })
    const capture = await page.evaluate(() => {
      const q = window.stripDragQa, strip = q.useWorkspaceEditor.getState().controller.getPanelState().strip
      return { id: window.stripQaPointer, captured: q.scene.layerHost().canvas.hasPointerCapture(window.stripQaPointer), selected: strip.selectedEdge }
    })
    assert(capture.captured && capture.selected === target.edge, `Pointer capture or selected edge incorrect: ${JSON.stringify(capture)}`)
    await page.mouse.move(...target.to, { steps: 8 })
    await page.waitForFunction(() => {
      const strip = window.stripDragQa.useWorkspaceEditor.getState().controller.getViewState().strip
      return strip && Math.hypot(...strip.delta) > 0.1
    }, { timeout: 10000 })
    const visible = await page.evaluate(() => {
      const q = window.stripDragQa, state = q.useWorkspaceEditor.getState().controller.getViewState()
      const group = q.scene.layerHost().partGroup.getObjectByName('tmar-edit-surface-strip')
      const selection = group?.getObjectByName('tmar-selected-strip-edge')
      let mesh
      group?.traverse(item => { if (item.isMesh && !item.isLine2 && item.geometry?.getAttribute('position')) mesh = item })
      const p = mesh?.geometry.getAttribute('position')
      return { delta: [...state.strip.delta], highlighted: !!selection, ghostVisible: !!mesh?.visible && mesh.material.opacity > 0,
        ghostOffset: p && p.count >= 3 ? [p.getX(2) - p.getX(1), p.getY(2) - p.getY(1), p.getZ(2) - p.getZ(1)] : null }
    })
    assert(visible.highlighted && visible.ghostVisible && visible.ghostOffset &&
      visible.ghostOffset.every((v, i) => Math.abs(v - visible.delta[i]) < 1e-4), `No matching visible preview: ${JSON.stringify(visible)}`)
    return visible
  }

  const canceled = await dragStart()
  report.dragPreview = canceled
  await page.screenshot({ path: join(out, 'drag-preview.png') })
  check(true, 'Pointer captured, selected edge highlighted, and live strip preview follows the drag')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => {
    const q = window.stripDragQa, s = q.useWorkspaceEditor.getState(), strip = s.controller?.getPanelState().strip
    return s.snapshot?.gesture === 'idle' && strip && !strip.pending && strip.delta.every(x => x === 0)
  }, { timeout: 10000 })
  const canceledState = await page.evaluate(() => {
    const q = window.stripDragQa, s = q.useWorkspaceEditor.getState(), strip = s.controller.getPanelState().strip
    return { captured: q.scene.layerHost().canvas.hasPointerCapture(window.stripQaPointer), hasResult: strip.hasResult,
      canUndo: strip.canUndo, previewFaces: s.controller.getViewState().preview.faceMeshes.length }
  })
  await page.mouse.up()
  check(!canceledState.captured && !canceledState.hasResult && !canceledState.canUndo && canceledState.previewFaces === 1,
    'Escape cancels the gesture, releases the pointer, and adds no undo frame')

  const committed = await dragStart()
  report.committedDelta = committed.delta; persist()
  await page.mouse.up()
  await page.waitForFunction(() => {
    const q = window.stripDragQa, s = q.useWorkspaceEditor.getState(), strip = s.controller?.getPanelState().strip
    return strip?.hasResult && !strip.pending && s.snapshot?.validation?.kind === 'valid'
  }, { timeout: 120000 })
  const result = await page.evaluate(() => {
    const q = window.stripDragQa, s = q.useWorkspaceEditor.getState(), strip = s.controller.getPanelState().strip
    return { captured: q.scene.layerHost().canvas.hasPointerCapture(window.stripQaPointer), addedArea: strip.addedArea,
      totalArea: strip.totalArea, canUndo: strip.canUndo, canRedo: strip.canRedo,
      previewFaces: s.controller.getViewState().preview.faceMeshes.length }
  })
  report.result = result
  check(!result.captured && result.previewFaces === 2 && result.addedArea > 0 && result.canUndo && !result.canRedo,
    'Release creates a validated two-face preview and one undo frame')
  await page.screenshot({ path: join(out, 'released-preview.png') })
  await page.click('[data-test=surface-strip-undo]')
  await page.waitForFunction(() => {
    const s = window.stripDragQa.useWorkspaceEditor.getState(), strip = s.controller?.getPanelState().strip
    return strip && !strip.hasResult && !strip.canUndo && strip.canRedo && s.controller.getViewState().preview.faceMeshes.length === 1
  }, { timeout: 30000 })
  check(true, 'Undo restores the original one-face preview')
  await page.click('[data-test=surface-strip-redo]')
  await page.waitForFunction(expected => {
    const s = window.stripDragQa.useWorkspaceEditor.getState(), strip = s.controller?.getPanelState().strip
    return strip?.hasResult && strip.canUndo && !strip.canRedo && s.snapshot?.validation?.kind === 'valid' &&
      s.controller.getViewState().preview.faceMeshes.length === 2 && Math.abs(strip.addedArea - expected) < 1e-7
  }, { timeout: 30000 }, result.addedArea)
  check(true, 'Redo restores the same validated extension and measured area')
  check(await page.evaluate(() => {
    const q = window.stripDragQa
    return q.useReverse.getState().bodies.length === 1 && q.useReverse.getState().bodies[0].id === q.id &&
      document.querySelectorAll('.viewport canvas').length === 1
  }), 'Original synthetic body and shared viewport remain present')
  check(app.consoleErrors.length === 0, 'No browser application errors')
  report.verdict = 'PASS'
} catch (error) {
  report.verdict = 'FAIL'; report.error = String(error?.stack ?? error)
  if (page) {
    try { await page.screenshot({ path: join(out, 'failure.png') }) } catch { /* Preserve original error. */ }
    try {
      report.diagnostics = await page.evaluate(() => {
        const q = window.stripDragQa, s = q?.useWorkspaceEditor.getState(), p = s?.controller?.getPanelState()
        return { snapshot: s?.snapshot, phase: s?.phase, message: p?.message, strip: p?.strip }
      })
    } catch { /* Browser or controller may be unavailable. */ }
  }
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  kernel?.[Symbol.dispose]()
  persist()
  console.log(JSON.stringify({ out, ...report }, null, 2))
}
