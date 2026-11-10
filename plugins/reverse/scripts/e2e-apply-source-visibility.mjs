// SPDX-License-Identifier: AGPL-3.0-only
// Isolated real-plugin UI test. Diagnostic additionally reads source-app state.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, isAbsolute } from 'node:path'
import { OcctKernel } from 'occt-wasm'
assert.equal(process.env.SCANRULER_ISOLATED,'1')
const url=new URL(process.env.APP_URL??'');assert.equal(url.hostname,'127.0.0.1');assert(['17671','17672'].includes(url.port))
const out=process.env.SHOT_DIR;assert(out&&isAbsolute(out));mkdirSync(out,{recursive:true})
const diagnostic=process.env.QA_DIAGNOSTIC==='1',keepBoth=process.env.QA_KEEP_BOTH==='1'
const fixture=process.env.QA_STEP??join(process.cwd(),'plugins/tmar-edit-surface/evidence/refined-roundtrip/run-Zlk2YR/edited.step')
const input=readFileSync(fixture),hash=createHash('sha256').update(input).digest('hex'),stepPath=join(out,'existing-nurbs-input.step');writeFileSync(stepPath,input)
const k=await OcctKernel.init(),initial=k.importStep(input.toString('utf8'))
const initialFaces=k.getSubShapes(initial,'face'),initialVolume=k.getVolume(initial)
assert(k.isValid(initial)&&initialFaces.some(f=>k.surfaceType(f)==='bspline'))
initialFaces.forEach(f=>k.release(f));k.release(initial)
const report={mode:diagnostic?'cause-diagnostic':keepBoth?'keep-both':'hide-source',plugin:'b36bf5a195db8c711347ff34117fa40d3bc279c9',inputHash:hash,initialVolume,checks:[],consoleErrors:[],verdict:'INCOMPLETE'}
const check=(ok,label)=>{assert(ok,label);report.checks.push(label);console.log('PASS',label)}
const wait=ms=>new Promise(r=>setTimeout(r,ms))
const downloads=join(out,'downloads');mkdirSync(downloads)
let browser,page
const rows=()=>page.$$eval('[data-test=body-row]',els=>els.map(row=>({name:row.querySelector('[data-test=body-name]')?.textContent,hidden:row.querySelector('[data-test=body-visible]')?.classList.contains('off')})))
const download=async suffix=>{for(let i=0;i<600;i++){const file=readdirSync(downloads).find(n=>n.endsWith(suffix));if(file)return join(downloads,file);await wait(100)}throw Error('Download timed out: '+suffix)}
try{
 const {launchApp}=await import('../../../scripts/e2e-lib.mjs')
 const app=await launchApp({url:url.href,width:1440,height:1000,agentDataOk:false,userDataDir:join(out,'owned-profile'),protocolTimeout:120000})
 browser=app.browser;page=app.page;report.consoleErrors=app.consoleErrors;page.on('dialog',d=>d.accept())
 const cdp=await page.createCDPSession();await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads})
 await page.click('[data-test=workspace-reverse]');await page.waitForSelector('[data-test=feature-import]:enabled',{timeout:120000})
 await(await page.$('[data-test=feature-import-file]')).uploadFile(stepPath);await page.waitForSelector('[data-test=import-create]:enabled',{timeout:120000});await page.click('[data-test=import-create]')
 await page.waitForSelector('[data-test=feature-edit-surface]:enabled',{timeout:120000});await page.click('[data-test=feature-edit-surface]')
 await page.waitForSelector('[data-test=workspace-surface-parameters]',{timeout:120000})
 const face=await page.$eval('[data-test=surface-face]',e=>[...e.options].find(o=>o.value!==''&&!o.disabled&&/bspline/i.test(o.textContent))?.value)
 assert(face!==undefined,'Existing B-spline face selectable');await page.select('[data-test=surface-face]',face)
 await page.waitForSelector('[data-test=workspace-editor-apply]:enabled',{timeout:120000})
 check(!await page.$('[data-test=edit-surface-dialog]'),'actual published plugin edits a pre-existing B-spline in the main view')
 if(!diagnostic){check(await page.$eval('[data-test=workspace-editor-hide-source]',e=>e.checked),'hide-source is visibly enabled by default');if(keepBoth)await page.click('[data-test=workspace-editor-hide-source]')}
 const free=await page.evaluateHandle(()=>[...document.querySelectorAll('[data-test=workspace-surface-parameters] button')].find(e=>e.textContent==='Seleziona liberi'));await free.asElement().click()
 await page.select('[data-test=surface-drag-mode]','local');await page.click('[data-test=surface-axis-2]')
 await page.$eval('[data-test=surface-distance]',e=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'0.05');e.dispatchEvent(new Event('input',{bubbles:true}))})
 await page.click('[data-test=surface-move]');await page.waitForSelector('[data-test=surface-undo]:enabled',{timeout:120000});await page.waitForSelector('[data-test=workspace-editor-apply]:enabled',{timeout:120000})
 await page.screenshot({path:join(out,'before-apply.png')});await page.click('[data-test=workspace-editor-apply]')
 await page.waitForFunction(()=>!document.querySelector('[data-test=workspace-editor-dock]'),{timeout:120000})
 await page.waitForFunction(()=>document.querySelectorAll('[data-test=body-row]').length===2,{timeout:120000});await wait(600)
 report.after=await rows();check(report.after.length===2,'Apply preserves original and creates one separate copy')
 if(diagnostic){
  await page.evaluate(async()=>{const {useReverse}=await import('/plugins/reverse/state/reStore.ts');const {sceneOf}=await import('/src/commands/host.ts');const {reSceneOf}=await import('/plugins/reverse/viewer/reScene.ts');const {reverseSession}=await import('/plugins/reverse/app/reSession.ts');window.vqa={useReverse,scene:sceneOf(),view:reSceneOf(sceneOf()),session:reverseSession()}})
  await page.waitForFunction(()=>window.vqa.view.overlaps.some(o=>o.mesh.visible),{timeout:120000})
  const state=()=>page.evaluate(()=>{const q=window.vqa,s=q.useReverse.getState(),cam=q.scene.layerHost().camera();return{shown:s.overlapsShown,bodies:s.bodies.map(b=>({id:b.id,visible:b.visible,volume:b.volume})),overlays:q.view.overlaps.map(o=>({a:o.a,b:o.b,visible:o.mesh.visible,color:o.mesh.material.color.getHex(),raycast:String(o.mesh.raycast)})),pose:JSON.stringify({p:cam.position.toArray(),q:cam.quaternion.toArray()})}})
  report.hatchOn=await state();await page.screenshot({path:join(out,'overlap-on.png')})
  check(report.hatchOn.overlays.some(o=>o.visible&&o.color===0xe0564f),'red hatched object is the explicit CAD-interference overlay')
  await page.evaluate(()=>window.vqa.useReverse.getState().setOverlapsShown(false));await page.waitForFunction(()=>window.vqa.view.overlaps.every(o=>!o.mesh.visible));await wait(100)
  report.hatchOff=await state();await page.screenshot({path:join(out,'overlap-off.png')})
  check(report.hatchOff.bodies.every(b=>b.visible)&&report.hatchOff.pose===report.hatchOn.pose,'disabling only Overlaps removes red overlay without hiding bodies or changing camera')
  await page.evaluate(()=>window.vqa.useReverse.getState().setOverlapsShown(true));await page.waitForFunction(()=>window.vqa.view.overlaps.some(o=>o.mesh.visible),{timeout:120000})
  await page.$eval('[data-test=body-row] [data-test=body-visible]',e=>e.click());await page.waitForFunction(()=>window.vqa.view.overlaps.every(o=>!o.mesh.visible));await wait(100)
  report.originalHidden=await state();await page.screenshot({path:join(out,'original-hidden.png')})
  check(report.originalHidden.shown&&report.originalHidden.bodies.filter(b=>b.visible).length===1&&report.originalHidden.pose===report.hatchOn.pose,'hiding only original removes overlap while the analysis remains enabled')
  check(JSON.stringify(report.originalHidden.bodies.map(b=>b.volume))===JSON.stringify(report.hatchOn.bodies.map(b=>b.volume)),'visibility switches leave CAD body volumes unchanged')
 }else{
  check(report.after[0].hidden===!keepBoth&&!report.after[1].hidden,'chosen source visibility is applied; copy stays visible')
  await page.screenshot({path:join(out,'after-apply.png')})
  await page.click('[data-test=undo]');await page.waitForFunction(()=>document.querySelectorAll('[data-test=body-row]').length===1,{timeout:120000})
  check(!(await rows())[0].hidden,'Undo removes copy and restores previous original visibility')
  await page.waitForSelector('[data-test=redo]:enabled',{timeout:120000});await page.click('[data-test=redo]');await page.waitForFunction(()=>document.querySelectorAll('[data-test=body-row]').length===2,{timeout:120000})
  const redone=await rows();check(redone[0].hidden===!keepBoth&&!redone[1].hidden,'Redo restores copy and the chosen visibility policy')
  await page.waitForSelector('[data-test=save-project]:enabled',{timeout:120000});await page.click('[data-test=save-project]');const project=await download('.scanruler')
  page=await browser.newPage();page.on('pageerror',e=>report.consoleErrors.push('reopen: '+e.message));page.on('dialog',d=>d.accept());await page.goto(url.href,{waitUntil:'domcontentloaded'})
  await page.waitForSelector('[data-test=project-input]');await(await page.$('[data-test=project-input]')).uploadFile(project);await page.click('[data-test=workspace-reverse]')
  await page.waitForFunction(()=>document.querySelectorAll('[data-test=body-row]').length===2,{timeout:120000})
  report.reopened=await rows();check(report.reopened[0].hidden===!keepBoth&&!report.reopened[1].hidden,'save/reopen preserves both bodies and individual visibility')
  await page.screenshot({path:join(out,'reopened.png')})
  // Explicitly show original ONLY for the final all-visible geometry export.
  if(!keepBoth)await page.$eval('[data-test=body-row] [data-test=body-visible]',e=>e.click())
  await page.waitForSelector('[data-test=export-body]:enabled',{timeout:120000});await page.click('[data-test=export-body]');await page.waitForSelector('[data-test=export-body-save]:enabled');await page.click('[data-test=export-body-save]')
  const exported=await download('.step'),shape=k.importStep(readFileSync(exported,'utf8')),solids=k.getSubShapes(shape,'solid')
  try{report.geometry={valid:k.isValid(shape),solids:solids.length,volumes:solids.map(s=>k.getVolume(s))};check(report.geometry.valid&&solids.length===2&&report.geometry.volumes.some(v=>Math.abs(v-initialVolume)<1e-5)&&report.geometry.volumes.some(v=>Math.abs(v-initialVolume)>1e-4),'OCCT reimport after reopen retains original volume and a distinct valid edited solid')}
  finally{solids.forEach(s=>k.release(s));k.release(shape)}
 }
 check(createHash('sha256').update(readFileSync(fixture)).digest('hex')===hash,'input STEP remains byte-for-byte unchanged')
 check(report.consoleErrors.length===0,'zero application console errors');report.verdict='PASS'
}catch(e){report.error=String(e?.stack??e);process.exitCode=1;console.error(report.error);if(page)await page.screenshot({path:join(out,'failure.png')}).catch(()=>{})}
finally{if(browser)await browser.close();k[Symbol.dispose]();writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))}
