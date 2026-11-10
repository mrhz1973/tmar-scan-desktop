// SPDX-License-Identifier: AGPL-3.0-only
// Isolated GUI qualification of direct whole-natural-boundary picking.
// A synthetic single-face STEP sheet is imported into a fresh app project.
// Four boundary clicks each start and then Escape-cancel a real drag; a middle
// drag checks that viewport navigation remains available while the tool is on.
// No Apply, project save, screenshots or user files are involved.
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

const out = mkdtempSync(join(resolve(outputRoot), 'workspace-whole-boundary-gui-'))
process.env.SHOT_DIR = out
const { OcctKernel } = await import('occt-wasm')
const kernel = await OcctKernel.init()
const solid = kernel.makeBox(20, 30, 10)
const solidFaces = kernel.getSubShapes(solid, 'face')
let step
try {
  const face = solidFaces.find(candidate => Math.abs(kernel.getSurfaceArea(candidate) - 600) < 1e-7)
  assert(face, 'Synthetic 20 x 30 mm planar face was not found.')
  step = kernel.exportStep(face)
} finally {
  solidFaces.forEach(face => kernel.release(face))
  kernel.release(solid)
}
const inputSha256 = createHash('sha256').update(step).digest('hex')
writeFileSync(join(out, 'synthetic-open-sheet.step'), step)
const report = {
  scope: 'isolated source application; direct wholeBoundary viewport gesture on each natural rim',
  appUrl: url.href,
  fixture: { kind: 'single planar face from a synthetic 20 x 30 x 10 mm box', inputSha256 },
  checks: [],
  limitations: ['Synthetic planar open sheet only.', 'Each gesture is cancelled before commit; no Apply or project publication.', 'No packaged desktop or QuickSurface parity claim.'],
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

  // Same isolated host/CAD import setup used by e2e-workspace-integration;
  // no command below calls a controller gesture method directly.
  await page.evaluate(async stepText => {
    const { runCommand } = await import('/src/commands/registry.ts')
    const { useShell } = await import('/src/state/shellStore.ts')
    const { useReverse } = await import('/plugins/reverse/state/reStore.ts')
    const { reverseSession } = await import('/plugins/reverse/app/reSession.ts')
    const { sceneOf } = await import('/src/commands/host.ts')
    const { reSceneOf } = await import('/plugins/reverse/viewer/reScene.ts')
    const { useWorkspaceEditor } = await import('/src/plugins/workspaceEditors.ts')
    useShell.getState().setWorkspace('reverse')
    for (let i = 0; !reverseSession() && i < 500; i++) await new Promise(resolve => setTimeout(resolve, 20))
    if (!reverseSession()) throw Error('Isolated CAD session unavailable')
    await reverseSession().startKernel()
    await reverseSession().settled()
    await runCommand('reverse.import.step', { bytes: new TextEncoder().encode(stepText), name: 'synthetic-open-sheet.step' })
    await reverseSession().settled()
    const scene = sceneOf(), id = useReverse.getState().bodies[0]?.id
    if (!scene || !id || useReverse.getState().bodies.length !== 1) throw Error('Synthetic sheet was not imported as one body')
    scene.fitToView()
    window.wholeBoundaryQa = { scene, reScene: reSceneOf(scene), useWorkspaceEditor, useReverse, id }
  }, step)
  await page.waitForFunction(() => {
    const q = window.wholeBoundaryQa
    return !!q?.reScene.bodyMeshes.get(q.id) && !q.useReverse.getState().building
  }, { timeout: 120000 })
  // Match the established shared-workspace navigation case: Fusion assigns
  // middle drag to pan and Shift+middle to orbit. The profile is isolated.
  await page.evaluate(async () => {
    const { useStore } = await import('/src/state/store.ts')
    useStore.getState().setNavScheme('fusion')
  })
  await new Promise(resolve => setTimeout(resolve, 250))
  await page.waitForSelector('[data-test=feature-edit-surface]:enabled', { timeout: 60000 })
  await page.click('[data-test=feature-edit-surface]')
  await page.waitForSelector('[data-test=workspace-surface-parameters]', { timeout: 120000 })
  await page.waitForFunction(() => document.querySelectorAll('[data-test=surface-face] option').length === 2, { timeout: 60000 })
  await page.select('[data-test=surface-face]', '0')
  await page.waitForFunction(() => {
    const s = window.wholeBoundaryQa.useWorkspaceEditor.getState(), p = s.controller?.getPanelState()
    return s.snapshot?.validation?.kind === 'valid' && p?.canFreeBoundary && !p.calculating
  }, { timeout: 120000 })
  await page.click('[data-test=surface-free-boundary]')
  await page.waitForFunction(() => window.wholeBoundaryQa.useWorkspaceEditor.getState().controller?.getPanelState().freeBoundary)
  // setFreeBoundary invalidates the current CAD preview. The checkbox can
  // reflect its new value before the worker has revalidated that preview;
  // wait for the actual gesture gate instead of clicking a still-disabled
  // whole-boundary control.
  try {
    await page.waitForFunction(() => {
      const panel = window.wholeBoundaryQa.useWorkspaceEditor.getState().controller?.getPanelState()
      return panel?.canMoveWholeBoundary === true && !panel.calculating
    }, { timeout: 120000 })
  } catch (error) {
    // Read scalar diagnostics only. Object identity is reported as booleans;
    // no controller action, mutation, or retry is performed here.
    report.gateDiagnostic = await page.evaluate(() => {
      const state = window.wholeBoundaryQa.useWorkspaceEditor.getState()
      const controller = state.controller
      const panel = controller?.getPanelState()
      const snapshot = controller?.getSnapshot()
      const draft = controller?.draft?.getSnapshot?.()
      const view = controller?.getViewState()
      const net = draft?.net ?? panel?.net
      const preview = draft?.preview ?? view?.preview
      return {
        phase: state.phase ?? null,
        error: state.error ?? null,
        panel: panel ? {
          canFreeBoundary: !!panel.canFreeBoundary,
          freeBoundary: !!panel.freeBoundary,
          canMoveWholeBoundary: !!panel.canMoveWholeBoundary,
          calculating: !!panel.calculating,
          busy: !!panel.busy,
          frozen: !!panel.frozen,
          symmetry: !!panel.symmetry,
          placingNote: !!panel.placingNote,
          surfaceTarget: panel.surfaceTarget ?? null,
          notes: panel.notes?.length ?? null,
          face: Number.isFinite(panel.face) ? panel.face : null,
          faceCount: panel.faces?.length ?? null,
          selectedFaceIsNaturalOpen: panel.face >= 0 ? !!panel.faces?.[panel.face]?.freeBoundary : null,
          stripActive: !!panel.strip,
          stripPending: !!panel.strip?.pending,
          gesture: panel.gesture ?? null,
          wholeBoundaryDrag: panel.wholeBoundaryDrag ?? null,
        } : null,
        draft: draft ? {
          calculating: !!draft.calculating,
          previewStale: !!draft.previewStale,
          freeBoundary: !!draft.freeBoundary,
          continuity: draft.continuity ?? null,
          hasNet: !!draft.net,
          hasCommittedNet: !!draft.committedNet,
          netIsCommittedNet: draft.net === draft.committedNet,
          hasValidNet: !!draft.validNet,
          validNetIsNet: draft.validNet === draft.net,
          selectedCount: draft.selected?.length ?? null,
          lockedCount: draft.locks?.length ?? null,
          trimLockedCount: draft.trimLocks?.length ?? null,
          hiddenCount: draft.hiddenPoles?.length ?? null,
          hasPreview: !!draft.preview,
          previewRevision: Number.isFinite(draft.preview?.previewRevision) ? draft.preview.previewRevision : null,
          error: draft.error ?? null,
        } : null,
        controller: snapshot ? {
          gesture: snapshot.gesture ?? null,
          validationKind: snapshot.validation?.kind ?? null,
          validationError: snapshot.validation?.error ?? null,
          dirty: !!snapshot.dirty,
          busy: !!snapshot.busy,
          message: snapshot.message ?? null,
        } : null,
        view: {
          viewHasNet: !!view?.net,
          viewNetMatchesPanel: !!view?.net && view.net === panel?.net,
          viewHasPreview: !!view?.preview,
          viewPreviewMatchesDraft: !!view?.preview && view.preview === preview,
          wholeBoundaryDrag: view?.wholeBoundaryDrag?.side ?? null,
          canStartWholeBoundary: view?.wholeBoundaryDrag?.canStart ?? null,
          navigationOnly: !!view?.navigationOnly,
        },
        gates: {
          singleFace: panel?.faces?.length === 1,
          freeBoundaryOption: !!panel?.canFreeBoundary,
          freeBoundaryEnabled: !!panel?.freeBoundary,
          validNetMatchesNet: !!draft && draft.validNet === draft.net,
          committedNetMatchesNet: !!draft && draft.committedNet === draft.net,
          previewFresh: !!draft && !draft.previewStale,
          idle: snapshot?.gesture === 'idle',
          noNotes: (panel?.notes?.length ?? 0) === 0,
          noSymmetry: !panel?.symmetry,
          noTangency: !panel?.planeTangencyActive && !panel?.curvedTangencyActive,
          noCylinderPreparation: panel?.faces?.[panel.face]?.experimentalCylinder !== true,
          noStrip: !panel?.strip && !panel?.strip?.pending,
          noSurfaceTarget: !panel?.surfaceTarget,
          notBusy: !panel?.busy && !draft?.calculating,
        },
      }
    })
    report.gateTimeout = String(error?.message ?? error)
    throw error
  }
  const wholeBoundary = await page.$('[data-test=surface-whole-boundary-drag]')
  assert(wholeBoundary, 'Whole-boundary drag option was not offered for the natural open face.')
  assert(!(await wholeBoundary.evaluate(element => element.disabled)), 'Whole-boundary drag remained disabled after CAD revalidation.')
  await wholeBoundary.click()
  await page.waitForFunction(() => !!window.wholeBoundaryQa.useWorkspaceEditor.getState().controller?.getPanelState().wholeBoundaryDrag)
  check(true, 'Whole-natural-boundary drag mode arms on an open natural sheet')

  const projectedRims = await page.evaluate(async () => {
    const { wholeBoundaryPath } = await import('/plugins/tmar-edit-surface/wholeBoundary.ts')
    const q = window.wholeBoundaryQa, controller = q.useWorkspaceEditor.getState().controller
    const host = q.scene.layerHost(), camera = host.camera(), rect = host.canvas.getBoundingClientRect(), group = host.partGroup
    const net = controller.getViewState().net
    if (!net) throw Error('Editable net missing')
    group.updateWorldMatrix(true, true); camera.updateMatrixWorld(true)
    const project = point => {
      const p = camera.position.clone().set(...point).applyMatrix4(group.matrixWorld).project(camera)
      return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2,
        visible: Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.z) < 1 }
    }
    const sides = ['U0', 'U1', 'V0', 'V1']
    return sides.map(side => {
      const path = wholeBoundaryPath(net, side)
      const positions = path.map(project)
      const middle = positions[Math.floor(positions.length / 2)]
      return { side, ...middle, onCanvas: middle.x > rect.left + 6 && middle.x < rect.right - 6 &&
        middle.y > rect.top + 6 && middle.y < rect.bottom - 6 }
    })
  })
  assert.equal(projectedRims.length, 4)
  assert(projectedRims.every(rim => rim.visible && rim.onCanvas), `A natural rim is outside the visible viewport: ${JSON.stringify(projectedRims)}`)

  for (const rim of projectedRims) {
    const before = await page.evaluate(() => {
      const controller = window.wholeBoundaryQa.useWorkspaceEditor.getState().controller
      return { poles: controller.getViewState().net.poles.map(point => [...point]), side: controller.getPanelState().wholeBoundaryDrag }
    })
    await page.mouse.move(rim.x, rim.y)
    await page.mouse.down({ button: 'left' })
    // Native CAD visibility is asynchronous. Hold the pointer until its
    // receipt promotes the real UI press to the boundary drag.
    await page.waitForFunction(side => {
      const state = window.wholeBoundaryQa.useWorkspaceEditor.getState()
      return state.snapshot?.gesture === 'pole' && state.controller?.getPanelState().wholeBoundaryDrag === side
    }, { timeout: 30000 }, rim.side)
    await page.mouse.move(rim.x + 12, rim.y - 9, { steps: 5 })
    await page.waitForFunction(previous => {
      const controller = window.wholeBoundaryQa.useWorkspaceEditor.getState().controller
      return controller.getViewState().net.poles.some((point, i) => point.some((v, axis) => Math.abs(v - previous[i][axis]) > 1e-7))
    }, { timeout: 15000 }, before.poles)
    await page.keyboard.press('Escape')
    await page.mouse.up({ button: 'left' })
    await page.waitForFunction(previous => {
      const state = window.wholeBoundaryQa.useWorkspaceEditor.getState(), controller = state.controller
      return state.snapshot?.gesture === 'idle' && controller.getViewState().net.poles.every((point, i) =>
        point.every((v, axis) => Math.abs(v - previous[i][axis]) < 1e-8))
    }, { timeout: 30000 }, before.poles)
    const activeSide = await page.$eval('[data-test=surface-whole-boundary-side]', element => element.value)
    check(activeSide === rim.side, `${rim.side} natural rim was picked through the viewport and Escape restored all poles`)
  }

  const cameraBefore = await page.evaluate(() => {
    const camera = window.wholeBoundaryQa.scene.layerHost().camera()
    return { position: camera.position.toArray(), quaternion: camera.quaternion.toArray() }
  })
  const canvasRect = await page.evaluate(() => {
    const r = window.wholeBoundaryQa.scene.layerHost().canvas.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height }
  })
  const navPoint = { x: canvasRect.x + canvasRect.width * .7, y: canvasRect.y + canvasRect.height * .3 }
  await page.mouse.move(navPoint.x, navPoint.y)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(navPoint.x + 70, navPoint.y + 35, { steps: 8 })
  await page.mouse.up({ button: 'middle' })
  await new Promise(resolve => setTimeout(resolve, 200))
  const afterPan = await page.evaluate(() => {
    const camera = window.wholeBoundaryQa.scene.layerHost().camera()
    return { position: camera.position.toArray(), quaternion: camera.quaternion.toArray() }
  })
  const changed = (a, b) => a.some((v, i) => Math.abs(v - b[i]) > 1e-7)
  check(changed(cameraBefore.position, afterPan.position) && !changed(cameraBefore.quaternion, afterPan.quaternion),
    'Middle-button drag pans the shared view with the whole-boundary tool armed')

  await page.mouse.move(navPoint.x, navPoint.y)
  await page.keyboard.down('Shift')
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(navPoint.x + 90, navPoint.y + 50, { steps: 8 })
  await page.mouse.up({ button: 'middle' })
  await page.keyboard.up('Shift')
  await new Promise(resolve => setTimeout(resolve, 200))
  const afterOrbit = await page.evaluate(() => {
    const camera = window.wholeBoundaryQa.scene.layerHost().camera()
    return { position: camera.position.toArray(), quaternion: camera.quaternion.toArray() }
  })
  check(changed(afterPan.quaternion, afterOrbit.quaternion),
    'Shift+middle drag orbits the shared view with the whole-boundary tool armed')
  assert.deepEqual(app.consoleErrors, [], 'Browser reported application errors')
  check(true, 'No browser application errors')
  report.rims = projectedRims.map(({ side }) => side)
  report.verdict = 'PASS_BOUNDED_GUI'
} catch (error) {
  report.error = String(error?.stack ?? error)
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  kernel[Symbol.dispose]()
  writeFileSync(join(out, 'result.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ out, ...report }))
}
