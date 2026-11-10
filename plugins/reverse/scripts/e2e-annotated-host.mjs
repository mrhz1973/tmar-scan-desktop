// SPDX-License-Identifier: AGPL-3.0-only
// Real source host + explicit QA controller, actual native project save/reopen.
// The author plugin is paired but its annotated adapter is deliberately NOT faked.
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
import { unzipSync, strFromU8 } from 'fflate'
import { OcctKernel } from 'occt-wasm'
import { launchApp } from '../../../scripts/e2e-lib.mjs'
assert.equal(process.env.SCANRULER_ISOLATED, '1')
const url = new URL(process.env.APP_URL ?? '')
assert.equal(url.href, 'http://127.0.0.1:17723/')
const out = process.env.OUT_DIR
assert(out && isAbsolute(out))
mkdirSync(out, {recursive:true})
const downloads = join(out,'downloads'); mkdirSync(downloads)
const report = {scope:'Real host annotated-copy contract, synthetic OCCT fixture controller, native project roundtrip; not the author annotated adapter',checks:[],consoleErrors:[],verdict:'INCOMPLETE'}
const check = (ok,label) => { assert(ok,label); report.checks.push(label); console.log('PASS',label) }
const k = await OcctKernel.init(), a = k.makeBox(20,30,10), b = k.makeBox(20,30,12), faces=k.getSubShapes(b,'face')
let input, prepared
try {
  const top=faces.find(f=>Math.abs(k.getBoundingBox(f).zmin-12)<1e-7)
  assert(top)
  const uv=k.uvFromPoint(top,{x:10,y:15,z:12}), p=k.pointOnSurface(top,uv.u,uv.v), n=k.surfaceNormal(top,uv.u,uv.v)
  input=k.exportStep(a)
  prepared={step:k.exportStep(b),brep:k.toBREP(top),uv:[uv.u,uv.v],at:[p.x,p.y,p.z],normal:[n.x,n.y,n.z]}
} finally {[a,b,...faces].forEach(h=>k.release(h))}
const noteText='Nota persistente — faccia superiore, quota 12 mm. àèìòù'
let browser,page
const waitFile=async suffix=>{
  for(let i=0;i<400;i++){const name=readdirSync(downloads).find(n=>n.endsWith(suffix));if(name)return join(downloads,name);await new Promise(r=>setTimeout(r,100))}
  throw Error('Download missing '+suffix)
}
try {
  const app=await launchApp({url:url.href,width:1440,height:1000,agentDataOk:false,userDataDir:join(out,'owned-browser-profile'),protocolTimeout:120000})
  browser=app.browser;page=app.page;report.consoleErrors=app.consoleErrors
  page.on('dialog',d=>d.accept())
  const cdp=await page.createCDPSession();await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,eventsEnabled:true})
  await page.evaluate(async ({input,prepared})=>{
    const {registerCoreCommands}=await import('/src/commands/core.ts');registerCoreCommands()
    const {runCommand}=await import('/src/commands/registry.ts')
    const {useShell}=await import('/src/state/shellStore.ts')
    const {useReverse}=await import('/plugins/reverse/state/reStore.ts')
    const {useNotes}=await import('/plugins/reverse/state/noteStore.ts')
    const {reverseSession}=await import('/plugins/reverse/app/reSession.ts')
    const {workspaceEditors,useWorkspaceEditor}=await import('/src/plugins/workspaceEditors.ts')
    const {useHistory}=await import('/src/state/historyStore.ts')
    const {takeAtomicNotificationErrors}=await import('/src/state/atomicNotifications.ts')
    const {noteOut}=await import('/plugins/reverse/app/reNoteCommands.ts')
    const {installAnnotatedEditorProbe}=await import('/tests/fixtures/annotatedEditorProbe.tsx')
    useShell.getState().setWorkspace('reverse')
    for(let i=0;!reverseSession()&&i<500;i++)await new Promise(r=>setTimeout(r,20))
    await reverseSession().startKernel();await reverseSession().settled()
    await runCommand('reverse.import.step',{bytes:new TextEncoder().encode(input),name:'source-box.step'})
    await reverseSession().settled()
    const sourceId=useReverse.getState().bodies[0].id
    const otherId=useNotes.getState().addAgentNote({text:'Nota preesistente da conservare',at:[0,0,0],on:[{kind:'scan'}]})
    installAnnotatedEditorProbe(prepared)
    window.notesQa={runCommand,useReverse,useNotes,reverseSession,workspaceEditors,useWorkspaceEditor,useHistory,takeAtomicNotificationErrors,noteOut,sourceId,otherId,history:useHistory.getState().past.length}
    await workspaceEditors.open('qa-annotated-copy',{bodyId:sourceId})
  },{input,prepared})
  await page.waitForSelector('[data-test=annotation-probe-text]')
  await page.type('[data-test=annotation-probe-text]',noteText)
  check(await page.evaluate(()=>window.notesQa.useNotes.getState().notes.length===1),'typing a draft does not publish a note or body')
  await page.screenshot({path:join(out,'draft.png')})
  await page.waitForSelector('[data-test=workspace-editor-apply]:enabled')
  await page.click('[data-test=workspace-editor-apply]')
  await page.waitForFunction(()=>window.notesQa.useWorkspaceEditor.getState().phase==='closed',{timeout:90000})
  await page.waitForFunction(()=>window.notesQa.useNotes.getState().notes.some(n=>n.attachment?.status==='verified'),{timeout:60000})
  const state=await page.evaluate(()=>{
    const q=window.notesQa,s=q.useReverse.getState(),n=q.useNotes.getState().notes.find(n=>n.attachment)
    return {bodies:s.bodies.map(b=>({id:b.id,visible:b.visible,volume:b.volume})),note:n,out:q.noteOut(n),receipt:q.useWorkspaceEditor.getState().receipt,history:q.useHistory.getState().past.length-q.history,atomicErrors:q.takeAtomicNotificationErrors().map(String)}
  })
  report.applied=state
  check(state.receipt?.mode==='annotated-cad-copy'&&state.bodies.length===2&&state.history===1,'host publishes one CAD copy plus notes as a single history action')
  check(state.note.text===noteText&&state.note.attachment.status==='verified'&&state.out.on[0].face?.bodyId===state.receipt.createdBodyIds[0],'published text and verified destination face binding are retained')
  check(state.bodies[0].visible===false&&state.bodies[1].visible===true,'annotated Apply also preserves the source-hiding policy')
  check(state.atomicErrors.length===0,'no rejected observer mutations or hidden atomic notification errors')
  await page.evaluate(()=>window.notesQa.useNotes.getState().setText(window.notesQa.otherId,'Nota preesistente modificata'))
  await page.click('[data-test=undo]')
  await page.waitForFunction(()=>window.notesQa.useReverse.getState().bodies.length===1&&!window.notesQa.useReverse.getState().building,{timeout:60000})
  check(await page.evaluate(()=>window.notesQa.useNotes.getState().notes.length===1&&window.notesQa.useNotes.getState().notes[0].text==='Nota preesistente modificata'&&window.notesQa.useReverse.getState().bodies[0].visible),'Undo removes only the copy/owned note and restores original visibility')
  await page.click('[data-test=redo]')
  await page.waitForFunction(()=>window.notesQa.useReverse.getState().bodies.length===2&&window.notesQa.useNotes.getState().notes.some(n=>n.attachment?.status==='verified'),{timeout:60000})
  check(await page.evaluate(expected=>window.notesQa.useNotes.getState().notes.some(n=>n.text===expected)&&window.notesQa.useNotes.getState().notes.some(n=>n.text==='Nota preesistente modificata'),noteText),'Redo restores the owned note without overwriting unrelated text')
  await page.waitForSelector('[data-test=save-project]:enabled');await page.click('[data-test=save-project]')
  const saved=await waitFile('.scanruler');report.project={name:saved.split(/[\\/]/).at(-1),sha256:createHash('sha256').update(readFileSync(saved)).digest('hex')}
  const archive=unzipSync(readFileSync(saved)),manifest=JSON.parse(strFromU8(archive['project.json']))
  report.savedNote=manifest.reverseNotes.notes.find(n=>n.attachment)
  check(report.savedNote.text===noteText&&report.savedNote.attachment.noteUuid===state.note.attachment.noteUuid,'native archive contains the same note UUID, text and face attachment')
  page=await browser.newPage();page.on('dialog',d=>d.accept());page.on('pageerror',e=>report.consoleErrors.push('reopen: '+e.message))
  await page.goto(url.href,{waitUntil:'domcontentloaded'});await page.waitForSelector('[data-test=project-input]')
  await (await page.$('[data-test=project-input]')).uploadFile(saved)
  await page.click('[data-test=workspace-reverse]')
  await page.evaluate(async()=>{
    const {useNotes}=await import('/plugins/reverse/state/noteStore.ts')
    const {useReverse}=await import('/plugins/reverse/state/reStore.ts')
    const {reverseSession}=await import('/plugins/reverse/app/reSession.ts')
    const {noteOut}=await import('/plugins/reverse/app/reNoteCommands.ts')
    const {takeAtomicNotificationErrors}=await import('/src/state/atomicNotifications.ts')
    window.reopenedNotes={useNotes,useReverse,reverseSession,noteOut,takeAtomicNotificationErrors}
  })
  await page.waitForFunction(()=>window.reopenedNotes.useNotes.getState().notes.some(n=>n.attachment?.status==='verified')&&window.reopenedNotes.useReverse.getState().bodies.length===2,{timeout:90000})
  const restored=await page.evaluate(async()=>{
    const q=window.reopenedNotes,n=q.useNotes.getState().notes.find(n=>n.attachment),id=n.on[0].body
    return {note:n,out:q.noteOut(n),bodies:q.useReverse.getState().bodies.map(b=>({id:b.id,visible:b.visible,volume:b.volume})),step:(await q.reverseSession().client().bodyEditSource(id)).text,atomicErrors:q.takeAtomicNotificationErrors().map(String)}
  })
  writeFileSync(join(out,'reopened-copy.step'),restored.step)
  const shape=k.importStep(restored.step)
  try{report.geometry={valid:k.isValid(shape),volume:k.getVolume(shape)};check(report.geometry.valid&&Math.abs(report.geometry.volume-7200)<1e-6,'reopened annotated body independently reimports as valid CAD')}
  finally{k.release(shape)}
  delete restored.step;report.reopened=restored
  check(restored.note.text===noteText&&restored.note.attachment.noteUuid===state.note.attachment.noteUuid&&restored.note.attachment.featureUuid===state.note.attachment.featureUuid&&restored.note.attachment.status==='verified'&&!restored.out.on[0].face?.gone,'fresh page revalidates the same persistent note against destination CAD')
  check(restored.bodies[0].visible===false&&restored.bodies[1].visible===true,'fresh page retains source visibility and copy')
  check(restored.atomicErrors.length===0,'reopening produces no atomic observer errors')
  await page.screenshot({path:join(out,'reopened.png')})
  check(report.consoleErrors.length===0,'zero browser application errors')
  report.verdict='PASS'
} catch(error){report.error=String(error?.stack??error);process.exitCode=1;if(page)await page.screenshot({path:join(out,'failure.png')}).catch(()=>{});console.error(report.error)}
finally{if(browser)await browser.close();k[Symbol.dispose]();writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,...report}))}
