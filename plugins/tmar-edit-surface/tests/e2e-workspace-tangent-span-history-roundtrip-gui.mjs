// SPDX-License-Identifier: AGPL-3.0-only
// Isolated GUI proof of reviewed UV-span tangent flattening using a synthetic
// STEP box only, including host Apply, project Undo/Redo, and Save/Load.
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
const out = mkdtempSync(join(resolve(outputRoot), 'workspace-tangent-span-gui-'))
process.env.SHOT_DIR = out

const { OcctKernel } = await import('occt-wasm')
const { launchApp } = await import('../../../scripts/e2e-lib.mjs')
const kernel = await OcctKernel.init()
const box = kernel.makeBox(20, 30, 10)
let step
try { step = kernel.exportStep(box) } finally { kernel.release(box) }
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const inputSha256 = sha(step)
writeFileSync(join(out, 'synthetic-box.step'), step)
const geometrySignature = text => {
  const shape = kernel.importStep(text), faces = kernel.getSubShapes(shape, 'face'), solids = kernel.getSubShapes(shape, 'solid')
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
const report = {
  scope: 'isolated reviewed UV-span tangent flattening: viewport review/apply, project Undo/Redo, and save/reopen roundtrip',
  appUrl: url.href,
  fixture: { kind: 'synthetic 20 x 30 x 10 mm STEP box', inputSha256 },
  checks: [],
  limitations: ['Only the synthetic top plane and one UV knot span are exercised.',
    'STEP import and fixture setup are harness-driven; span selection, review, Apply, Undo/Redo, Save, and reopen use UI controls.',
    'No user CAD, scan, packaged desktop, or general NURBS surface qualification.'],
  prerequisites: ['Isolated QA host at 127.0.0.1:17527 with the WIP tangent-span command loaded.',
    'Run from the ScanRuler checkout with SCANRULER_ISOLATED=1 and EDIT_SURFACE_QA_OUT outside the checkout.'],
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
    const { useHistory } = await import('/src/state/historyStore.ts')
    useStore.getState().setNavScheme('fusion')
    useShell.getState().setWorkspace('reverse')
    for (let i = 0; !reverseSession() && i < 500; i++) await new Promise(resolve => setTimeout(resolve, 20))
    if (!reverseSession()) throw Error('Isolated CAD session unavailable')
    await reverseSession().startKernel(); await reverseSession().settled()
    await runCommand('reverse.import.step', { bytes: new TextEncoder().encode(stepText), name: 'synthetic-box.step' })
    await reverseSession().settled()
    const scene = sceneOf(), reverse = useReverse.getState(), sourceId = reverse.bodies[0]?.id
    if (!scene || !sourceId || reverse.bodies.length !== 1) throw Error('Synthetic STEP did not import as one isolated body')
    const source = await runCommand('reverse.body.edit_source', { body: sourceId })
    scene.fitToView(); scene.viewFrom('top')
    window.tangentSpanQa = { runCommand, scene, reScene: reSceneOf(scene), useWorkspaceEditor,
      useReverse, useStore, useHistory, sourceId, sourceStep: new TextDecoder().decode(source.file.bytes),
      initialBodyCount: reverse.bodies.length, initialHistoryLength: useHistory.getState().past.length }
  }, step)
  await page.waitForFunction(() => {
    const q = window.tangentSpanQa
    return !!q.reScene.bodyMeshes.get(q.sourceId) && !q.useReverse.getState().building && !q.useStore.getState().busy
  }, { timeout: 120000 })
  await page.waitForSelector('[data-test=feature-edit-surface]:enabled', { timeout: 60000 })
  await page.click('[data-test=feature-edit-surface]')
  await page.waitForSelector('[data-test=workspace-surface-parameters]', { timeout: 120000 })
  const faceIndex = await page.evaluate(() => {
    const c = window.tangentSpanQa.useWorkspaceEditor.getState().controller
    const meshes = c.getViewState().preview.faceMeshes
    const face = c.getPanelState().faces.find(item => item.kind === 'plane' && !item.reason &&
      [...meshes[item.index].positions].filter((_, i) => i % 3 === 2).every(z => Math.abs(z - 10) < 1e-4))
    if (!face) throw Error('Synthetic top plane was not found')
    return face.index
  })
  await page.select('[data-test=surface-face]', String(faceIndex))
  await page.waitForFunction(() => {
    const s = window.tangentSpanQa.useWorkspaceEditor.getState(), p = s.controller?.getPanelState()
    return s.snapshot?.validation?.kind === 'valid' && !!p?.net && !p.calculating
  }, { timeout: 120000 })
  await page.click('[data-test=surface-refine-both]')
  await page.waitForFunction(() => {
    const s = window.tangentSpanQa.useWorkspaceEditor.getState(), p = s.controller?.getPanelState()
    return s.snapshot?.validation?.kind === 'valid' && !!p?.net && !p.calculating
      && p.net.nu >= 3 && p.net.nv >= 3
  }, { timeout: 120000 })
  await page.click('[data-test=surface-refine-both]')
  await page.waitForFunction(() => {
    const s = window.tangentSpanQa.useWorkspaceEditor.getState(), p = s.controller?.getPanelState()
    return s.snapshot?.validation?.kind === 'valid' && !!p?.net && !p.calculating
      && p.net.nu >= 11 && p.net.nv >= 11
  }, { timeout: 120000 })
  report.refinement = await page.evaluate(() => {
    const p = window.tangentSpanQa.useWorkspaceEditor.getState().controller.getPanelState()
    return { nu: p.net.nu, nv: p.net.nv, degree: [p.net.du, p.net.dv] }
  })
  await page.select('[data-test=surface-selection-mode]', 'points')

  const deformationPick = await page.evaluate(() => {
    const q = window.tangentSpanQa, c = q.useWorkspaceEditor.getState().controller, view = c.getViewState(), net = view.net
    const candidates = net.poles.flatMap((pole, id) => {
      const u = Math.floor(id / net.nv), v = id % net.nv
      return u > 0 && u < net.nu - 1 && v > 0 && v < net.nv - 1 && !view.locked.includes(id) ? [{ id, pole }] : []
    }).sort((a, b) => Math.hypot(a.pole[0] - 10, a.pole[1] - 15) - Math.hypot(b.pole[0] - 10, b.pole[1] - 15))
    const chosen = candidates[0]
    if (!chosen) throw Error('No editable interior pole exists after refinement')
    const host = q.scene.layerHost(), canvas = host.canvas, rect = canvas.getBoundingClientRect(), camera = host.camera(), group = host.partGroup
    group.updateWorldMatrix(true, true); camera.updateMatrixWorld(true)
    const p = group.position.clone().set(...chosen.pole).applyMatrix4(group.matrixWorld).project(camera)
    const x = rect.left + (p.x + 1) * rect.width / 2, y = rect.top + (1 - p.y) * rect.height / 2
    const visible = Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) && Math.abs(p.z) < 1
      && x > rect.left + 12 && x < rect.right - 12 && y > rect.top + 12 && y < rect.bottom - 12
      && document.elementFromPoint(x, y) === canvas
    return { id: chosen.id, pole: chosen.pole, x, y, visible, net: structuredClone(net), locked: [...view.locked] }
  })
  assert(deformationPick.visible, `Seed pole is not directly clickable: ${JSON.stringify(deformationPick)}`)
  await page.mouse.click(deformationPick.x, deformationPick.y)
  await page.waitForFunction(id => {
    const p = window.tangentSpanQa.useWorkspaceEditor.getState().controller?.getPanelState()
    return p?.selected?.length === 1 && p.selected[0] === id
  }, { timeout: 30000 }, deformationPick.id)
  await page.select('[data-test=surface-drag-mode]', 'axis')
  await page.click('[data-test=surface-axis-2]')
  await page.$eval('[data-test=surface-distance]', element => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, '0.2')
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.click('[data-test=surface-move]')
  await page.waitForFunction(() => {
    const s = window.tangentSpanQa.useWorkspaceEditor.getState(), p = s.controller?.getPanelState()
    return s.snapshot?.validation?.kind === 'valid' && !p?.busy && !p?.calculating
  }, { timeout: 120000 })
  const beforeReview = await page.evaluate(() => {
    const c = window.tangentSpanQa.useWorkspaceEditor.getState().controller, p = c.getPanelState()
    return { net: structuredClone(p.net), selected: [...p.selected], historyRevision: c.getSnapshot().historyRevision,
      previewRevision: c.getViewState().preview.previewRevision }
  })
  assert.deepEqual(beforeReview.selected, [deformationPick.id], 'Only the seed pole should be selected before support review.')
  assert(Math.abs(beforeReview.net.poles[deformationPick.id][2] - deformationPick.pole[2]) > 0.1,
    'Seed pole did not move enough to create a nonplanar span.')

  const selectFree = await page.evaluateHandle(() => [...document.querySelectorAll('[data-test=workspace-surface-parameters] button')]
    .find(button => button.textContent?.trim() === 'Seleziona liberi'))
  assert(selectFree.asElement(), 'Visible “Seleziona liberi” control exists.')
  await selectFree.asElement().click()
  const selectedSupports = await page.evaluate(() => {
    const c = window.tangentSpanQa.useWorkspaceEditor.getState().controller, p = c.getPanelState(), v = c.getViewState()
    return { selected: [...p.selected], locked: [...p.locked], hidden: [...v.hiddenPoles],
      canTargetPoint: p.canTargetPoint, freeBoundary: p.freeBoundary }
  })
  assert(selectedSupports.selected.includes(deformationPick.id), 'The deformed pole must be included in the free support selection.')
  assert(selectedSupports.canTargetPoint && !selectedSupports.freeBoundary, 'Span mode requires a valid face and protected boundary.')

  await page.click('[data-test=surface-point-tangent-span]')
  await page.waitForFunction(() => window.tangentSpanQa.useWorkspaceEditor.getState().controller?.getPanelState().surfaceTarget === 'tangent-span',
    { timeout: 30000 })
  const witness = await page.evaluate(async () => {
    const c = window.tangentSpanQa.useWorkspaceEditor.getState().controller
    return c.runtime.worker.ask({ action: 'finalFaceWitness', previewRevision: c.getViewState().preview.previewRevision })
  })
  const net = beforeReview.net
  const expanded = (knots, multiplicities) => knots.flatMap((knot, index) => Array(multiplicities[index]).fill(knot))
  const spans = (knots, multiplicities, degree) => {
    const full = expanded(knots, multiplicities), found = []
    for (let span = degree; span < full.length - degree - 1; span++) {
      if (full[span] < full[span + 1]) found.push({ first: span - degree, bounds: [full[span], full[span + 1]] })
    }
    return found
  }
  const uSpans = spans(net.ku, net.mu, net.du), vSpans = spans(net.kv, net.mv, net.dv)
  const supportIds = (u, v) => {
    const ids = []
    for (let i = 0; i <= net.du; i++) for (let j = 0; j <= net.dv; j++)
      ids.push((u.first + i) * net.nv + v.first + j)
    return ids
  }
  const witnessFace = kernel.fromBREP(witness.faceBrep)
  let uvChoice, clickPoint
  try {
    const choices = []
    for (const uSpan of uSpans) for (const vSpan of vSpans) {
      const ids = supportIds(uSpan, vSpan)
      if (!ids.includes(deformationPick.id) || !ids.every(id => selectedSupports.selected.includes(id)
          && !selectedSupports.locked.includes(id) && !selectedSupports.hidden.includes(id))) continue
      const u = (uSpan.bounds[0] + uSpan.bounds[1]) / 2, v = (vSpan.bounds[0] + vSpan.bounds[1]) / 2
      if (kernel.classifyPointOnFace(witnessFace, u, v) !== 'in') continue
      const point = kernel.pointOnSurface(witnessFace, u, v)
      const at = [point.x, point.y, point.z]
      const score = Math.hypot(...at.map((value, axis) => value - beforeReview.net.poles[deformationPick.id][axis]))
      choices.push({ u, v, uBounds: uSpan.bounds, vBounds: vSpan.bounds, ids, at, score })
    }
    choices.sort((a, b) => a.score - b.score)
    uvChoice = choices[0]
    if (!uvChoice) throw Error('No interior UV span supports the selected deformation pole; stop without fallback.')
    clickPoint = uvChoice.at
  } finally { kernel.release(witnessFace) }
  report.requestedZone = { u: uvChoice.u, v: uvChoice.v, uBounds: uvChoice.uBounds, vBounds: uvChoice.vBounds,
    supportIds: uvChoice.ids, seedPole: deformationPick.id }
  await page.evaluate(zone => { window.tangentSpanQa.requestedZone = zone }, report.requestedZone)

  const projected = await page.evaluate(point => {
    const q = window.tangentSpanQa, host = q.scene.layerHost(), canvas = host.canvas, rect = canvas.getBoundingClientRect()
    const camera = host.camera(), group = host.partGroup
    group.updateWorldMatrix(true, true); camera.updateMatrixWorld(true)
    const p = group.position.clone().set(...point).applyMatrix4(group.matrixWorld).project(camera)
    const x = rect.left + (p.x + 1) * rect.width / 2, y = rect.top + (1 - p.y) * rect.height / 2
    const visible = Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) && Math.abs(p.z) < 1
      && x > rect.left + 12 && x < rect.right - 12 && y > rect.top + 12 && y < rect.bottom - 12
      && document.elementFromPoint(x, y) === canvas
    return { point, x, y, visible, canvasCount: document.querySelectorAll('.viewport canvas').length }
  }, clickPoint)
  report.viewportPick = projected
  assert(projected.visible && projected.canvasCount === 1,
    `Fixed interior span point is not visible/clickable; no alternative will be tried: ${JSON.stringify(projected)}`)
  const prePickMessage = await page.evaluate(() =>
    window.tangentSpanQa.useWorkspaceEditor.getState().controller.getPanelState().message)
  await page.evaluate(() => {
    const q = window.tangentSpanQa, c = q.useWorkspaceEditor.getState().controller
    const original = c.pickTangentPlane.bind(c)
    c.pickTangentPlane = async point => {
      const revision = c.getViewState().preview.previewRevision
      const pin = await c.runtime.worker.ask({ action: 'notePick', point, previewRevision: revision })
      q.tangentPick = { point, pin }
      return original(point)
    }
  })
  await page.mouse.click(projected.x, projected.y)
  try {
    await page.waitForFunction(previousMessage => {
      const p = window.tangentSpanQa.useWorkspaceEditor.getState().controller?.getPanelState()
      return !!p?.tangentSpanReview || p?.message !== previousMessage || p?.surfaceTarget !== 'tangent-span'
    }, { timeout: 30000 }, prePickMessage)
  } catch (error) {
    let diagnostic = null
    try {
      diagnostic = await page.evaluate(() => {
        const q = window.tangentSpanQa, s = q.useWorkspaceEditor.getState(), c = s.controller, p = c?.getPanelState()
        return { phase: s.phase, error: s.error ?? null, surfaceTarget: p?.surfaceTarget ?? null,
          busy: p?.busy ?? null, calculating: p?.calculating ?? null, message: p?.message ?? null,
          tangentSpanReview: p?.tangentSpanReview ?? null, selected: p?.selected ?? null,
          locked: p?.locked ?? null, hidden: c?.getViewState().hiddenPoles ?? null,
          supportPoles: (q.requestedZone?.supportIds ?? []).map(id => ({ id, pole: p?.net?.poles[id] ?? null,
            selected: p?.selected?.includes(id) ?? false, locked: p?.locked?.includes(id) ?? false,
            hidden: c?.getViewState().hiddenPoles?.includes(id) ?? false })),
          validation: s.snapshot?.validation ?? null, pickedPoint: q.tangentPick ?? null,
          viewFace: c?.getViewState().face ?? null, alert: document.querySelector('[role=alert]')?.textContent ?? null }
      })
    } catch (diagnosticError) { diagnostic = { diagnosticError: String(diagnosticError) } }
    report.spanPickFailure = diagnostic
    throw new Error(`Viewport click ended without a UV-span review: ${JSON.stringify(diagnostic)}; wait error: ${String(error)}`)
  }
  const review = await page.evaluate(() => {
    const c = window.tangentSpanQa.useWorkspaceEditor.getState().controller, p = c.getPanelState()
    return { review: structuredClone(p.tangentSpanReview), surfaceTarget: p.surfaceTarget,
      message: p.message, historyRevision: c.getSnapshot().historyRevision,
      pin: window.tangentSpanQa.tangentPick, selected: [...p.selected], locked: [...p.locked],
      hidden: [...c.getViewState().hiddenPoles], net: structuredClone(p.net) }
  })
  report.spanPickState = { surfaceTarget: review.surfaceTarget, message: review.message,
    review: review.review, pickedPoint: review.pin ?? null }
  if (!review.review || review.surfaceTarget !== 'tangent-span') {
    const picked = review.pin?.pin, normal = picked?.normal, at = picked?.at
    const length = normal ? Math.hypot(...normal) : 0
    const unit = length > 0 ? normal.map(value => value / length) : null
    report.spanPickFailure = { message: review.message, surfaceTarget: review.surfaceTarget,
      pickedPoint: review.pin ?? null, supportPoles: uvChoice.ids.map(id => {
        const pole = review.net.poles[id]
        const signedDistance = unit && at ? pole.reduce((sum, value, axis) => sum + (value - at[axis]) * unit[axis], 0) : null
        return { id, selected: review.selected.includes(id), locked: review.locked.includes(id),
          hidden: review.hidden.includes(id), signedDistanceMm: signedDistance }
      }) }
    throw new Error(`Tangent-span pick refused before review: ${JSON.stringify(report.spanPickFailure)}`)
  }
  assert.equal(review.surfaceTarget, 'tangent-span', 'Review must remain open until the explicit Apply action.')
  assert.deepEqual(review.selected, selectedSupports.selected, 'Review must not change the support selection.')
  assert.equal(review.review.supportCount, uvChoice.ids.length, 'Review support count must match the selected UV span.')
  assert(review.review.movedCount > 0 && review.review.movedCount <= review.review.supportCount,
    'Review must report at least one moved pole within the chosen span.')
  assert(review.review.u[0] < uvChoice.u && uvChoice.u < review.review.u[1]
    && review.review.v[0] < uvChoice.v && uvChoice.v < review.review.v[1], 'Visible review zone does not contain the clicked UV point.')
  assert(review.pin?.pin?.at && review.pin?.pin?.normal, 'Viewport click did not resolve to a real CAD point and normal.')
  const reviewText = await page.$eval('[data-test=surface-tangent-span-review]', element => element.textContent)
  assert.match(reviewText, /Verranno mossi/i, 'Review summary is not visible in the panel.')
  const reviewedDisplacementLimit = review.review.maxSurfaceDisplacementMm
  assert(Number.isFinite(reviewedDisplacementLimit) && reviewedDisplacementLimit >= 0,
    `Review must expose a finite maximum surface displacement: ${reviewedDisplacementLimit}`)
  const displayedLimit = reviewText.match(/(?:spostamento|massimo)[^\d]*([\d.,]+)\s*mm/i)
  assert(displayedLimit, `Review text must show the maximum surface displacement limit: ${reviewText}`)
  const displayedLimitMm = Number(displayedLimit[1].replace(',', '.'))
  assert(Number.isFinite(displayedLimitMm) && displayedLimitMm >= reviewedDisplacementLimit,
    `Displayed rounded limit ${displayedLimitMm} mm must cover review value ${reviewedDisplacementLimit} mm.`)
  assert.equal(await page.$eval('[data-test=surface-tangent-span-apply]', element => element.disabled), false,
    'The explicit zone Apply control must be enabled after review.')
  report.review = { ...review.review, text: reviewText, clickedUv: [review.pin.pin.anchor.u, review.pin.pin.anchor.v],
    point: review.pin.pin.at, normal: review.pin.pin.normal }
  check(true, 'One actual viewport click produces a visible UV-zone review before applying')

  const sampleUVs = [0.1, 0.5, 0.9].flatMap(u => [0.1, 0.5, 0.9].map(v => [
    review.review.u[0] + u * (review.review.u[1] - review.review.u[0]),
    review.review.v[0] + v * (review.review.v[1] - review.review.v[0]),
  ]))
  const spanIndex = (items, bounds) => items.findIndex(item =>
    Math.abs(item.bounds[0] - bounds[0]) <= 1e-10 && Math.abs(item.bounds[1] - bounds[1]) <= 1e-10)
  const chosenU = spanIndex(uSpans, uvChoice.uBounds), chosenV = spanIndex(vSpans, uvChoice.vBounds)
  assert(chosenU >= 0 && chosenV >= 0, 'Reviewed UV bounds must match spans in the same source net.')
  const adjacentSpans = [
    ...(chosenU > 0 ? [{ side: 'u-low', uBounds: uSpans[chosenU - 1].bounds, vBounds: uvChoice.vBounds }] : []),
    ...(chosenU + 1 < uSpans.length ? [{ side: 'u-high', uBounds: uSpans[chosenU + 1].bounds, vBounds: uvChoice.vBounds }] : []),
    ...(chosenV > 0 ? [{ side: 'v-low', uBounds: uvChoice.uBounds, vBounds: vSpans[chosenV - 1].bounds }] : []),
    ...(chosenV + 1 < vSpans.length ? [{ side: 'v-high', uBounds: uvChoice.uBounds, vBounds: vSpans[chosenV + 1].bounds }] : []),
  ].map(span => ({ ...span, sampleUVs: [0.1, 0.5, 0.9].flatMap(u => [0.1, 0.5, 0.9].map(v => [
    span.uBounds[0] + u * (span.uBounds[1] - span.uBounds[0]),
    span.vBounds[0] + v * (span.vBounds[1] - span.vBounds[0]),
  ])) }))
  const adjacentUVs = adjacentSpans.flatMap(span => span.sampleUVs)
  const preApplyWitness = await page.evaluate(async () => {
    const c = window.tangentSpanQa.useWorkspaceEditor.getState().controller
    return c.runtime.worker.ask({ action: 'finalFaceWitness', previewRevision: c.getViewState().preview.previewRevision })
  })
  const preApplyFace = kernel.fromBREP(preApplyWitness.faceBrep)
  let samplesBefore, adjacentSamplesBefore
  try {
    samplesBefore = sampleUVs.map(([u, v]) => {
      const p = kernel.pointOnSurface(preApplyFace, u, v)
      return [p.x, p.y, p.z]
    })
    adjacentSamplesBefore = adjacentUVs.map(([u, v]) => {
      const p = kernel.pointOnSurface(preApplyFace, u, v)
      return [p.x, p.y, p.z]
    })
  } finally { kernel.release(preApplyFace) }
  const tangentNormal = review.pin.pin.normal, tangentAt = review.pin.pin.at
  const tangentUnit = tangentNormal.map(value => value / Math.hypot(...tangentNormal))
  const signedPlaneDistance = point => point.reduce((sum, value, axis) => sum + (value - tangentAt[axis]) * tangentUnit[axis], 0)
  const beforeSampleResiduals = samplesBefore.map(point => Math.abs(signedPlaneDistance(point)))
  assert(Math.max(...beforeSampleResiduals) > 1e-6, 'Pre-Apply span samples do not show a measurable departure from the picked tangent plane.')
  await page.click('[data-test=surface-tangent-span-apply]')
  await page.waitForFunction(previous => {
    const s = window.tangentSpanQa.useWorkspaceEditor.getState(), p = s.controller?.getPanelState()
    return s.snapshot?.validation?.kind === 'valid' && !p?.busy && !p?.calculating
      && p?.surfaceTarget === null && s.snapshot.historyRevision === previous + 1
  }, { timeout: 120000 }, review.historyRevision)
  const afterApply = await page.evaluate(() => {
    const c = window.tangentSpanQa.useWorkspaceEditor.getState().controller, p = c.getPanelState()
    return { net: structuredClone(p.net), message: p.message, historyRevision: c.getSnapshot().historyRevision,
      canUndo: p.canUndo }
  })
  const changedIds = afterApply.net.poles.flatMap((pole, id) =>
    pole.some((value, axis) => value !== review.net.poles[id][axis]) ? [id] : [])
  assert.equal(changedIds.length, review.review.movedCount, 'Changed pole count must equal the reviewed movement count.')
  assert(changedIds.every(id => uvChoice.ids.includes(id) && selectedSupports.selected.includes(id)),
    'Only selected free support poles may change.')
  for (const id of uvChoice.ids) {
    const pole = afterApply.net.poles[id], residual = Math.abs(signedPlaneDistance(pole))
    assert(residual <= 1e-8, `Applied span support pole ${id} lies outside the tangent plane by ${residual} mm.`)
  }
  assert.match(afterApply.message ?? '', /Zona UV proiettata/i, `Span Apply did not complete: ${afterApply.message}`)

  const afterWitness = await page.evaluate(async () => {
    const c = window.tangentSpanQa.useWorkspaceEditor.getState().controller
    return c.runtime.worker.ask({ action: 'finalFaceWitness', previewRevision: c.getViewState().preview.previewRevision })
  })
  const afterFace = kernel.fromBREP(afterWitness.faceBrep)
  let samplesAfter, adjacentSamplesAfter
  try {
    samplesAfter = sampleUVs.map(([u, v]) => {
      const p = kernel.pointOnSurface(afterFace, u, v)
      return [p.x, p.y, p.z]
    })
    adjacentSamplesAfter = adjacentUVs.map(([u, v]) => {
      const p = kernel.pointOnSurface(afterFace, u, v)
      return [p.x, p.y, p.z]
    })
  } finally { kernel.release(afterFace) }
  const afterSampleResiduals = samplesAfter.map(point => Math.abs(signedPlaneDistance(point)))
  assert(Math.max(...afterSampleResiduals) < 1e-6, `Applied span samples are not on the reviewed plane: ${JSON.stringify(afterSampleResiduals)}.`)
  const sampleDisplacements = samplesAfter.map((point, index) => Math.hypot(...point.map((value, axis) => value - samplesBefore[index][axis])))
  assert(Math.max(...sampleDisplacements) > 1e-4, 'CAD samples did not move measurably inside the reviewed span.')
  const adjacentSpanEffects = adjacentSpans.map((span, spanIndex) => {
    const offset = spanIndex * 9
    const samples = span.sampleUVs.map((uv, sampleIndex) => {
      const before = adjacentSamplesBefore[offset + sampleIndex], after = adjacentSamplesAfter[offset + sampleIndex]
      return { uv, before, after, displacementMm: Math.hypot(...after.map((value, axis) => value - before[axis])) }
    })
    return { side: span.side, uBounds: span.uBounds, vBounds: span.vBounds, samples,
      maxDisplacementMm: Math.max(...samples.map(sample => sample.displacementMm)) }
  })
  const measuredSurfaceDisplacementMm = Math.max(
    ...sampleDisplacements,
    ...adjacentSpanEffects.flatMap(span => span.samples.map(sample => sample.displacementMm)),
  )
  assert(reviewedDisplacementLimit + 1e-9 >= measuredSurfaceDisplacementMm,
    `Review limit ${reviewedDisplacementLimit} mm must cover measured span and adjacent sample displacement ${measuredSurfaceDisplacementMm} mm.`)
  const protectedBoundaryIds = review.locked
  const protectedBoundaryMaxDeltaMm = protectedBoundaryIds.reduce((maxDelta, id) => {
    const before = review.net.poles[id], after = afterApply.net.poles[id]
    return Math.max(maxDelta, Math.hypot(...after.map((value, axis) => value - before[axis])))
  }, 0)
  assert.equal(protectedBoundaryMaxDeltaMm, 0, 'Protected boundary poles must remain exactly unchanged through Apply.')
  const exported = await page.evaluate(async () => {
    const c = window.tangentSpanQa.useWorkspaceEditor.getState().controller
    return (await c.exportStep()).step
  })
  const editedGeometry = geometrySignature(exported), sourceGeometry = geometrySignature(step)
  assert(editedGeometry.valid && editedGeometry.solidCount === 1 && editedGeometry.faceCount === 6,
    'Edited CAD STEP must remain a valid six-face solid.')
  const bounds = editedGeometry.bounds, sourceBounds = sourceGeometry.bounds
  assert(bounds.slice(0, 5).every((value, index) => Math.abs(value - sourceBounds[index]) <= 1e-5),
    'Span flattening must preserve the untouched lower and lateral solid bounds.')
  assert(Math.abs(bounds[5] - sourceBounds[5]) > 0.01,
    'CAD bounding height should reflect the deliberately displaced and tangent-flattened top span.')
  report.appliedCad = { geometry: editedGeometry, sourceGeometry,
    boundsChangedAsExpected: { source: sourceBounds, edited: bounds },
    samples: sampleUVs.map((uv, i) => ({ uv, before: samplesBefore[i], after: samplesAfter[i], displacementMm: sampleDisplacements[i],
      beforePlaneResidualMm: beforeSampleResiduals[i], afterPlaneResidualMm: afterSampleResiduals[i] })),
    adjacentSpanEffects,
    surfaceDisplacementLimit: { reviewedMm: reviewedDisplacementLimit, displayedMm: displayedLimitMm,
      measuredMaxSampleMm: measuredSurfaceDisplacementMm,
      coversMeasuredSamples: reviewedDisplacementLimit + 1e-9 >= measuredSurfaceDisplacementMm },
    protectedBoundary: { poleCount: protectedBoundaryIds.length, maxDisplacementMm: protectedBoundaryMaxDeltaMm },
    changedPoleIds: changedIds }
  check(true, 'Apply moves only reviewed support poles; UV samples become planar and the exported solid remains valid')

  await page.click('[data-test=surface-undo]')
  await page.waitForFunction(original => {
    const s = window.tangentSpanQa.useWorkspaceEditor.getState(), p = s.controller?.getPanelState()
    return s.snapshot?.validation?.kind === 'valid' && !p?.calculating && p?.canRedo
      && JSON.stringify(p.net.poles) === JSON.stringify(original.poles)
  }, { timeout: 120000 }, review.net)
  const undo = await page.evaluate(async () => {
    const q = window.tangentSpanQa, c = q.useWorkspaceEditor.getState().controller
    const answer = await q.runCommand('reverse.body.edit_source', { body: q.sourceId })
    return { bodyCount: q.useReverse.getState().bodies.length, net: c.getPanelState().net,
      sourceStep: new TextDecoder().decode(answer.file.bytes) }
  })
  assert.equal(undo.bodyCount, 1, 'Draft Undo must leave the synthetic source as the only project body.')
  assert.deepEqual(geometrySignature(undo.sourceStep), sourceGeometry, 'Undo must leave the original synthetic source CAD geometry unchanged.')
  assert.deepEqual(app.consoleErrors, [], 'No application console errors')
  report.undo = { exactPreApplyNet: true, sourceGeometryUnchanged: true }
  check(true, 'One Undo restores the exact reviewed pre-Apply net and original source geometry')

  await page.click('[data-test=surface-redo]')
  await page.waitForFunction(expected => {
    const s = window.tangentSpanQa.useWorkspaceEditor.getState(), p = s.controller?.getPanelState()
    return s.snapshot?.validation?.kind === 'valid' && !p?.calculating
      && JSON.stringify(p.net.poles) === JSON.stringify(expected.poles)
  }, { timeout: 120000 }, afterApply.net)
  check(true, 'Draft Redo restores the exact reviewed post-Apply net before host Apply')

  const preHostSourceGeometry = geometrySignature(undo.sourceStep)
  await page.waitForSelector('[data-test=workspace-editor-apply]:enabled', { timeout: 120000 })
  await page.click('[data-test=workspace-editor-apply]')
  await page.waitForFunction(() => window.tangentSpanQa.useWorkspaceEditor.getState().phase === 'closed', { timeout: 120000 })
  const applied = await page.evaluate(async () => {
    const q = window.tangentSpanQa, state = q.useReverse.getState(), receipt = q.useWorkspaceEditor.getState().receipt
    if (receipt?.createdBodyIds?.length !== 1) throw Error('Host Apply did not return exactly one created CAD copy')
    const steps = []
    for (const id of [q.sourceId, receipt.createdBodyIds[0]]) {
      const answer = await q.runCommand('reverse.body.edit_source', { body: id })
      steps.push({ id, text: new TextDecoder().decode(answer.file.bytes) })
    }
    return { receipt, bodyCount: state.bodies.length, initialBodyCount: q.initialBodyCount,
      steps, historyDelta: q.useHistory.getState().past.length - q.initialHistoryLength }
  })
  assert.equal(applied.bodyCount, applied.initialBodyCount + 1, 'Host Apply should publish exactly one isolated CAD copy.')
  assert.equal(applied.historyDelta, 1, 'Host Apply should publish exactly one project history step.')
  const [hostSourceGeometry, copyGeometry] = applied.steps.map(item => geometrySignature(item.text))
  assert(hostSourceGeometry.valid && copyGeometry.valid, 'Source and applied STEP copy must both be valid.')
  assert.equal(hostSourceGeometry.solidCount, 1); assert.equal(copyGeometry.solidCount, 1)
  assert.equal(hostSourceGeometry.faceCount, 6); assert.equal(copyGeometry.faceCount, 6)
  assert.deepEqual(hostSourceGeometry, preHostSourceGeometry, 'Host Apply must preserve the original CAD source geometry.')
  assert.deepEqual(copyGeometry, editedGeometry, 'Host-applied STEP copy must match the edited workspace geometry.')
  report.appliedGeometries = { source: hostSourceGeometry, copy: copyGeometry }
  check(true, 'Host Apply publishes one valid edited STEP copy and preserves the original source')

  const readProject = () => page.evaluate(async () => {
    const q = window.tangentSpanQa, state = q.useReverse.getState(), steps = []
    for (const body of state.bodies) {
      const answer = await q.runCommand('reverse.body.edit_source', { body: body.id })
      steps.push({ id: body.id, text: new TextDecoder().decode(answer.file.bytes) })
    }
    return { count: state.bodies.length, steps }
  })
  const historyRevision = async () => page.evaluate(() => window.tangentSpanQa.useHistory.getState().revision)
  const waitHistory = revision => page.waitForFunction(previous => {
    const q = window.tangentSpanQa, history = q.useHistory.getState()
    return history.revision > previous && !history.restoring && !q.useReverse.getState().building
  }, { timeout: 120000 }, revision)
  let revision = await historyRevision()
  await page.click('[data-test=undo]')
  await waitHistory(revision)
  let projectState = await readProject()
  assert.equal(projectState.count, 1, 'Project Undo must remove only the applied CAD copy.')
  assert.deepEqual(geometrySignature(projectState.steps[0].text), hostSourceGeometry, 'Project Undo must preserve original CAD geometry.')
  check(true, 'Project Undo removes the copy and preserves the source solid')

  revision = await historyRevision()
  await page.click('[data-test=redo]')
  await waitHistory(revision)
  projectState = await readProject()
  assert.equal(projectState.count, 2, 'Project Redo must restore the applied CAD copy.')
  const redoGeometries = projectState.steps.map(item => geometrySignature(item.text))
  assert.deepEqual(redoGeometries[0], hostSourceGeometry)
  assert.deepEqual(redoGeometries[1], copyGeometry)
  check(true, 'Project Redo restores the original source and edited CAD copy')

  await page.evaluate(() => {
    const q = window.tangentSpanQa
    q.savedBlob = null
    const originalCreate = URL.createObjectURL, originalClick = HTMLAnchorElement.prototype.click
    q.restoreSaveHooks = () => { URL.createObjectURL = originalCreate; HTMLAnchorElement.prototype.click = originalClick }
    URL.createObjectURL = blob => { q.savedBlob = blob; return 'blob:tangent-span-qa' }
    HTMLAnchorElement.prototype.click = function () {
      if (this.download?.endsWith('.scanruler')) return
      return originalClick.call(this)
    }
  })
  try {
    await page.click('[data-test=save-project]')
    await page.waitForFunction(() => window.tangentSpanQa.savedBlob instanceof Blob, { timeout: 120000 })
    const savedBytes = await page.evaluate(async () => Array.from(new Uint8Array(await window.tangentSpanQa.savedBlob.arrayBuffer())))
    const projectPath = join(out, 'synthetic-tangent-span.scanruler')
    writeFileSync(projectPath, Uint8Array.from(savedBytes))
    report.savedProject = { name: 'synthetic-tangent-span.scanruler', bytes: savedBytes.length,
      sha256: createHash('sha256').update(Uint8Array.from(savedBytes)).digest('hex') }
  } finally {
    await page.evaluate(() => window.tangentSpanQa.restoreSaveHooks?.())
  }
  const projectInput = await page.$('[data-test="project-input"]')
  assert(projectInput, 'Project file input is missing from the isolated host.')
  await projectInput.uploadFile(join(out, 'synthetic-tangent-span.scanruler'))
  await page.waitForFunction(() => {
    const q = window.tangentSpanQa
    return q.useReverse.getState().bodies.length === 2 && !q.useReverse.getState().building
      && q.useStore.getState().statusText.startsWith('Project opened —')
  }, { timeout: 120000 })
  await page.waitForFunction(() => window.tangentSpanQa.useHistory.getState().past.length === 0, { timeout: 30000 })
  const reopened = await readProject()
  const reopenedGeometries = reopened.steps.map(item => geometrySignature(item.text))
  assert.equal(reopened.count, 2)
  assert.deepEqual(reopenedGeometries[0], hostSourceGeometry)
  assert.deepEqual(reopenedGeometries[1], copyGeometry)
  report.reopenedGeometries = reopenedGeometries
  check(true, 'Saved synthetic project reopens with the original and tangent-flattened CAD copy intact')
  assert.deepEqual(app.consoleErrors, [], 'No application console errors')
  report.verdict = 'PASS_BOUNDED_GUI_TANGENT_SPAN_HISTORY_ROUNDTRIP'
} catch (error) {
  report.error = String(error?.stack ?? error)
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  kernel[Symbol.dispose]()
  writeFileSync(join(out, 'result.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ out, ...report }))
}
