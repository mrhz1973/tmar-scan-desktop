// SPDX-License-Identifier: AGPL-3.0-only
// Isolated browser test: actual pointer D gestures on imported multi-face shells.
import assert from 'node:assert/strict'
import {mkdirSync,mkdtempSync,readdirSync,writeFileSync} from 'node:fs'
import {isAbsolute,join,relative,resolve,sep} from 'node:path'
import {OcctKernel} from 'occt-wasm'

assert.equal(process.env.SCANRULER_ISOLATED,'1','Explicit isolated-host guard required')
const url=new URL(process.env.APP_URL??'')
assert.equal(url.href,'http://127.0.0.1:17723/','Only designated isolated host permitted')
const root=process.env.EDIT_SURFACE_QA_OUT
assert(root&&isAbsolute(root),'Absolute external evidence directory required')
const rel=relative(resolve(process.cwd()),resolve(root))
assert(rel&&(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)),'Evidence must be outside checkout')
mkdirSync(root,{recursive:true})
const out=mkdtempSync(join(root,'workspace-multiface-d-'))
process.env.SHOT_DIR=out
const report={scope:'synthetic 2-face STEP shell, pointer D, Apply-copy, save/reopen and second pointer D',checks:[],consoleErrors:[],verdict:'INCOMPLETE',
  limitations:'Source host and simulated browser input only; no physical input, desktop package, production scan, QS parity or global intersection proof.'}
const persist=()=>writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2))
const check=(ok,label)=>{assert(ok,label);report.checks.push(label);persist();console.log('PASS',label)}
const k=await OcctKernel.init(),owned=[]
let browser,page
const rectangle=x=>{
  const p=[{x,y:0,z:0},{x:x+10,y:0,z:0},{x:x+10,y:10,z:0},{x,y:10,z:0}]
  const edges=p.map((a,i)=>k.makeLineEdge(a,p[(i+1)%4]));owned.push(...edges)
  const wire=k.makeWire(edges);owned.push(wire)
  const face=k.makeFace(wire);owned.push(face);return face
}
const measure=step=>{
  const shape=k.importStep(step),faces=k.getSubShapes(shape,'face'),solids=k.getSubShapes(shape,'solid')
  try{
    let shared=0
    for(let a=0;a<faces.length;a++)for(let b=a+1;b<faces.length;b++){
      const edges=k.sharedEdges(faces[a],faces[b]);shared+=edges.length;edges.forEach(h=>k.release(h))
    }
    return {valid:k.isValid(shape),faces:faces.length,solids:solids.length,area:k.getSurfaceArea(shape),shared,
      samples:faces.map(face=>{const b=k.uvBounds(face),p=[]
        for(const s of [0,.5,1])for(const t of [0,.5,1]){const q=k.pointOnSurface(face,b.uMin+s*(b.uMax-b.uMin),b.vMin+t*(b.vMax-b.vMin));p.push([q.x,q.y,q.z])}
        return p})}
  }finally{faces.forEach(h=>k.release(h));solids.forEach(h=>k.release(h));k.release(shape)}
}
const bind=async()=>page.evaluate(async()=>{
  const {useReverse}=await import('/plugins/reverse/state/reStore.ts'),{reverseSession}=await import('/plugins/reverse/app/reSession.ts')
  const {useWorkspaceEditor}=await import('/src/plugins/workspaceEditors.ts'),{sceneOf}=await import('/src/commands/host.ts')
  window.multiD={useReverse,reverseSession,useWorkspaceEditor,scene:sceneOf()}
  window.addEventListener('pointerdown',event=>{window.multiD.pointer=event.pointerId},true)
})
const bodyStep=id=>page.evaluate(async id=>(await window.multiD.reverseSession().client().bodyEditSource(id)).text,id)
const openBody=async(id,count)=>{
  await page.waitForSelector('[data-test=feature-edit-surface]:enabled',{timeout:60000})
  await page.click('[data-test=feature-edit-surface]')
  // With multiple bodies use the actual source chooser.
  await page.waitForFunction(()=>document.querySelector('[data-test=surface-source-body]')||document.querySelector('[data-test=surface-face]'),{timeout:60000})
  if(await page.$('[data-test=surface-source-body]')){
    await page.select('[data-test=surface-source-body]',String(id))
    const button=await page.evaluateHandle(()=>[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent==='Continua'))
    assert(button.asElement(),'Source chooser Continue exists');await button.asElement().click()
  }
  await page.waitForSelector('[data-test=surface-face]',{timeout:120000})
  const face=await page.evaluate(()=>window.multiD.useWorkspaceEditor.getState().controller.getPanelState().faces.find(f=>!f.reason)?.index)
  assert.notEqual(face,undefined,'Editable shell face exists');await page.select('[data-test=surface-face]',String(face))
  await page.waitForFunction(count=>{
    const s=window.multiD.useWorkspaceEditor.getState(),c=s.controller,p=c?.getPanelState(),v=c?.getViewState()
    return p?.faces.length===count&&p.canBeginStrip&&v?.directStrip?.paths.length>0&&s.snapshot?.validation.kind==='valid'
  },{timeout:120000},count)
  const bound=await page.evaluate(()=>window.multiD.useWorkspaceEditor.getState().controller.context.source.bodyId)
  assert.equal(bound,id,'Editor must bind the requested source body')
  await page.evaluate(()=>{window.multiD.scene.fitToView();window.multiD.scene.viewFrom('iso')})
}
const project=point=>page.evaluate(point=>{
  const host=window.multiD.scene.layerHost(),rect=host.canvas.getBoundingClientRect(),group=host.partGroup,camera=host.camera()
  group.updateWorldMatrix(true,true);camera.updateMatrixWorld(true)
  const v=group.position.clone().set(...point).applyMatrix4(group.matrixWorld).project(camera)
  return [rect.left+(v.x+1)*rect.width/2,rect.top+(1-v.y)*rect.height/2]
},point)
const pointerExtend=async({axis,delta,baseFaces,seams,label})=>{
  const selection=await page.evaluate(({axis,seams})=>{
    const q=window.multiD,c=q.useWorkspaceEditor.getState().controller,v=c.getViewState(),paths=v.directStrip.paths
    const seamPresent=seams.some(x=>paths.some(path=>path.every(p=>Math.abs(p[0]-x)<1e-6&&Math.abs(p[2])<1e-6)))
    const xmax=Math.max(...paths.flat().map(p=>p[0]))
    const edge=paths.findIndex(path=>path.length===2&&path.every(p=>Math.abs(p[0]-xmax)<1e-6&&Math.abs(p[2])<1e-6))
    if(edge<0)return {seamPresent,edge}
    const path=paths[edge],anchor=path[0].map((x,i)=>(x+path[1][i])/2)
    const point=path[0].map((x,i)=>x+.37*(path[1][i]-x))
    return {seamPresent,edge,anchor,point,xmax,length:Math.hypot(...path[1].map((x,i)=>x-path[0][i]))}
  },{axis,seams})
  check(!selection.seamPresent,label+': shared seams are absent from selectable free paths')
  assert(selection.edge>=0,label+': outer edge found')
  // A seam click must not expose D. This does not assert that a control-net
  // segment cannot be selected at the same screen location.
  const seam=await project([seams[0],3.7,0]);await page.mouse.click(...seam)
  const seamHandle=await page.$('[data-test=surface-strip-handle]')
  check(!seamHandle||!(await seamHandle.boundingBox()),label+': seam click does not expose the D handle')
  await page.select('[data-test=surface-direct-strip-axis]',String(axis))
  const edgePoint=await project(selection.point);await page.mouse.click(...edgePoint)
  await page.waitForSelector('[data-test=surface-strip-handle]',{visible:true,timeout:15000})
  const box=await(await page.$('[data-test=surface-strip-handle]')).boundingBox()
  assert(box,'Visible D handle has bounds')
  const start=[box.x+box.width/2,box.y+box.height/2]
  const clickable=await page.evaluate(([x,y])=>document.elementFromPoint(x,y)?.dataset.test==='surface-strip-handle',start)
  check(clickable,label+': D handle is clickable at its visible centre')
  const a=await project(selection.anchor),b=await project(selection.anchor.map((v,i)=>v+delta[i]))
  const finish=[start[0]+b[0]-a[0],start[1]+b[1]-a[1]]
  assert(Math.hypot(finish[0]-start[0],finish[1]-start[1])>8,'Projected displacement exceeds drag threshold')
  await page.mouse.move(...start);await page.mouse.down()
  await page.waitForFunction(()=>window.multiD.useWorkspaceEditor.getState().snapshot?.gesture==='strip',{timeout:15000})
  check(await page.evaluate(()=>window.multiD.scene.layerHost().canvas.hasPointerCapture(window.multiD.pointer)),label+': D gesture captures the pointer')
  await page.mouse.move(...finish,{steps:8})
  await page.waitForFunction(()=>Math.hypot(...window.multiD.useWorkspaceEditor.getState().controller.getViewState().strip.delta)>.1)
  const observed=await page.evaluate(()=>[...window.multiD.useWorkspaceEditor.getState().controller.getViewState().strip.delta])
  assert(observed[axis]>.1&&observed.every((v,i)=>i===axis||Math.abs(v)<1e-7),'Preview follows selected positive axis')
  await page.screenshot({path:join(out,label+'-drag.png')});await page.mouse.up()
  await page.waitForFunction(count=>{
    const s=window.multiD.useWorkspaceEditor.getState(),v=s.controller?.getViewState()
    return s.snapshot?.validation.kind==='valid'&&s.snapshot.gesture==='idle'&&v?.strip?.hasResult&&v.preview.faceMeshes.length===count
  },{timeout:120000},baseFaces+1)
  const beforeApply=await page.evaluate(()=>window.multiD.useReverse.getState().bodies.length)
  await page.waitForSelector('[data-test=workspace-editor-apply]:enabled',{timeout:60000});await page.click('[data-test=workspace-editor-apply]')
  await page.waitForFunction(()=>{const s=window.multiD.useWorkspaceEditor.getState();return s.phase==='closed'||!!s.error},{timeout:120000})
  const applied=await page.evaluate(()=>{
    const s=window.multiD.useWorkspaceEditor.getState()
    return {phase:s.phase,error:s.error,receipt:s.receipt,bodies:window.multiD.useReverse.getState().bodies}
  })
  assert.equal(applied.phase,'closed',`Apply refused: ${applied.error}`)
  check(applied.bodies.length===beforeApply+1&&applied.receipt?.createdBodyIds?.length===1,label+': Apply creates one CAD copy')
  const id=applied.receipt.createdBodyIds[0],step=await bodyStep(id),geometry=measure(step)
  check(geometry.valid&&geometry.faces===baseFaces+1&&geometry.solids===0&&geometry.shared===baseFaces,label+': copied STEP is a valid connected shell with expected faces/seams')
  writeFileSync(join(out,label+'.step'),step)
  report[label]={selection,observed,receipt:applied.receipt,geometry};persist()
  return {id,step,geometry,observed,length:selection.length}
}
const saveProject=async label=>{
  const dir=join(out,label+'-downloads');mkdirSync(dir)
  const cdp=await page.createCDPSession();await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:dir,eventsEnabled:true})
  await page.waitForSelector('[data-test=save-project]:enabled');await page.click('[data-test=save-project]')
  for(let i=0;i<400;i++){
    const name=readdirSync(dir).find(n=>n.endsWith('.scanruler'));if(name)return join(dir,name)
    await new Promise(r=>setTimeout(r,100))
  }
  throw Error('Project download missing')
}
try{
  const shell=k.sew([rectangle(0),rectangle(10)],1e-7);owned.push(shell)
  const source=k.exportStep(shell);writeFileSync(join(out,'source.step'),source)
  report.fixture=measure(source);assert(report.fixture.valid&&report.fixture.faces===2&&report.fixture.solids===0)
  const {launchApp}=await import('../../../scripts/e2e-lib.mjs')
  const app=await launchApp({url:url.href,width:1440,height:1000,agentDataOk:false,userDataDir:join(out,'owned-browser-profile'),protocolTimeout:120000})
  browser=app.browser;page=app.page;report.consoleErrors=app.consoleErrors;page.on('dialog',d=>void d.accept())
  await page.evaluate(async step=>{
    const {useShell}=await import('/src/state/shellStore.ts'),{runCommand}=await import('/src/commands/registry.ts')
    const {reverseSession}=await import('/plugins/reverse/app/reSession.ts')
    useShell.getState().setWorkspace('reverse')
    for(let i=0;!reverseSession()&&i<500;i++)await new Promise(r=>setTimeout(r,20))
    if(!reverseSession())throw Error('CAD session unavailable')
    await reverseSession().startKernel();await reverseSession().settled()
    await runCommand('reverse.import.step',{bytes:new TextEncoder().encode(step),name:'two-face-shell.step'})
    await reverseSession().settled()
  },source)
  await bind()
  const sourceId=await page.evaluate(()=>window.multiD.useReverse.getState().bodies[0].id)
  const sourceBefore=measure(await bodyStep(sourceId))
  await openBody(sourceId,2)
  const first=await pointerExtend({axis:0,delta:[5,0,0],baseFaces:2,seams:[10],label:'first'})
  assert(Math.abs(first.geometry.area-sourceBefore.area-first.length*Math.abs(first.observed[0]))<1e-3)
  assert.deepEqual(measure(await bodyStep(sourceId)),sourceBefore)
  const saved=await saveProject('first');report.firstProject=saved;persist()
  page=await browser.newPage();page.on('dialog',d=>void d.accept());page.on('pageerror',e=>report.consoleErrors.push('reopen: '+e.message))
  await page.goto(url.href,{waitUntil:'domcontentloaded'});await page.waitForSelector('[data-test=project-input]')
  await(await page.$('[data-test=project-input]')).uploadFile(saved);await page.click('[data-test=workspace-reverse]');await bind()
  await page.waitForFunction(()=>window.multiD.useReverse.getState().bodies.length===2&&!window.multiD.useReverse.getState().building,{timeout:120000})
  assert.deepEqual(measure(await bodyStep(sourceId)),sourceBefore)
  assert.deepEqual(measure(await bodyStep(first.id)),first.geometry)
  check(true,'saved/reopened project preserves original source and first shell copy')
  await openBody(first.id,3)
  const second=await pointerExtend({axis:2,delta:[0,0,4],baseFaces:3,seams:[10,20],label:'second'})
  assert(Math.abs(second.geometry.area-first.geometry.area-second.length*Math.abs(second.observed[2]))<1e-3)
  assert.deepEqual(measure(await bodyStep(sourceId)),sourceBefore)
  assert.deepEqual(measure(await bodyStep(first.id)),first.geometry)
  check(true,'second Apply preserves both preceding CAD sources')
  report.finalProject=await saveProject('second')
  check(report.consoleErrors.length===0,'no browser application errors')
  report.verdict='PASS'
}catch(error){report.verdict='FAIL';report.error=String(error?.stack??error);process.exitCode=1;if(page)try{await page.screenshot({path:join(out,'failure.png')})}catch{}}
finally{if(browser)await browser.close();owned.forEach(h=>k.release(h));k[Symbol.dispose]();persist();console.log(JSON.stringify({out,...report},null,2))}

