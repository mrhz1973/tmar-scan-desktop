// SPDX-License-Identifier: AGPL-3.0-only
// Isolated GUI probe: whole-face Locale/N drag on a pinned curved sheet,
// host Apply, project Undo/Redo, and synthetic project save/reopen.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

assert.equal(process.env.SCANRULER_ISOLATED, '1', 'Requires the isolated QA app.')
const url = new URL(process.env.APP_URL ?? '')
assert.equal(url.href, 'http://127.0.0.1:17527/', 'Only the designated isolated QA origin is permitted.')
const outputRoot = process.env.EDIT_SURFACE_QA_OUT
assert(outputRoot && isAbsolute(outputRoot), 'Evidence requires an absolute external output directory.')
const rel = relative(resolve(process.cwd()), resolve(outputRoot))
assert(rel && (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)), 'Evidence must stay outside the checkout.')

const fixture = process.env.WHOLE_FACE_QA_STEP || new URL('../evidence/free-boundary/compiled-20261103/moved.step', import.meta.url)
const input = readFileSync(fixture)
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const expectedSha = '61e1e624a432089e613cc9b744a7c883ccee3cd79ba459f0ef1c5c159419741f'
assert.equal(sha(input), expectedSha, 'Only the prequalified curved synthetic STEP may be used.')
mkdirSync(resolve(outputRoot), { recursive: true })
const out = mkdtempSync(join(resolve(outputRoot), 'workspace-whole-face-local-history-roundtrip-gui-'))
process.env.SHOT_DIR = out

const report = {
  scope: 'Pinned synthetic curved open sheet; UI whole-face Locale/N drag, host Apply, project Undo/Redo, and save/reopen',
  fixture: { source: process.env.WHOLE_FACE_QA_STEP ? 'environment override' : 'repository fixture', sha256: expectedSha },
  checks: [], verdict: 'INCOMPLETE',
  limitations: [
    'One synthetic B-spline sheet only; no real scan or solid-face qualification.',
    'Pointer input is automated and does not qualify physical mouse behavior.',
    'One synthetic open B-spline sheet only; host translation is qualified by OCCT topology, area, bounds, and project snapshot, not by general surface deviation.',
    'No packaged build, real scan, solid-face, or QuickSurface parity claim.',
    'Corner comparison uses the existing net frame at pole 0 as the former corner-associated direction.',
  ],
}
const check = (ok, label) => { assert(ok, label); report.checks.push(label) }
let browser, page, kernel

try {
  // Read-only CAD preflight: pin the topology and compute candidate point
  // normals. The GUI stage later refuses unless the projected ray is unique.
  const { OcctKernel } = await import('occt-wasm')
  kernel = await OcctKernel.init()
  const geometrySignature = stepText => {
    const shape = kernel.importStep(stepText), faces = kernel.getSubShapes(shape, 'face'), solids = kernel.getSubShapes(shape, 'solid')
    const round = value => Number(value.toFixed(7)), box = kernel.getBoundingBox(shape)
    const bounds = [box.xmin, box.ymin, box.zmin, box.xmax, box.ymax, box.zmax].map(round)
    try { return { valid: kernel.isValid(shape), faceCount: faces.length, solidCount: solids.length,
      surfaceTypes: faces.map(face => kernel.surfaceType(face)),
      area: round(faces.reduce((sum, face) => sum + kernel.getSurfaceArea(face), 0)), bounds } }
    finally { faces.forEach(face => kernel.release(face)); solids.forEach(solid => kernel.release(solid)); kernel.release(shape) }
  }
  const sameGeometry = (actual, expected, label) => {
    assert.equal(actual.valid, expected.valid, `${label}: validity differs`)
    assert.equal(actual.faceCount, expected.faceCount, `${label}: face count differs`)
    assert.equal(actual.solidCount, expected.solidCount, `${label}: solid count differs`)
    assert.deepEqual(actual.surfaceTypes, expected.surfaceTypes, `${label}: surface types differ`)
    assert(Math.abs(actual.area - expected.area) <= 1e-5, `${label}: area differs (${actual.area} vs ${expected.area})`)
    assert(actual.bounds.every((value, i) => Math.abs(value - expected.bounds[i]) <= 2e-4),
      `${label}: bounds differ (${actual.bounds} vs ${expected.bounds})`)
  }
  const source = kernel.importStep(input.toString('utf8'))
  const faces = kernel.getSubShapes(source, 'face'), solids = kernel.getSubShapes(source, 'solid')
  let candidates = []
  try {
    assert(kernel.isValid(source), 'Pinned STEP must import as valid CAD.')
    assert.equal(faces.length, 1, 'Fixture must contain exactly one natural face.')
    assert.equal(solids.length, 0, 'Fixture must remain an open sheet, not a solid.')
    assert.equal(kernel.surfaceType(faces[0]), 'bspline', 'Fixture must be a curved B-spline face.')
    const bounds = kernel.uvBounds(faces[0]), orientation = kernel.shapeOrientation(faces[0])
    assert(orientation === 'forward' || orientation === 'reverse', 'Unsupported face orientation.')
    const orientedNormal = (u, v) => {
      const raw = kernel.surfaceNormal(faces[0], u, v)
      let n = [raw.x, raw.y, raw.z]
      if (orientation === 'reverse') n = n.map(x => -x)
      const length = Math.hypot(...n)
      assert(Number.isFinite(length) && length > 1e-12, 'CAD normal is singular at a candidate UV.')
      return n.map(x => x / length)
    }
    const cornerU = bounds.uMin + .02 * (bounds.uMax - bounds.uMin)
    const cornerV = bounds.vMin + .02 * (bounds.vMax - bounds.vMin)
    assert.equal(kernel.classifyPointOnFace(faces[0], cornerU, cornerV), 'in', 'Corner comparison sample must be interior.')
    const cornerNormal = orientedNormal(cornerU, cornerV)
    for (const fu of [.23, .37, .63, .77]) for (const fv of [.23, .37, .63, .77]) {
      const u = bounds.uMin + fu * (bounds.uMax - bounds.uMin)
      const v = bounds.vMin + fv * (bounds.vMax - bounds.vMin)
      if (kernel.classifyPointOnFace(faces[0], u, v) !== 'in') continue
      const p = kernel.pointOnSurface(faces[0], u, v), normal = orientedNormal(u, v)
      const angle = Math.acos(Math.max(-1, Math.min(1, normal.reduce((s, x, i) => s + x * cornerNormal[i], 0)))) * 180 / Math.PI
      candidates.push({ u, v, point: [p.x, p.y, p.z], normal, angleToCornerCadNormalDeg: angle })
    }
    candidates.sort((a, b) => b.angleToCornerCadNormalDeg - a.angleToCornerCadNormalDeg)
    assert(candidates.length && candidates[0].angleToCornerCadNormalDeg >= 5,
      'Fixture does not provide a stable interior normal distinguishable from the corner sample.')
    report.cadPreflight = { faceCount: faces.length, solidCount: solids.length, surface: 'bspline',
      selectedCandidate: candidates[0], candidateCount: candidates.length }
  } finally {
    faces.forEach(face => kernel.release(face)); solids.forEach(solid => kernel.release(solid)); kernel.release(source)
  }

  const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
  assert(response.ok && /ScanRuler/i.test(await response.text()), 'QA origin must identify as ScanRuler.')
  const { launchApp } = await import('../../../scripts/e2e-lib.mjs')
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
    const { useHistory } = await import('/src/state/historyStore.ts')
    const { useStore } = await import('/src/state/store.ts')
    useStore.getState().setNavScheme('fusion')
    useShell.getState().setWorkspace('reverse')
    for (let i = 0; !reverseSession() && i < 500; i++) await new Promise(resolve => setTimeout(resolve, 20))
    if (!reverseSession()) throw Error('Isolated CAD session unavailable')
    await reverseSession().startKernel(); await reverseSession().settled()
    if (useReverse.getState().bodies.length) throw Error('Fresh isolated project required; refusing existing bodies')
    await runCommand('reverse.import.step', { bytes: new TextEncoder().encode(stepText), name: 'pinned-curved-open-sheet.step' })
    await reverseSession().settled()
    const scene = sceneOf(), id = useReverse.getState().bodies[0]?.id
    if (!scene || !id || useReverse.getState().bodies.length !== 1) throw Error('Expected one imported fixture body')
    scene.fitToView()
    const source = await runCommand('reverse.body.edit_source', { body: id })
    window.wholeFaceLocalQa = { runCommand, scene, reScene: reSceneOf(scene), useWorkspaceEditor, useReverse,
      useHistory, useStore, id, sourceStep: new TextDecoder().decode(source.file.bytes),
      initialBodyCount: useReverse.getState().bodies.length, initialHistoryLength: useHistory.getState().past.length }
  }, input.toString('utf8'))
  await page.waitForFunction(() => {
    const q = window.wholeFaceLocalQa
    return !!q?.reScene.bodyMeshes.get(q.id) && !q.useReverse.getState().building
  }, { timeout: 120000 })
  await page.waitForSelector('[data-test=feature-edit-surface]:enabled', { timeout: 60000 })
  await page.click('[data-test=feature-edit-surface]')
  await page.waitForSelector('[data-test=workspace-surface-parameters]', { timeout: 120000 })
  await page.waitForFunction(() => document.querySelectorAll('[data-test=surface-face] option').length === 2, { timeout: 60000 })
  await page.select('[data-test=surface-face]', '0')
  await page.waitForFunction(() => {
    const s = window.wholeFaceLocalQa.useWorkspaceEditor.getState(), p = s.controller?.getPanelState()
    return s.snapshot?.validation?.kind === 'valid' && p?.canFreeBoundary && !p.calculating && !p.busy
  }, { timeout: 120000 })
  await page.click('[data-test=surface-free-boundary]')
  await page.waitForFunction(() => {
    const s = window.wholeFaceLocalQa.useWorkspaceEditor.getState(), p = s.controller?.getPanelState()
    return p?.freeBoundary === true && p?.canMoveWholeFace === true && !p.calculating && !p.busy
  }, { timeout: 120000 })
  await page.select('[data-test=surface-drag-mode]', 'local')
  await page.click('[data-test=surface-axis-2]')
  await page.waitForFunction(() => {
    const p = window.wholeFaceLocalQa.useWorkspaceEditor.getState().controller?.getPanelState()
    return p?.dragMode === 'local' && p?.axis === 2
  }, { timeout: 30000 })
  const checkbox = await page.$('[data-test=surface-whole-face-drag]')
  assert(checkbox && !(await checkbox.evaluate(e => e.disabled)), 'Whole-face checkbox must be enabled for this open sheet.')
  await checkbox.click()
  await page.waitForFunction(() => {
    const p = window.wholeFaceLocalQa.useWorkspaceEditor.getState().controller?.getPanelState()
    return p?.wholeFaceDrag === true && document.querySelector('[data-test=surface-whole-face-drag]')?.checked === true
  }, { timeout: 30000 })
  check(true, 'UI enables Faces-only mode and selects Locale/N')

  const ready = await page.evaluate(async candidates => {
    const q = window.wholeFaceLocalQa, c = q.useWorkspaceEditor.getState().controller
    const p = c.getPanelState(), view = c.getViewState(), host = q.scene.layerHost(), net = view.net
    if (!p.canMoveWholeFace || !p.wholeFaceDrag || p.dragMode !== 'local' || p.axis !== 2 || p.locked.length || view.hiddenPoles.length)
      throw Error(`Whole-face preconditions unavailable: ${JSON.stringify({ canMoveWholeFace: p.canMoveWholeFace, locked: p.locked?.length, hidden: view.hiddenPoles?.length })}`)
    const { localFrame } = await import('/plugins/tmar-edit-surface/localFrame.ts')
    const corner = localFrame(net, 0)?.[2]
    if (!corner) throw Error('No corner-associated frame exists for the normal comparison.')
    const camera = host.camera(), canvas = host.canvas, rect = canvas.getBoundingClientRect(), partGroup = host.partGroup
    const group = partGroup.getObjectByName('tmar-edit-surface-preview')
    if (!group) throw Error('Rendered CAD preview is absent; refusing an estimated target.')
    partGroup.updateWorldMatrix(true, true); group.updateWorldMatrix(true, true); camera.updateMatrixWorld(true)
    const V = camera.position.constructor, raycaster = new host.raycaster.constructor()
    const projectPartPoint = point => {
      const projected = new V(...point).applyMatrix4(partGroup.matrixWorld).project(camera)
      const clientX = rect.left + (projected.x + 1) * rect.width / 2
      const clientY = rect.top + (1 - projected.y) * rect.height / 2
      return { clientX, clientY, visible: [projected.x, projected.y, projected.z, clientX, clientY].every(Number.isFinite) &&
        Math.abs(projected.z) < 1 && clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom }
    }
    const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, a.reduce((s, x, i) => s + x * b[i], 0)))) * 180 / Math.PI
    for (const candidate of candidates) {
      const uvAngle = angle(candidate.normal, corner)
      if (uvAngle < 5) continue
      const screen = projectPartPoint(candidate.point)
      if (!screen.visible || screen.clientX < rect.left + 12 || screen.clientX > rect.right - 12 ||
          screen.clientY < rect.top + 12 || screen.clientY > rect.bottom - 12) continue
      const dom = document.elementFromPoint(screen.clientX, screen.clientY)
      if (dom !== canvas) continue
      raycaster.setFromCamera(new V((screen.clientX - rect.left) * 2 / rect.width - 1,
        1 - (screen.clientY - rect.top) * 2 / rect.height, 0), camera)
      const hits = raycaster.intersectObjects(group.children, false).filter(hit => hit.object.userData.face === 0)
      if (!hits.length) continue
      const depths = []
      for (const hit of hits) if (!depths.some(d => Math.abs(d - hit.distance) < .02)) depths.push(hit.distance)
      // A second separated mesh hit is an ambiguous fold/overlap: do not click it.
      if (depths.length !== 1) continue
      const hitPart = partGroup.worldToLocal(hits[0].point.clone())
      const seedDistance = hitPart.distanceTo(new V(...candidate.point))
      if (!Number.isFinite(seedDistance) || seedDistance > .15) continue
      const target = projectPartPoint(candidate.point.map((x, i) => x + .5 * candidate.normal[i]))
      const projectedAxisPixels = target.visible ? Math.hypot(target.clientX - screen.clientX, target.clientY - screen.clientY) : 0
      return { point: candidate.point, normal: candidate.normal, u: candidate.u, v: candidate.v,
        x: screen.clientX, y: screen.clientY, seedDistanceMm: seedDistance, rayHitCount: depths.length,
        cornerNormal: corner, angleToCornerNormalDeg: uvAngle,
        dragTo: projectedAxisPixels >= 5 ? { x: target.clientX, y: target.clientY, method: 'projected CAD normal' }
          : { x: screen.clientX, y: screen.clientY - 18, method: 'view-aligned depth fallback' },
        poles: net.poles.map(point => [...point]), poleCount: net.poles.length }
    }
    throw Error('No projected candidate has one unambiguous face hit, CAD-consistent mesh seed and distinct corner normal.')
  }, candidates)
  report.pick = { u: ready.u, v: ready.v, point: ready.point, normal: ready.normal,
    rayHitCount: ready.rayHitCount, seedDistanceMm: ready.seedDistanceMm,
    angleToCornerNormalDeg: ready.angleToCornerNormalDeg, dragMethod: ready.dragTo.method }
  check(ready.rayHitCount === 1 && ready.seedDistanceMm <= .15,
    'Projected click is a unique preview-face hit close to the pinned CAD point')

  await page.mouse.move(ready.x, ready.y)
  await page.mouse.down({ button: 'left' })
  // The real UI gesture only promotes after the asynchronous native CAD ray
  // query has accepted one intersection and supplied its UV-derived direction.
  await page.waitForFunction(() => window.wholeFaceLocalQa.useWorkspaceEditor.getState().snapshot?.gesture === 'pole',
    { timeout: 30000 })
  const during = await page.evaluate(() => {
    const c = window.wholeFaceLocalQa.useWorkspaceEditor.getState().controller
    const p = c.getPanelState()
    return { selected: c.getViewState().selected.length, poleCount: p.net?.poles.length ?? 0,
      direction: c.uniformGesture?.direction ? [...c.uniformGesture.direction] : null }
  })
  check(during.selected === ready.poleCount, 'The actual viewport press promoted a whole-face CAD-verified gesture')
  assert(during.direction && during.direction.length === 3 && during.direction.every(Number.isFinite),
    'The promoted whole-face gesture must retain the verified local-N direction.')
  const dot = during.direction.reduce((s, x, i) => s + x * ready.normal[i], 0)
  assert(dot > .999999, `Promoted N direction does not match the CAD normal at the picked point (dot=${dot}).`)
  report.workerDirection = { vector: during.direction, dotWithPickedCadNormal: dot }
  await page.mouse.move(ready.dragTo.x, ready.dragTo.y, { steps: 6 })
  await page.waitForFunction(before => {
    const net = window.wholeFaceLocalQa.useWorkspaceEditor.getState().controller.getViewState().net
    return net.poles.some((pole, i) => pole.some((x, d) => Math.abs(x - before[i][d]) > 1e-6))
  }, { timeout: 15000 }, ready.poles)
  await page.mouse.up({ button: 'left' })
  await page.waitForFunction(() => {
    const s = window.wholeFaceLocalQa.useWorkspaceEditor.getState(), p = s.controller?.getPanelState()
    return s.snapshot?.gesture === 'idle' && s.snapshot?.validation?.kind === 'valid' && !p?.calculating && !p?.busy
  }, { timeout: 120000 })
  const moved = await page.evaluate((before, expectedNormal, cornerNormal) => {
    const c = window.wholeFaceLocalQa.useWorkspaceEditor.getState().controller, net = c.getViewState().net
    const deltas = net.poles.map((pole, i) => pole.map((x, d) => x - before[i][d]))
    const delta = deltas[0], length = Math.hypot(...delta)
    const residual = Math.max(...deltas.flatMap(v => v.map((x, d) => Math.abs(x - delta[d]))))
    const unit = delta.map(x => x / length)
    const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0)
    const degrees = cosine => Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI
    const dotWithPickedCadNormal = dot(unit, expectedNormal), dotWithCornerNormal = dot(unit, cornerNormal)
    return { delta, length, maxResidual: residual, unitDirection: unit,
      dotWithPickedCadNormal, dotWithCornerNormal,
      angleToPickedCadNormalDeg: degrees(dotWithPickedCadNormal), angleToCornerNormalDeg: degrees(dotWithCornerNormal),
      selectedCount: c.getViewState().selected.length, poleCount: net.poles.length }
  }, ready.poles, ready.normal, ready.cornerNormal)
  report.translation = moved
  check(moved.length > .02 && moved.maxResidual < 1e-7 && moved.selectedCount === ready.poleCount,
    'Viewport gesture translates every face pole uniformly and materially')
  check(moved.dotWithPickedCadNormal > .9999 && moved.angleToCornerNormalDeg > moved.angleToPickedCadNormalDeg + 2,
    'Measured translation follows the CAD normal at the picked UV, not the corner-associated normal')

  const sourceBefore = await page.evaluate(() => window.wholeFaceLocalQa.sourceStep)
  const sourceGeometry = geometrySignature(sourceBefore)
  assert(sourceGeometry.valid && sourceGeometry.faceCount === 1 && sourceGeometry.solidCount === 0
    && sourceGeometry.surfaceTypes[0] === 'bspline', 'Input must be one valid open B-spline sheet before Apply.')
  await page.waitForSelector('[data-test=workspace-editor-apply]:enabled', { timeout: 120000 })
  await page.click('[data-test=workspace-editor-apply]')
  await page.waitForFunction(() => window.wholeFaceLocalQa.useWorkspaceEditor.getState().phase === 'closed', { timeout: 120000 })
  const applied = await page.evaluate(async () => {
    const q = window.wholeFaceLocalQa, receipt = q.useWorkspaceEditor.getState().receipt, state = q.useReverse.getState()
    if (receipt?.createdBodyIds?.length !== 1) throw Error('Host Apply did not create exactly one CAD copy.')
    const steps = []
    for (const id of [q.id, receipt.createdBodyIds[0]]) {
      const result = await q.runCommand('reverse.body.edit_source', { body: id })
      steps.push({ id, text: new TextDecoder().decode(result.file.bytes) })
    }
    return { receipt, bodyCount: state.bodies.length, initialBodyCount: q.initialBodyCount,
      historyDelta: q.useHistory.getState().past.length - q.initialHistoryLength, steps }
  })
  assert.equal(applied.bodyCount, applied.initialBodyCount + 1, 'Apply must add exactly one copy to the isolated project.')
  assert.equal(applied.historyDelta, 1, 'Host Apply must add exactly one project history record.')
  const [hostSourceGeometry, appliedCopyGeometry] = applied.steps.map(item => geometrySignature(item.text))
  assert.deepEqual(hostSourceGeometry, sourceGeometry, 'Host Apply must preserve original sheet CAD geometry.')
  assert(appliedCopyGeometry.valid && appliedCopyGeometry.faceCount === 1 && appliedCopyGeometry.solidCount === 0
    && appliedCopyGeometry.surfaceTypes[0] === 'bspline', 'Applied CAD copy must remain a valid one-face open B-spline sheet.')
  assert(Math.abs(appliedCopyGeometry.area - sourceGeometry.area) < 1e-5, 'Whole-face translation must preserve sheet area.')
  const expectedBounds = sourceGeometry.bounds.map((value, i) => Number((value + moved.delta[i % 3]).toFixed(7)))
  assert(appliedCopyGeometry.bounds.every((value, i) => Math.abs(value - expectedBounds[i]) < 2e-4),
    `Applied CAD bounds do not match measured translation: expected ${expectedBounds}, got ${appliedCopyGeometry.bounds}`)
  report.hostApply = { receipt: applied.receipt, source: hostSourceGeometry, copy: appliedCopyGeometry,
    expectedTranslatedBounds: expectedBounds, measuredDeltaMm: moved.delta }
  check(true, 'Host Apply preserves original and creates one valid open sheet translated by measured Locale/N vector')

  const readProject = () => page.evaluate(async () => {
    const q = window.wholeFaceLocalQa, steps = []
    for (const body of q.useReverse.getState().bodies) {
      const result = await q.runCommand('reverse.body.edit_source', { body: body.id })
      steps.push({ id: body.id, text: new TextDecoder().decode(result.file.bytes) })
    }
    return { count: q.useReverse.getState().bodies.length, steps }
  })
  const historyRevision = async () => page.evaluate(() => window.wholeFaceLocalQa.useHistory.getState().revision)
  const waitHistory = revision => page.waitForFunction(previous => {
    const q = window.wholeFaceLocalQa, history = q.useHistory.getState()
    return history.revision > previous && !history.restoring && !q.useReverse.getState().building
  }, { timeout: 120000 }, revision)
  let revision = await historyRevision()
  await page.click('[data-test=undo]')
  await waitHistory(revision)
  let project = await readProject()
  assert.equal(project.count, 1, 'Project Undo must remove the applied copy.')
  sameGeometry(geometrySignature(project.steps[0].text), sourceGeometry, 'Undo source snapshot')
  check(true, 'Project Undo removes the CAD copy and preserves the source sheet')

  revision = await historyRevision()
  await page.click('[data-test=redo]')
  await waitHistory(revision)
  project = await readProject()
  assert.equal(project.count, 2, 'Project Redo must restore the copy.')
  sameGeometry(geometrySignature(project.steps[0].text), sourceGeometry, 'Redo source snapshot')
  sameGeometry(geometrySignature(project.steps[1].text), appliedCopyGeometry, 'Redo copy snapshot')
  check(true, 'Project Redo restores original and translated open sheet geometry')

  await page.evaluate(() => {
    const q = window.wholeFaceLocalQa; q.savedBlob = null
    const create = URL.createObjectURL, click = HTMLAnchorElement.prototype.click
    q.restoreSaveHooks = () => { URL.createObjectURL = create; HTMLAnchorElement.prototype.click = click }
    URL.createObjectURL = blob => { q.savedBlob = blob; return 'blob:whole-face-local-qa' }
    HTMLAnchorElement.prototype.click = function () { if (this.download?.endsWith('.scanruler')) return; return click.call(this) }
  })
  const projectPath = join(out, 'synthetic-whole-face-local.scanruler')
  try {
    await page.click('[data-test=save-project]')
    await page.waitForFunction(() => window.wholeFaceLocalQa.savedBlob instanceof Blob, { timeout: 120000 })
    const bytes = await page.evaluate(async () => Array.from(new Uint8Array(await window.wholeFaceLocalQa.savedBlob.arrayBuffer())))
    writeFileSync(projectPath, Uint8Array.from(bytes))
    report.savedProject = { filename: 'synthetic-whole-face-local.scanruler', bytes: bytes.length, sha256: sha(Uint8Array.from(bytes)) }
  } finally { await page.evaluate(() => window.wholeFaceLocalQa.restoreSaveHooks?.()) }
  const projectInput = await page.$('[data-test="project-input"]')
  assert(projectInput, 'Project file picker input is missing.')
  await projectInput.uploadFile(projectPath)
  await page.waitForFunction(() => {
    const q = window.wholeFaceLocalQa
    return q.useReverse.getState().bodies.length === 2 && !q.useReverse.getState().building
      && q.useStore.getState().statusText.startsWith('Project opened —')
  }, { timeout: 120000 })
  await page.waitForFunction(() => window.wholeFaceLocalQa.useHistory.getState().past.length === 0, { timeout: 30000 })
  const reopened = await readProject()
  assert.equal(reopened.count, 2)
  const reopenedGeometries = reopened.steps.map(item => geometrySignature(item.text))
  sameGeometry(reopenedGeometries[0], sourceGeometry, 'Reopened source snapshot')
  sameGeometry(reopenedGeometries[1], appliedCopyGeometry, 'Reopened copy snapshot')
  report.roundTrip = { reopenedGeometries }
  check(true, 'Saved QA project reopens with source and translated sheet intact in OCCT snapshots')
  assert.deepEqual(app.consoleErrors, [], 'Application console errors')
  check(sha(readFileSync(fixture)) === expectedSha, 'Pinned synthetic fixture bytes remain unchanged')
  report.verdict = 'PASS_BOUNDED_WHOLE_FACE_LOCAL_HISTORY_ROUNDTRIP_GUI'
} catch (error) {
  report.error = String(error?.stack ?? error)
  process.exitCode = 1
  if (page) try {
    report.stateAtFailure = await page.evaluate(() => {
      const s = window.wholeFaceLocalQa?.useWorkspaceEditor.getState(), p = s?.controller?.getPanelState()
      const view = s?.controller?.getViewState()
      return { phase: s?.phase, validation: s?.snapshot?.validation?.kind, gesture: s?.snapshot?.gesture,
        face: p?.face, faceCount: p?.faces?.length, freeBoundary: p?.freeBoundary,
        canMoveWholeFace: p?.canMoveWholeFace, wholeFaceDrag: p?.wholeFaceDrag, dragMode: p?.dragMode,
        axis: p?.axis, locked: p?.locked?.length, hidden: view?.hiddenPoles?.length,
        calculating: p?.calculating, busy: p?.busy, message: p?.message }
    })
  } catch {}
} finally {
  if (browser) await browser.close()
  if (kernel) kernel[Symbol.dispose]()
  report.fixtureUnchanged = sha(readFileSync(fixture)) === expectedSha
  writeFileSync(join(out, 'result.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ out, ...report }))
}
