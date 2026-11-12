// SPDX-License-Identifier: AGPL-3.0-only
// Dedicated synthetic CAD browser test for three-axis picking in the *V5 host*
// workspace viewport. Never opens or modifies the operator's Tube/CAD project.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve, isAbsolute, sep } from 'node:path'
import { OcctKernel } from 'occt-wasm'
import { launchApp } from '../../../scripts/e2e-lib.mjs'

assert.equal(process.env.SCANRULER_ISOLATED,'1')
const url=process.env.APP_URL
assert.equal(url,'http://127.0.0.1:17729/')
const base=resolve(process.env.TMAR_V5_PALETTE_QA_OUT || '')
assert(isAbsolute(base) && !base.toLowerCase().startsWith(resolve(process.cwd()).toLowerCase()+sep))
mkdirSync(base,{recursive:true})
const output=mkdtempSync(join(base,'v5-gizmo-'))
const report={schema:'TMAR_V5_WORKSPACE_3AXIS_BROWSER_V1',startedAtUtc:new Date().toISOString(),
  scope:'V5 host viewport, synthetic 6-face box only',verdict:'INCOMPLETE',checks:[],axes:[],errors:[],output}
const save=()=>writeFileSync(join(output,'receipt.json'),JSON.stringify(report,null,2)+'\n')
const check=(yes,name)=>{assert(yes,name);report.checks.push(name);console.log('PASS',name);save()}
const kernel=await OcctKernel.init()
let box,browser,page,consoleErrors=[]
try{
  box=kernel.makeBox(20,30,10)
  const step=kernel.exportStep(box)
  check(kernel.isValid(box),'OCCT synthetic box is valid')
  const app=await launchApp({url,width:1440,height:1000,language:'',agentDataOk:false,userDataDir:join(output,'profile'),protocolTimeout:120000})
  browser=app.browser;page=app.page;consoleErrors=app.consoleErrors
  page.on('dialog',d=>void d.accept())
  await page.click('[data-test=workspace-reverse]')
  await page.waitForFunction(()=>window.__re?.store.getState().kernelStatus==='ready',{timeout:60000})
  await page.evaluate(async text=>{
    const {runCommand}=await import('/src/commands/registry.ts')
    await runCommand('reverse.import.step',{bytes:new TextEncoder().encode(text),name:'synthetic-v5-xyz.step'})
  },step)
  await page.waitForFunction(()=>window.__re?.store.getState().bodies.length===1&&!window.__re?.store.getState().building,{timeout:60000})
  await page.evaluate(async()=>{
    const {useWorkspaceEditor}=await import('/src/plugins/workspaceEditors.ts')
    const {sceneOf}=await import('/src/commands/host.ts')
    window.gizmoQA={useWorkspaceEditor,scene:sceneOf()}
  })
  await page.click('[data-test=feature-edit-surface]')
  await page.waitForSelector('[data-test=workspace-surface-parameters]',{timeout:30000})
  await page.waitForFunction(()=>document.querySelectorAll('[data-test=surface-face] option').length>1,{timeout:60000})
  const choices=await page.$$eval('[data-test=surface-face] option',els=>els.map(x=>({value:x.value,disabled:x.disabled})))
  const chosen=choices.find(x=>x.value==='5'&&!x.disabled)??choices.find(x=>x.value!==''&&!x.disabled)
  assert(chosen,'editable CAD face')
  await page.select('[data-test=surface-face]',chosen.value)
  await page.waitForFunction(()=>window.gizmoQA.useWorkspaceEditor.getState().controller?.getViewState().net!==null &&
    !window.gizmoQA.useWorkspaceEditor.getState().controller?.getPanelState().calculating,{timeout:60000})
  const index=await page.evaluate(()=>{
    const c=window.gizmoQA.useWorkspaceEditor.getState().controller
    const s=c.getViewState(),available=s.net.poles.map((_,i)=>i).filter(i=>!s.locked.includes(i)&&!s.hiddenPoles.includes(i))
    if(!available.length)throw Error('No free pole under current G1 guard')
    c.setDragMode('axis');c.setSnap(false);c.setSelectionMode('points');c.selectPoints([available[0]],false)
    return available[0]
  })
  await page.waitForFunction(i=>{
    const s=window.gizmoQA.useWorkspaceEditor.getState().controller?.getViewState()
    const cage=window.gizmoQA.scene?.layerHost().partGroup.getObjectByName('tmar-edit-surface-cage')
    return s?.selected.includes(i)&&cage?.children.filter(o=>o.userData.gizmoPole===i).length===3
  },{timeout:15000},index)
  check(true,'V5 host draws all three axes on a movable G1 pole')
  // Read the actual arrow orientation, size and transformed host camera pose.
  const arrows=await page.evaluate(async i=>{
    const THREE=await import('/node_modules/three/build/three.module.js')
    const h=window.gizmoQA.scene.layerHost(),cam=h.camera(),part=h.partGroup
    const cage=part.getObjectByName('tmar-edit-surface-cage'),rect=h.canvas.getBoundingClientRect()
    part.updateWorldMatrix(true,true);cam.updateMatrixWorld(true);cam.updateProjectionMatrix()
    const project=p=>{const v=p.applyMatrix4(part.matrixWorld).project(cam);return {x:rect.left+(1+v.x)*rect.width/2,y:rect.top+(1-v.y)*rect.height/2,visible:Math.abs(v.z)<1}}
    return cage.children.filter(o=>o.userData.gizmoPole===i).map(arrow=>{
      const length=arrow.line.scale.y+arrow.cone.scale.y
      const start=project(arrow.position.clone())
      const dir=new THREE.Vector3(0,1,0).applyQuaternion(arrow.quaternion)
      const tip=project(arrow.position.clone().addScaledVector(dir,length))
      return {axis:arrow.userData.gizmoAxis,start,tip,projectedLength:Math.hypot(tip.x-start.x,tip.y-start.y)}
    }).sort((a,b)=>a.axis-b.axis)
  },index)
  check(arrows.length===3 && arrows.every(a=>a.start.visible&&a.tip.visible&&a.projectedLength>=8),
    'all three host-space projected arrow segments are pickable')
  const initial=await page.evaluate(i=>window.gizmoQA.useWorkspaceEditor.getState().controller.getViewState().net.poles[i],index)
  for(const arrow of arrows){
    const click={x:arrow.start.x+(arrow.tip.x-arrow.start.x)*.75,
      y:arrow.start.y+(arrow.tip.y-arrow.start.y)*.75}
    const dx=(arrow.tip.x-arrow.start.x)/arrow.projectedLength
    const dy=(arrow.tip.y-arrow.start.y)/arrow.projectedLength
    await page.mouse.move(click.x,click.y)
    await page.mouse.down({button:'left'})
    await page.waitForFunction(()=>window.gizmoQA.useWorkspaceEditor.getState().snapshot?.gesture==='pole',
      {timeout:12000})
    await page.mouse.move(click.x+dx*8,click.y+dy*8,{steps:10})
    await page.mouse.up({button:'left'})
    await page.waitForFunction(({i,axis,reference})=>{
      const c=window.gizmoQA.useWorkspaceEditor.getState().controller
      const s=c?.getViewState(),p=s?.net?.poles[i]
      return !!p && !c?.getPanelState().calculating && c?.getPanelState().canUndo &&
        Math.abs(p[axis]-reference[axis])>1e-5 && c?.getPanelState().gesture==='idle'
    },{timeout:60000},{i:index,axis:arrow.axis,reference:initial})
    const changed=await page.evaluate(i=>window.gizmoQA.useWorkspaceEditor.getState().controller.getViewState().net.poles[i],index)
    const delta=changed.map((v,j)=>v-initial[j])
    report.axes.push({axis:arrow.axis,delta})
    check(Math.abs(delta[arrow.axis])>1e-5 && delta.every((v,j)=>j===arrow.axis||Math.abs(v)<1e-6),
      ['X','Y','Z'][arrow.axis]+' arrow changes its own coordinate only')
    await page.evaluate(()=>window.gizmoQA.useWorkspaceEditor.getState().controller.undo())
    await page.waitForFunction(({index,reference})=>{
      const c=window.gizmoQA.useWorkspaceEditor.getState().controller
      const p=c?.getViewState()?.net?.poles[index]
      return !c?.getPanelState().calculating && p?.every((v,j)=>Math.abs(v-reference[j])<1e-6)
    },{timeout:60000},{index,reference:initial})
  }
  check(consoleErrors.length===0,'host browser has no JavaScript errors')
  report.verdict='PASS'
}catch(error){
  report.verdict='FAIL';report.errors.push(String(error?.stack??error));process.exitCode=1
  if(page)try{await page.screenshot({path:join(output,'failure.png')})}catch{}
}finally{
  report.completedAtUtc=new Date().toISOString();report.consoleErrors=consoleErrors;save()
  if(browser)try{await browser.close()}catch{}
  if(box)kernel.release(box)
  kernel[Symbol.dispose]()
  console.log(JSON.stringify({verdict:report.verdict,checks:report.checks.length,axes:report.axes,errors:report.errors,output},null,2))
}
