// SPDX-License-Identifier: AGPL-3.0-only
// Bounded isolated positive GUI flow for collected multi-anchor targets.
// Uses only a synthetic box STEP and a translated synthetic STL scan.
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
const out = mkdtempSync(join(resolve(outputRoot), 'workspace-multi-anchor-positive-gui-'))
process.env.SHOT_DIR = out

const { OcctKernel } = await import('occt-wasm')
const { importStep, writeBinarySTL } = await import('meshstep')
const { launchApp, loadScan } = await import('../../../scripts/e2e-lib.mjs')
const kernel = await OcctKernel.init()
const box = kernel.makeBox(20, 30, 10)
let sourceStep, scanPath
try {
  sourceStep = kernel.exportStep(box)
  const shifted = kernel.translate(box, 0, 0, 0.02)
  try {
    const shiftedStep = kernel.exportStep(shifted)
    const mesh = importStep(shiftedStep, { surfaceDeviation: 0.005, maxEdge: 2 }).mesh
    scanPath = join(out, 'synthetic-reference-plus-0.02mm.stl')
    writeFileSync(scanPath, Buffer.from(writeBinarySTL(mesh)))
  } finally { kernel.release(shifted) }
} finally { kernel.release(box) }
const sourceSha256 = createHash('sha256').update(sourceStep).digest('hex')
writeFileSync(join(out, 'synthetic-source.step'), sourceStep)

const report = {
  scope: 'isolated positive 0.02 mm multi-anchor collection, removal, keyboard Apply, draft Undo/Redo and CAD Apply',
  appUrl: url.href,
  fixture: { kind: '20 x 30 x 10 mm synthetic box STEP plus parallel STL scan at +0.02 mm', sourceSha256 },
  checks: [],
  limitations: ['Synthetic planar top face and synthetic mesh scan only.', 'Actual viewport clicks are tested; CAD import, scan upload and selection setup are harness-driven.', 'No user project, save/reopen, packaged desktop or QuickSurface parity claim.'],
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
  await loadScan(page, scanPath, { inputSelector: '[data-test=slot-scan] input[type=file]', timeout: 120000 })

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
    await runCommand('reverse.import.step', { bytes: new TextEncoder().encode(stepText), name: 'synthetic-source.step' })
    await reverseSession().settled()
    const scene = sceneOf(), reverse = useReverse.getState(), sourceId = reverse.bodies[0]?.id
    if (!scene || !sourceId || reverse.bodies.length !== 1) throw Error('Synthetic CAD source was not imported as one body')
    useReverse.getState().clearSelection()
    useReverse.getState().setListSelection({ bodies: [], folders: [] })
    scene.fitToView()
    window.multiAnchorQa = { runCommand, scene, reScene: reSceneOf(scene), useWorkspaceEditor,
      useReverse, useStore, history: useHistory, sourceId, initialBodyCount: reverse.bodies.length }
  }, sourceStep)
  await page.waitForFunction(() => {
    const q = window.multiAnchorQa, app = q.useStore.getState()
    return !!q.reScene.bodyMeshes.get(q.sourceId) && !q.useReverse.getState().building && !app.busy
  }, { timeout: 120000 })

  const sourceState = await page.evaluate(async () => {
    const q = window.multiAnchorQa
    const answer = await q.runCommand('reverse.body.edit_source', { body: q.sourceId })
    return { id: q.sourceId, step: new TextDecoder().decode(answer.file.bytes), canvases: document.querySelectorAll('.viewport canvas').length }
  })
  assert.equal(sourceState.canvases, 1, 'The shared host should keep one viewport canvas')
  await page.waitForSelector('[data-test=feature-edit-surface]:enabled', { timeout: 60000 })
  await page.click('[data-test=feature-edit-surface]')
  await page.waitForSelector('[data-test=workspace-surface-parameters]', { timeout: 120000 })
  const faceIndex = await page.evaluate(() => {
    const c = window.multiAnchorQa.useWorkspaceEditor.getState().controller
    const meshes = c.getViewState().preview.faceMeshes
    const face = c.getPanelState().faces.find(item => item.kind === 'plane' && !item.reason &&
      [...meshes[item.index].positions].filter((_, i) => i % 3 === 2).every(z => Math.abs(z - 10) < 1e-4))
    if (!face) throw Error('Synthetic top plane was not found')
    return face.index
  })
  await page.select('[data-test=surface-face]', String(faceIndex))
  await page.waitForFunction(() => {
    const s = window.multiAnchorQa.useWorkspaceEditor.getState(), p = s.controller?.getPanelState()
    return s.snapshot?.validation.kind === 'valid' && !!p?.net && !p.calculating
  }, { timeout: 120000 })
  await page.click('[data-test=surface-refine-both]')
  await page.waitForFunction(() => {
    const s = window.multiAnchorQa.useWorkspaceEditor.getState(), p = s.controller?.getPanelState()
    return s.snapshot?.validation.kind === 'valid' && !!p?.net && !p.calculating && p.net.nu >= 3 && p.net.nv >= 3
  }, { timeout: 120000 })
  const selectFree = await page.evaluateHandle(() => [...document.querySelectorAll('[data-test=workspace-surface-parameters] button')]
    .find(button => button.textContent?.trim() === 'Seleziona liberi'))
  assert(selectFree.asElement(), 'Visible “Seleziona liberi” control exists')
  await selectFree.asElement().click()
  await page.select('[data-test=surface-selection-mode]', 'points')
  await page.waitForFunction(() => {
    const p = window.multiAnchorQa.useWorkspaceEditor.getState().controller?.getPanelState()
    return p?.canTargetPoint && p.selected.some(i => !p.locked.includes(i))
  }, { timeout: 30000 })
  await page.evaluate(() => { const scene=window.multiAnchorQa.scene; scene.viewFrom('top'); scene.fitToView() })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))

  const before = await page.evaluate(() => {
    const q = window.multiAnchorQa, c = q.useWorkspaceEditor.getState().controller, v = c.getViewState()
    const net = v.net, mesh = v.preview.faceMeshes[v.face], zValues = [...mesh.positions].filter((_, i) => i % 3 === 2)
    const xs = [...mesh.positions].filter((_, i) => i % 3 === 0), ys = [...mesh.positions].filter((_, i) => i % 3 === 1)
    const bounds = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), z: zValues.reduce((a,b)=>a+b,0)/zValues.length }
    const host = q.scene.layerHost(), canvas = host.canvas, rect = canvas.getBoundingClientRect(), camera = host.camera(), group = host.partGroup
    group.updateWorldMatrix(true, true); camera.updateMatrixWorld(true)
    const project = local => {
      const p = group.position.clone().set(...local).applyMatrix4(group.matrixWorld).project(camera)
      const x=rect.left + (p.x + 1) * rect.width / 2, y=rect.top + (1 - p.y) * rect.height / 2
      const hit=document.elementFromPoint(x,y),insideCanvas=x>rect.left+12&&x<rect.right-12&&y>rect.top+12&&y<rect.bottom-12
      const finite=Number.isFinite(p.x)&&Number.isFinite(p.y)&&Number.isFinite(p.z),inClip=finite&&Math.abs(p.z)<1
      return { x, y, z:p.z, insideCanvas, inClip, hitTag:hit?.tagName??null,
        hitClass:typeof hit?.className==='string'?hit.className:'', hitCanvas:hit===canvas,
        visible:finite&&inClip&&insideCanvas&&hit===canvas }
    }
    const fractions=[.15,.2,.25,.3,.35,.5,.65,.7,.75,.8,.85],candidates=[]
    for(const u of fractions)for(const v of fractions){
      const local=[bounds.x0+(bounds.x1-bounds.x0)*u,bounds.y0+(bounds.y1-bounds.y0)*v,bounds.z]
      candidates.push({u,v,local,...project(local)})
    }
    const usable=candidates.filter(point=>point.visible),desired=[[.5,.25],[.35,.5],[.65,.5]],points=[]
    for(const [u,v] of desired){
      const ranked=usable.map((point,index)=>({point,index,score:Math.hypot(point.u-u,point.v-v)}))
        .filter(item=>points.every(other=>Math.hypot(...item.point.local.map((x,d)=>x-other.local[d]))>=4))
        .sort((a,b)=>a.score-b.score)
      if(!ranked.length)break
      points.push(ranked[0].point);usable.splice(ranked[0].index,1)
    }
    return { net: structuredClone(net), historyRevision: c.getSnapshot().historyRevision, points,
      pointCandidates: candidates.map(({u,v,local,x,y,z,insideCanvas,inClip,hitTag,hitClass,hitCanvas})=>({u,v,local,x,y,z,insideCanvas,inClip,hitTag,hitClass,hitCanvas})),
      canvas: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
      canvasCount: document.querySelectorAll('.viewport canvas').length }
  })
  assert.equal(before.canvasCount, 1, 'There is one shared viewport canvas')
  assert.equal(before.points.length,3,`Could not find three visible, well-conditioned interior points near the requested UV positions: ${JSON.stringify({canvas:before.canvas,candidates:before.pointCandidates})}`)
  for (const point of before.points) assert(point.visible && point.x > before.canvas.left+12 && point.x < before.canvas.right-12
    && point.y > before.canvas.top+12 && point.y < before.canvas.bottom-12, `Synthetic face pick is outside the visible canvas: ${JSON.stringify(point)}`)
  await page.click('[data-test=surface-point-multiple]')
  assert.equal(await page.$eval('[data-test=surface-point-multiple]', element => element.checked), true)
  await page.click('[data-test=surface-point-scan]')
  await page.waitForSelector('[data-test=surface-point-announcement]')

  const collected = []
  for (let i=0; i<before.points.length; i++) {
    const point = before.points[i]
    await page.mouse.click(point.x, point.y)
    await page.waitForFunction(count => {
      const s = window.multiAnchorQa.useWorkspaceEditor.getState(), p = s.controller?.getPanelState()
      const alert=document.querySelector('[data-test=workspace-surface-parameters] [role=alert]')?.textContent?.trim()
      return (p?.surfaceTargetBatch?.length === count && !p.busy && !p.calculating) || (!!alert&&!p?.busy) || !p?.surfaceTarget
    }, { timeout: 30000 }, i+1)
    const status=await page.evaluate(() => {
      const p = window.multiAnchorQa.useWorkspaceEditor.getState().controller.getPanelState()
      const s=window.multiAnchorQa.useWorkspaceEditor.getState()
      return { count:p.surfaceTargetBatch?.length??0,batch:p.surfaceTargetBatch,poles:p.net?.poles,
        busy:p.busy,validation:s.snapshot?.validation,alert:document.querySelector('[data-test=workspace-surface-parameters] [role=alert]')?.textContent?.trim()??null }
    })
    if(status.count!==i+1)throw Error(`Viewport target ${i+1} was not collected: ${JSON.stringify(status)}`)
    collected.push(status)
    assert.deepEqual(collected.at(-1).poles, before.net.poles, 'Collecting an anchor must not change CAD poles')
  }
  check(collected.at(-1).count === 3, 'Three real viewport clicks collected three scan-to-CAD anchors without changing geometry')
  const retainedPairs = collected.at(-1).batch.slice(1)

  await page.click('[data-test=surface-point-remove]')
  await page.waitForFunction(() => window.multiAnchorQa.useWorkspaceEditor.getState().controller.getPanelState().surfaceTargetBatch?.length === 2)
  check(await page.evaluate(() => {
    const panel = document.querySelector('[data-test=workspace-surface-parameters]')
    return panel?.contains(document.activeElement) && document.activeElement?.getAttribute('data-test') === 'surface-point-remove'
  }), 'Removing one pair keeps keyboard focus on the remaining remove control')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-test')), 'surface-point-apply',
    'Tab navigation reaches the Apply control after the pair list')
  await page.keyboard.press('Enter')
  await page.waitForFunction(previous => {
    const s = window.multiAnchorQa.useWorkspaceEditor.getState(), p = s.controller?.getPanelState()
    const alert=document.querySelector('[data-test=workspace-surface-parameters] [role=alert]')?.textContent?.trim()
    return (!p?.surfaceTarget && s.snapshot?.validation?.kind === 'valid' && !p?.calculating && p?.canUndo
        && s.snapshot.historyRevision === previous + 1) || (!!alert&&!p?.busy)
  }, { timeout: 120000 }, before.historyRevision)
  const applyState=await page.evaluate(previous=>{
    const s=window.multiAnchorQa.useWorkspaceEditor.getState(),c=s.controller,p=c.getPanelState()
    const alert=document.querySelector('[data-test=workspace-surface-parameters] [role=alert]')?.textContent?.trim()??null
    const applied=!p.surfaceTarget&&s.snapshot?.validation?.kind==='valid'&&!p.calculating&&p.canUndo&&s.snapshot.historyRevision===previous+1
    return {applied,alert,validation:s.snapshot?.validation,historyRevision:s.snapshot?.historyRevision,
      panelMessage:p.message,busy:p.busy,calculating:p.calculating,target:p.surfaceTarget,batchCount:p.surfaceTargetBatch?.length??0,
      canUndo:p.canUndo,focus:document.activeElement?.getAttribute('data-test')}
  },before.historyRevision)
  if(!applyState.applied){report.applyFailure=applyState;throw Error(`Multi-anchor Apply refused instead of committing the 0.02 mm case: ${JSON.stringify(applyState)}`)}
  const afterTarget = await page.evaluate(() => {
    const c = window.multiAnchorQa.useWorkspaceEditor.getState().controller, p = c.getPanelState()
    return { net: structuredClone(p.net), pairs: p.surfaceTargetBatch, revision: c.getSnapshot().historyRevision, canUndo: p.canUndo }
  })
  const moved = afterTarget.net.poles.some((p,i) => p.some((x,d) => Math.abs(x-before.net.poles[i][d])>1e-6))
  assert(moved && !afterTarget.pairs && afterTarget.canUndo, 'Applying the pair batch must commit one valid draft change')
  check(true, 'Keyboard Apply commits the two retained anchors as one undoable valid CAD preview')

  await page.click('[data-test=surface-undo]')
  await page.waitForFunction(original => {
    const s = window.multiAnchorQa.useWorkspaceEditor.getState(), p = s.controller?.getPanelState()
    return s.snapshot?.validation?.kind === 'valid' && !p?.calculating && p?.canRedo
      && JSON.stringify(p.net.poles) === JSON.stringify(original.poles)
  }, { timeout: 120000 }, before.net)
  check(true, 'Draft Undo restores the exact pre-collection control net')
  await page.click('[data-test=surface-redo]')
  await page.waitForFunction(expected => {
    const s = window.multiAnchorQa.useWorkspaceEditor.getState(), p = s.controller?.getPanelState()
    return s.snapshot?.validation?.kind === 'valid' && !p?.calculating
      && JSON.stringify(p.net.poles) === JSON.stringify(expected.poles)
  }, { timeout: 120000 }, afterTarget.net)
  check(true, 'Draft Redo restores the multi-anchor CAD preview')

  await page.waitForSelector('[data-test=workspace-editor-apply]:enabled', { timeout: 120000 })
  await page.click('[data-test=workspace-editor-apply]')
  await page.waitForFunction(() => window.multiAnchorQa.useWorkspaceEditor.getState().phase === 'closed', { timeout: 120000 })
  const applied = await page.evaluate(async () => {
    const q = window.multiAnchorQa, state = q.useReverse.getState(), receipt = q.useWorkspaceEditor.getState().receipt
    if (receipt?.createdBodyIds?.length !== 1) throw Error('Final Apply did not create exactly one CAD copy')
    const bodies = []
    for (const id of [q.sourceId, receipt.createdBodyIds[0]]) {
      const answer = await q.runCommand('reverse.body.edit_source', { body: id })
      bodies.push({ id, text: new TextDecoder().decode(answer.file.bytes) })
    }
    return { receipt, count: state.bodies.length, initialCount: q.initialBodyCount, bodies }
  })
  assert.equal(applied.count, applied.initialCount + 1, 'Final Apply publishes exactly one synthetic CAD copy')
  const geometries = applied.bodies.map(item => {
    const shape = kernel.importStep(item.text), faces = kernel.getSubShapes(shape, 'face'), solids = kernel.getSubShapes(shape, 'solid')
    try { return { id: item.id, valid: kernel.isValid(shape), faceCount: faces.length, solidCount: solids.length,
      area: faces.reduce((sum,face)=>sum+kernel.getSurfaceArea(face),0), volume: kernel.getVolume(shape) }
    } finally { faces.forEach(face=>kernel.release(face)); solids.forEach(body=>kernel.release(body)); kernel.release(shape) }
  })
  const [sourceGeometry, copyGeometry] = geometries
  check(sourceGeometry.valid && copyGeometry.valid && sourceGeometry.solidCount === 1 && copyGeometry.solidCount === 1
    && sourceGeometry.faceCount === 6 && copyGeometry.faceCount === 6 && Math.abs(sourceGeometry.volume-6000)<1e-6,
    'Source and applied copy are valid six-face solids; the original 6000 mm³ source is preserved')
  let maxTargetDistance = 0
  const copyShape = kernel.importStep(applied.bodies[1].text), copyFaces = kernel.getSubShapes(copyShape, 'face')
  try {
    for (const pair of retainedPairs) {
      const vertex = kernel.makeVertex(...pair.target)
      try { maxTargetDistance=Math.max(maxTargetDistance,Math.min(...copyFaces.map(face=>kernel.distanceBetween(vertex,face)))) }
      finally { kernel.release(vertex) }
    }
  } finally { copyFaces.forEach(face=>kernel.release(face)); kernel.release(copyShape) }
  assert(maxTargetDistance < 1e-4, `Applied CAD copy misses a retained target by ${maxTargetDistance} mm`)
  check(true, `Both retained scan anchors lie on the applied CAD copy (max ${maxTargetDistance.toExponential(2)} mm)`)
  report.anchorBatch = { initialCount: 3, removedCount: 1, appliedCount: 2, targetPairs: retainedPairs, maxTargetDistance }
  report.geometries = geometries
  report.verdict = 'PASS_BOUNDED_GUI_MULTI_ANCHOR'
  assert.deepEqual(app.consoleErrors, [], 'No application console errors')
  check(true, 'No browser application errors')
} catch (error) {
  report.error = String(error?.stack ?? error)
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  kernel[Symbol.dispose]()
  writeFileSync(join(out, 'result.json'), JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify({ out, ...report }))
}
