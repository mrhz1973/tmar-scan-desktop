// SPDX-License-Identifier: AGPL-3.0-only
// Isolated GUI test: release one direct whole-natural-boundary drag, Apply the
// CAD copy, Undo/Redo it, and save/reopen the synthetic project. OCCT validates
// the preserved source and edited copy after each state transition.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

assert.equal(process.env.SCANRULER_ISOLATED, '1', 'Set SCANRULER_ISOLATED=1 for the isolated QA app.')
const url = new URL(process.env.APP_URL ?? '')
assert.equal(url.href, 'http://127.0.0.1:17527/', 'Only the designated isolated QA host is permitted.')
const outputRoot = process.env.EDIT_SURFACE_QA_OUT
assert(outputRoot && isAbsolute(outputRoot), 'Set EDIT_SURFACE_QA_OUT to an absolute folder outside the checkout.')
const rel = relative(resolve(process.cwd()), resolve(outputRoot))
assert(rel && (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)), 'Evidence must stay outside the checkout.')

mkdirSync(resolve(outputRoot), { recursive: true })
const out = mkdtempSync(join(resolve(outputRoot), 'workspace-whole-boundary-history-roundtrip-'))
process.env.SHOT_DIR = out
const { OcctKernel } = await import('occt-wasm')
const kernel = await OcctKernel.init()
const solid = kernel.makeBox(20, 30, 10)
const solidFaces = kernel.getSubShapes(solid, 'face')
let inputStep
try {
  const face = solidFaces.find(candidate => Math.abs(kernel.getSurfaceArea(candidate) - 600) < 1e-7)
  assert(face, 'Synthetic 20 x 30 mm planar face was not found.')
  inputStep = kernel.exportStep(face)
} finally {
  solidFaces.forEach(face => kernel.release(face))
  kernel.release(solid)
}
const inputSha256 = createHash('sha256').update(inputStep).digest('hex')
writeFileSync(join(out, 'synthetic-open-sheet.step'), inputStep)
const report = {
  scope: 'isolated GUI boundary gesture, Apply, Undo/Redo, project save/reopen, and OCCT STEP readback',
  appUrl: url.href,
  fixture: { kind: 'single planar face from synthetic 20 x 30 x 10 mm box', inputSha256 },
  checks: [],
  limitations: ['Synthetic planar open sheet only.', 'Save and Load operate only on the synthetic project.', 'STEP checks compare validity, face count, and area; they are not a general surface-deviation audit.', 'No packaged desktop or QuickSurface parity claim.'],
  verdict: 'INCOMPLETE',
}
const check = (ok, label) => { assert(ok, label); report.checks.push(label); console.log('PASS', label) }
let browser, page

try {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
  assert(response.ok, `Isolated server returned HTTP ${response.status}.`)
  assert(/ScanRuler/i.test(await response.text()), 'QA port does not identify as ScanRuler.')
  const { launchApp } = await import('../../../scripts/e2e-lib.mjs')
  const app = await launchApp({ url: url.href, width: 1440, height: 1000, agentDataOk: false,
    userDataDir: join(out, 'owned-browser-profile'), protocolTimeout: 120000 })
  browser = app.browser
  page = app.page
  report.consoleErrors = app.consoleErrors
  page.on('dialog', dialog => dialog.accept())

  // Isolated host initialization follows e2e-workspace-integration. Subsequent
  // selection, direct-edge press/drag/release, and Apply use the actual UI.
  await page.evaluate(async stepText => {
    const { runCommand } = await import('/src/commands/registry.ts')
    const { useShell } = await import('/src/state/shellStore.ts')
    const { useReverse } = await import('/plugins/reverse/state/reStore.ts')
    const { reverseSession } = await import('/plugins/reverse/app/reSession.ts')
    const { sceneOf } = await import('/src/commands/host.ts')
    const { reSceneOf } = await import('/plugins/reverse/viewer/reScene.ts')
    const { useWorkspaceEditor } = await import('/src/plugins/workspaceEditors.ts')
    const { useHistory } = await import('/src/state/historyStore.ts')
    const { useStore } = await import('/src/state/store.ts')
    useStore.getState().setNavScheme('fusion')
    useShell.getState().setWorkspace('reverse')
    for (let i = 0; !reverseSession() && i < 500; i++) await new Promise(resolve => setTimeout(resolve, 20))
    if (!reverseSession()) throw Error('Isolated CAD session unavailable')
    await reverseSession().startKernel()
    await reverseSession().settled()
    await runCommand('reverse.import.step', { bytes: new TextEncoder().encode(stepText), name: 'synthetic-open-sheet.step' })
    await reverseSession().settled()
    const scene = sceneOf(), reverse = useReverse.getState(), id = reverse.bodies[0]?.id
    if (!scene || !id || reverse.bodies.length !== 1) throw Error('Synthetic sheet was not imported as one body')
    scene.fitToView()
    window.wholeBoundaryApplyQa = { runCommand, scene, reScene: reSceneOf(scene), useWorkspaceEditor,
      useReverse, useHistory, useStore, id, initialBodyCount: reverse.bodies.length,
      initialHistoryLength: useHistory.getState().past.length }
  }, inputStep)
  await page.waitForFunction(() => {
    const q = window.wholeBoundaryApplyQa
    return !!q?.reScene.bodyMeshes.get(q.id) && !q.useReverse.getState().building
  }, { timeout: 120000 })
  await page.waitForSelector('[data-test=feature-edit-surface]:enabled', { timeout: 60000 })
  await page.click('[data-test=feature-edit-surface]')
  await page.waitForSelector('[data-test=workspace-surface-parameters]', { timeout: 120000 })
  await page.waitForFunction(() => document.querySelectorAll('[data-test=surface-face] option').length === 2, { timeout: 60000 })
  await page.select('[data-test=surface-face]', '0')
  await page.waitForFunction(() => {
    const s = window.wholeBoundaryApplyQa.useWorkspaceEditor.getState(), panel = s.controller?.getPanelState()
    return s.snapshot?.validation?.kind === 'valid' && panel?.canFreeBoundary && !panel.calculating
  }, { timeout: 120000 })
  await page.click('[data-test=surface-free-boundary]')
  await page.waitForFunction(() => {
    const panel = window.wholeBoundaryApplyQa.useWorkspaceEditor.getState().controller?.getPanelState()
    return panel?.freeBoundary && panel.canMoveWholeBoundary && !panel.calculating
  }, { timeout: 120000 })

  // Make the gesture direction deterministic. The pointer itself still drives
  // the actual whole-boundary capture/preview/commit path.
  await page.select('[data-test=surface-drag-mode]', 'axis')
  await page.click('[data-test=surface-axis-2]')
  const dragMode = await page.$eval('[data-test=surface-drag-mode]', element => element.value)
  assert.equal(dragMode, 'axis')
  const wholeBoundary = await page.$('[data-test=surface-whole-boundary-drag]')
  assert(wholeBoundary && !(await wholeBoundary.evaluate(element => element.disabled)), 'Whole-boundary drag is unavailable')
  await wholeBoundary.click()
  await page.waitForFunction(() => window.wholeBoundaryApplyQa.useWorkspaceEditor.getState().controller?.getPanelState().wholeBoundaryDrag === 'U0')

  const before = await page.evaluate(async () => {
    const { wholeBoundaryIndices } = await import('/plugins/tmar-edit-surface/wholeBoundary.ts')
    const controller = window.wholeBoundaryApplyQa.useWorkspaceEditor.getState().controller
    const net = controller.getViewState().net
    return { net: structuredClone(net), ids: wholeBoundaryIndices(net, 'U0') }
  })
  const pick = await page.evaluate(async () => {
    const { wholeBoundaryPath } = await import('/plugins/tmar-edit-surface/wholeBoundary.ts')
    const q = window.wholeBoundaryApplyQa, host = q.scene.layerHost(), camera = host.camera()
    const rect = host.canvas.getBoundingClientRect(), group = host.partGroup
    group.updateWorldMatrix(true, true); camera.updateMatrixWorld(true)
    const path = wholeBoundaryPath(q.useWorkspaceEditor.getState().controller.getViewState().net, 'U0')
    const point = path[Math.floor(path.length / 2)]
    const p = camera.position.clone().set(...point).applyMatrix4(group.matrixWorld).project(camera)
    return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2,
      visible: Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.z) < 1,
      bounds: { left: rect.left + 6, right: rect.right - 6, top: rect.top + 6, bottom: rect.bottom - 6 } }
  })
  assert(pick.visible && pick.x > pick.bounds.left && pick.x < pick.bounds.right && pick.y > pick.bounds.top && pick.y < pick.bounds.bottom,
    'U0 boundary midpoint is not visible in the viewport')
  await page.mouse.move(pick.x, pick.y)
  await page.mouse.down({ button: 'left' })
  await page.waitForFunction(() => window.wholeBoundaryApplyQa.useWorkspaceEditor.getState().snapshot?.gesture === 'pole', { timeout: 30000 })
  await page.mouse.move(pick.x + 8, pick.y - 8, { steps: 5 })
  await page.waitForFunction(previous => {
    const controller = window.wholeBoundaryApplyQa.useWorkspaceEditor.getState().controller
    return controller.getViewState().net.poles.some((point, i) => point.some((v, axis) => Math.abs(v - previous.net.poles[i][axis]) > 1e-7))
  }, { timeout: 15000 }, before)
  await page.mouse.up({ button: 'left' })
  await page.waitForFunction(() => {
    const s = window.wholeBoundaryApplyQa.useWorkspaceEditor.getState(), panel = s.controller?.getPanelState()
    return s.snapshot?.gesture === 'idle' && s.snapshot?.validation?.kind === 'valid' && panel?.canUndo && !panel.calculating
  }, { timeout: 120000 })

  const afterGesture = await page.evaluate(previous => {
    const controller = window.wholeBoundaryApplyQa.useWorkspaceEditor.getState().controller
    const current = controller.getViewState().net, ids = previous.ids, selected = new Set(ids)
    const delta = current.poles[ids[0]].map((v, axis) => v - previous.net.poles[ids[0]][axis])
    const rowError = Math.max(...ids.flatMap(i => current.poles[i].map((v, axis) => Math.abs(v - previous.net.poles[i][axis] - delta[axis]))))
    const otherChange = Math.max(0, ...current.poles.flatMap((p, i) => selected.has(i) ? [] : p.map((v, axis) => Math.abs(v - previous.net.poles[i][axis]))))
    return { delta, displacement: Math.hypot(...delta), rowError, otherChange, canUndo: controller.getPanelState().canUndo }
  }, before)
  assert(afterGesture.displacement > 1e-4, 'Released edge gesture did not commit a measurable displacement')
  assert(afterGesture.rowError < 1e-7 && afterGesture.otherChange < 1e-8, 'Gesture did not translate only the complete selected natural boundary')
  check(true, `Released U0 drag committed one uniform boundary motion (${afterGesture.displacement.toPrecision(5)} mm)`)

  await page.waitForSelector('[data-test=workspace-editor-apply]:enabled', { timeout: 120000 })
  await page.click('[data-test=workspace-editor-apply]')
  await page.waitForFunction(() => window.wholeBoundaryApplyQa.useWorkspaceEditor.getState().phase === 'closed', { timeout: 120000 })
  const bodies = await page.evaluate(async () => {
    const q = window.wholeBoundaryApplyQa, state = q.useReverse.getState(), receipt = q.useWorkspaceEditor.getState().receipt
    if (!receipt?.createdBodyIds || receipt.createdBodyIds.length !== 1) throw Error('Apply did not return exactly one created CAD body')
    const ids = [q.id, receipt.createdBodyIds[0]]
    const steps = []
    for (const id of ids) {
      const answer = await q.runCommand('reverse.body.edit_source', { body: id })
      steps.push({ id, text: new TextDecoder().decode(answer.file.bytes) })
    }
    return { receipt, bodyCount: state.bodies.length, initialBodyCount: q.initialBodyCount, ids, steps,
      historyDelta: q.useHistory.getState().past.length - q.initialHistoryLength }
  })
  assert.equal(bodies.bodyCount, bodies.initialBodyCount + 1, 'Apply should publish exactly one isolated copy')
  assert.equal(bodies.historyDelta, 1, 'Apply should publish exactly one project history step')
  check(true, 'Apply published one CAD copy and one history step into the fresh synthetic project')

  const geometries = bodies.steps.map(item => {
    const shape = kernel.importStep(item.text), faces = kernel.getSubShapes(shape, 'face'), solids = kernel.getSubShapes(shape, 'solid')
    try {
      const area = faces.reduce((sum, face) => sum + kernel.getSurfaceArea(face), 0)
      return { id: item.id, valid: kernel.isValid(shape), faceCount: faces.length, solidCount: solids.length, area }
    } finally {
      faces.forEach(face => kernel.release(face))
      solids.forEach(body => kernel.release(body))
      kernel.release(shape)
    }
  })
  const [sourceGeometry, copyGeometry] = geometries
  check(sourceGeometry.valid && copyGeometry.valid && sourceGeometry.faceCount === 1 && copyGeometry.faceCount === 1,
    'Source and applied STEP copy both reimport as valid one-face CAD shapes')
  check(Math.abs(sourceGeometry.area - copyGeometry.area) > 1e-6,
    `Applied copy differs geometrically from its preserved source (area ${sourceGeometry.area} -> ${copyGeometry.area} mm²)`)

  const history = async () => page.evaluate(async () => {
    const q = window.wholeBoundaryApplyQa, state = q.useReverse.getState(), steps = []
    for (const body of state.bodies) {
      const answer = await q.runCommand('reverse.body.edit_source', { body: body.id })
      steps.push({ id: body.id, text: new TextDecoder().decode(answer.file.bytes) })
    }
    return { count: state.bodies.length, steps }
  })
  const geometryOf = items => items.map(item => {
    const shape = kernel.importStep(item.text), faces = kernel.getSubShapes(shape, 'face'), solids = kernel.getSubShapes(shape, 'solid')
    try {
      return { valid: kernel.isValid(shape), faceCount: faces.length, solidCount: solids.length,
        area: faces.reduce((sum, face) => sum + kernel.getSurfaceArea(face), 0) }
    } finally {
      faces.forEach(face => kernel.release(face))
      solids.forEach(body => kernel.release(body))
      kernel.release(shape)
    }
  })
  const historyRevision = async () => page.evaluate(() => window.wholeBoundaryApplyQa.useHistory.getState().revision)
  const waitHistory = async revision => page.waitForFunction(previous => {
    const q = window.wholeBoundaryApplyQa, history = q.useHistory.getState()
    return history.revision > previous && !history.restoring && !q.useReverse.getState().building
  }, { timeout: 120000 }, revision)

  let revision = await historyRevision()
  await page.click('[data-test=undo]')
  await waitHistory(revision)
  let state = await history()
  const undoGeometry = geometryOf(state.steps)
  check(state.count === 1 && undoGeometry[0]?.valid && undoGeometry[0]?.faceCount === 1
      && Math.abs(undoGeometry[0].area - 600) < 1e-5,
    'Undo removes the applied copy and preserves the original 600 mm² source face')

  revision = await historyRevision()
  await page.click('[data-test=redo]')
  await waitHistory(revision)
  state = await history()
  const redoGeometry = geometryOf(state.steps)
  check(state.count === 2 && redoGeometry.length === 2 && redoGeometry.every(item => item.valid && item.faceCount === 1)
      && Math.abs(redoGeometry[0].area - sourceGeometry.area) < 1e-5
      && Math.abs(redoGeometry[1].area - copyGeometry.area) < 1e-5,
    'Redo restores both the unchanged source and the edited CAD copy')

  // Save through the visible command; capture its synthetic download in-page
  // so no real download location or user file is involved.
  await page.evaluate(() => {
    window.wholeBoundaryApplyQa.savedBlob = null
    const originalCreate = URL.createObjectURL, originalClick = HTMLAnchorElement.prototype.click
    window.wholeBoundaryApplyQa.restoreSaveHooks = () => {
      URL.createObjectURL = originalCreate
      HTMLAnchorElement.prototype.click = originalClick
    }
    URL.createObjectURL = blob => { window.wholeBoundaryApplyQa.savedBlob = blob; return 'blob:whole-boundary-qa' }
    HTMLAnchorElement.prototype.click = function () {
      if (this.download?.endsWith('.scanruler')) return
      return originalClick.call(this)
    }
  })
  try {
    await page.click('[data-test=save-project]')
    await page.waitForFunction(() => window.wholeBoundaryApplyQa.savedBlob instanceof Blob, { timeout: 120000 })
    const savedBytes = await page.evaluate(async () => Array.from(new Uint8Array(await window.wholeBoundaryApplyQa.savedBlob.arrayBuffer())))
    const projectPath = join(out, 'synthetic-whole-boundary.scanruler')
    writeFileSync(projectPath, Uint8Array.from(savedBytes))
    report.savedProject = { name: 'synthetic-whole-boundary.scanruler', bytes: savedBytes.length,
      sha256: createHash('sha256').update(Uint8Array.from(savedBytes)).digest('hex') }
  } finally {
    await page.evaluate(() => window.wholeBoundaryApplyQa.restoreSaveHooks?.())
  }
  const projectInput = await page.$('[data-test="project-input"]')
  assert(projectInput, 'Project file input is missing from the host UI')
  await projectInput.uploadFile(join(out, 'synthetic-whole-boundary.scanruler'))
  await page.waitForFunction(() => {
    const q = window.wholeBoundaryApplyQa
    return q.useReverse.getState().bodies.length === 2 && !q.useReverse.getState().building
      && q.useStore.getState().statusText.startsWith('Project opened —')
  }, { timeout: 120000 })
  // Opening a saved project clears history and rebuilds CAD from its project archive.
  await page.waitForFunction(() => window.wholeBoundaryApplyQa.useHistory.getState().past.length === 0, { timeout: 30000 })
  const reopened = await history()
  const reopenedGeometry = geometryOf(reopened.steps)
  check(reopened.count === 2 && reopenedGeometry.length === 2
      && reopenedGeometry.every(item => item.valid && item.faceCount === 1)
      && Math.abs(reopenedGeometry[0].area - sourceGeometry.area) < 1e-5
      && Math.abs(reopenedGeometry[1].area - copyGeometry.area) < 1e-5,
    'Saved project reopens with the original unchanged and the applied CAD copy geometrically preserved')
  report.historyRoundTrip = { afterUndo: undoGeometry, afterRedo: redoGeometry, afterReopen: reopenedGeometry }
  report.gesture = afterGesture
  report.geometries = geometries
  report.verdict = 'PASS_BOUNDED_GUI_HISTORY_ROUNDTRIP'
  assert.deepEqual(app.consoleErrors, [], 'Browser reported application errors')
  check(true, 'No browser application errors')
} catch (error) {
  report.error = String(error?.stack ?? error)
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  kernel[Symbol.dispose]()
  writeFileSync(join(out, 'result.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ out, ...report }))
}
