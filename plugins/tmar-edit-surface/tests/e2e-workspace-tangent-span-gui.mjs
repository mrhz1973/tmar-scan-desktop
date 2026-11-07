// SPDX-License-Identifier: AGPL-3.0-only
// Isolated GUI proof of reviewed UV-span tangent flattening using a synthetic
// STEP box only. One viewport click, review, apply, sample check, and one Undo.
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
  scope: 'isolated reviewed UV-span tangent flattening: refine, select support poles, one viewport pick, review, apply, sample comparison, Undo',
  appUrl: url.href,
  fixture: { kind: 'synthetic 20 x 30 x 10 mm STEP box', inputSha256 },
  checks: [],
  limitations: ['Only the synthetic top plane and one UV knot span are exercised.',
    'STEP import and fixture setup are harness-driven; the span point selection and Apply/Undo use actual UI actions.',
    'No user CAD, scan, project save, packaged desktop, or general NURBS surface qualification.'],
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
      useReverse, useStore, sourceId, sourceStep: new TextDecoder().decode(source.file.bytes) }
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
  assert.equal(await page.$eval('[data-test=surface-tangent-span-apply]', element => element.disabled), false,
    'The explicit zone Apply control must be enabled after review.')
  report.review = { ...review.review, text: reviewText, clickedUv: [review.pin.pin.anchor.u, review.pin.pin.anchor.v],
    point: review.pin.pin.at, normal: review.pin.pin.normal }
  check(true, 'One actual viewport click produces a visible UV-zone review before applying')

  const sampleUVs = [0.1, 0.5, 0.9].flatMap(u => [0.1, 0.5, 0.9].map(v => [
    review.review.u[0] + u * (review.review.u[1] - review.review.u[0]),
    review.review.v[0] + v * (review.review.v[1] - review.review.v[0]),
  ]))
  const preApplyWitness = await page.evaluate(async () => {
    const c = window.tangentSpanQa.useWorkspaceEditor.getState().controller
    return c.runtime.worker.ask({ action: 'finalFaceWitness', previewRevision: c.getViewState().preview.previewRevision })
  })
  const preApplyFace = kernel.fromBREP(preApplyWitness.faceBrep)
  let samplesBefore
  try {
    samplesBefore = sampleUVs.map(([u, v]) => {
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
  let samplesAfter
  try {
    samplesAfter = sampleUVs.map(([u, v]) => {
      const p = kernel.pointOnSurface(afterFace, u, v)
      return [p.x, p.y, p.z]
    })
  } finally { kernel.release(afterFace) }
  const afterSampleResiduals = samplesAfter.map(point => Math.abs(signedPlaneDistance(point)))
  assert(Math.max(...afterSampleResiduals) < 1e-6, `Applied span samples are not on the reviewed plane: ${JSON.stringify(afterSampleResiduals)}.`)
  const sampleDisplacements = samplesAfter.map((point, index) => Math.hypot(...point.map((value, axis) => value - samplesBefore[index][axis])))
  assert(Math.max(...sampleDisplacements) > 1e-4, 'CAD samples did not move measurably inside the reviewed span.')
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
      beforePlaneResidualMm: beforeSampleResiduals[i], afterPlaneResidualMm: afterSampleResiduals[i] })), changedPoleIds: changedIds }
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
  report.verdict = 'PASS_BOUNDED_GUI_TANGENT_SPAN'
} catch (error) {
  report.error = String(error?.stack ?? error)
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  kernel[Symbol.dispose]()
  writeFileSync(join(out, 'result.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ out, ...report }))
}
