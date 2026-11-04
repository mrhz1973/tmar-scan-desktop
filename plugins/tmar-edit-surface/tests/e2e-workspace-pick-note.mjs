// SPDX-License-Identifier: AGPL-3.0-only
// Real shared-view QA: synthetic STEP only, isolated browser profile, no user project.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

if (process.env.SCANRULER_ISOLATED !== '1') throw Error('Set SCANRULER_ISOLATED=1 for the isolated QA app.')
if (process.env.APP_URL !== 'http://127.0.0.1:17527/') throw Error('This test is restricted to APP_URL=http://127.0.0.1:17527/.')
const url = new URL(process.env.APP_URL)
if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port !== '17527' ||
    url.pathname !== '/' || url.search || url.hash || url.username || url.password)
  throw Error('Refusing any non-isolated or non-exact QA origin.')
const outputRoot = process.env.EDIT_SURFACE_QA_OUT
if (!outputRoot || !isAbsolute(outputRoot)) throw Error('Set EDIT_SURFACE_QA_OUT to an absolute evidence folder outside the app checkout.')
const appRoot = resolve(process.cwd())
const outputRelative = relative(appRoot, resolve(outputRoot))
if (!outputRelative || (!outputRelative.startsWith('..' + sep) && outputRelative !== '..' && !isAbsolute(outputRelative)))
  throw Error('Evidence and browser profile must remain outside the app checkout.')

const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
if (!response.ok) throw Error('Isolated QA server returned HTTP ' + response.status + '.')
const html = await response.text()
if (!/ScanRuler/i.test(html)) throw Error('Port 17527 did not identify itself as the ScanRuler QA app.')

const root = resolve(outputRoot)
mkdirSync(root, { recursive: true })
const out = mkdtempSync(join(root, 'workspace-pick-note-'))
process.env.SHOT_DIR = out
const { OcctKernel } = await import('occt-wasm')
const { launchApp } = await import('../../../scripts/e2e-lib.mjs')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const kernel = await OcctKernel.init()
const box = kernel.makeBox(20, 30, 10)
let input
try { input = Buffer.from(kernel.exportStep(box)) } finally { kernel.release(box) }
const inputHash = sha(input)
const report = { scope: 'shared main view; synthetic box; select-face click; Zebra; note click/text; Apply blocked; cancel',
  appUrl: url.href, isolation: 'SCANRULER_ISOLATED=1; isolated Chromium profile; synthetic STEP imported only in fresh app project',
  inputKind: 'synthetic 20 x 30 x 10 mm box', inputHash, checks: [], consoleErrors: [], verdict: 'INCOMPLETE' }
const check = (ok, label) => { assert(ok, label); report.checks.push(label); console.log('PASS', label) }
let browser, page
try {
  const launched = await launchApp({ url: url.href, width: 1440, height: 1000, agentDataOk: false,
    userDataDir: join(out, 'owned-browser-profile'), protocolTimeout: 120000 })
  browser = launched.browser
  page = launched.page
  report.consoleErrors = launched.consoleErrors
  page.on('dialog', dialog => dialog.accept())

  await page.evaluate(async step => {
    const { runCommand, listCommands } = await import('/src/commands/registry.ts')
    const { useShell } = await import('/src/state/shellStore.ts')
    const { useReverse } = await import('/plugins/reverse/state/reStore.ts')
    const { reverseSession } = await import('/plugins/reverse/app/reSession.ts')
    const { sceneOf } = await import('/src/commands/host.ts')
    const { reSceneOf } = await import('/plugins/reverse/viewer/reScene.ts')
    const history = await import('/src/state/historyStore.ts')
    const { useWorkspaceEditor } = await import('/src/plugins/workspaceEditors.ts')
    useShell.getState().setWorkspace('reverse')
    for (let i = 0; !reverseSession() && i < 500; i++) await new Promise(resolve => setTimeout(resolve, 20))
    if (!reverseSession()) throw Error('Isolated reverse CAD session unavailable')
    await reverseSession().startKernel()
    await reverseSession().settled()
    await runCommand('reverse.import.step', { bytes: new TextEncoder().encode(step), name: 'synthetic-workspace-note.step' })
    await reverseSession().settled()
    const scene = sceneOf(), id = useReverse.getState().bodies[0]?.id
    if (!scene || !id || useReverse.getState().bodies.length !== 1) throw Error('Synthetic CAD body not isolated in a fresh project')
    if (!listCommands().some(command => command.name === 'reverse.body.edit_source'))
      throw Error('Host source identity command is unavailable; cannot verify exact source preservation')
    scene.fitToView()
    window.workspacePickNoteQa = { runCommand, useReverse, reverseSession, scene, reScene: reSceneOf(scene),
      history, useWorkspaceEditor, id, listCommands }
  }, input.toString('utf8'))

  await page.waitForFunction(() => !!window.workspacePickNoteQa.reScene.bodyMeshes.get(window.workspacePickNoteQa.id), { timeout: 60000 })
  const before = await page.evaluate(async () => {
    const q = window.workspacePickNoteQa
    const read = await q.runCommand('reverse.body.edit_source', { body: q.id })
    const bytes = new Uint8Array(read.file.bytes)
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const sourceSha = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
    const mesh = q.reScene.bodyMeshes.get(q.id)
    q.before = { sourceSha, sourceStep: new TextDecoder().decode(bytes), geometry: mesh.geometry, bodyIds: q.useReverse.getState().bodies.map(body => body.id),
      history: q.history.useHistory.getState().past.length, buildVersion: q.useReverse.getState().buildVersion }
    return { sourceSha, sourceStep: q.before.sourceStep, bodyIds: q.before.bodyIds, history: q.before.history, buildVersion: q.before.buildVersion }
  })
  report.before = { sourceSha: before.sourceSha, bodyIds: before.bodyIds, history: before.history, buildVersion: before.buildVersion }

  await page.waitForSelector('[data-test=feature-edit-surface]:enabled', { timeout: 60000 })
  await page.click('[data-test=feature-edit-surface]')
  await page.waitForSelector('[data-test=workspace-surface-parameters]', { timeout: 120000 })
  await page.waitForFunction(() => {
    const q = window.workspacePickNoteQa, c = q.useWorkspaceEditor.getState().controller
    return !!c?.getViewState().preview?.faceMeshes?.length &&
      !!q.scene.layerHost().partGroup.getObjectByName('tmar-edit-surface-preview')
  }, { timeout: 120000 })

  const findVisibleFacePixel = async face => page.evaluate(faceId => {
    const q = window.workspacePickNoteQa, lease = q.scene.layerHost()
    const camera = lease.camera(), canvas = lease.canvas, rect = canvas.getBoundingClientRect()
    const preview = lease.partGroup.getObjectByName('tmar-edit-surface-preview')
    preview.updateWorldMatrix(true, true); camera.updateMatrixWorld(true)
    const faces = q.useWorkspaceEditor.getState().controller.getPanelState().faces
    for (const mesh of preview.children) {
      const face = mesh.userData.face
      if (!Number.isInteger(face) || (faceId !== null && face !== faceId) || faces[face]?.reason) continue
      const position = mesh.geometry.getAttribute('position'), index = mesh.geometry.index
      if (!position || !index) continue
      for (let i = 0; i + 2 < index.count; i += 3) {
        const Vector = mesh.position.constructor
        const a = new Vector().fromBufferAttribute(position, index.getX(i))
        const b = new Vector().fromBufferAttribute(position, index.getX(i + 1))
        const c = new Vector().fromBufferAttribute(position, index.getX(i + 2))
        // The synthetic source is a box; use a top-face triangle so the click
        // point is well inside an unobstructed, supported plane.
        if (Math.abs(a.z - 10) > 1e-6 || Math.abs(b.z - 10) > 1e-6 || Math.abs(c.z - 10) > 1e-6) continue
        const world = mesh.localToWorld(a.add(b).add(c).multiplyScalar(1 / 3))
        const ndc = world.clone().project(camera)
        const x = rect.left + (ndc.x + 1) * rect.width / 2, y = rect.top + (1 - ndc.y) * rect.height / 2
        if (ndc.z < -1 || ndc.z > 1 || x < rect.left + 12 || x > rect.right - 12 || y < rect.top + 12 || y > rect.bottom - 12) continue
        return { face, x, y }
      }
    }
    throw Error('No visible interior point found on the synthetic box top face.')
  }, face)
  const faceTarget = await findVisibleFacePixel(null)
  report.faceIndex = faceTarget.face
  await page.mouse.click(faceTarget.x, faceTarget.y)
  await page.waitForFunction(face => {
    const s = window.workspacePickNoteQa.useWorkspaceEditor.getState()
    return s.controller?.getPanelState().face === face && s.snapshot?.validation.kind === 'valid'
  }, { timeout: 120000 }, faceTarget.face)
  check(true, 'selected supported face ' + faceTarget.face + ' by clicking its visible interior in the shared workspace')

  await page.click('[data-test=surface-zebra]')
  await page.waitForFunction(() => {
    const q = window.workspacePickNoteQa, root = q.scene.layerHost().partGroup.getObjectByName('tmar-edit-surface-preview')
    let count = 0; root?.traverse(node => { if (node.userData.tmarZebra) count++ })
    return count > 0 && !!q.useWorkspaceEditor.getState().controller.getPanelState().stripes
  }, { timeout: 30000 })
  check(true, 'Zebra is active on the shared-view preview')

  await page.click('[data-test=surface-note-add]')
  const noteTarget = await findVisibleFacePixel(faceTarget.face)
  await page.mouse.click(noteTarget.x, noteTarget.y)
  await page.waitForSelector('[data-test=surface-note-text]', { timeout: 30000 })
  const noteText = 'Nota di prova Zebra'
  await page.type('[data-test=surface-note-text]', noteText)
  await page.waitForFunction(() => {
    const q = window.workspacePickNoteQa, state = q.useWorkspaceEditor.getState(), controller = state.controller
    return controller?.getPanelState().notes.length === 1 && controller.getViewState().notePins.length === 1
  }, { timeout: 30000 })
  const noteState = await page.evaluate(() => {
    const q = window.workspacePickNoteQa, state = q.useWorkspaceEditor.getState(), controller = state.controller
    return { text: controller.getPanelState().notes[0]?.text, notes: state.snapshot?.draftNoteCount,
      pins: controller.getViewState().notePins.length, applyDisabled: document.querySelector('[data-test=workspace-editor-apply]')?.disabled,
      zebra: !!controller.getPanelState().stripes }
  })
  check(noteState.text === noteText && noteState.notes === 1 && noteState.pins === 1 && noteState.applyDisabled && noteState.zebra,
    'clicked note is attached to the selected face with Zebra active and Apply blocked')
  await page.screenshot({ path: join(out, 'zebra-note-before-cancel.png') })

  const cancelButton = await page.$('[data-test=workspace-editor-cancel]') ??
    await page.$('button[aria-label="Annulla"]') ??
    (await page.$x('//button[normalize-space(.)="Annulla" or normalize-space(.)="Cancel"]'))[0]
  assert(cancelButton, 'Visible host Cancel button was not found.')
  await cancelButton.click()
  await page.waitForFunction(() => window.workspacePickNoteQa.useWorkspaceEditor.getState().phase === 'closed', { timeout: 60000 })

  const after = await page.evaluate(async () => {
    const q = window.workspacePickNoteQa, mesh = q.reScene.bodyMeshes.get(q.id)
    const read = await q.runCommand('reverse.body.edit_source', { body: q.id })
    const bytes = new Uint8Array(read.file.bytes), digest = await crypto.subtle.digest('SHA-256', bytes)
    const sourceSha = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
    return { sourceSha, sourceStep: new TextDecoder().decode(bytes), sameGeometry: mesh.geometry === q.before.geometry, sourceVisible: mesh.visible,
      bodyIds: q.useReverse.getState().bodies.map(body => body.id),
      history: q.history.useHistory.getState().past.length, buildVersion: q.useReverse.getState().buildVersion,
      noPreview: !q.scene.layerHost().partGroup.getObjectByName('tmar-edit-surface-preview'),
      editorPhase: q.useWorkspaceEditor.getState().phase }
  })
  const signature = step => {
    const shape = kernel.importStep(step), solids = kernel.getSubShapes(shape, 'solid'), faces = kernel.getSubShapes(shape, 'face')
    try {
      const box = kernel.getBoundingBox(shape)
      const faceMetrics = faces.map(face => {
        const b = kernel.getBoundingBox(face)
        const values = [kernel.getSurfaceArea(face), b.xmin, b.ymin, b.zmin, b.xmax, b.ymax, b.zmax]
        return { kind: kernel.surfaceType(face), values, key: kernel.surfaceType(face) + '|' + values.map(value => value.toFixed(7)).join('|') }
      }).sort((a, b) => a.key.localeCompare(b.key))
      return { valid: kernel.isValid(shape), solids: solids.length, faces: faces.length, volume: kernel.getVolume(shape),
        bounds: [box.xmin, box.ymin, box.zmin, box.xmax, box.ymax, box.zmax], faceMetrics }
    } finally { solids.forEach(solid => kernel.release(solid)); faces.forEach(face => kernel.release(face)); kernel.release(shape) }
  }
  const beforeGeometry = signature(before.sourceStep), afterGeometry = signature(after.sourceStep)
  const closeArray = (a, b, tolerance) => a.length === b.length && a.every((value, index) => Math.abs(value - b[index]) <= tolerance)
  const sameGeometry = beforeGeometry.valid && afterGeometry.valid && beforeGeometry.solids === 1 && afterGeometry.solids === 1 &&
    beforeGeometry.solids === afterGeometry.solids && beforeGeometry.faces === afterGeometry.faces &&
    Math.abs(beforeGeometry.volume - afterGeometry.volume) <= 1e-9 && closeArray(beforeGeometry.bounds, afterGeometry.bounds, 1e-9) &&
    beforeGeometry.faceMetrics.length === afterGeometry.faceMetrics.length && beforeGeometry.faceMetrics.every((face, index) =>
      face.kind === afterGeometry.faceMetrics[index].kind && closeArray(face.values, afterGeometry.faceMetrics[index].values, 1e-8))
  report.after = { sourceSha: after.sourceSha, sameGeometryReference: after.sameGeometry, sourceVisible: after.sourceVisible,
    bodyIds: after.bodyIds, history: after.history, buildVersion: after.buildVersion, noPreview: after.noPreview,
    editorPhase: after.editorPhase, beforeGeometry, afterGeometry, sourceBytesSame: before.sourceSha === after.sourceSha }
  check(sameGeometry && after.sameGeometry && JSON.stringify(after.bodyIds) === JSON.stringify(before.bodyIds) &&
    after.history === before.history && after.buildVersion === before.buildVersion,
    'Cancel preserves valid CAD geometry, original render geometry, body list, build and project history')
  check(after.sourceVisible && after.noPreview && after.editorPhase === 'closed', 'Cancel restores source visibility and removes the shared preview')
  check(report.consoleErrors.length === 0, 'no browser application errors')
  report.verdict = 'PASS'
} catch (error) {
  report.error = String(error?.stack ?? error)
  if (page) try { await page.screenshot({ path: join(out, 'failure.png') }) } catch { /* Preserve the test failure. */ }
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  kernel[Symbol.dispose]()
  writeFileSync(join(out, 'result.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ out, ...report }))
}
