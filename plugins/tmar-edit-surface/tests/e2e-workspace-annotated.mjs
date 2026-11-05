// SPDX-License-Identifier: AGPL-3.0-only
// Isolated QA only: actual Edit Surface controller and annotated-capable host.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { OcctKernel } from 'occt-wasm'

assert.equal(process.env.SCANRULER_ISOLATED,'1')
const url=new URL(process.env.APP_URL ?? '')
assert.equal(url.href,'http://127.0.0.1:17723/')
const root=process.env.EDIT_SURFACE_QA_OUT
assert(root && isAbsolute(root))
const fromCheckout=relative(resolve(process.cwd()),resolve(root))
if(!fromCheckout || (!fromCheckout.startsWith('..'+sep) && fromCheckout!=='..' && !isAbsolute(fromCheckout)))
  throw Error('EDIT_SURFACE_QA_OUT must be outside the app checkout.')
mkdirSync(root,{recursive:true})
const out=mkdtempSync(join(root,'annotated-edit-'))
const downloads=join(out,'downloads');mkdirSync(downloads)
process.env.SHOT_DIR=out
const {launchApp}=await import('../../../scripts/e2e-lib.mjs')
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
// STEP headers may change on export; compare actual CAD geometry independently.
const geometrySignature=step=>{
  const shape=k.importStep(step),faces=k.getSubShapes(shape,'face'),solids=k.getSubShapes(shape,'solid')
  const rounded=n=>Number(n.toFixed(8))
  try {
    const samples=faces.map(face=>{
      const b=k.uvBounds(face),points=[]
      for(const u of [0,.5,1])for(const v of [0,.5,1]){
        const p=k.pointOnSurface(face,b.uMin+(b.uMax-b.uMin)*u,b.vMin+(b.vMax-b.vMin)*v)
        points.push([p.x,p.y,p.z].map(rounded))
      }
      return {kind:k.surfaceType(face),area:rounded(k.getSurfaceArea(face)),points}
    }).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))
    return {valid:k.isValid(shape),solids:solids.length,volume:rounded(k.getVolume(shape)),samples}
  } finally {faces.forEach(f=>k.release(f));solids.forEach(s=>k.release(s));k.release(shape)}
}
const k=await OcctKernel.init(),box=k.makeBox(20,30,10)
let input
try{input=k.exportStep(box)}finally{k.release(box)}
const report={scope:'isolated source app; real Edit Surface and experimental patched host; synthetic STEP box',checks:[],consoleErrors:[],verdict:'INCOMPLETE',sourceSha256:sha(input)}
const check=(ok,label)=>{assert(ok,label);report.checks.push(label);console.log('PASS',label)}
let browser,page
const waitFile=async suffix=>{
  for(let i=0;i<400;i++){const name=readdirSync(downloads).find(n=>n.endsWith(suffix));if(name)return join(downloads,name);await new Promise(r=>setTimeout(r,100))}
  throw Error('Download missing '+suffix)
}
try {
  const app=await launchApp({url:url.href,width:1440,height:1000,agentDataOk:false,userDataDir:join(out,'owned-browser-profile'),protocolTimeout:120000})
  browser=app.browser;page=app.page;report.consoleErrors=app.consoleErrors
  const dialogChoices=[], dialogMessages=[]
  page.on('dialog',d=>{dialogMessages.push(d.message());void (dialogChoices.shift()===false?d.dismiss():d.accept())})
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
    const {takeAtomicNotificationErrors}=await import('/src/state/atomicNotifications.ts')
    useShell.getState().setWorkspace('reverse')
    for(let i=0;!reverseSession()&&i<500;i++)await new Promise(r=>setTimeout(r,20))
    if(!reverseSession())throw Error('CAD session unavailable')
    await reverseSession().startKernel();await reverseSession().settled()
    await runCommand('reverse.import.step',{bytes:new TextEncoder().encode(step),name:'synthetic-box.step'})
    await reverseSession().settled()
    const id=useReverse.getState().bodies[0]?.id
    if(!id)throw Error('Synthetic body unavailable')
    window.annotatedQa={useReverse,useNotes,reverseSession,useWorkspaceEditor,useHistory,takeAtomicNotificationErrors,id,
      history:useHistory.getState().past.length}
  },input)
  await page.waitForSelector('[data-test=feature-edit-surface]:enabled',{timeout:60000})
  await page.click('[data-test=feature-edit-surface]')
  await page.waitForSelector('[data-test=workspace-surface-parameters]',{timeout:120000})
  const source=await page.evaluate(()=>Array.from(window.annotatedQa.useWorkspaceEditor.getState().controller.context.step))
  const imported=k.importStep(new TextDecoder().decode(new Uint8Array(source))),faces=k.getSubShapes(imported,'face')
  let selected
  try {
    const index=faces.findIndex(face=>k.shapeOrientation(face)==='reversed')
    assert(index>=0,'STEP has a reversed face')
    const face=faces[index],b=k.uvBounds(face),u=(b.uMin+b.uMax)/2,v=(b.vMin+b.vMax)/2,p=k.pointOnSurface(face,u,v),n=k.surfaceNormal(face,u,v)
    const outward=[p.x-10,p.y-15,p.z-5],length=Math.hypot(...outward)
    assert((n.x*outward[0]+n.y*outward[1]+n.z*outward[2])/length>.999999,'reversed face normal is outward')
    selected={index,point:[p.x,p.y,p.z],normal:[n.x,n.y,n.z]}
  }finally{faces.forEach(f=>k.release(f));k.release(imported)}
  report.sourceBindingSha256=sha(new Uint8Array(source));report.face=selected
  await page.select('[data-test=surface-face]',String(selected.index))
  await page.waitForFunction(()=>{const s=window.annotatedQa.useWorkspaceEditor.getState();return s.snapshot?.validation.kind==='valid'&&!s.controller?.getPanelState().calculating},{timeout:120000})
  const supported=await page.evaluate(index=>!window.annotatedQa.useWorkspaceEditor.getState().controller.getPanelState().faces[index].reason,selected.index)
  check(supported,'a reversed STEP solid face is editable')
  if (process.env.TEST_SNAP_ENTRY === '1') {
    const selector='[data-test=surface-snap-distance]'
    const selectAll=async()=>{await page.click(selector);await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control')}
    await selectAll();await page.type(selector,'0.05');await page.keyboard.press('Enter')
    check(await page.evaluate(()=>window.annotatedQa.useWorkspaceEditor.getState().controller.getPanelState().snapDistance===0.05),'small fractional magnet distance can be typed and confirmed')
    await selectAll();await page.type(selector,'0');await page.keyboard.press('Enter')
    check(await page.$eval(selector,e=>e.value==='0.05') && await page.evaluate(()=>window.annotatedQa.useWorkspaceEditor.getState().controller.getPanelState().snapDistance===0.05),'invalid magnet distance restores the last valid value')
    await selectAll();await page.type(selector,'0.2');await page.keyboard.press('Escape')
    check(await page.$eval(selector,e=>e.value==='0.05') && await page.evaluate(()=>window.annotatedQa.useWorkspaceEditor.getState().phase!=='closed'),'Escape cancels numeric input without closing the editor')
  }
  await page.click('[data-test=surface-zebra]')
  await page.click('[data-test=surface-note-add]')
  await page.evaluate(point=>window.annotatedQa.useWorkspaceEditor.getState().controller.placeNote(point),selected.point)
  await page.waitForSelector('[data-test=surface-note-text]')
  const noteText='Nota persistente sulla faccia inversa'
  await page.type('[data-test=surface-note-text]',noteText)
  if (process.env.TEST_NOTED_FACE_SWITCH === '1') {
    const other=await page.evaluate(index=>window.annotatedQa.useWorkspaceEditor.getState().controller.getPanelState().faces.find(f=>f.index!==index&&!f.reason)?.index,selected.index)
    assert.notEqual(other,undefined,'Second editable face exists')
    dialogChoices.push(false)
    await page.select('[data-test=surface-face]',String(other))
    await page.waitForFunction(()=>window.annotatedQa.useWorkspaceEditor.getState().controller.getPanelState().notes[0]?.text==='Nota persistente sulla faccia inversa')
    check(await page.evaluate(index=>{const p=window.annotatedQa.useWorkspaceEditor.getState().controller.getPanelState();return p.face===index&&p.notes.length===1},selected.index),'declining face change preserves the note and face')
    assert.match(dialogMessages.at(-1),/note/i)
    dialogChoices.push(true)
    await page.select('[data-test=surface-face]',String(other))
    await page.waitForFunction(index=>{const s=window.annotatedQa.useWorkspaceEditor.getState();return s.controller?.getPanelState().face===index&&s.snapshot?.validation.kind==='valid'},{timeout:120000},other)
    check(await page.evaluate(()=>window.annotatedQa.useWorkspaceEditor.getState().controller.getPanelState().notes.length===0),'confirming face change clears the draft note after loading')
    await page.select('[data-test=surface-face]',String(selected.index))
    await page.waitForFunction(index=>{const s=window.annotatedQa.useWorkspaceEditor.getState();return s.controller?.getPanelState().face===index&&s.snapshot?.validation.kind==='valid'},{timeout:120000},selected.index)
    await page.click('[data-test=surface-note-add]')
    await page.evaluate(point=>window.annotatedQa.useWorkspaceEditor.getState().controller.placeNote(point),selected.point)
    await page.waitForSelector('[data-test=surface-note-text]')
    await page.type('[data-test=surface-note-text]',noteText)
  }
  if(process.env.TEST_REFINE_NOTES==='1') {
  const noteSnapshot=()=>page.evaluate(()=>{
    const c=window.annotatedQa.useWorkspaceEditor.getState().controller,p=c.getPanelState(),v=c.getViewState()
    return {note:p.notes[0],nu:p.net.nu,nv:p.net.nv,pins:v.notePins,zebra:!!v.stripes}
  })
  const waitReady=()=>page.waitForFunction(()=>{
    const s=window.annotatedQa.useWorkspaceEditor.getState(),c=s.controller,p=c?.getPanelState(),v=c?.getViewState()
    return s.snapshot?.validation.kind==='valid'&&!p?.calculating&&p.notes.length===1&&
      p.notes[0].revision===v.preview?.previewRevision&&v.notePins.length===1&&!!v.stripes
  },{timeout:120000})
  await waitReady()
  const originalNote=await noteSnapshot()
  for(const axis of ['U','V','both']) {
    check(await page.$eval(`[data-test=surface-refine-${axis}]`,e=>!e.disabled),`refinement ${axis} control is enabled`)
  }
  const assertAnchor=(state,label)=>{
    assert.equal(state.note.text,noteText,label+' text')
    assert.deepEqual(state.note.anchor,originalNote.note.anchor,label+' UV identity')
    assert.equal(state.pins.length,1,label+' visible pin')
    assert(state.zebra,label+' Zebra')
    for(let i=0;i<3;i++)assert(Math.abs(state.pins[0][i]-originalNote.pins[0][i])<1e-8,label+' pin geometry')
    check(true,label)
  }
  // Exercise every visible refinement direction, including local Undo/Redo.
  for(const axis of ['U','V','both']) {
    const beforeRefine=await noteSnapshot()
    await page.click(`[data-test=surface-refine-${axis}]`)
    await page.waitForFunction(({axis,nu,nv})=>{
      const p=window.annotatedQa.useWorkspaceEditor.getState().controller.getPanelState()
      return p.net.nu>=(nu+(axis==='V'?0:1))&&p.net.nv>=(nv+(axis==='U'?0:1))
    },{timeout:120000},{axis,nu:beforeRefine.nu,nv:beforeRefine.nv})
    await waitReady()
    const refined=await noteSnapshot()
    if(axis==='V')assert.equal(refined.nu,beforeRefine.nu,'V leaves U dimension unchanged')
    if(axis==='U')assert.equal(refined.nv,beforeRefine.nv,'U leaves V dimension unchanged')
    assertAnchor(refined,`refinement ${axis} preserves the note and its geometric anchor`)
    await page.click('[data-test=surface-undo]')
    await page.waitForFunction(({nu,nv})=>{
      const p=window.annotatedQa.useWorkspaceEditor.getState().controller.getPanelState()
      return p.net.nu===nu&&p.net.nv===nv
    },{timeout:120000},beforeRefine)
    await waitReady();assertAnchor(await noteSnapshot(),`Undo refinement ${axis} restores net and note`)
    await page.click('[data-test=surface-redo]')
    await page.waitForFunction(({nu,nv})=>{
      const p=window.annotatedQa.useWorkspaceEditor.getState().controller.getPanelState()
      return p.net.nu===nu&&p.net.nv===nv
    },{timeout:120000},refined)
    await waitReady();assertAnchor(await noteSnapshot(),`Redo refinement ${axis} restores refined net and note`)
  }
  report.refined=await noteSnapshot()
  const sourceBefore=await page.evaluate(async()=>{
    const q=window.annotatedQa
    return (await q.reverseSession().client().bodyEditSource(q.id)).text
  })
  report.sourceBefore=geometrySignature(sourceBefore)
  }
  await page.select('[data-test=surface-drag-mode]','local')
  await page.click('[data-test=surface-axis-2]')
  const selectFree=await page.evaluateHandle(()=>[...document.querySelectorAll('[data-test=workspace-surface-parameters] button')].find(e=>e.textContent==='Seleziona liberi'))
  await selectFree.asElement().click()
  const before=await page.evaluate(()=>window.annotatedQa.useWorkspaceEditor.getState().controller.getPanelState().net.poles.map(p=>[...p]))
  await page.$eval('[data-test=surface-distance]',element=>{
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,'0.05')
    element.dispatchEvent(new Event('input',{bubbles:true}))
  })
  await page.click('[data-test=surface-move]')
  await page.waitForFunction(previous=>{
    const s=window.annotatedQa.useWorkspaceEditor.getState(),c=s.controller,p=c.getPanelState(),v=c.getViewState()
    return s.snapshot?.validation.kind==='valid'&&p.notes[0]?.revision===v.preview?.previewRevision&&
      p.net.poles.some((point,i)=>point.some((value,j)=>Math.abs(value-previous[i][j])>1e-8))&&!!v.stripes
  },{timeout:120000},before)
  check(true,'real controller deforms the face and resolves the note with Zebra enabled')
  await page.waitForSelector('[data-test=workspace-editor-apply]:enabled',{timeout:120000})
  check(await page.$eval('[data-test=workspace-editor-hide-source]',input=>input.checked),'source hiding is selected for the transaction')
  await page.screenshot({path:join(out,'draft.png')})
  await page.click('[data-test=workspace-editor-apply]')
  await page.waitForFunction(()=>{const s=window.annotatedQa.useWorkspaceEditor.getState();return s.phase==='closed'||!!s.error},{timeout:120000})
  const failure=await page.evaluate(()=>window.annotatedQa.useWorkspaceEditor.getState().error)
  if(failure)throw Error('Host refused annotated Apply: '+failure)
  const receipt=await page.evaluate(()=>window.annotatedQa.useWorkspaceEditor.getState().receipt)
  assert(receipt?.notes?.length===1&&receipt.createdBodyIds?.length===1,'Expected one note and one copy in the receipt')
  const expected={uuid:receipt.notes[0].noteUuid,body:receipt.createdBodyIds[0],feature:receipt.createdFeatureUuid}
  await page.waitForFunction(({uuid,body,feature})=>window.annotatedQa.useNotes.getState().notes.some(n=>
    n.attachment?.noteUuid===uuid&&n.attachment?.featureUuid===feature&&n.attachment?.status==='verified'&&n.on[0]?.body===body),{timeout:60000},expected)
  const applied=await page.evaluate(()=>{
    const q=window.annotatedQa,s=q.useWorkspaceEditor.getState()
    return {phase:s.phase,error:s.error,receipt:s.receipt,notes:q.useNotes.getState().notes,bodies:q.useReverse.getState().bodies,
      history:q.useHistory.getState().past.length-q.history,errors:q.takeAtomicNotificationErrors().map(String)}
  })
  if(applied.error)throw Error('Host refused annotated Apply: '+applied.error)
  if(process.env.TEST_REFINE_NOTES==='1') {
  const sourceAfter=await page.evaluate(async()=>{
    const q=window.annotatedQa
    return (await q.reverseSession().client().bodyEditSource(q.id)).text
  })
  assert.deepEqual(geometrySignature(sourceAfter),report.sourceBefore)
  check(true,'Apply preserves original source CAD geometry')
  }
  report.applied=applied
  const note=applied.notes.find(n=>n.attachment),copyId=applied.receipt?.createdBodyIds?.[0]
  check(applied.phase==='closed'&&applied.receipt?.mode==='annotated-cad-copy'&&applied.bodies.length===2&&applied.history===1,'Apply creates one annotated copy in a single history action')
  check(note?.text===noteText&&note.attachment.status==='verified'&&note.on[0]?.body===copyId,'note text and verified face binding belong to the CAD copy')
  check(applied.bodies.find(b=>b.id===copyId)?.visible===true&&applied.bodies.find(b=>b.id!==copyId)?.visible===false,'original is preserved and hidden while the copy is visible')
  check(applied.errors.length===0,'no atomic publication errors')
  await page.click('[data-test=undo]')
  await page.waitForFunction(()=>{const q=window.annotatedQa;return q.useReverse.getState().bodies.length===1&&!q.useReverse.getState().building},{timeout:60000})
  check(await page.evaluate(()=>{const q=window.annotatedQa;return q.useNotes.getState().notes.length===0&&q.useReverse.getState().bodies[0].visible}),'Undo removes the copy and its note and restores the original')
  await page.click('[data-test=redo]')
  await page.waitForFunction(({uuid,body,feature})=>{const q=window.annotatedQa;return q.useReverse.getState().bodies.length===2&&q.useNotes.getState().notes.some(n=>
    n.attachment?.noteUuid===uuid&&n.attachment?.featureUuid===feature&&n.attachment?.status==='verified'&&n.on[0]?.body===body)},{timeout:60000},expected)
  check(await page.evaluate(text=>window.annotatedQa.useNotes.getState().notes.some(n=>n.text===text),noteText),'Redo restores the annotated copy')
  await page.waitForSelector('[data-test=save-project]:enabled');await page.click('[data-test=save-project]')
  const saved=await waitFile('.scanruler');report.savedSha256=sha(readFileSync(saved))
  page=await browser.newPage();page.on('dialog',d=>d.accept());page.on('pageerror',e=>report.consoleErrors.push('reopen: '+e.message))
  await page.goto(url.href,{waitUntil:'domcontentloaded'});await page.waitForSelector('[data-test=project-input]')
  await (await page.$('[data-test=project-input]')).uploadFile(saved)
  await page.click('[data-test=workspace-reverse]')
  await page.evaluate(async()=>{
    const {useNotes}=await import('/plugins/reverse/state/noteStore.ts')
    const {useReverse}=await import('/plugins/reverse/state/reStore.ts')
    const {reverseSession}=await import('/plugins/reverse/app/reSession.ts')
    window.annotatedReopen={useNotes,useReverse,reverseSession}
  })
  await page.waitForFunction(({uuid,body,feature})=>{const q=window.annotatedReopen;return q.useNotes.getState().notes.some(n=>
    n.attachment?.noteUuid===uuid&&n.attachment?.featureUuid===feature&&n.attachment?.status==='verified'&&n.on[0]?.body===body)&&q.useReverse.getState().bodies.length===2},{timeout:90000},expected)
  const reopened=await page.evaluate(async()=>{
    const q=window.annotatedReopen,n=q.useNotes.getState().notes.find(n=>n.attachment)
    return {note:n,bodies:q.useReverse.getState().bodies,step:(await q.reverseSession().client().bodyEditSource(n.on[0].body)).text}
  })
  if(process.env.TEST_REFINE_NOTES==='1') {
  const reopenedSource=await page.evaluate(async id=>
    (await window.annotatedReopen.reverseSession().client().bodyEditSource(id)).text,applied.bodies.find(b=>b.id!==copyId).id)
  assert.deepEqual(geometrySignature(reopenedSource),report.sourceBefore)
  check(true,'saved and reopened original retains source CAD geometry')
  assert.deepEqual(reopened.note.at,note.at,'reopen retains annotated-copy note position')
  assert.deepEqual(reopened.note.on,note.on,'reopen retains annotated-copy face reference')
  }
  const final=k.importStep(reopened.step),solids=k.getSubShapes(final,'solid')
  try{check(k.isValid(final)&&solids.length===1,'reopened copy reimports as a valid solid')}finally{solids.forEach(s=>k.release(s));k.release(final)}
  check(reopened.note.text===noteText&&reopened.note.attachment.noteUuid===note.attachment.noteUuid&&reopened.note.attachment.featureUuid===note.attachment.featureUuid&&reopened.note.attachment.status==='verified','reopening preserves note UUID, text and verified face binding')
  check(reopened.note.normal.reduce((sum,value,i)=>sum+value*selected.normal[i],0)>.99,'reopened note retains the outward orientation of the reversed face')
  check(reopened.bodies.find(b=>b.id===reopened.note.on[0].body)?.visible===true&&reopened.bodies.find(b=>b.id!==reopened.note.on[0].body)?.visible===false,'reopening preserves copy and original visibility')
  delete reopened.step;report.reopened=reopened
  check(report.consoleErrors.length===0,'no browser application errors')
  await page.screenshot({path:join(out,'reopened.png')})
  report.verdict='PASS'
} catch(error) {
  report.error=String(error?.stack??error);process.exitCode=1
  if(page)await page.screenshot({path:join(out,'failure.png')}).catch(()=>{})
  console.error(report.error)
} finally {
  if(browser)await browser.close()
  k[Symbol.dispose]()
  writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2))
  console.log(JSON.stringify({out,...report}))
}
