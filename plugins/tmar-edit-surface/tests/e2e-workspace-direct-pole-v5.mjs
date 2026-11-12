// SPDX-License-Identifier: AGPL-3.0-only
// True left-mouse freehand drag on the yellow control point in the V5 host.
// Uses an isolated browser profile and a synthetic closed CAD solid only.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve, isAbsolute, sep } from 'node:path'
import { OcctKernel } from 'occt-wasm'
import { launchApp } from '../../../scripts/e2e-lib.mjs'

assert.equal(process.env.SCANRULER_ISOLATED,'1','Only synthetic isolated tests')
const url=process.env.APP_URL
assert.equal(url,'http://127.0.0.1:18945/','Dedicated localhost QA only')
const base=resolve(process.env.TMAR_DIRECT_POLE_QA_OUT||'')
assert(isAbsolute(base)&&!base.toLowerCase().startsWith(resolve(process.cwd()).toLowerCase()+sep))
mkdirSync(base,{recursive:true})
const output=mkdtempSync(join(base,'v5-direct-pole-'))
const report={schema:'TMAR_V5_DIRECT_YELLOW_POLE_MOUSE_V1',scope:'isolated synthetic six-face closed CAD solid',
  verdict:'INCOMPLETE',checks:[],freehand:[],errors:[],output,startedUtc:new Date().toISOString()}
const save=()=>writeFileSync(join(output,'receipt.json'),JSON.stringify(report,null,2)+'\n')
const check=(yes,name)=>{assert(yes,name);report.checks.push(name);console.log('PASS',name);save()}
const occt=await OcctKernel.init()
let box,browser,page,consoleErrors=[]
try{
  box=occt.makeBox(20,30,10)
  const step=occt.exportStep(box)
  check(occt.isValid(box),'synthetic source STEP shape is valid')
  const app=await launchApp({url,width:1440,height:1000,language:'',agentDataOk:false,
    userDataDir:join(output,'browser-profile'),protocolTimeout:120000})
  browser=app.browser;page=app.page;consoleErrors=app.consoleErrors
  page.on('dialog',d=>void d.accept())
  await page.click('[data-test=workspace-reverse]')
  await page.waitForFunction(()=>window.__re?.store.getState().kernelStatus==='ready',{timeout:60000})
  await page.evaluate(async step=>{
    const {runCommand}=await import('/src/commands/registry.ts')
    await runCommand('reverse.import.step',{bytes:new TextEncoder().encode(step),name:'qa-direct-yellow-pole.step'})
  },step)
  await page.waitForFunction(()=>window.__re?.store.getState().bodies.length===1&&!window.__re?.store.getState().building,{timeout:60000})
  await page.evaluate(async()=>{
    const {useWorkspaceEditor}=await import('/src/plugins/workspaceEditors.ts')
    const {sceneOf}=await import('/src/commands/host.ts')
    window.directPoleQA={useWorkspaceEditor,scene:sceneOf()}
  })
  await page.click('[data-test=feature-edit-surface]')
  await page.waitForSelector('[data-test=workspace-surface-parameters]',{timeout:30000})
  await page.waitForFunction(()=>document.querySelectorAll('[data-test=surface-face] option').length>1,{timeout:60000})
  const faces=await page.$$eval('[data-test=surface-face] option',nodes=>nodes.map(x=>({value:x.value,disabled:x.disabled})))
  const chosen=faces.find(x=>x.value==='5'&&!x.disabled)??faces.find(x=>x.value!==''&&!x.disabled)
  assert(chosen,'editable face present')
  await page.select('[data-test=surface-face]',chosen.value)
  await page.waitForFunction(()=>{
    const c=window.directPoleQA.useWorkspaceEditor.getState().controller
    return c?.getPanelState().net?.poles.length===25 && !c.getPanelState().calculating
  },{timeout:60000})
  await page.evaluate(()=>{
    const c=window.directPoleQA.useWorkspaceEditor.getState().controller
    c.setContinuity('G0');c.setDragMode('axis');c.setAxis(0);c.setSelectionMode('points');c.setSnap(false)
    c.selectPoints([6],false)
  })
  await page.waitForFunction(()=>{
    const c=window.directPoleQA.useWorkspaceEditor.getState().controller
    const s=c?.getViewState(),cage=window.directPoleQA.scene?.layerHost().partGroup.getObjectByName('tmar-edit-surface-cage')
    return c?.getPanelState().continuity==='G0' && s && !s.locked.includes(6) && s.selected.includes(6)
      && cage?.children.filter(o=>o.userData.gizmoPole===6).length===3
  },{timeout:15000})
  check(true,'G0 allows non-central pole 6 and keeps three XYZ arrow handles')

  const project=async index=>page.evaluate(async index=>{
    const THREE=await import('/node_modules/three/build/three.module.js')
    const q=window.directPoleQA,h=q.scene.layerHost(),cam=h.camera(),rect=h.canvas.getBoundingClientRect()
    const pole=q.useWorkspaceEditor.getState().controller.getViewState().net.poles[index]
    h.partGroup.updateWorldMatrix(true,true);cam.updateMatrixWorld(true);cam.updateProjectionMatrix()
    const v=new THREE.Vector3(...pole).applyMatrix4(h.partGroup.matrixWorld).project(cam)
    const x=rect.left+(1+v.x)*rect.width/2,y=rect.top+(1-v.y)*rect.height/2
    return {x,y,visible:Math.abs(v.z)<1,canvasUnderCursor:document.elementFromPoint(x,y)===h.canvas}
  },index)
  const pole=async index=>page.evaluate(index=>
    [...window.directPoleQA.useWorkspaceEditor.getState().controller.getViewState().net.poles[index]],index)
  const all=()=>page.evaluate(()=>window.directPoleQA.useWorkspaceEditor.getState().controller.getViewState().net.poles.map(p=>[...p]))
  const waitMove=async(index,old)=>page.waitForFunction(({index,old})=>{
    const c=window.directPoleQA.useWorkspaceEditor.getState().controller
    const current=c?.getPanelState(),point=c?.getViewState()?.net?.poles[index]
    return current?.gesture==='idle' && !current?.calculating &&
      point?.some((v,i)=>Math.abs(v-old[i])>1e-5)
  },{timeout:60000},{index,old})
  const waitUndo=async(index,old)=>page.waitForFunction(({index,old})=>{
    const c=window.directPoleQA.useWorkspaceEditor.getState().controller
    const point=c?.getViewState()?.net?.poles[index]
    return !c?.getPanelState().calculating && point?.every((v,i)=>Math.abs(v-old[i])<1e-6)
  },{timeout:60000},{index,old})

  // One yellow point, held with LMB: the cursor moves in two screen directions.
  const initialNet=await all(),before=await pole(6),start=await project(6)
  check(start.visible&&start.canvasUnderCursor,'selected yellow point is visible and directly clickable on host canvas')
  const travel={dx:23,dy:-17}
  await page.mouse.move(start.x,start.y);await page.mouse.down({button:'left'})
  await page.waitForFunction(()=>window.directPoleQA.useWorkspaceEditor.getState().snapshot?.gesture==='pole',{timeout:12000})
  await page.mouse.move(start.x+travel.dx,start.y+travel.dy,{steps:12});await page.mouse.up({button:'left'})
  await waitMove(6,before)
  const after=await pole(6),projected=await project(6)
  const errorPx=Math.hypot(projected.x-start.x-travel.dx,projected.y-start.y-travel.dy)
  const delta=after.map((v,i)=>v-before[i])
  report.freehand.push({kind:'single',pole:6,delta,errorPx})
  check(errorPx<3,'freehand point follows mouse in both screen directions (no axis lock)')
  check(delta.filter(v=>Math.abs(v)>1e-5).length>=2,'screen-plane drag changes multiple CAD coordinates')
  check((await all())[0].every((v,i)=>Math.abs(v-initialNet[0][i])<1e-8),'G0 boundary pole remains unchanged')
  check((await page.evaluate(()=>window.directPoleQA.useWorkspaceEditor.getState().controller.getPanelState().dragMode))==='axis',
    'freehand direct drag does not change the XYZ arrow mode')
  await page.evaluate(()=>window.directPoleQA.useWorkspaceEditor.getState().controller.undo())
  await waitUndo(6,before)
  check(true,'Undo restores the directly dragged point without modifying the original body')

  // Clicking any previously selected point drags the entire multi-selection.
  await page.evaluate(()=>window.directPoleQA.useWorkspaceEditor.getState().controller.selectPoints([6,7],false))
  await page.waitForFunction(()=>{
    const s=window.directPoleQA.useWorkspaceEditor.getState().controller.getViewState()
    return s.selected.includes(6)&&s.selected.includes(7)
  })
  const originals={six:await pole(6),seven:await pole(7)},startGroup=await project(6)
  await page.mouse.move(startGroup.x,startGroup.y);await page.mouse.down({button:'left'})
  await page.waitForFunction(()=>window.directPoleQA.useWorkspaceEditor.getState().snapshot?.gesture==='pole',{timeout:12000})
  await page.mouse.move(startGroup.x-19,startGroup.y+15,{steps:10});await page.mouse.up({button:'left'})
  await waitMove(6,originals.six)
  const changedGroup={six:await pole(6),seven:await pole(7)}
  const deltaSix=changedGroup.six.map((v,i)=>v-originals.six[i])
  const deltaSeven=changedGroup.seven.map((v,i)=>v-originals.seven[i])
  report.freehand.push({kind:'multi',poles:[6,7],deltaSix,deltaSeven})
  check(deltaSix.some(v=>Math.abs(v)>1e-5) && deltaSix.every((v,i)=>Math.abs(v-deltaSeven[i])<1e-6),
    'freehand drag translates both selected editable points by the same 3D vector')
  const selected=await page.evaluate(()=>window.directPoleQA.useWorkspaceEditor.getState().controller.getViewState().selected)
  check(selected.includes(6)&&selected.includes(7),'dragging an already selected pole retains the multi-selection')
  await page.evaluate(()=>window.directPoleQA.useWorkspaceEditor.getState().controller.undo())
  await waitUndo(6,originals.six)
  check((await pole(7)).every((v,i)=>Math.abs(v-originals.seven[i])<1e-6),'group Undo restores both poles')

  // A protected shared boundary must never accept the new freehand gesture.
  const boundaryBefore=await all()
  await page.evaluate(()=>window.directPoleQA.useWorkspaceEditor.getState().controller.selectPoints([0],false))
  const lockedStart=await project(0)
  check(lockedStart.visible&&lockedStart.canvasUnderCursor,'protected boundary point is in the viewport')
  await page.mouse.move(lockedStart.x,lockedStart.y)
  await page.mouse.down({button:'left'})
  await page.mouse.move(lockedStart.x+15,lockedStart.y-11,{steps:8})
  await page.mouse.up({button:'left'})
  const boundaryAfter=await all()
  check(boundaryAfter.every((p,i)=>p.every((v,j)=>Math.abs(v-boundaryBefore[i][j])<1e-8)),
    'LMB drag cannot move a locked G0 boundary point or any other CAD pole')
  check(consoleErrors.length===0,'no JavaScript browser errors')
  report.verdict='PASS'
}catch(error){
  report.verdict='FAIL';report.errors.push(String(error?.stack??error));process.exitCode=1
  if(page)try{await page.screenshot({path:join(output,'failure.png')})}catch{}
}finally{
  report.completedUtc=new Date().toISOString();report.consoleErrors=consoleErrors;save()
  if(browser)try{await browser.close()}catch{}
  if(box)occt.release(box)
  occt[Symbol.dispose]()
  console.log(JSON.stringify({verdict:report.verdict,checks:report.checks.length,freehand:report.freehand,errors:report.errors,output},null,2))
}
