// SPDX-License-Identifier: AGPL-3.0-only
// Synthetic two-face shell; simulated browser input, never a real-scan/global G1 proof.
import assert from 'node:assert/strict'
import {mkdirSync,mkdtempSync,readdirSync,readFileSync,writeFileSync} from 'node:fs'
import {isAbsolute,join,relative,resolve,sep} from 'node:path'
import {OcctKernel} from 'occt-wasm'

assert.equal(process.env.SCANRULER_ISOLATED,'1','Explicit isolated-host guard required')
const url=new URL(process.env.APP_URL??'')
assert.equal(url.href,'http://127.0.0.1:17723/','Only the designated isolated host is permitted')
const root=process.env.EDIT_SURFACE_QA_OUT
assert(root&&isAbsolute(root),'Absolute external evidence directory required')
const rel=relative(resolve(process.cwd()),resolve(root))
assert(rel&&(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)),'Evidence must be outside checkout')
mkdirSync(root,{recursive:true})
const out=mkdtempSync(join(root,'workspace-g1-plane-')),downloads=join(out,'downloads')
mkdirSync(downloads);process.env.SHOT_DIR=out
const report={scope:'synthetic sewn coplanar rectangles; real worker/controller and simulated UI input',checks:[],verdict:'INCOMPLETE',
  limitations:'Only this natural shared edge and planar support are exercised; no global G1, real scan, physical input, compiled app or macOS qualification.'}
const persist=()=>writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2))
const check=(ok,label)=>{assert(ok,label);report.checks.push(label);persist();console.log('PASS',label)}
const k=await OcctKernel.init(),owned=[]
const rectangle=x=>{
  const p=[{x,y:0,z:0},{x:x+10,y:0,z:0},{x:x+10,y:10,z:0},{x,y:10,z:0}]
  const edges=p.map((a,i)=>k.makeLineEdge(a,p[(i+1)%4]));owned.push(...edges)
  const wire=k.makeWire(edges);owned.push(wire)
  const face=k.makeFace(wire);owned.push(face);return face
}
let browser,page
const inspect=step=>{
  const shape=k.importStep(step),faces=k.getSubShapes(shape,'face'),solids=k.getSubShapes(shape,'solid')
  try {
    const samples=faces.map(face=>{
      const b=k.uvBounds(face),points=[]
      for(const s of [0,.25,.5,.75,1])for(const t of [0,.25,.5,.75,1]){
        const u=b.uMin+s*(b.uMax-b.uMin),v=b.vMin+t*(b.vMax-b.vMin),p=k.pointOnSurface(face,u,v),n=k.surfaceNormal(face,u,v)
        points.push({at:[p.x,p.y,p.z],normal:[n.x,n.y,n.z]})
      }
      return points
    })
    return {valid:k.isValid(shape),faces:faces.length,solids:solids.length,samples}
  }finally{faces.forEach(f=>k.release(f));solids.forEach(s=>k.release(s));k.release(shape)}
}
const ready=()=>page.waitForFunction(()=>{
  const s=window.g1PlaneQa.useWorkspaceEditor.getState(),p=s.controller?.getPanelState()
  return s.snapshot?.validation.kind==='valid'&&!p?.busy&&!p?.calculating&&!!p?.net
},{timeout:120000})
const poles=()=>page.evaluate(()=>window.g1PlaneQa.useWorkspaceEditor.getState().controller.getPanelState().net.poles)
const waitPoles=expected=>page.waitForFunction(expected=>{
  const s=window.g1PlaneQa.useWorkspaceEditor.getState(),p=s.controller?.getPanelState()
  return s.snapshot?.validation.kind==='valid'&&!p?.calculating&&JSON.stringify(p?.net?.poles)===JSON.stringify(expected)
},{timeout:120000},expected)
try{
  const shell=k.sew([rectangle(0),rectangle(10)],1e-7);owned.push(shell)
  const input=k.exportStep(shell);writeFileSync(join(out,'source.step'),input)
  report.source=inspect(input)
  check(report.source.valid&&report.source.faces===2&&report.source.solids===0,'fixture is a valid two-face shell, not a solid')
  const {launchApp}=await import('../../../scripts/e2e-lib.mjs')
  const app=await launchApp({url:url.href,width:1440,height:1000,agentDataOk:false,userDataDir:join(out,'owned-browser-profile'),protocolTimeout:120000})
  browser=app.browser;page=app.page;report.consoleErrors=app.consoleErrors
  page.on('dialog',d=>void d.accept())
  const cdp=await page.createCDPSession()
  await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,eventsEnabled:true})
  await page.evaluate(async step=>{
    const {runCommand}=await import('/src/commands/registry.ts')
    const {useShell}=await import('/src/state/shellStore.ts')
    const {useReverse}=await import('/plugins/reverse/state/reStore.ts')
    const {useNotes}=await import('/plugins/reverse/state/noteStore.ts')
    const {reverseSession}=await import('/plugins/reverse/app/reSession.ts')
    const {useWorkspaceEditor}=await import('/src/plugins/workspaceEditors.ts')
    const {useHistory}=await import('/src/state/historyStore.ts')
    const {sceneOf}=await import('/src/commands/host.ts')
    useShell.getState().setWorkspace('reverse')
    for(let i=0;!reverseSession()&&i<500;i++)await new Promise(r=>setTimeout(r,20))
    if(!reverseSession())throw Error('CAD session unavailable')
    await reverseSession().startKernel();await reverseSession().settled()
    await runCommand('reverse.import.step',{bytes:new TextEncoder().encode(step),name:'g1-coplanar-shell.step'})
    await reverseSession().settled()
    const id=useReverse.getState().bodies[0]?.id
    if(!id||useReverse.getState().bodies.length!==1)throw Error('Shell import failed')
    const sourceBefore=(await reverseSession().client().bodyEditSource(id)).text
    const scene=sceneOf();scene.fitToView();scene.viewFrom('top')
    window.g1PlaneQa={useReverse,useNotes,reverseSession,useWorkspaceEditor,useHistory,scene,id,sourceBefore,history:useHistory.getState().past.length}
  },input)
  await page.waitForSelector('[data-test=feature-edit-surface]:enabled',{timeout:60000})
  await page.click('[data-test=feature-edit-surface]')
  await page.waitForSelector('[data-test=surface-face]',{timeout:120000})
  const face=await page.evaluate(()=>window.g1PlaneQa.useWorkspaceEditor.getState().controller.getPanelState().faces.find(f=>!f.reason)?.index)
  assert.notEqual(face,undefined,'Editable plane exists')
  await page.select('[data-test=surface-face]',String(face));await ready()
  await page.select('[data-test=surface-continuity]','G0');await ready()
  const original=await poles()
  // Match g1PublishedKernel fixture: one interior pole immediately adjacent to x=10.
  const target=await page.evaluate(()=>{
    const q=window.g1PlaneQa,c=q.useWorkspaceEditor.getState().controller,v=c.getViewState(),net=v.net
    const choices=net.poles.flatMap((p,id)=>{
      const u=Math.floor(id/net.nv),w=id%net.nv
      return u>0&&u<net.nu-1&&w>0&&w<net.nv-1&&!v.locked.includes(id)?[{id,p}]:[]
    }).sort((a,b)=>Math.abs(a.p[0]-10)-Math.abs(b.p[0]-10)||Math.abs(a.p[1]-5)-Math.abs(b.p[1]-5))
    const chosen=choices[0];if(!chosen)return null
    const host=q.scene.layerHost(),rect=host.canvas.getBoundingClientRect(),camera=host.camera(),group=host.partGroup
    group.updateWorldMatrix(true,true);camera.updateMatrixWorld(true)
    const p=group.position.clone().set(...chosen.p).applyMatrix4(group.matrixWorld).project(camera)
    const x=rect.left+(p.x+1)*rect.width/2,y=rect.top+(1-p.y)*rect.height/2
    return {id:chosen.id,x,y,visible:document.elementFromPoint(x,y)===host.canvas}
  })
  assert(target?.visible,'Interior pole must be visibly clickable')
  await page.select('[data-test=surface-selection-mode]','points')
  await page.mouse.click(target.x,target.y)
  await page.waitForFunction(id=>window.g1PlaneQa.useWorkspaceEditor.getState().controller.getPanelState().selected.includes(id),{},target.id)
  await page.select('[data-test=surface-drag-mode]','local');await page.click('[data-test=surface-axis-2]')
  await page.$eval('[data-test=surface-distance]',e=>{
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'0.2');e.dispatchEvent(new Event('input',{bubbles:true}))
  })
  await page.click('[data-test=surface-move]');await ready()
  const defect=await poles()
  check(Math.abs(defect[target.id][2]-original[target.id][2])>.1,'UI move creates the adjacent-row tangency defect')
  await page.screenshot({path:join(out,'defect.png')})
  await page.click('[data-test=surface-g1-load]')
  await page.waitForFunction(()=>document.querySelectorAll('[data-test=surface-g1-support] option[value]:not([value=""])').length===1,{timeout:120000})
  const candidate=await page.$eval('[data-test=surface-g1-support]',e=>[...e.options].find(o=>o.value!=='')?.value)
  assert(candidate,'One planar support required');await page.select('[data-test=surface-g1-support]',candidate)
  await page.waitForSelector('[data-test=surface-g1-apply]:enabled');await page.click('[data-test=surface-g1-apply]');await ready()
  await page.waitForFunction(()=>window.g1PlaneQa.useWorkspaceEditor.getState().controller.getPanelState().planeTangencyActive,{timeout:120000})
  const corrected=await poles()
  check(Math.abs(corrected[target.id][2])<1e-7,'G1 button repairs the defective adjacent pole against the coplanar support')
  report.g1Status=await page.$eval('[data-test=surface-g1-status]',e=>e.textContent)
  assert.match(report.g1Status,/attivo nella bozza/,'Explicit local G1 status is visible')
  await page.click('[data-test=surface-undo]');await waitPoles(defect)
  assert.equal(await page.evaluate(()=>window.g1PlaneQa.useWorkspaceEditor.getState().controller.getPanelState().planeTangencyActive),false)
  await page.click('[data-test=surface-redo]');await waitPoles(corrected)
  assert.equal(await page.evaluate(()=>window.g1PlaneQa.useWorkspaceEditor.getState().controller.getPanelState().planeTangencyActive),true)
  check(true,'local Undo/Redo restore the defect and the corrected CAD net')
  await page.click('[data-test=surface-zebra]');await page.click('[data-test=surface-note-add]')
  // CAD anchoring is direct; point movement/G1 and note text use actual UI controls.
  await page.evaluate(async()=>{
    const c=window.g1PlaneQa.useWorkspaceEditor.getState().controller,v=c.getViewState(),m=v.preview.faceMeshes[v.face]
    const ids=[...m.indices.slice(0,3)],p=[0,1,2].map(a=>ids.reduce((sum,id)=>sum+m.positions[id*3+a],0)/3)
    await c.placeNote(p)
  })
  await page.waitForSelector('[data-test=surface-note-text]');await page.type('[data-test=surface-note-text]','Nota G1 con Zebra')
  await page.waitForFunction(()=>{
    const c=window.g1PlaneQa.useWorkspaceEditor.getState().controller,p=c.getPanelState(),v=c.getViewState()
    return p.notes[0]?.text==='Nota G1 con Zebra'&&v.notePins.length===1&&!!v.stripes
  },{timeout:30000})
  check(true,'resolved note and Zebra coexist after G1 and local history')
  await page.screenshot({path:join(out,'g1-zebra-note.png')})
  const annotated=await page.evaluate(()=>window.g1PlaneQa.useWorkspaceEditor.getState().controller.getPanelState().annotatedCopyAvailable)
  if(!annotated){
    check(await page.$eval('[data-test=workspace-editor-apply]',e=>e.disabled),'host without annotations blocks publishing a noted copy')
    // Remove only the draft note to exercise plain CAD-copy publication.
    const remove=await page.evaluateHandle(()=>[...document.querySelectorAll('[data-test=workspace-surface-parameters] button')].find(e=>e.textContent==='Rimuovi nota'))
    assert(remove.asElement(),'Remove-note control exists');await remove.asElement().click()
  }
  await page.waitForSelector('[data-test=workspace-editor-apply]:enabled',{timeout:120000});await page.click('[data-test=workspace-editor-apply]')
  await page.waitForFunction(()=>{const s=window.g1PlaneQa.useWorkspaceEditor.getState();return s.phase==='closed'||!!s.error},{timeout:120000})
  const applied=await page.evaluate(async()=>{
    const q=window.g1PlaneQa,s=q.useWorkspaceEditor.getState(),copy=s.receipt?.createdBodyIds?.[0]
    return {phase:s.phase,error:s.error,receipt:s.receipt,bodies:q.useReverse.getState().bodies,notes:q.useNotes.getState().notes,
      history:q.useHistory.getState().past.length-q.history,sourceBefore:q.sourceBefore,
      source:(await q.reverseSession().client().bodyEditSource(q.id)).text,
      copy:copy?(await q.reverseSession().client().bodyEditSource(copy)).text:null}
  })
  assert.equal(applied.phase,'closed',`Apply refused: ${applied.error}`)
  check(applied.bodies.length===2&&applied.receipt?.createdBodyIds.length===1&&applied.history===1,'Apply publishes exactly one CAD copy and one history step')
  assert.deepEqual(inspect(applied.source),inspect(applied.sourceBefore),'Original CAD source remains unchanged')
  report.copy=inspect(applied.copy)
  check(report.copy.valid&&report.copy.faces===2&&report.copy.solids===0,'published copy remains a valid two-face shell')
  const edgeSamples=report.copy.samples.flat().filter(s=>Math.abs(s.at[0]-10)<1e-6)
  check(edgeSamples.length>=10&&edgeSamples.every(s=>Math.abs(s.at[2])<1e-6&&Math.abs(s.normal[2])>1-1e-8),'independent STEP sampling finds planar positions/normals on both sides of the shared edge')
  // watchAnnotations deliberately marks new managed notes unresolved while its
  // async CAD verification runs. Read the current store after verification,
  // rather than asserting against the earlier Apply snapshot.
  report.appliedNotesInitial=applied.notes;report.applyReceipt=applied.receipt;persist()
  if(annotated){
    await page.waitForFunction(copy=>window.g1PlaneQa.useNotes.getState().notes.some(n=>
      n.text==='Nota G1 con Zebra'&&n.attachment?.status==='verified'&&n.on[0]?.body===copy),
      {timeout:120000},applied.receipt.createdBodyIds[0])
    applied.notes=await page.evaluate(()=>window.g1PlaneQa.useNotes.getState().notes)
    report.appliedNotesVerified=applied.notes
    check(applied.notes.some(n=>n.text==='Nota G1 con Zebra'&&n.attachment?.status==='verified'&&n.on[0]?.body===applied.receipt.createdBodyIds[0]),'annotated host binds the verified note to the copy')
  }
  writeFileSync(join(out,'g1-copy.step'),applied.copy)
  await page.waitForSelector('[data-test=save-project]:enabled',{timeout:30000});await page.click('[data-test=save-project]')
  let saved
  for(let i=0;i<400;i++){
    const name=readdirSync(downloads).find(n=>n.endsWith('.scanruler'));if(name){saved=join(downloads,name);break}
    await new Promise(r=>setTimeout(r,100))
  }
  assert(saved,'Sheet-capable host must save its project')
  page=await browser.newPage();page.on('dialog',d=>void d.accept());page.on('pageerror',e=>report.consoleErrors.push('reopen: '+e.message))
  await page.goto(url.href,{waitUntil:'domcontentloaded'});await page.waitForSelector('[data-test=project-input]')
  await(await page.$('[data-test=project-input]')).uploadFile(saved);await page.click('[data-test=workspace-reverse]')
  await page.evaluate(async()=>{
    const {useReverse}=await import('/plugins/reverse/state/reStore.ts'),{useNotes}=await import('/plugins/reverse/state/noteStore.ts')
    const {reverseSession}=await import('/plugins/reverse/app/reSession.ts')
    window.g1PlaneReopen={useReverse,useNotes,reverseSession}
  })
  await page.waitForFunction(()=>window.g1PlaneReopen.useReverse.getState().bodies.length===2&&!window.g1PlaneReopen.useReverse.getState().building,{timeout:120000})
  if(annotated)await page.waitForFunction(expected=>window.g1PlaneReopen.useNotes.getState().notes.some(n=>
    n.text===expected.text&&n.attachment?.noteUuid===expected.uuid&&n.attachment?.status==='verified'&&n.on[0]?.body===expected.body),
    {timeout:120000},{text:'Nota G1 con Zebra',uuid:applied.notes.find(n=>n.text==='Nota G1 con Zebra').attachment.noteUuid,body:applied.receipt.createdBodyIds[0]})
  const reopened=await page.evaluate(async ids=>{
    const q=window.g1PlaneReopen
    return {source:(await q.reverseSession().client().bodyEditSource(ids.source)).text,copy:(await q.reverseSession().client().bodyEditSource(ids.copy)).text,notes:q.useNotes.getState().notes}
  },{source:applied.bodies.find(b=>b.id!==applied.receipt.createdBodyIds[0]).id,copy:applied.receipt.createdBodyIds[0]})
  assert.deepEqual(inspect(reopened.source),inspect(applied.source));assert.deepEqual(inspect(reopened.copy),report.copy)
  if(annotated){const note=applied.notes.find(n=>n.text==='Nota G1 con Zebra');check(reopened.notes.some(n=>n.text===note.text&&n.attachment?.noteUuid===note.attachment.noteUuid&&n.attachment?.status==='verified'),'reopening preserves verified note identity')}
  check(true,'saved/reopened project preserves source and copied shell geometry')
  check(report.consoleErrors.length===0,'no browser application errors')
  report.verdict='PASS'
}catch(error){report.verdict='FAIL';report.error=String(error?.stack??error);process.exitCode=1;if(page)try{await page.screenshot({path:join(out,'failure.png')})}catch{}}
finally{if(browser)await browser.close();owned.forEach(h=>k.release(h));k[Symbol.dispose]();persist();console.log(JSON.stringify({out,...report},null,2))}


