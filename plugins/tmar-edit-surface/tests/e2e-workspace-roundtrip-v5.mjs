// SPDX-License-Identifier: AGPL-3.0-only
// The exact Versione 5 workspace Apply -> Save Project -> Reopen flow.
// Synthetic solid only, in a newly owned headless profile.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs'
import { join, resolve, isAbsolute, sep } from 'node:path'
import { OcctKernel } from 'occt-wasm'
import { launchApp } from '../../../scripts/e2e-lib.mjs'

assert.equal(process.env.SCANRULER_ISOLATED,'1')
const url=process.env.APP_URL
assert.equal(url,'http://127.0.0.1:17729/')
const base=resolve(process.env.TMAR_V5_PALETTE_QA_OUT||'')
assert(isAbsolute(base)&&!base.toLowerCase().startsWith(resolve(process.cwd()).toLowerCase()+sep))
mkdirSync(base,{recursive:true})
const output=mkdtempSync(join(base,'v5-roundtrip-')),downloads=join(output,'downloads')
mkdirSync(downloads)
const report={schema:'TMAR_V5_WORKSPACE_APPLY_SAVE_REOPEN_V1',scope:'synthetic six-face solid, V5 host and integrated UX plugin',
  verdict:'INCOMPLETE',checks:[],errors:[],output,startedAtUtc:new Date().toISOString()}
const save=()=>writeFileSync(join(output,'receipt.json'),JSON.stringify(report,null,2)+'\n')
const check=(value,name)=>{assert(value,name);report.checks.push(name);console.log('PASS',name);save()}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const kernel=await OcctKernel.init()
let box,browser,page,reopened,consoleErrors=[]
try{
  box=kernel.makeBox(20,30,10)
  const step=kernel.exportStep(box)
  check(kernel.isValid(box),'synthetic source box is a valid OCCT solid')
  const app=await launchApp({url,width:1440,height:1000,language:'',agentDataOk:false,
    userDataDir:join(output,'profile'),protocolTimeout:120000})
  browser=app.browser;page=app.page;consoleErrors=app.consoleErrors
  const cdp=await page.createCDPSession()
  await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,eventsEnabled:true})
  page.on('dialog',d=>void d.accept())
  await page.click('[data-test=workspace-reverse]')
  await page.waitForFunction(()=>window.__re?.store.getState().kernelStatus==='ready',{timeout:60000})
  await page.evaluate(async text=>{
    const {runCommand}=await import('/src/commands/registry.ts')
    await runCommand('reverse.import.step',{bytes:new TextEncoder().encode(text),name:'synthetic-v5-roundtrip.step'})
  },step)
  await page.waitForFunction(()=>window.__re?.store.getState().bodies.length===1&&!window.__re?.store.getState().building,{timeout:60000})
  await page.evaluate(async()=>{
    const {useWorkspaceEditor}=await import('/src/plugins/workspaceEditors.ts')
    const {useReverse}=await import('/plugins/reverse/state/reStore.ts')
    const {runCommand}=await import('/src/commands/registry.ts')
    const {useHistory}=await import('/src/state/historyStore.ts')
    window.roundtripQA={useWorkspaceEditor,useReverse,runCommand,useHistory,
      originalId:useReverse.getState().bodies[0].id,historyStart:useHistory.getState().past.length}
  })
  await page.click('[data-test=feature-edit-surface]')
  await page.waitForSelector('[data-test=workspace-surface-parameters]',{timeout:30000})
  await page.waitForFunction(()=>document.querySelectorAll('[data-test=surface-face] option').length>1,{timeout:60000})
  const options=await page.$$eval('[data-test=surface-face] option',els=>els.map(x=>({value:x.value,disabled:x.disabled})))
  const picked=options.find(x=>x.value==='5'&&!x.disabled)??options.find(x=>x.value!==''&&!x.disabled)
  assert(picked,'editable synthetic CAD face')
  await page.select('[data-test=surface-face]',picked.value)
  await page.waitForFunction(()=>{
    const editor=window.roundtripQA.useWorkspaceEditor.getState()
    return editor.snapshot?.validation.kind==='valid' && !editor.controller?.getPanelState().calculating &&
      editor.controller?.getViewState().net!==null
  },{timeout:120000})
  check(true,'real V5 editor accepts the synthetic CAD face')
  const before=await page.evaluate(()=>{
    const q=window.roundtripQA,c=q.useWorkspaceEditor.getState().controller,p=c.getPanelState()
    c.setDragMode('axis');c.setAxis(2);c.setSnap(false);c.selectAllFree()
    return {net:p.net.poles.map(v=>[...v]),count:p.net.poles.length}
  })
  await page.evaluate(async()=>{
    await window.roundtripQA.useWorkspaceEditor.getState().controller.moveSelected(.4)
  })
  await page.waitForFunction(()=>{
    const s=window.roundtripQA.useWorkspaceEditor.getState()
    return s.snapshot?.validation.kind==='valid'&&!s.controller?.getPanelState().calculating&&!!s.snapshot?.dirty
  },{timeout:120000})
  const afterNet=await page.evaluate(()=>window.roundtripQA.useWorkspaceEditor.getState().controller.getPanelState().net.poles)
  check(afterNet.length===before.count && afterNet.some((p,i)=>Math.abs(p[2]-before.net[i][2])>1e-5),
    'precise numeric Z movement changes an editable control point')
  await page.waitForSelector('[data-test=workspace-editor-apply]:enabled',{timeout:120000})
  await page.click('[data-test=workspace-editor-apply]')
  await page.waitForFunction(()=>window.roundtripQA.useWorkspaceEditor.getState().phase==='closed',{timeout:120000})
  const applied=await page.evaluate(async()=>{
    const q=window.roundtripQA,bodies=q.useReverse.getState().bodies
    const copy=bodies.find(b=>b.id!==q.originalId)
    if(!copy)throw Error('CAD copy missing')
    const steps=[]
    for(const body of bodies){
      const result=await q.runCommand('reverse.body.edit_source',{body:body.id})
      steps.push({id:body.id,text:new TextDecoder().decode(result.file.bytes)})
    }
    return {bodies:bodies.map(b=>({id:b.id,visible:b.visible})),originalId:q.originalId,copyId:copy.id,
      historyDelta:q.useHistory.getState().past.length-q.historyStart,steps}
  })
  check(applied.bodies.length===2 && applied.historyDelta===1,'Apply creates a separate CAD body and exactly one history entry')
  const geometries=[]
  for(const body of applied.steps){
    const shape=kernel.importStep(body.text),solids=kernel.getSubShapes(shape,'solid'),faces=kernel.getSubShapes(shape,'face')
    geometries.push({id:body.id,valid:kernel.isValid(shape),solidCount:solids.length,faceCount:faces.length,volume:kernel.getVolume(shape)})
    solids.forEach(s=>kernel.release(s));faces.forEach(f=>kernel.release(f));kernel.release(shape)
  }
  const source=geometries.find(g=>g.id===applied.originalId),copy=geometries.find(g=>g.id===applied.copyId)
  check(geometries.every(x=>x.valid&&x.solidCount===1)&&source.faceCount===copy.faceCount,
    'both exported STEP bodies re-import as valid native solids with unchanged face count')
  check(Math.abs(copy.volume-source.volume)>1e-7,'edited copy differs geometrically from original')
  await page.waitForSelector('[data-test=save-project]:enabled',{timeout:120000})
  await page.click('[data-test=save-project]')
  let saved
  for(let i=0;i<500&&!saved;i++){
    const filename=readdirSync(downloads).find(name=>name.endsWith('.scanruler'))
    if(filename)saved=join(downloads,filename)
    else await new Promise(resolve=>setTimeout(resolve,100))
  }
  if(!saved||statSync(saved).size===0)throw Error('Project download missing')
  report.savedProjectSha256=hash(readFileSync(saved))
  check(true,'V5 Save Project writes a nonempty .scanruler archive')
  reopened=await browser.newPage()
  reopened.on('dialog',d=>void d.accept())
  reopened.on('pageerror',e=>consoleErrors.push('reopen: '+e.message))
  await reopened.goto(url,{waitUntil:'domcontentloaded'})
  await reopened.waitForSelector('[data-test=project-input]',{timeout:30000})
  await (await reopened.$('[data-test=project-input]')).uploadFile(saved)
  await reopened.click('[data-test=workspace-reverse]')
  await reopened.waitForFunction(({original,copy})=>{
    const state=window.__re?.store.getState()
    return state && !state.building && state.bodies.length===2 &&
      state.bodies.some(b=>b.id===original)&&state.bodies.some(b=>b.id===copy)
  },{timeout:120000},{original:applied.originalId,copy:applied.copyId})
  const reStep=await reopened.evaluate(async id=>{
    const {reverseSession}=await import('/plugins/reverse/app/reSession.ts')
    return (await reverseSession().client().bodyEditSource(id)).text
  },applied.copyId)
  const restoredShape=kernel.importStep(reStep),restoredSolids=kernel.getSubShapes(restoredShape,'solid')
  check(kernel.isValid(restoredShape)&&restoredSolids.length===1&&
    Math.abs(kernel.getVolume(restoredShape)-copy.volume)<1e-6,
    'reopened project retains the valid edited CAD copy and its volume')
  restoredSolids.forEach(s=>kernel.release(s));kernel.release(restoredShape)
  check(consoleErrors.length===0,'no JavaScript browser errors')
  report.geometry=geometries
  report.verdict='PASS'
}catch(e){
  report.verdict='FAIL';report.errors.push(String(e?.stack??e));process.exitCode=1
  if(page)try{await page.screenshot({path:join(output,'failure.png')})}catch{}
}finally{
  report.completedAtUtc=new Date().toISOString();report.consoleErrors=consoleErrors;save()
  if(reopened)try{await reopened.close()}catch{}
  if(browser)try{await browser.close()}catch{}
  if(box)kernel.release(box)
  kernel[Symbol.dispose]()
  console.log(JSON.stringify({verdict:report.verdict,checks:report.checks.length,errors:report.errors,output},null,2))
}
