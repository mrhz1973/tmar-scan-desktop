// SPDX-License-Identifier: AGPL-3.0-only
// Real source-app/host, a test-only controller, and real OCCT/STEP. Not the author plugin.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { OcctKernel } from 'occt-wasm'
import { launchApp, OUT_DIR } from '../../../scripts/e2e-lib.mjs'
const k = await OcctKernel.init()
const a = k.makeBox(20,30,10), b = k.makeBox(20,30,12)
const input = k.exportStep(a), result = k.exportStep(b)
k.release(a); k.release(b)
mkdirSync(OUT_DIR,{recursive:true})
const { browser, page, consoleErrors } = await launchApp({agentDataOk:false,userDataDir:join(OUT_DIR,'browser-profile'),protocolTimeout:120_000})
const checks=[]
function check(ok,name){ checks.push({ok:!!ok,name}); if(!ok) throw Error(name); console.log('PASS',name) }
page.on('dialog',dialog=>dialog.accept())
page.on('pageerror',error=>console.error('PAGEERROR_STACK',error.stack))
const pause=()=>new Promise(resolve=>setTimeout(resolve,100))
try {
  await page.evaluate(async ({input,result})=>{
    const {runCommand}=await import('/src/commands/registry.ts')
    const {registerCoreCommands}=await import('/src/commands/core.ts'); registerCoreCommands()
    const {useShell}=await import('/src/state/shellStore.ts')
    const {useReverse}=await import('/plugins/reverse/state/reStore.ts')
    const {reverseSession}=await import('/plugins/reverse/app/reSession.ts')
    const {sceneOf}=await import('/src/commands/host.ts')
    const {reSceneOf}=await import('/plugins/reverse/viewer/reScene.ts')
    const {workspaceEditors,useWorkspaceEditor}=await import('/src/plugins/workspaceEditors.ts')
    const history=await import('/src/state/historyStore.ts')
    const fixture=await import('/tests/fixtures/workspaceEditorProbe.ts')
    useShell.getState().setWorkspace('reverse')
    for (let i=0; !reverseSession() && i<500; i++) await new Promise(resolve=>setTimeout(resolve,20))
    if (!reverseSession()) throw Error('QA CAD session not initialized')
    await reverseSession().startKernel(); await reverseSession().settled()
    await runCommand('reverse.import.step',{bytes:new TextEncoder().encode(input),name:'host-input.step'})
    await reverseSession().settled()
    fixture.installProbe(new TextEncoder().encode(result))
    const scene=sceneOf(),id=useReverse.getState().bodies[0].id
    window.qa={runCommand,useReverse,reverseSession,scene,reScene:reSceneOf(scene),workspaceEditors,useWorkspaceEditor,history,fixture,id}
  },{input,result})
  await pause()
  await page.evaluate(()=>{
    const q=window.qa,cam=q.scene.layerHost().camera()
    q.before={canvas:q.scene.layerHost().canvas,camera:cam,pose:JSON.stringify({p:cam.position.toArray(),q:cam.quaternion.toArray()}),
      geometry:q.reScene.bodyMeshes.get(q.id).geometry,selection:q.useReverse.getState().selection,
      history:q.history.useHistory.getState().past.length,count:document.querySelectorAll('.viewport canvas').length}
  })
  await page.evaluate(()=>window.qa.workspaceEditors.open('qa-host-probe',{bodyId:window.qa.id}))
  // This legacy scenario explicitly retains both bodies; the new visibility
  // policy has its own real-plugin source and compiled UI regression.
  await page.evaluate(()=>window.qa.workspaceEditors.setHideSourceAfterApply(false))
  await page.waitForSelector('[data-test="probe-parameters"]')
  await pause()
  const entered=await page.evaluate(()=>{
    const q=window.qa,cam=q.scene.layerHost().camera()
    return {sameCanvas:q.scene.layerHost().canvas===q.before.canvas,sameCamera:cam===q.before.camera,
      samePose:JSON.stringify({p:cam.position.toArray(),q:cam.quaternion.toArray()})===q.before.pose,
      count:document.querySelectorAll('.viewport canvas').length,oldCount:q.before.count,
      originalMasked:q.reScene.bodyMeshes.get(q.id).material.visible===false,
      overlay:!!document.querySelector('[data-slot="workspace.editor.overlay"]'),
      slots:['parameters','actions','status'].every(x=>document.querySelector(`[data-slot="workspace.editor.${x}"]`)),
      originalGeometry:q.reScene.bodyMeshes.get(q.id).geometry===q.before.geometry,
      originalSelection:q.useReverse.getState().selection===q.before.selection,
      noModal:!document.querySelector('.es-modal,.modalback')}
  })
  check(entered.sameCanvas&&entered.sameCamera&&entered.samePose&&entered.count===entered.oldCount,'same main canvas, camera and pose on entry')
  check(entered.originalMasked&&entered.originalGeometry&&entered.originalSelection,'transient source mask, geometry and selection preserved')
  check(entered.overlay&&entered.slots&&entered.noModal,'contextual parameters/actions/status and overlay without modal')
  const point=await page.evaluate(()=>window.qa.fixture.probe.lease.projectPartPoint([10,15,10]))
  await page.mouse.move(point.clientX,point.clientY);await page.mouse.down();await page.mouse.move(point.clientX,point.clientY-18,{steps:4})
  const during=await page.evaluate(()=>({gesture:window.qa.useWorkspaceEditor.getState().snapshot.gesture,captured:window.qa.fixture.probe.lease.hasPointerCapture(1),disabled:document.querySelector('[data-test="workspace-editor-apply"]').disabled}))
  check(during.gesture==='pole'&&during.captured&&during.disabled,'real pointer is captured and Apply is blocked during gesture')
  const second=await page.evaluate(()=>{
    const q=window.qa,count=q.fixture.probe.gestures,canvas=q.scene.layerHost().canvas
    canvas.dispatchEvent(new PointerEvent('pointerdown',{pointerId:77,pointerType:'pen',button:0,buttons:1,clientX:100,clientY:100,bubbles:true}))
    canvas.dispatchEvent(new PointerEvent('pointerup',{pointerId:77,pointerType:'pen',button:0,clientX:100,clientY:100,bubbles:true}))
    return {countUnchanged:q.fixture.probe.gestures===count,gesture:q.useWorkspaceEditor.getState().snapshot.gesture,firstStillCaptured:q.fixture.probe.lease.hasPointerCapture(1)}
  })
  check(second.countUnchanged&&second.gesture==='pole'&&second.firstStillCaptured,'foreign pointer does not take or finish the active gesture')
  await page.keyboard.press('Escape')
  const escaped=await page.evaluate(()=>({phase:window.qa.useWorkspaceEditor.getState().phase,gesture:window.qa.useWorkspaceEditor.getState().snapshot.gesture,captured:window.qa.fixture.probe.lease.hasPointerCapture(1),history:window.qa.useWorkspaceEditor.getState().snapshot.historyRevision}))
  check(escaped.phase==='editing'&&escaped.gesture==='idle'&&!escaped.captured&&escaped.history===0,'Esc before mouseup cancels gesture, releases capture, keeps editor open')
  await page.mouse.up();await pause()
  check(await page.evaluate(()=>window.qa.useWorkspaceEditor.getState().snapshot.historyRevision===0),'late mouseup does not create a history step')
  await page.click('[data-test="probe-change"]')
  await page.click('[data-test="undo"]');await pause()
  check(await page.evaluate(()=>window.qa.useWorkspaceEditor.getState().snapshot.historyRevision===0&&window.qa.history.useHistory.getState().past.length===window.qa.before.history),'toolbar Undo uses local history without project leakage')
  await page.click('[data-test="redo"]');await pause()
  check(await page.evaluate(()=>window.qa.useWorkspaceEditor.getState().snapshot.historyRevision===1),'toolbar Redo restores the local change')
  await page.screenshot({path:join(OUT_DIR,'host-main-view.png')})
  await page.click('[data-test="workspace-editor-apply"]')
  await page.waitForFunction(()=>window.qa.useWorkspaceEditor.getState().phase==='closed',{timeout:120_000})
  const applied=await page.evaluate(()=>{
    const q=window.qa,rs=q.useReverse.getState(),rc=q.useWorkspaceEditor.getState().receipt
    return {bodies:rs.bodies.length,volumes:rs.bodies.map(b=>b.volume),history:q.history.useHistory.getState().past.length-q.before.history,
      id:rc?.createdBodyIds[0],maskReleased:q.reScene.bodyMeshes.get(q.id).material.visible,receipt:!!rc,
      overlays:document.querySelectorAll('[data-slot="workspace.editor.overlay"]').length,selection:rs.selection===q.before.selection}
  })
  check(applied.bodies===2&&applied.history===1&&applied.receipt&&applied.maskReleased&&applied.overlays===0&&applied.selection,'one CAD copy and one project Undo entry; leases removed after Apply')
  await page.click('[data-test="undo"]')
  await page.waitForFunction(()=>window.qa.useReverse.getState().bodies.length===1&&!window.qa.useReverse.getState().building)
  await page.click('[data-test="redo"]')
  await page.waitForFunction(()=>window.qa.useReverse.getState().bodies.length===2&&!window.qa.useReverse.getState().building)
  check(true,'project toolbar Undo/Redo removes and restores the copy')
  // Hold AFTER real staged OCCT validation. Cancellation must forbid late publication.
  await page.evaluate(async()=>{
    const q=window.qa,s=q.reverseSession(),orig=s.stageEditorCopy
    q.stageOriginal=orig;q.stageEntered=false
    s.stageEditorCopy=async(...args)=>{const stage=await orig(...args);q.stageEntered=true;await new Promise(resolve=>{q.releaseStage=resolve});return stage}
    q.savedCount=q.useReverse.getState().bodies.length;q.savedHistory=q.history.useHistory.getState().past.length
    await q.workspaceEditors.open('qa-host-probe',{bodyId:q.id})
    q.fixture.probe.controller.change(2)
    q.pendingApply=q.workspaceEditors.apply().then(()=>false,()=>true)
  })
  await page.waitForFunction(()=>window.qa.stageEntered,{timeout:120_000})
  await page.click('[data-test="workspace-editor-cancel"]')
  await page.waitForFunction(()=>window.qa.useWorkspaceEditor.getState().phase==='closed')
  const cancelled=await page.evaluate(async()=>{
    const q=window.qa;q.reverseSession().stageEditorCopy=q.stageOriginal;q.releaseStage()
    const refused=await q.pendingApply
    return refused&&q.useReverse.getState().bodies.length===q.savedCount&&q.history.useHistory.getState().past.length===q.savedHistory
  })
  check(cancelled,'Cancel after real CAD staging prevents delayed publication without body/history residue')
  const saved=await page.evaluate(async()=>{
    const q=window.qa,answer=await q.runCommand('project.save',{})
    const file=answer.file??answer
    return {name:file.name,bytes:Array.from(file.bytes)}
  })
  writeFileSync(join(OUT_DIR,saved.name),Buffer.from(saved.bytes))
  const reopened=await browser.newPage()
  reopened.on('pageerror',error=>consoleErrors.push(error.message))
  await reopened.goto(process.env.APP_URL??'http://127.0.0.1:17641/',{waitUntil:'networkidle0'})
  await reopened.evaluate(({name,bytes})=>{
    const dataTransfer=new DataTransfer();dataTransfer.items.add(new File([new Uint8Array(bytes)],name))
    window.dispatchEvent(new DragEvent('drop',{dataTransfer,bubbles:true,cancelable:true}))
  },saved)
  await reopened.waitForFunction(async()=>{const {useReverse}=await import('/plugins/reverse/state/reStore.ts');return useReverse.getState().bodies.length===2&&!useReverse.getState().building},{timeout:120_000})
  const exports=await reopened.evaluate(async()=>{
    const {runCommand}=await import('/src/commands/registry.ts'),{useReverse}=await import('/plugins/reverse/state/reStore.ts')
    const results=[]
    for(const body of useReverse.getState().bodies){const answer=await runCommand('reverse.body.edit_source',{body:body.id});results.push({id:body.id,text:new TextDecoder().decode(answer.file.bytes)})}
    return results
  })
  const measures=[]
  for(const exp of exports){const shape=k.importStep(exp.text),faces=k.getSubShapes(shape,'face');try{measures.push({id:exp.id,valid:k.isValid(shape),faces:faces.length,volume:k.getVolume(shape)});writeFileSync(join(OUT_DIR,`reopened-${exp.id}.step`),exp.text)}finally{faces.forEach(h=>k.release(h));k.release(shape)}}
  check(measures.every(m=>m.valid&&m.faces===6)&&measures.some(m=>Math.abs(m.volume-6000)<1e-6)&&measures.some(m=>Math.abs(m.volume-7200)<1e-6),'saved/reopened project exports two independently valid CAD solids with preserved volumes')
  check(consoleErrors.length===0,'no browser application console errors')
  writeFileSync(join(OUT_DIR,'result.json'),JSON.stringify({pass:true,checks,entered,applied,measures,consoleErrors,scope:'SOURCE HOST + QA CONTROLLER; not the author Edit Surface integration'},null,2))
} catch(error){
  console.error(error)
  writeFileSync(join(OUT_DIR,'failure.json'),JSON.stringify({message:error.message,checks,consoleErrors},null,2))
  try{await page.screenshot({path:join(OUT_DIR,'failure.png')})}catch{}
  process.exitCode=1
} finally { await browser.close(); k[Symbol.dispose]() }
