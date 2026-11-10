// SPDX-License-Identifier: AGPL-3.0-only
// Minimal isolated GUI proof of the tangent-plane projection on selected poles.
// Synthetic STEP only; a viewport click chooses the tangent point, then one Undo.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

assert.equal(process.env.SCANRULER_ISOLATED, '1', 'Set SCANRULER_ISOLATED=1 for isolated QA.')
const url = new URL(process.env.APP_URL ?? '')
assert.equal(url.href, 'http://127.0.0.1:17527/', 'Only the designated isolated QA host is permitted.')
const outputRoot = process.env.EDIT_SURFACE_QA_OUT
assert(outputRoot && isAbsolute(outputRoot), 'Set EDIT_SURFACE_QA_OUT to an absolute folder outside the checkout.')
const rel = relative(resolve(process.cwd()), resolve(outputRoot))
assert(rel && (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)), 'Evidence must stay outside the checkout.')
mkdirSync(resolve(outputRoot), { recursive: true })
const out = mkdtempSync(join(resolve(outputRoot), 'workspace-tangent-plane-gui-'))
process.env.SHOT_DIR = out

const { OcctKernel } = await import('occt-wasm')
const { launchApp } = await import('../../../scripts/e2e-lib.mjs')
const kernel = await OcctKernel.init()
const geometrySignature = source => {
  const shape = kernel.importStep(source), faces = kernel.getSubShapes(shape, 'face'), solids = kernel.getSubShapes(shape, 'solid')
  const round = value => Number(value.toFixed(8))
  const bounds = box => [box.xmin, box.ymin, box.zmin, box.xmax, box.ymax, box.zmax].map(round)
  try {
    const faceMetrics = faces.map(face => ({ kind: kernel.surfaceType(face), area: round(kernel.getSurfaceArea(face)),
      bounds: bounds(kernel.getBoundingBox(face)) })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    return { valid: kernel.isValid(shape), solidCount: solids.length, faceCount: faces.length,
      volume: round(kernel.getVolume(shape)), bounds: bounds(kernel.getBoundingBox(shape)), faceMetrics }
  } finally {
    faces.forEach(face => kernel.release(face)); solids.forEach(solid => kernel.release(solid)); kernel.release(shape)
  }
}
const box = kernel.makeBox(20, 30, 10)
let step
try { step = kernel.exportStep(box) } finally { kernel.release(box) }
const inputSha256 = createHash('sha256').update(step).digest('hex')
writeFileSync(join(out, 'synthetic-box.step'), step)
const report = {
  scope: 'isolated GUI click on a live CAD face, tangent-plane projection of one selected pole, and one draft Undo',
  appUrl: url.href,
  fixture: { kind: 'synthetic 20 x 30 x 10 mm STEP box', inputSha256 },
  checks: [],
  limitations: ['STEP is synthetic; CAD import and point-selection setup are harness-driven.',
    'The tangent-plane command and face-point choice use an actual viewport click.',
    'No host Apply, project save, user CAD, scan, packaged desktop, or independent physical-scale claim.'],
  verdict: 'INCOMPLETE',
}
const check = (ok, label) => { assert(ok, label); report.checks.push(label); console.log('PASS', label) }
let browser, page

try {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
  assert(response.ok, `Isolated host returned HTTP ${response.status}.`)
  assert(/ScanRuler/i.test(await response.text()), 'Isolated host does not identify as ScanRuler.')
  const app = await launchApp({ url: url.href, width: 1440, height: 1000, agentDataOk: false,
    userDataDir: join(out, 'owned-browser-profile'), protocolTimeout: 120000 })
  browser = app.browser; page = app.page; report.consoleErrors = app.consoleErrors
  page.on('dialog', dialog => dialog.accept())

  await page.evaluate(async stepText => {
    const { runCommand } = await import('/src/commands/registry.ts')
    const { useShell } = await import('/src/state/shellStore.ts')
    const { useReverse } = await import('/plugins/reverse/state/reStore.ts')
    const { reverseSession } = await import('/plugins/reverse/app/reSession.ts')
    const { sceneOf } = await import('/src/commands/host.ts')
    const { reSceneOf } = await import('/plugins/reverse/viewer/reScene.ts')
    const { useWorkspaceEditor } = await import('/src/plugins/workspaceEditors.ts')
    const { useStore } = await import('/src/state/store.ts')
    useStore.getState().setNavScheme('fusion')
    useShell.getState().setWorkspace('reverse')
    for (let i = 0; !reverseSession() && i < 500; i++) await new Promise(resolve => setTimeout(resolve, 20))
    if (!reverseSession()) throw Error('Isolated CAD session unavailable')
    await reverseSession().startKernel(); await reverseSession().settled()
    await runCommand('reverse.import.step', { bytes: new TextEncoder().encode(stepText), name: 'synthetic-box.step' })
    await reverseSession().settled()
    const scene = sceneOf(), reverse = useReverse.getState(), sourceId = reverse.bodies[0]?.id
    if (!scene || !sourceId || reverse.bodies.length !== 1) throw Error('Synthetic STEP did not import as one isolated CAD body')
    const source = await runCommand('reverse.body.edit_source', { body: sourceId })
    scene.fitToView(); scene.viewFrom('top')
    window.tangentPlaneQa = { runCommand, scene, reScene: reSceneOf(scene), useWorkspaceEditor,
      useReverse, useStore, sourceId, sourceStep: new TextDecoder().decode(source.file.bytes) }
  }, step)
  await page.waitForFunction(() => {
    const q = window.tangentPlaneQa
    return !!q.reScene.bodyMeshes.get(q.sourceId) && !q.useReverse.getState().building && !q.useStore.getState().busy
  }, { timeout: 120000 })
  await page.waitForSelector('[data-test=feature-edit-surface]:enabled', { timeout: 60000 })
  await page.click('[data-test=feature-edit-surface]')
  await page.waitForSelector('[data-test=workspace-surface-parameters]', { timeout: 120000 })
  const faceIndex = await page.evaluate(() => {
    const c = window.tangentPlaneQa.useWorkspaceEditor.getState().controller
    const meshes = c.getViewState().preview.faceMeshes
    const face = c.getPanelState().faces.find(item => item.kind === 'plane' && !item.reason &&
      [...meshes[item.index].positions].filter((_, i) => i % 3 === 2).every(z => Math.abs(z - 10) < 1e-4))
    if (!face) throw Error('Synthetic top plane was not found')
    return face.index
  })
  await page.select('[data-test=surface-face]', String(faceIndex))
  await page.waitForFunction(() => {
    const s = window.tangentPlaneQa.useWorkspaceEditor.getState(), p = s.controller?.getPanelState()
    return s.snapshot?.validation?.kind === 'valid' && !!p?.net && !p.calculating
  }, { timeout: 120000 })
  await page.click('[data-test=surface-refine-both]')
  await page.waitForFunction(() => {
    const s = window.tangentPlaneQa.useWorkspaceEditor.getState(), p = s.controller?.getPanelState()
    return s.snapshot?.validation?.kind === 'valid' && !!p?.net && !p.calculating && p.net.nu >= 3 && p.net.nv >= 3
  }, { timeout: 120000 })
  await page.select('[data-test=surface-selection-mode]', 'points')

  const target = await page.evaluate(() => {
    const q = window.tangentPlaneQa, c = q.useWorkspaceEditor.getState().controller, v = c.getViewState(), net = v.net
    const candidates = net.poles.flatMap((pole, id) => {
      const u = Math.floor(id / net.nv), w = id % net.nv
      return u > 0 && u < net.nu - 1 && w > 0 && w < net.nv - 1 && !v.locked.includes(id) ? [{ id, pole }] : []
    }).sort((a, b) => Math.hypot(a.pole[0] - 10, a.pole[1] - 15) - Math.hypot(b.pole[0] - 10, b.pole[1] - 15))
    const chosen = candidates[0]
    if (!chosen) throw Error('No editable interior pole is available')
    const host = q.scene.layerHost(), canvas = host.canvas, rect = canvas.getBoundingClientRect(), camera = host.camera(), group = host.partGroup
    group.updateWorldMatrix(true, true); camera.updateMatrixWorld(true)
    const projected = group.position.clone().set(...chosen.pole).applyMatrix4(group.matrixWorld).project(camera)
    const x = rect.left + (projected.x + 1) * rect.width / 2, y = rect.top + (1 - projected.y) * rect.height / 2
    const finite = Number.isFinite(projected.x) && Number.isFinite(projected.y) && Number.isFinite(projected.z)
    const visible = finite && Math.abs(projected.z) < 1 && x > rect.left + 12 && x < rect.right - 12
      && y > rect.top + 12 && y < rect.bottom - 12 && document.elementFromPoint(x, y) === canvas
    return { id: chosen.id, pole: chosen.pole, x, y, visible, canvas: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } }
  })
  report.selectedPoleCandidate = target
  assert(target.visible, `Interior control point is not directly clickable: ${JSON.stringify(target)}`)
  await page.mouse.click(target.x, target.y)
  await page.waitForFunction(id => {
    const p = window.tangentPlaneQa.useWorkspaceEditor.getState().controller?.getPanelState()
    return p?.selected?.length === 1 && p.selected[0] === id
  }, { timeout: 30000 }, target.id)

  await page.select('[data-test=surface-drag-mode]', 'axis')
  await page.click('[data-test=surface-axis-2]')
  await page.$eval('[data-test=surface-distance]', element => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, '0.4')
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.click('[data-test=surface-move]')
  await page.waitForFunction(() => {
    const s = window.tangentPlaneQa.useWorkspaceEditor.getState(), p = s.controller?.getPanelState()
    return s.snapshot?.validation?.kind === 'valid' && !p?.calculating && !p?.busy
  }, { timeout: 120000 })
  const beforeTangent = await page.evaluate(() => {
    const c = window.tangentPlaneQa.useWorkspaceEditor.getState().controller, p = c.getPanelState()
    return { net: structuredClone(p.net), selected: [...p.selected], historyRevision: c.getSnapshot().historyRevision,
      previewRevision: c.getViewState().preview.previewRevision, message: p.message }
  })
  assert.deepEqual(beforeTangent.selected, [target.id], 'Exactly one free pole must be selected for projection.')
  assert(Math.abs(beforeTangent.net.poles[target.id][2] - target.pole[2]) > 0.1, 'Selected pole did not acquire the controlled normal offset.')

  await page.click('[data-test=surface-point-tangent-plane]')
  await page.waitForFunction(() => window.tangentPlaneQa.useWorkspaceEditor.getState().controller?.getPanelState().surfaceTarget === 'tangent-plane',
    { timeout: 30000 })
  // Instrument the read-only point-pick result while leaving the original UI
  // callback in place. This records the point the real viewport raycaster chose.
  await page.evaluate(() => {
    const q = window.tangentPlaneQa, c = q.useWorkspaceEditor.getState().controller
    const original = c.pickTangentPlane.bind(c)
    c.pickTangentPlane = async point => {
      const revision = c.getViewState().preview.previewRevision
      const pin = await c.runtime.worker.ask({ action: 'notePick', point, previewRevision: revision })
      q.tangentPick = { point, pin }
      return original(point)
    }
  })
  const pick = await page.evaluate(() => {
    const q = window.tangentPlaneQa, c = q.useWorkspaceEditor.getState().controller, view = c.getViewState()
    const preview = view.preview, mesh = preview?.faceMeshes[view.face]
    if (!mesh) throw Error(`Current face preview mesh missing (face=${view.face}, previewFaces=${preview?.faceMeshes?.length ?? 0}).`)
    const host = q.scene.layerHost(), canvas = host.canvas
    const rect = canvas.getBoundingClientRect(), camera = host.camera(), group = host.partGroup
    group.updateWorldMatrix(true, true); camera.updateMatrixWorld(true)
    const positions = mesh.positions, indices = mesh.indices, choices = []
    for (let i = 0; i < indices.length; i += 3) {
      const points = [indices[i], indices[i + 1], indices[i + 2]].map(index => [positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]])
      const local = [0, 1, 2].map(axis => points.reduce((sum, point) => sum + point[axis] / 3, 0))
      const p = group.position.clone().set(...local).applyMatrix4(group.matrixWorld).project(camera)
      const x = rect.left + (p.x + 1) * rect.width / 2, y = rect.top + (1 - p.y) * rect.height / 2
      const visible = Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) && Math.abs(p.z) < 1
        && x > rect.left + 12 && x < rect.right - 12 && y > rect.top + 12 && y < rect.bottom - 12
        && document.elementFromPoint(x, y) === canvas
      if (visible) choices.push({ local, x, y, z: p.z })
    }
    const center = { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 }
    choices.sort((a, b) => Math.hypot(a.x - center.x, a.y - center.y) - Math.hypot(b.x - center.x, b.y - center.y))
    return { point: choices[0] ?? null, visibleTriangleCount: choices.length, canvasCount: document.querySelectorAll('.viewport canvas').length }
  })
  report.viewportPoint = pick
  assert(pick.point && pick.visibleTriangleCount > 0 && pick.canvasCount === 1, 'No visible real CAD face point is available for the tangent-plane click.')
  await page.mouse.click(pick.point.x, pick.point.y)
  await page.waitForFunction(() => {
    const s = window.tangentPlaneQa.useWorkspaceEditor.getState(), p = s.controller?.getPanelState()
    return !p?.busy && !p?.calculating && p?.surfaceTarget === null && s.snapshot?.validation?.kind === 'valid'
  }, { timeout: 120000 })

  const projected = await page.evaluate(() => {
    const q = window.tangentPlaneQa, c = q.useWorkspaceEditor.getState().controller, p = c.getPanelState()
    return { net: structuredClone(p.net), selected: [...p.selected], message: p.message,
      historyRevision: c.getSnapshot().historyRevision, pin: q.tangentPick }
  })
  assert(projected.pin?.point && projected.pin?.pin?.at && projected.pin?.pin?.normal, 'Viewport click did not resolve to a CAD surface point and normal.')
  assert.match(projected.message ?? '', /Poli proiettati sul piano tangente/i, `Tangent-plane operation did not report projection: ${projected.message}`)
  assert.equal(projected.historyRevision, beforeTangent.historyRevision + 1, 'Projection must create one undoable edit.')
  assert.deepEqual(projected.selected, [target.id])
  const normal = projected.pin.pin.normal, at = projected.pin.pin.at
  const normalLength = Math.hypot(...normal), normalized = normal.map(value => value / normalLength)
  const selectedPole = projected.net.poles[target.id]
  const planeResidual = Math.abs(selectedPole.reduce((sum, value, axis) => sum + (value - at[axis]) * normalized[axis], 0))
  assert(planeResidual < 1e-7, `Selected pole is not on the chosen tangent plane: residual ${planeResidual} mm.`)
  for (let i = 0; i < beforeTangent.net.poles.length; i++) {
    if (i !== target.id) assert.deepEqual(projected.net.poles[i], beforeTangent.net.poles[i], `Unselected pole ${i} changed.`)
  }
  assert(Math.hypot(...selectedPole.map((value, axis) => value - beforeTangent.net.poles[target.id][axis])) > 0.01,
    'Tangent-plane operation did not move the selected pole.')
  report.projection = { pickedPoint: projected.pin.point, tangentPlaneAt: at, tangentPlaneNormal: normal,
    selectedPole: target.id, residualMm: planeResidual, changedPoleCount: 1 }
  check(true, 'Actual face click projects the single selected pole onto its tangent plane; every other pole is unchanged')

  await page.click('[data-test=surface-undo]')
  await page.waitForFunction(original => {
    const s = window.tangentPlaneQa.useWorkspaceEditor.getState(), p = s.controller?.getPanelState()
    return s.snapshot?.validation?.kind === 'valid' && !p?.calculating && p?.canRedo
      && JSON.stringify(p.net.poles) === JSON.stringify(original.poles)
  }, { timeout: 120000 }, beforeTangent.net)
  const sourceAfter = await page.evaluate(async () => {
    const q = window.tangentPlaneQa, answer = await q.runCommand('reverse.body.edit_source', { body: q.sourceId })
    return { bodyCount: q.useReverse.getState().bodies.length,
      sourceStep: new TextDecoder().decode(answer.file.bytes) }
  })
  assert.equal(sourceAfter.bodyCount, 1, 'Draft Undo must leave the isolated source body as the only body.')
  const sourceBeforeText = await page.evaluate(() => window.tangentPlaneQa.sourceStep)
  const sourceGeometryBefore = geometrySignature(sourceBeforeText), sourceGeometryAfter = geometrySignature(sourceAfter.sourceStep)
  assert(sourceGeometryBefore.valid && sourceGeometryAfter.valid, 'Source STEP must remain a valid CAD shape before and after Undo.')
  assert.equal(sourceGeometryBefore.solidCount, 1, 'Synthetic source must contain one solid.')
  assert.equal(sourceGeometryAfter.solidCount, sourceGeometryBefore.solidCount, 'Undo must preserve source solid count.')
  assert.equal(sourceGeometryAfter.faceCount, sourceGeometryBefore.faceCount, 'Undo must preserve source face count.')
  assert.deepEqual(sourceGeometryAfter, sourceGeometryBefore, 'Undo must preserve source bounds, volume and per-face geometry.')
  report.sourceGeometry = { before: sourceGeometryBefore, after: sourceGeometryAfter, unchanged: true }
  assert.deepEqual(app.consoleErrors, [], 'No application console errors')
  check(true, 'One Undo restores the exact pre-projection net; OCCT confirms the source solid, faces and geometry are unchanged')
  report.verdict = 'PASS_BOUNDED_GUI_TANGENT_PLANE'
} catch (error) {
  report.error = String(error?.stack ?? error)
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  kernel[Symbol.dispose]()
  writeFileSync(join(out, 'result.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ out, ...report }))
}
