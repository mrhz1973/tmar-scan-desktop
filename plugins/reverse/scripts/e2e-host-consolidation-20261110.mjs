// SPDX-License-Identifier: AGPL-3.0-only
// Real editor + real mouse + native readback, on an isolated synthetic box.
// Qualifies the integrated source app only, not a desktop build or T2 geometry.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { OcctKernel } from 'occt-wasm'

assert.equal(process.env.SCANRULER_ISOLATED,'1','An isolated app is required')
const url=new URL(process.env.APP_URL ?? '')
assert(url.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname) && url.port &&
  url.pathname==='/' && !url.username && !url.password && !url.search && !url.hash,'Explicit local app origin required')
const root=process.env.HOST_QA_OUT
assert(root && isAbsolute(root),'Absolute HOST_QA_OUT required')
const rel=relative(resolve(process.cwd()),resolve(root))
assert(rel && (rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)),'Evidence must be outside the Vite checkout')
mkdirSync(root,{recursive:true})
const out=mkdtempSync(join(root,'host-consolidation-')),downloads=join(out,'downloads')
mkdirSync(downloads);process.env.SHOT_DIR=out
const {launchApp,drag}=await import('../../../scripts/e2e-lib.mjs')
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const k=await OcctKernel.init(), box=k.makeBox(20,30,10)
let input
try{input=k.exportStep(box)}finally{k.release(box)}
const report={scope:'isolated Vite source app, actual Edit Surface controller, synthetic 20×30×10 mm box',
  head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  sourceSha256:sha(input),checks:[],consoleErrors:[],cleanupErrors:[],verdict:'INCOMPLETE'}
const check=(ok,label)=>{assert(ok,label);report.checks.push(label);console.log('PASS',label)}
const pause=ms=>new Promise(r=>setTimeout(r,ms))
const changed=(a,b)=>a.some((v,i)=>Math.abs(v-b[i])>1e-7)
let browser,page
try{
  const app=await launchApp({url:url.href,width:1440,height:1000,agentDataOk:false,
    userDataDir:join(out,'owned-browser-profile'),protocolTimeout:120000})
  browser=app.browser;page=app.page;report.consoleErrors=app.consoleErrors
  page.on('dialog',d=>d.accept())
  const cdp=await page.createCDPSession()
  await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,eventsEnabled:true})
  await page.evaluate(async step=>{
    const {runCommand}=await import('/src/commands/registry.ts')
    const {useShell}=await import('/src/state/shellStore.ts')
    const {useReverse}=await import('/plugins/reverse/state/reStore.ts')
    const {reverseSession}=await import('/plugins/reverse/app/reSession.ts')
    const {sceneOf}=await import('/src/commands/host.ts')
    const {reSceneOf}=await import('/plugins/reverse/viewer/reScene.ts')
    const {useWorkspaceEditor}=await import('/src/plugins/workspaceEditors.ts')
    const {useHistory}=await import('/src/state/historyStore.ts')
    useShell.getState().setWorkspace('reverse')
    for(let i=0;!reverseSession()&&i<500;i++)await new Promise(r=>setTimeout(r,20))
    if(!reverseSession())throw Error('CAD session unavailable')
    await reverseSession().startKernel();await reverseSession().settled()
    await runCommand('reverse.import.step',{bytes:new TextEncoder().encode(step),name:'host-qa-box.step'})
    await reverseSession().settled()
    const scene=sceneOf(),id=useReverse.getState().bodies[0]?.id
    if(!scene||!id)throw Error('Synthetic source unavailable')
    scene.fitToView()
    window.hostQa={useReverse,reverseSession,scene,reScene:reSceneOf(scene),useWorkspaceEditor,useHistory,id}
  },input)
  await page.waitForFunction(()=>!!window.hostQa.reScene.bodyMeshes.get(window.hostQa.id),{timeout:60000})
  await page.evaluate(()=>{
    const q=window.hostQa,h=q.scene.layerHost()
    q.before={canvas:h.canvas,camera:h.camera(),geometry:q.reScene.bodyMeshes.get(q.id).geometry,
      history:q.useHistory.getState().past.length}
  })
  await page.waitForSelector('[data-test=feature-edit-surface]:enabled',{timeout:60000})
  await page.click('[data-test=feature-edit-surface]')
  await page.waitForSelector('[data-test=workspace-surface-parameters]',{timeout:120000})
  const face=await page.evaluate(()=>{
    const c=window.hostQa.useWorkspaceEditor.getState().controller,meshes=c.getViewState().preview.faceMeshes
    return c.getPanelState().faces.find(f=>f.kind==='plane'&&!f.reason&&
      Array.from(meshes[f.index].positions).filter((_,i)=>i%3===2).every(z=>Math.abs(z-10)<1e-5))?.index
  })
  assert(Number.isInteger(face),'Top planar face must be editable')
  await page.select('[data-test=surface-face]',String(face))
  await page.waitForFunction(()=>{const s=window.hostQa.useWorkspaceEditor.getState();return s.snapshot?.validation.kind==='valid'&&!s.controller.getPanelState().calculating},{timeout:120000})
  await page.evaluate(()=>{const q=window.hostQa;q.poles=JSON.stringify(q.useWorkspaceEditor.getState().controller.getViewState().net.poles)})
  check(await page.evaluate(()=>{const q=window.hostQa,h=q.scene.layerHost();return h.canvas===q.before.canvas&&h.camera()===q.before.camera&&q.reScene.bodyMeshes.get(q.id).geometry===q.before.geometry}),
    'Edit Surface borrows the existing viewport, camera and source geometry')

  const camera=()=>page.evaluate(()=>{const q=window.hostQa,c=q.scene.layerHost().camera();return {position:c.position.toArray(),rotation:c.quaternion.toArray(),zoom:c.zoom,target:q.scene.viewLink().target.toArray()}})
  const unchanged=()=>page.evaluate(()=>{const q=window.hostQa;return JSON.stringify(q.useWorkspaceEditor.getState().controller.getViewState().net.poles)===q.poles&&q.useHistory.getState().past.length===q.before.history})
  // Confirm every point of the gesture path is on empty canvas, not on a net,
  // a preview triangle, an HTML overlay or the orientation gizmo.
  const emptyPath=()=>page.evaluate(()=>{
    const q=window.hostQa,h=q.scene.layerHost(),r=h.canvas.getBoundingClientRect(),cam=h.camera(),ray=h.raycaster
    h.partGroup.updateWorldMatrix(true,true);cam.updateMatrixWorld(true)
    const root=h.partGroup.getObjectByName('tmar-edit-surface-preview')
    const targets=[q.reScene.bodyMeshes.get(q.id),...(root?.children??[])].filter(Boolean)
    for(const fy of [.15,.25,.75,.65,.45])for(const fx of [.12,.2,.65,.7]){
      const from={x:r.left+r.width*fx,y:r.top+r.height*fy},to={x:from.x+60,y:from.y+30}
      let clear=true
      for(let i=0;i<=12;i++){
        const x=from.x+(to.x-from.x)*i/12,y=from.y+(to.y-from.y)*i/12
        if(x>r.right-15||y>r.bottom-15||document.elementFromPoint(x,y)!==h.canvas||q.scene.gizmoAt(x,y)){clear=false;break}
        const ndc={x:2*(x-r.left)/r.width-1,y:1-2*(y-r.top)/r.height}
        ray.setFromCamera(ndc,cam)
        if(ray.intersectObjects(targets,true).length){clear=false;break}
      }
      if(clear)return {from:[from.x,from.y],to:[to.x,to.y]}
    }
    throw Error('No verified empty canvas gesture path')
  })
  const setScheme=async scheme=>{
    await page.click('[data-test=open-settings]');await page.waitForSelector('#navscheme')
    await page.select('#navscheme',scheme);await page.click('[data-test=settings-close]');await pause(200)
  }
  await setScheme('fusion')
  let path=await emptyPath(),before=await camera()
  await page.keyboard.down('Shift');await drag(page,path.from,path.to,{button:'middle'});await page.keyboard.up('Shift')
  let after=await camera()
  check(changed(before.rotation,after.rotation)&&await unchanged(),'Fusion Shift+MMB orbits without editing poles or project history')
  path=await emptyPath();before=after
  await drag(page,path.from,path.to,{button:'middle'});after=await camera()
  check(changed(before.target,after.target)&&!changed(before.rotation,after.rotation)&&await unchanged(),'Fusion MMB pans without rotating or editing the draft')
  await setScheme('cnckitchen')
  path=await emptyPath();before=await camera()
  await drag(page,path.from,path.to,{button:'left'});after=await camera()
  check(changed(before.rotation,after.rotation)&&await unchanged(),'CNC Kitchen LMB orbits on verified empty canvas with the editor active')
  path=await emptyPath();before=after
  await drag(page,path.from,path.to,{button:'right'});after=await camera()
  check(changed(before.target,after.target)&&!changed(before.rotation,after.rotation)&&await unchanged(),'CNC Kitchen RMB pans on verified empty canvas with the editor active')

  for(const axis of ['x','y','z']){
    const tip=await page.evaluate(axis=>{
      const q=window.hostQa,r=q.scene.layerHost().canvas.getBoundingClientRect()
      for(let y=Math.ceil(r.bottom-140);y<r.bottom-10;y+=2)for(let x=Math.ceil(r.right-140);x<r.right-10;x+=2)
        if(q.scene.gizmoAt(x,y)===axis&&document.elementFromPoint(x,y)===q.scene.layerHost().canvas)return {x,y}
      throw Error('No clickable '+axis+' orientation handle')
    },axis)
    await page.mouse.click(tip.x,tip.y);await pause(450)
    const aligned=await page.evaluate(axis=>{
      const q=window.hostQa,c=q.scene.layerHost().camera(),d=c.position.clone().sub(q.scene.viewLink().target).normalize()
      return Math.abs(d[axis])>.999
    },axis)
    check(aligned&&await unchanged(),`Clicking the ${axis.toUpperCase()} gizmo orients the shared camera without editing the draft`)
  }
  before=await camera()
  await page.waitForSelector('[data-test=workspace-editor-frame-reticle]:enabled')
  await page.click('[data-test=workspace-editor-frame-reticle]');await pause(450);after=await camera()
  const framed=await page.evaluate(()=>{
    const q=window.hostQa,h=q.scene.layerHost(),c=h.camera(),net=q.useWorkspaceEditor.getState().controller.getViewState().net
    h.partGroup.updateWorldMatrix(true,true);c.updateMatrixWorld(true)
    return net.poles.every(p=>{const v=c.position.clone().set(...p).applyMatrix4(h.partGroup.matrixWorld).project(c);return Math.abs(v.x)<=1&&Math.abs(v.y)<=1&&Math.abs(v.z)<=1})
  })
  check(!changed(before.rotation,after.rotation)&&framed&&await unchanged(),'Inquadra reticolo fits the net while preserving camera direction and poles')
  await page.screenshot({path:join(out,'navigation-gizmo-frame.png')})

  // Duplicate face is part of the V5 Modify tool group: reveal it before clicking.
  await page.click('[data-test=workspace-surface-tool-modify]')
  await page.waitForSelector('[data-test=surface-duplicate-cad-face]:enabled',{visible:true})
  await page.click('[data-test=surface-duplicate-cad-face]')
  if(await page.$eval('[data-test=workspace-editor-hide-source]',e=>e.checked))await page.click('[data-test=workspace-editor-hide-source]')
  await page.waitForSelector('[data-test=workspace-editor-apply]:enabled',{timeout:120000})
  await page.click('[data-test=workspace-editor-apply]')
  await page.waitForFunction(()=>{const s=window.hostQa.useWorkspaceEditor.getState();return s.phase==='closed'||!!s.error},{timeout:120000})
  const applied=await page.evaluate(()=>{
    const q=window.hostQa,s=q.useWorkspaceEditor.getState()
    return {phase:s.phase,error:s.error,receipt:s.receipt,bodies:q.useReverse.getState().bodies,
      feature:q.useReverse.getState().features.at(-1),historyDelta:q.useHistory.getState().past.length-q.before.history,sourceId:q.id}
  })
  if(applied.error)throw Error('Duplicate Apply refused: '+applied.error)
  const copyId=applied.receipt?.createdBodyIds?.[0]
  check(applied.phase==='closed'&&applied.receipt?.mode==='cad-copy'&&applied.receipt.createdBodyIds.length===1&&
    applied.bodies.length===2&&applied.historyDelta===1,'Duplica faccia CAD Apply creates one separate CAD body in one history action')
  check(applied.bodies.every(b=>b.visible)&&applied.feature.kind==='import'&&!applied.feature.surfaceEditHistory,
    'Original visibility choice is respected; the duplicate is an ordinary CAD import')
  const readBodies=()=>page.evaluate(async({sourceId,copyId})=>{
    const q=window.hostQa
    return {source:(await q.reverseSession().client().bodyEditSource(sourceId)).text,copy:(await q.reverseSession().client().bodyEditSource(copyId)).text}
  },{sourceId:applied.sourceId,copyId})
  const inspect=step=>{
    const s=k.importStep(step)
    try{return {valid:k.isValid(s),faces:k.subShapeCount(s,'face'),solids:k.subShapeCount(s,'solid'),area:k.getSurfaceArea(s),volume:k.getVolume(s)}}finally{k.release(s)}
  }
  const inspectPair=pair=>({source:inspect(pair.source),copy:inspect(pair.copy)})
  const correctPair=p=>p.source.valid&&p.source.faces===6&&p.source.solids===1&&Math.abs(p.source.volume-6000)<1e-6&&
    p.copy.valid&&p.copy.faces===1&&p.copy.solids===0&&Math.abs(p.copy.area-600)<1e-6
  report.afterApply=inspectPair(await readBodies())
  check(correctPair(report.afterApply),'Native readback confirms the intact 6000 mm³ solid and separate 600 mm² face')
  await page.click('[data-test=undo]')
  await page.waitForFunction(()=>{const q=window.hostQa;return q.useReverse.getState().bodies.length===1&&!q.useReverse.getState().building},{timeout:60000})
  check(await page.evaluate(()=>window.hostQa.useReverse.getState().bodies[0].id===window.hostQa.id),'Global Undo removes only the duplicate')
  await page.click('[data-test=redo]')
  await page.waitForFunction(id=>{const q=window.hostQa;return q.useReverse.getState().bodies.some(b=>b.id===id)&&!q.useReverse.getState().building},{timeout:60000},copyId)
  report.afterRedo=inspectPair(await readBodies())
  check(correctPair(report.afterRedo),'Global Redo restores the same valid solid and detached face')
  await page.click('[data-test=save-project]')
  let saved
  for(let i=0;i<400;i++){const name=readdirSync(downloads).find(n=>n.endsWith('.scanruler'));if(name){saved=join(downloads,name);break}await pause(100)}
  assert(saved,'Project ZIP download missing');report.projectSha256=sha(readFileSync(saved))
  page=await browser.newPage();await page.setViewport({width:1440,height:1000})
  page.on('dialog',d=>d.accept());page.on('pageerror',e=>report.consoleErrors.push('reopen: '+e.message))
  page.on('console',message=>{if(message.type()==='error')report.consoleErrors.push('reopen: '+message.text())})
  await page.goto(url.href,{waitUntil:'domcontentloaded'});await page.waitForSelector('[data-test=project-input]')
  await(await page.$('[data-test=project-input]')).uploadFile(saved)
  await page.click('[data-test=workspace-reverse]')
  await page.evaluate(async()=>{
    const {useReverse}=await import('/plugins/reverse/state/reStore.ts')
    const {reverseSession}=await import('/plugins/reverse/app/reSession.ts')
    window.hostQa={useReverse,reverseSession}
  })
  await page.waitForFunction(()=>{const q=window.hostQa;return q.useReverse.getState().bodies.length===2&&!q.useReverse.getState().building&&!!q.reverseSession()?.client()},{timeout:120000})
  report.afterReopen=inspectPair(await readBodies())
  check(correctPair(report.afterReopen),'Fresh-page project ZIP reopen preserves the valid source solid and separate CAD face')
  check(await page.evaluate(()=>window.hostQa.useReverse.getState().bodies.every(b=>b.visible)),'Project reopen preserves the explicit source and copy visibility')
  check(report.consoleErrors.length===0,'No browser application errors')
  await page.screenshot({path:join(out,'duplicate-reopened.png')})
  report.verdict='PASS'
}catch(error){
  report.verdict='FAIL';report.error=String(error?.stack??error);process.exitCode=1
  if(page)await page.screenshot({path:join(out,'failure.png')}).catch(()=>{})
  console.error(report.error)
}finally{
  try{if(browser)await browser.close()}catch(error){report.cleanupErrors.push('browser.close: '+String(error?.stack??error))}
  try{k[Symbol.dispose]()}catch(error){report.cleanupErrors.push('kernel.dispose: '+String(error?.stack??error))}
  if(report.cleanupErrors.length){
    report.verdict='FAIL';process.exitCode=1
    report.error??='Cleanup failed: '+report.cleanupErrors.join('; ')
  }
  writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2))
  console.log(JSON.stringify({out,verdict:report.verdict,checks:report.checks.length,error:report.error}))
}
