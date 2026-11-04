// SPDX-License-Identifier: AGPL-3.0-only
// Isolated source host; generated cylinder; shared-view pointer gesture.
import assert from 'node:assert/strict'
import { OcctKernel } from 'occt-wasm'
import { launchApp } from '../../../scripts/e2e-lib.mjs'
assert.equal(process.env.SCANRULER_ISOLATED,'1')
assert.equal(process.env.APP_URL,'http://127.0.0.1:17723/')
const k=await OcctKernel.init(),body=k.makeCylinder(10,20)
let step;try {step=k.exportStep(body)} finally {k.release(body);k[Symbol.dispose]()}
const {browser,page,consoleErrors}=await launchApp({url:process.env.APP_URL,width:1440,height:1000,agentDataOk:false})
try {
  await page.evaluate(async step=>{
    const {runCommand}=await import('/src/commands/registry.ts')
    const {useShell}=await import('/src/state/shellStore.ts')
    const {useReverse}=await import('/plugins/reverse/state/reStore.ts')
    const {reverseSession}=await import('/plugins/reverse/app/reSession.ts')
    const {useWorkspaceEditor}=await import('/src/plugins/workspaceEditors.ts')
    const {sceneOf}=await import('/src/commands/host.ts')
    useShell.getState().setWorkspace('reverse')
    for(let i=0;!reverseSession()&&i<500;i++)await new Promise(r=>setTimeout(r,20))
    if(!reverseSession())throw Error('CAD session unavailable')
    await reverseSession().startKernel();await reverseSession().settled()
    await runCommand('reverse.import.step',{bytes:new TextEncoder().encode(step),name:'synthetic-cylinder.step'})
    await reverseSession().settled()
    if(!useReverse.getState().bodies.length)throw Error('Cylinder missing')
    const scene=sceneOf();if(!scene)throw Error('Scene missing');scene.fitToView()
    window.cylinderQa={useWorkspaceEditor,useReverse,scene}
  },step)
  await page.waitForSelector('[data-test=feature-edit-surface]:enabled',{timeout:60000})
  await page.click('[data-test=feature-edit-surface]')
  await page.waitForSelector('[data-test=workspace-surface-parameters]',{timeout:120000})
  const index=await page.evaluate(()=>window.cylinderQa.useWorkspaceEditor.getState().controller.getPanelState().faces.find(f=>f.experimentalCylinder)?.index)
  assert.notEqual(index,undefined,'eligible cylinder')
  await page.select('[data-test=surface-face]',String(index))
  await page.waitForFunction(index=>{const c=window.cylinderQa.useWorkspaceEditor.getState().controller,p=c.getPanelState(),v=c.getViewState();return p.face===index && v.provisionalPreview?.faceMeshes.length===3},{timeout:120000},index)
  await page.select('[data-test=surface-selection-mode]','points')
  await page.select('[data-test=surface-drag-mode]','screen')
  await page.evaluate(()=>window.cylinderQa.scene.viewFrom('front'))
  await page.mouse.move(750,500)
  for(let i=0;i<7;i++){await page.mouse.wheel({deltaY:200,deltaX:0});await new Promise(r=>setTimeout(r,40))}
  await new Promise(r=>setTimeout(r,300))
  const before=await page.evaluate(()=>{
    const q=window.cylinderQa,c=q.useWorkspaceEditor.getState().controller,p=c.getPanelState(),index=3*p.net.nv+2
    const layer=q.scene.layerHost(),rect=layer.canvas.getBoundingClientRect(),camera=layer.camera(),group=layer.partGroup
    group.updateWorldMatrix(true,true);camera.updateMatrixWorld(true)
    const v=group.position.clone().set(...p.net.poles[index]).applyMatrix4(group.matrixWorld).project(camera)
    return {point:p.net.poles[index],index,x:rect.left+(v.x+1)*rect.width/2,y:rect.top+(1-v.y)*rect.height/2,
      canvas:document.elementFromPoint(rect.left+(v.x+1)*rect.width/2,rect.top+(1-v.y)*rect.height/2)===layer.canvas,
      hit:document.elementFromPoint(rect.left+(v.x+1)*rect.width/2,rect.top+(1-v.y)*rect.height/2)?.outerHTML.slice(0,180),rect:{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom}}
  })
  assert(before.canvas,'control point must be visible on canvas: '+JSON.stringify(before))
  await page.mouse.move(before.x,before.y);await page.mouse.down()
  await page.mouse.move(before.x+30,before.y-20,{steps:5});await page.mouse.up()
  await page.waitForFunction(({point,index})=>{const c=window.cylinderQa.useWorkspaceEditor.getState().controller,p=c.getPanelState();return p.net.poles[index].some((x,i)=>Math.abs(x-point[i])>1e-5)&&!!c.getViewState().provisionalPreview},{timeout:120000},before)
  const result=await page.evaluate(()=>{
    const state=window.cylinderQa.useWorkspaceEditor.getState(),c=state.controller,p=c.getPanelState()
    return {validation:state.snapshot.validation.kind,canExport:p.canExportStep,canUndo:p.canUndo,faces:c.getViewState().provisionalPreview.faceMeshes.length}
  })
  assert.notEqual(result.validation,'valid');assert.equal(result.canExport,false);assert.equal(result.canUndo,true);assert.equal(result.faces,3)
  assert.deepEqual(consoleErrors,[])
  console.log(JSON.stringify({status:'PASS',scope:'isolated source host; synthetic cylinder; shared-view pointer gesture',...result}))
} finally {await browser.close()}
