// SPDX-License-Identifier: AGPL-3.0-only
// Isolated GUI refusal case for a 0.25 mm multi-anchor request.
// A synthetic box STEP and a parallel synthetic STL scan are the only inputs.
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
const out = mkdtempSync(join(resolve(outputRoot), 'workspace-multi-anchor-refusal-gui-'))
process.env.SHOT_DIR = out

const { OcctKernel } = await import('occt-wasm')
const { importStep, writeBinarySTL } = await import('meshstep')
const { launchApp, loadScan } = await import('../../../scripts/e2e-lib.mjs')
const kernel = await OcctKernel.init()
const box = kernel.makeBox(20, 30, 10)
let sourceStep, scanPath
try {
  sourceStep = kernel.exportStep(box)
  const shifted = kernel.translate(box, 0, 0, 0.25)
  try {
    const shiftedStep = kernel.exportStep(shifted)
    const mesh = importStep(shiftedStep, { surfaceDeviation: 0.005, maxEdge: 2 }).mesh
    scanPath = join(out, 'synthetic-scan-plus-0.25mm.stl')
    writeFileSync(scanPath, Buffer.from(writeBinarySTL(mesh)))
  } finally { kernel.release(shifted) }
} finally { kernel.release(box) }
const report = { scope: '0.25 mm multi-anchor GUI refusal; draft and batch preservation', appUrl: url.href,
  fixture: { kind: '20 x 30 x 10 mm box STEP with parallel synthetic scan at +0.25 mm', sourceSha256: createHash('sha256').update(sourceStep).digest('hex') },
  checks: [], limitations: ['Synthetic box and scan only.', 'CAD import, scan upload and free-pole selection are harness-driven; target acquisition and Apply are GUI actions.', 'Positive 0.02 mm case is not included.'], verdict: 'INCOMPLETE' }
const check = (ok, label) => { assert(ok, label); report.checks.push(label); console.log('PASS', label) }
let browser

try {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
  assert(response.ok && /ScanRuler/i.test(await response.text()), 'Isolated host identifies as ScanRuler')
  const app = await launchApp({ url: url.href, width: 1440, height: 1000, agentDataOk: false,
    userDataDir: join(out, 'owned-browser-profile'), protocolTimeout: 120000 })
  browser = app.browser; const page = app.page; report.consoleErrors = app.consoleErrors
  page.on('dialog', dialog => dialog.accept())
  await loadScan(page, scanPath, { inputSelector: '[data-test=slot-scan] input[type=file]', timeout: 120000 })
  await page.evaluate(async stepText => {
    const { runCommand } = await import('/src/commands/registry.ts')
    const { useShell } = await import('/src/state/shellStore.ts')
    const { useReverse } = await import('/plugins/reverse/state/reStore.ts')
    const { reverseSession } = await import('/plugins/reverse/app/reSession.ts')
    const { sceneOf } = await import('/src/commands/host.ts')
    const { useWorkspaceEditor } = await import('/src/plugins/workspaceEditors.ts')
    useShell.getState().setWorkspace('reverse')
    for (let i=0; !reverseSession() && i<500; i++) await new Promise(resolve=>setTimeout(resolve,20))
    if (!reverseSession()) throw Error('Isolated CAD session unavailable')
    await reverseSession().startKernel(); await reverseSession().settled()
    await runCommand('reverse.import.step', { bytes: new TextEncoder().encode(stepText), name: 'synthetic-source.step' })
    await reverseSession().settled()
    const id=useReverse.getState().bodies[0]?.id,scene=sceneOf()
    if(!id||!scene||useReverse.getState().bodies.length!==1)throw Error('Synthetic source body unavailable')
    scene.fitToView()
    window.multiAnchorRejectQa={runCommand,useReverse,useWorkspaceEditor,scene,id}
  }, sourceStep)
  await page.waitForFunction(()=>{
    const q=window.multiAnchorRejectQa
    return !!q.useReverse.getState().bodies.find(body=>body.id===q.id)&&!q.useReverse.getState().building
  },{timeout:120000})
  await page.click('[data-test=feature-edit-surface]')
  await page.waitForSelector('[data-test=workspace-surface-parameters]',{timeout:120000})
  const faceIndex=await page.evaluate(()=>{
    const c=window.multiAnchorRejectQa.useWorkspaceEditor.getState().controller,meshes=c.getViewState().preview.faceMeshes
    const top=c.getPanelState().faces.find(f=>f.kind==='plane'&&!f.reason&&
      [...meshes[f.index].positions].filter((_,i)=>i%3===2).every(z=>Math.abs(z-10)<1e-4))
    if(!top)throw Error('Synthetic top plane not found')
    return top.index
  })
  await page.select('[data-test=surface-face]',String(faceIndex))
  await page.waitForFunction(()=>{
    const s=window.multiAnchorRejectQa.useWorkspaceEditor.getState(),p=s.controller?.getPanelState()
    return s.snapshot?.validation?.kind==='valid'&&!!p?.net&&!p.calculating
  },{timeout:120000})
  await page.click('[data-test=surface-refine-both]')
  await page.waitForFunction(()=>{
    const s=window.multiAnchorRejectQa.useWorkspaceEditor.getState(),p=s.controller?.getPanelState()
    return s.snapshot?.validation?.kind==='valid'&&!!p?.net&&!p.calculating&&p.net.nu>=3&&p.net.nv>=3
  },{timeout:120000})
  const selectFree=await page.evaluateHandle(()=>[...document.querySelectorAll('[data-test=workspace-surface-parameters] button')]
    .find(button=>button.textContent?.trim()==='Seleziona liberi'))
  assert(selectFree.asElement(),'Seleziona liberi UI control exists')
  await selectFree.asElement().click()
  await page.select('[data-test=surface-selection-mode]','points')
  await page.waitForFunction(()=>{
    const p=window.multiAnchorRejectQa.useWorkspaceEditor.getState().controller?.getPanelState()
    return p?.canTargetPoint&&p.selected.some(i=>!p.locked.includes(i))
  },{timeout:30000})
  await page.evaluate(()=>{
    const q=window.multiAnchorRejectQa
    q.scene.viewFrom('top');q.scene.fitToView()
  })

  const picks=await page.evaluate(()=>{
    const q=window.multiAnchorRejectQa,c=q.useWorkspaceEditor.getState().controller,v=c.getViewState()
    const mesh=v.preview.faceMeshes[v.face],positions=mesh.positions
    const xs=[],ys=[],zs=[]
    for(let i=0;i<positions.length;i+=3){xs.push(positions[i]);ys.push(positions[i+1]);zs.push(positions[i+2])}
    const bounds={x0:Math.min(...xs),x1:Math.max(...xs),y0:Math.min(...ys),y1:Math.max(...ys),z:zs.reduce((a,b)=>a+b,0)/zs.length}
    const host=q.scene.layerHost(),canvas=host.canvas,rect=canvas.getBoundingClientRect(),camera=host.camera(),group=host.partGroup
    group.updateWorldMatrix(true,true);camera.updateMatrixWorld(true)
    const fractions=[.15,.2,.25,.3,.7,.75,.8,.85],candidates=[]
    for(const u of fractions)for(const v of fractions){
      const local=[bounds.x0+(bounds.x1-bounds.x0)*u,bounds.y0+(bounds.y1-bounds.y0)*v,bounds.z]
      const p=group.position.clone().set(...local).applyMatrix4(group.matrixWorld).project(camera)
      const x=rect.left+(p.x+1)*rect.width/2,y=rect.top+(1-p.y)*rect.height/2,hit=document.elementFromPoint(x,y)
      const visible=[p.x,p.y,p.z,x,y].every(Number.isFinite)&&Math.abs(p.z)<1&&x>rect.left+12&&x<rect.right-12&&
        y>rect.top+12&&y<rect.bottom-12&&hit===canvas
      if(visible)candidates.push({u,v,local,x,y,influence:2*Math.min(u,1-u)*2*Math.min(v,1-v)})
    }
    const pairs=[]
    for(let i=0;i<candidates.length;i++)for(let j=i+1;j<candidates.length;j++){
      const a=candidates[i],b=candidates[j],gap=Math.hypot(...a.local.map((x,d)=>x-b.local[d]))
      if(gap>=8)pairs.push({a,b,gap,score:a.influence+b.influence})
    }
    pairs.sort((a,b)=>a.score-b.score||b.gap-a.gap)
    return {points:pairs[0]?[pairs[0].a,pairs[0].b]:[],diagnostics:{canvas:{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom},visibleCandidates:candidates.length,
      sample:candidates.slice(0,12),canvasHitTest:'elementFromPoint === viewport canvas'}}
  })
  report.pickDiagnostics=picks.diagnostics
  assert.equal(picks.points.length,2,`Could not find two separated visible face points: ${JSON.stringify(picks.diagnostics)}`)
  const before=await page.evaluate(()=>{
    const c=window.multiAnchorRejectQa.useWorkspaceEditor.getState().controller,p=c.getPanelState()
    return {poles:structuredClone(p.net.poles),historyRevision:c.getSnapshot().historyRevision,canUndo:p.canUndo}
  })
  await page.click('[data-test=surface-point-multiple]')
  await page.click('[data-test=surface-point-scan]')
  for(let i=0;i<picks.points.length;i++){
    await page.mouse.click(picks.points[i].x,picks.points[i].y)
    await page.waitForFunction(count=>{
      const p=window.multiAnchorRejectQa.useWorkspaceEditor.getState().controller?.getPanelState()
      return p?.surfaceTargetBatch?.length===count&&!p.busy
    },{timeout:30000},i+1)
  }
  const collected=await page.evaluate(()=>{
    const c=window.multiAnchorRejectQa.useWorkspaceEditor.getState().controller,p=c.getPanelState()
    return {poles:structuredClone(p.net.poles),batch:p.surfaceTargetBatch,historyRevision:c.getSnapshot().historyRevision,canUndo:p.canUndo}
  })
  assert.equal(collected.batch?.length,2)
  assert.deepEqual(collected.poles,before.poles,'Collection must not move control poles')
  assert.equal(collected.historyRevision,before.historyRevision,'Collection must not create an Undo step')
  check(true,'Two 0.25 mm scan targets collected without changing the preview or history')

  await page.click('[data-test=surface-point-apply]')
  await page.waitForFunction(()=>{
    const p=window.multiAnchorRejectQa.useWorkspaceEditor.getState().controller?.getPanelState()
    const alert=document.querySelector('[data-test=workspace-surface-parameters] [role=alert]')
    return !!alert?.textContent?.trim()&&!p?.busy
  },{timeout:120000})
  const rejected=await page.evaluate(()=>{
    const s=window.multiAnchorRejectQa.useWorkspaceEditor.getState(),c=s.controller,p=c.getPanelState()
    return {alert:document.querySelector('[data-test=workspace-surface-parameters] [role=alert]')?.textContent?.trim()??'',
      message:p.message,validation:s.snapshot?.validation,historyRevision:c.getSnapshot().historyRevision,canUndo:p.canUndo,
      target:p.surfaceTarget,batch:p.surfaceTargetBatch,removeButtons:document.querySelectorAll('[data-test=surface-point-remove]').length,
      poles:structuredClone(p.net?.poles),calculating:p.calculating,busy:p.busy}
  })
  report.rejection=rejected
  assert(/limite|vincol|influenza|residuo/i.test(rejected.alert),`Expected a visible CAD refusal message, got: ${rejected.alert}`)
  assert.equal(rejected.batch?.length,2,'Both collected pairs remain available for review')
  assert.equal(rejected.removeButtons,2,'Both retained pairs still have removal controls')
  assert.deepEqual(rejected.poles,before.poles,'Rejected candidate leaves all CAD control poles unchanged')
  assert.equal(rejected.historyRevision,before.historyRevision,'Rejected candidate creates no Undo/history step')
  assert.equal(rejected.canUndo,before.canUndo,'Rejected candidate does not alter Undo availability')
  check(true,`0.25 mm request refused and both pairs remain reviewable: ${rejected.alert}`)
  assert.deepEqual(app.consoleErrors,[],'No application console errors')
  report.verdict='PASS_BOUNDED_GUI_MULTI_ANCHOR_REFUSAL'
} catch(error) {
  report.error=String(error?.stack??error);process.exitCode=1
} finally {
  if(browser)await browser.close()
  kernel[Symbol.dispose]()
  writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify({out,...report}))
}
