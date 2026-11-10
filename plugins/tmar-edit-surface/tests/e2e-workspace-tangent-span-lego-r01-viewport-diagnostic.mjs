// SPDX-License-Identifier: AGPL-3.0-only
// Read-only viewport diagnostic for the R01 span seed that failed the prior
// visibility gate. It never clicks, deforms, applies, or undoes CAD geometry.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

assert.equal(process.env.SCANRULER_ISOLATED, '1', 'Set SCANRULER_ISOLATED=1 for isolated QA.')
const url = new URL(process.env.APP_URL ?? '')
assert.equal(url.href, 'http://127.0.0.1:17527/', 'Only the designated isolated QA host is permitted.')
const outputRoot = process.env.EDIT_SURFACE_QA_OUT
assert(outputRoot && isAbsolute(outputRoot), 'Set EDIT_SURFACE_QA_OUT to an absolute folder outside the checkout.')
const rel = relative(resolve(process.cwd()), resolve(outputRoot))
assert(rel && (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)), 'Evidence must stay outside the checkout.')
const cadPath = process.env.SURFACE_QA_PAIRED_CAD
assert(cadPath && isAbsolute(cadPath), 'Set SURFACE_QA_PAIRED_CAD to the authorized lego_CAD_R01.step.')

const expected = {
  cad: '9278dbf72e5b148d4f9027053867caae40e35a28836f8f629759aab899ff7b22',
  report: 'bcfb71b025e0886f6a55d07208cb72af1355bacae147c1c673460de62a132ee0',
  manifest: '5ea1d57337bcbe806ca41844fe73be954cf2c87c1b6379126b7b43f27f6678c5',
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const cadBytes = readFileSync(cadPath), sourceHash = sha(cadBytes)
assert.equal(sourceHash, expected.cad, 'CAD SHA-256 does not match the authorized R01 file.')
const pairDir = dirname(cadPath)
const manifestBytes = readFileSync(join(pairDir, 'lego_R01_manifest.json'))
const reportBytes = readFileSync(join(pairDir, 'lego_REPORT_R01.md'))
assert.equal(sha(manifestBytes), expected.manifest, 'R01 manifest SHA-256 changed.')
assert.equal(sha(reportBytes), expected.report, 'R01 report SHA-256 changed.')
assert(reportBytes.toString('utf8').includes('Trasformazione finale identita: nessun riallineamento best-fit.'),
  'Hash-matched R01 report does not state identity alignment.')

mkdirSync(resolve(outputRoot), { recursive: true })
const out = mkdtempSync(join(resolve(outputRoot), 'workspace-tangent-span-lego-r01-viewport-diagnostic-'))
process.env.SHOT_DIR = out
writeFileSync(join(out, 'lego_CAD_R01.step'), cadBytes)
assert.equal(sha(readFileSync(join(out, 'lego_CAD_R01.step'))), expected.cad, 'QA STEP copy must match source bytes.')

const { OcctKernel } = await import('occt-wasm')
const { launchApp } = await import('../../../scripts/e2e-lib.mjs')
const kernel = await OcctKernel.init()
const sourceText = cadBytes.toString('utf8')
const source = kernel.importStep(sourceText), faces = kernel.getSubShapes(source, 'face'), solids = kernel.getSubShapes(source, 'solid')
try {
  assert(kernel.isValid(source), 'Authorized source STEP must import as valid CAD.')
  assert.equal(solids.length, 1)
  assert.equal(faces.length, 51)
  assert.equal(kernel.surfaceType(faces[0]), 'plane')
  assert.equal(kernel.classifyPointOnFace(faces[0], 4.83, -6.0915), 'in')
} finally { faces.forEach(face => kernel.release(face)); solids.forEach(solid => kernel.release(solid)); kernel.release(source) }

const report = {
  scope: 'read-only replay of R01 face 0 import/refinement and visibility diagnostics for seed candidate; no GUI gestures',
  appUrl: url.href,
  fixture: { cadPath, cadSha256: sourceHash, manifestSha256: sha(manifestBytes), reportSha256: sha(reportBytes),
    faceIndex: 0, priorSeedPoleId: 60, priorSeedPole: [7.890000000000001, 0.05, 4.765000000000001] },
  actions: ['import exact hash-pinned STEP copy', 'open Edit Surface', 'select face 0', 'refine both twice',
    'project the same free-span seed candidate', 'collect DOM/canvas diagnostics only'],
  forbiddenActionsPerformed: [],
  checks: [],
  limitations: ['This script does not attempt a pointer event, selection, deformation, tangent-span review, Apply, or Undo.',
    'It diagnoses visibility/hit-testing only; it cannot qualify a span edit or prove CAD behavior.',
    'Camera pose and DOM hit-testing are observations from the isolated host, not proof of a successful human click.'],
  prerequisites: ['Isolated QA host at 127.0.0.1:17527.',
    'Run from the ScanRuler checkout with SCANRULER_ISOLATED=1, SURFACE_QA_PAIRED_CAD hash-pinned to R01,',
    'and EDIT_SURFACE_QA_OUT set outside the checkout.'],
  verdict: 'INCOMPLETE_READ_ONLY_DIAGNOSTIC',
}
let browser
try {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
  assert(response.ok, `Isolated host returned HTTP ${response.status}.`)
  assert(/ScanRuler/i.test(await response.text()), 'Isolated host does not identify as ScanRuler.')
  const app = await launchApp({ url: url.href, width: 1440, height: 1000, agentDataOk: false,
    userDataDir: join(out, 'owned-browser-profile'), protocolTimeout: 120000 })
  browser = app.browser
  const page = app.page
  report.consoleErrors = app.consoleErrors
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
    await runCommand('reverse.import.step', { bytes: new TextEncoder().encode(stepText), name: 'lego_CAD_R01.step' })
    await reverseSession().settled()
    const scene = sceneOf(), reverse = useReverse.getState(), sourceId = reverse.bodies[0]?.id
    if (!scene || !sourceId || reverse.bodies.length !== 1) throw Error('R01 STEP did not import as one isolated body')
    scene.fitToView(); scene.viewFrom('front')
    window.spanViewportQa = { runCommand, scene, reScene: reSceneOf(scene), useWorkspaceEditor, useReverse, useStore, sourceId }
  }, sourceText)
  await page.waitForFunction(() => {
    const q = window.spanViewportQa
    return !!q.reScene.bodyMeshes.get(q.sourceId) && !q.useReverse.getState().building && !q.useStore.getState().busy
  }, { timeout: 120000 })
  await page.waitForSelector('[data-test=feature-edit-surface]:enabled', { timeout: 60000 })
  await page.click('[data-test=feature-edit-surface]')
  await page.waitForSelector('[data-test=workspace-surface-parameters]', { timeout: 120000 })
  await page.waitForFunction(() => document.querySelectorAll('[data-test=surface-face] option').length > 1, { timeout: 60000 })
  await page.select('[data-test=surface-face]', '0')
  await page.waitForFunction(() => {
    const s = window.spanViewportQa.useWorkspaceEditor.getState(), p = s.controller?.getPanelState()
    return s.snapshot?.validation?.kind === 'valid' && !!p?.net && !p.calculating
  }, { timeout: 120000 })
  const face = await page.evaluate(() => {
    const c = window.spanViewportQa.useWorkspaceEditor.getState().controller, v = c.getViewState(), p = c.getPanelState()
    const ys = [...v.preview.faceMeshes[0].positions].filter((_, i) => i % 3 === 1)
    return { selected: v.face, kind: p.faces[0]?.kind, reason: p.faces[0]?.reason,
      yMin: Math.min(...ys), yMax: Math.max(...ys), trimLocks: p.faces[0]?.trimLocks,
      hiddenPoles: p.faces[0]?.hiddenPoles }
  })
  assert.equal(face.selected, 0)
  assert.equal(face.kind, 'plane')
  assert.equal(face.reason, null)
  assert(Math.abs(face.yMin - 0.05) < 1e-5 && Math.abs(face.yMax - 0.05) < 1e-5)
  assert.deepEqual(face.trimLocks, [])
  assert.deepEqual(face.hiddenPoles, [])
  await page.click('[data-test=surface-refine-both]')
  await page.waitForFunction(() => {
    const s = window.spanViewportQa.useWorkspaceEditor.getState(), p = s.controller?.getPanelState()
    return s.snapshot?.validation?.kind === 'valid' && !!p?.net && !p.calculating && p.net.nu >= 3 && p.net.nv >= 3
  }, { timeout: 120000 })
  await page.click('[data-test=surface-refine-both]')
  await page.waitForFunction(() => {
    const s = window.spanViewportQa.useWorkspaceEditor.getState(), p = s.controller?.getPanelState()
    return s.snapshot?.validation?.kind === 'valid' && !!p?.net && !p.calculating && p.net.nu >= 11 && p.net.nv >= 11
  }, { timeout: 120000 })
  const diagnostic = await page.evaluate(async () => {
    const q = window.spanViewportQa, c = q.useWorkspaceEditor.getState().controller, view = c.getViewState(), net = view.net
    const expand = (knots, multiplicities) => knots.flatMap((knot, i) => Array(multiplicities[i]).fill(knot))
    const intervals = (knots, multiplicities, degree) => {
      const full = expand(knots, multiplicities), found = []
      for (let span = degree; span < full.length - degree - 1; span++)
        if (full[span] < full[span + 1]) found.push({ first: span - degree, bounds: [full[span], full[span + 1]] })
      return found
    }
    const uSpans = intervals(net.ku, net.mu, net.du), vSpans = intervals(net.kv, net.mv, net.dv)
    const free = new Set(net.poles.flatMap((_, id) => !view.locked.includes(id) && !view.hiddenPoles.includes(id) ? [id] : []))
    const eligible = new Set(), supportZones = []
    for (const u of uSpans) for (const v of vSpans) {
      const ids = []
      for (let i = 0; i <= net.du; i++) for (let j = 0; j <= net.dv; j++) ids.push((u.first + i) * net.nv + v.first + j)
      if (ids.length === 16 && ids.every(id => free.has(id))) {
        ids.forEach(id => eligible.add(id))
        supportZones.push({ uBounds: u.bounds, vBounds: v.bounds, supportIds: ids })
      }
    }
    const candidates = [...eligible].map(id => ({ id, pole: net.poles[id] }))
      .sort((a, b) => Math.hypot(a.pole[0] - 7.89, a.pole[2] - 4.765) - Math.hypot(b.pole[0] - 7.89, b.pole[2] - 4.765))
    const chosen = candidates.find(candidate => {
      const id = candidate.id, u = Math.floor(id / net.nv), v = id % net.nv
      return u > 0 && u < net.nu - 1 && v > 0 && v < net.nv - 1
    })
    const canvas = q.scene.layerHost().canvas, rect = canvas.getBoundingClientRect(), camera = q.scene.layerHost().camera()
    const group = q.scene.layerHost().partGroup
    group.updateWorldMatrix(true, true); camera.updateMatrixWorld(true)
    const world = chosen ? group.position.clone().set(...chosen.pole).applyMatrix4(group.matrixWorld) : null
    const projected = world?.clone().project(camera) ?? null
    const x = projected ? rect.left + (projected.x + 1) * rect.width / 2 : null
    const y = projected ? rect.top + (1 - projected.y) * rect.height / 2 : null
    const rectInfo = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
      width: rect.width, height: rect.height }
    const ndc = projected ? { x: projected.x, y: projected.y, z: projected.z } : null
    const finite = !!projected && [projected.x, projected.y, projected.z].every(Number.isFinite)
    const depthInRange = finite && Math.abs(projected.z) < 1
    const insideMargin = finite && x > rect.left + 12 && x < rect.right - 12 && y > rect.top + 12 && y < rect.bottom - 12
    const top = x !== null && y !== null ? document.elementFromPoint(x, y) : null
    const describe = element => element ? { tag: element.tagName, id: element.id || null,
      className: typeof element.className === 'string' ? element.className : null,
      dataTest: element.getAttribute('data-test'), ariaLabel: element.getAttribute('aria-label'),
      title: element.getAttribute('title'), outerHTML: element.outerHTML.slice(0, 500) } : null
    const stack = x !== null && y !== null ? document.elementsFromPoint(x, y).slice(0, 8).map(describe) : []
    const cameraPosition = camera.position.toArray(), cameraQuaternion = camera.quaternion.toArray()
    const faceWitness = await c.runtime.worker.ask({ action: 'finalFaceWitness', previewRevision: view.preview.previewRevision })
    return { refinement: { nu: net.nu, nv: net.nv, degree: [net.du, net.dv], face: view.face,
      lockedCount: view.locked.length, hiddenCount: view.hiddenPoles.length },
      supportZoneCount: supportZones.length, supportZones, chosenSeed: chosen ? { id: chosen.id, pole: chosen.pole } : null,
      faceWitness,
      projection: { ndc, x, y, finite, depthInRange, insideMargin, clientWidth: canvas.clientWidth,
        clientHeight: canvas.clientHeight, backingWidth: canvas.width, backingHeight: canvas.height,
        canvas: describe(canvas), canvasRect: rectInfo, hostRect: rectInfo, hitIsCanvas: !!top && top === canvas,
        elementAtPoint: describe(top), elementsAtPoint: stack },
      viewport: { innerWidth: window.innerWidth, innerHeight: window.innerHeight, outerWidth: window.outerWidth,
        outerHeight: window.outerHeight, devicePixelRatio: window.devicePixelRatio,
        visualViewport: window.visualViewport ? { width: window.visualViewport.width, height: window.visualViewport.height,
          offsetLeft: window.visualViewport.offsetLeft, offsetTop: window.visualViewport.offsetTop, scale: window.visualViewport.scale } : null,
        canvasCount: document.querySelectorAll('.viewport canvas').length },
      orientation: { requestedView: 'front', cameraPosition, cameraQuaternion, cameraUp: camera.up.toArray(),
        cameraRotation: camera.rotation.toArray() },
      noPointerEventIssued: true }
  })
  const { faceWitness, ...viewportDiagnostic } = diagnostic
  const witnessFace = kernel.fromBREP(faceWitness.faceBrep)
  try {
    viewportDiagnostic.uvClassification = diagnostic.supportZones.map(zone => {
      const u = (zone.uBounds[0] + zone.uBounds[1]) / 2, v = (zone.vBounds[0] + zone.vBounds[1]) / 2
      return { u, v, classification: kernel.classifyPointOnFace(witnessFace, u, v), supportIds: zone.supportIds }
    })
  } finally { kernel.release(witnessFace) }
  report.face = face
  report.diagnostic = viewportDiagnostic
  report.checks.push('R01 face 0 imported and refined; seed projection and DOM hit-test observed without pointer input')
  report.verdict = 'PASS_READ_ONLY_VIEWPORT_DIAGNOSTIC'
} catch (error) {
  report.error = String(error?.stack ?? error)
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  try {
    report.cadSha256After = sha(readFileSync(cadPath))
    report.sourceHashUnchanged = report.cadSha256After === expected.cad
    if (!report.sourceHashUnchanged) { report.verdict = 'FAIL_SOURCE_HASH_CHANGED'; process.exitCode = 1 }
  } catch (error) {
    report.sourceHashUnchanged = false
    report.sourceHashError = String(error)
    report.verdict = 'FAIL_SOURCE_HASH_UNREADABLE'
    process.exitCode = 1
  }
  kernel[Symbol.dispose]()
  writeFileSync(join(out, 'result.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ out, ...report }))
}
