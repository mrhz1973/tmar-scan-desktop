// SPDX-License-Identifier: AGPL-3.0-only
// Isolated source host; generated cylinder; shared-view pointer gesture.
import assert from 'node:assert/strict'
import { OcctKernel } from 'occt-wasm'
import { launchApp } from '../../../scripts/e2e-lib.mjs'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
assert.equal(process.env.SCANRULER_ISOLATED,'1')
assert.equal(process.env.APP_URL,'http://127.0.0.1:17723/')
const k=await OcctKernel.init(),body=k.makeCylinder(10,20)
let step;try {step=k.exportStep(body)} finally {k.release(body);k[Symbol.dispose]()}
const {browser,page,consoleErrors}=await launchApp({url:process.env.APP_URL,width:1440,height:1000,agentDataOk:false})
try {
  const downloads=mkdtempSync(join(tmpdir(),'scanruler-cylinder-qa-'))
  const cdp=await page.createCDPSession();await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,eventsEnabled:true})
  await page.evaluate(async step=>{
    const {runCommand}=await import('/src/commands/registry.ts')
    const {useShell}=await import('/src/state/shellStore.ts')
    const {useReverse}=await import('/plugins/reverse/state/reStore.ts')
    const {useNotes}=await import('/plugins/reverse/state/noteStore.ts')
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
    window.cylinderQa={useWorkspaceEditor,useReverse,useNotes,scene,runCommand}
  },step)
  const original=await page.evaluate(async()=>{const q=window.cylinderQa,id=q.useReverse.getState().bodies[0].id;return Array.from((await q.runCommand('reverse.export.step',{bodies:[id]})).file.bytes)})
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
  const second=await page.evaluate(()=>{
    const q=window.cylinderQa,c=q.useWorkspaceEditor.getState().controller,p=c.getPanelState(),index=3*p.net.nv+3
    const layer=q.scene.layerHost(),rect=layer.canvas.getBoundingClientRect(),camera=layer.camera(),group=layer.partGroup
    group.updateWorldMatrix(true,true);camera.updateMatrixWorld(true)
    const v=group.position.clone().set(...p.net.poles[index]).applyMatrix4(group.matrixWorld).project(camera)
    const x=rect.left+(v.x+1)*rect.width/2,y=rect.top+(1-v.y)*rect.height/2
    return {point:p.net.poles[index],index,x,y,canvas:document.elementFromPoint(x,y)===layer.canvas,locked:c.getViewState().locked.includes(index)}
  })
  assert(second.canvas && !second.locked,'second control point must be available: '+JSON.stringify(second))
  await page.mouse.move(second.x,second.y);await page.mouse.down()
  await page.mouse.move(second.x-20,second.y-15,{steps:5});await page.mouse.up()
  await page.waitForFunction(({point,index})=>{const c=window.cylinderQa.useWorkspaceEditor.getState().controller,p=c.getPanelState();return p.net.poles[index].some((x,i)=>Math.abs(x-point[i])>1e-5)&&!!c.getViewState().provisionalPreview},{timeout:120000},second)
  const result=await page.evaluate(()=>{
    const state=window.cylinderQa.useWorkspaceEditor.getState(),c=state.controller,p=c.getPanelState()
    return {validation:state.snapshot.validation.kind,canExport:p.canExportStep,canUndo:p.canUndo,faces:c.getViewState().provisionalPreview.faceMeshes.length}
  })
  assert.notEqual(result.validation,'valid');assert.equal(result.canExport,false);assert.equal(result.canUndo,true);assert.equal(result.faces,3)
  await page.waitForSelector('[data-test=surface-validate-cylinder]:enabled',{timeout:60000})
  await page.click('[data-test=surface-validate-cylinder]')
  await page.waitForFunction(()=>window.cylinderQa.useWorkspaceEditor.getState().snapshot?.validation.kind==='valid',{timeout:120000})
  await page.click('[data-test=surface-undo]')
  await page.waitForFunction(()=>window.cylinderQa.useWorkspaceEditor.getState().snapshot?.validation.kind!=='valid',{timeout:60000})
  assert.equal(await page.$eval('[data-test=workspace-editor-apply]',e=>e.disabled),true)
  await page.click('[data-test=surface-redo]')
  await page.waitForSelector('[data-test=surface-validate-cylinder]:enabled',{timeout:60000})
  await page.click('[data-test=surface-validate-cylinder]')
  await page.waitForFunction(()=>window.cylinderQa.useWorkspaceEditor.getState().snapshot?.validation.kind==='valid',{timeout:120000})
  await page.click('[data-test=surface-zebra]')
  await page.click('[data-test=surface-note-add]')
  const noteTarget=await page.evaluate(async()=>{
    const q=window.cylinderQa,c=q.useWorkspaceEditor.getState().controller,state=c.getViewState(),layer=q.scene.layerHost()
    const rect=layer.canvas.getBoundingClientRect(),camera=layer.camera(),group=layer.partGroup,preview=group.getObjectByName('tmar-edit-surface-preview')
    const THREE=await import('/node_modules/.vite/deps/three.js'),caster=new THREE.Raycaster()
    group.updateWorldMatrix(true,true);camera.updateMatrixWorld(true)
    const mesh=preview?.children.find(m=>m.userData.face===state.face)
    if(!mesh)return null
    const position=mesh.geometry.getAttribute('position'),indices=mesh.geometry.getIndex(),count=indices?indices.count:position.count
    for(let i=0;i+2<count;i+=3){
      const p=new THREE.Vector3()
      for(let j=0;j<3;j++)p.add(new THREE.Vector3().fromBufferAttribute(position,indices?indices.getX(i+j):i+j))
      p.multiplyScalar(1/3).applyMatrix4(mesh.matrixWorld)
      const projected=p.clone().project(camera),x=rect.left+(projected.x+1)*rect.width/2,y=rect.top+(1-projected.y)*rect.height/2
      if(Math.abs(projected.z)>=1 || document.elementFromPoint(x,y)!==layer.canvas)continue
      caster.setFromCamera(new THREE.Vector2(projected.x,projected.y),camera)
      if(caster.intersectObjects(preview.children,false)[0]?.object.userData.face===state.face)return {x,y}
    }
    return null
  })
  assert(noteTarget,'no visible point on the cylinder face')
  await page.mouse.click(noteTarget.x,noteTarget.y)
  await page.waitForSelector('[data-test=surface-note-text]')
  await page.type('[data-test=surface-note-text]','Nota sul cilindro')
  await page.click('[data-test=surface-undo]')
  await page.waitForFunction(()=>window.cylinderQa.useWorkspaceEditor.getState().snapshot?.validation.kind!=='valid',{timeout:60000})
  await page.click('[data-test=surface-redo]')
  await page.waitForSelector('[data-test=surface-validate-cylinder]:enabled',{timeout:60000})
  await page.click('[data-test=surface-validate-cylinder]')
  await page.waitForFunction(()=>{const s=window.cylinderQa.useWorkspaceEditor.getState();return s.snapshot?.validation.kind==='valid'&&s.controller.getPanelState().notes[0]?.text==='Nota sul cilindro'}, {timeout:120000})
  await page.waitForSelector('[data-test=workspace-editor-apply]:enabled',{timeout:60000})
  await page.click('[data-test=workspace-editor-apply]')
  await page.waitForFunction(()=>{const s=window.cylinderQa.useWorkspaceEditor.getState();return s.phase==='closed'||!!s.error},{timeout:120000})
  const applied=await page.evaluate(()=>{const q=window.cylinderQa,s=q.useWorkspaceEditor.getState();return {phase:s.phase,error:s.error,bodies:q.useReverse.getState().bodies.length,receipt:s.receipt}})
  assert.equal(applied.error,null);assert.equal(applied.phase,'closed');assert.equal(applied.bodies,2)
  assert.equal(applied.receipt?.mode,'annotated-cad-copy')
  await page.waitForFunction(()=>window.cylinderQa.useNotes.getState().notes.some(n=>n.text==='Nota sul cilindro' && n.attachment?.status==='verified'),{timeout:60000})
  const exported=await page.evaluate(async()=>{
    const q=window.cylinderQa,ids=q.useReverse.getState().bodies.map(b=>b.id)
    return Promise.all(ids.map(async id=>Array.from((await q.runCommand('reverse.export.step',{bodies:[id]})).file.bytes)))
  })
  const data=bytes=>{const text=new TextDecoder().decode(new Uint8Array(bytes)),at=text.indexOf('DATA;');assert(at>=0);return text.slice(at)}
  assert.equal(data(exported[0]),data(original),'original CAD STEP data remains unchanged (header timestamp excluded)')
  const verify=await OcctKernel.init(),copy=verify.importStep(new TextDecoder().decode(new Uint8Array(exported[1])))
  try {assert.equal(verify.isValid(copy),true)} finally {verify.release(copy);verify[Symbol.dispose]()}
  await page.waitForSelector('[data-test=save-project]:enabled');await page.click('[data-test=save-project]')
  let saved
  for(let i=0;i<200&&!saved;i++){saved=readdirSync(downloads).find(n=>n.endsWith('.scanruler'));if(!saved)await new Promise(r=>setTimeout(r,100))}
  assert(saved,'saved project missing')
  const reopened=await browser.newPage()
  await reopened.goto(process.env.APP_URL,{waitUntil:'domcontentloaded'});await reopened.waitForSelector('[data-test=project-input]')
  await (await reopened.$('[data-test=project-input]')).uploadFile(join(downloads,saved))
  await reopened.click('[data-test=workspace-reverse]')
  await reopened.evaluate(async()=>{
    const {useNotes}=await import('/plugins/reverse/state/noteStore.ts'),{useReverse}=await import('/plugins/reverse/state/reStore.ts')
    window.reopenedCylinderQa={useNotes,useReverse}
  })
  await reopened.waitForFunction(()=>window.reopenedCylinderQa.useReverse.getState().bodies.length===2 && window.reopenedCylinderQa.useNotes.getState().notes.some(n=>n.text==='Nota sul cilindro'&&n.attachment?.status==='verified'),{timeout:90000})
  await reopened.close()
  assert.deepEqual(consoleErrors,[])
  console.log(JSON.stringify({status:'PASS',scope:'isolated source host; synthetic cylinder; shared-view pointer gesture, annotated CAD copy and project reopen',...result,applied:applied.phase,bodies:applied.bodies}))
} finally {await browser.close()}
