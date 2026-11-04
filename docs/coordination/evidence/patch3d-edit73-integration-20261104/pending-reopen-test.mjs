// SPDX-License-Identifier: AGPL-3.0-only
// QA only: recovery of the exact project saved during asynchronous validation.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {unzipSync,strFromU8} from 'fflate'
import {OcctKernel} from 'occt-wasm'
import {launchApp,sleep} from '../../../scripts/e2e-lib.mjs'
assert.equal(process.env.APP_URL,'http://127.0.0.1:17726/');assert.equal(process.env.SCANRULER_ISOLATED,'1')
const root=process.env.PAIR_EVIDENCE,out=process.env.OUT_DIR,report={checks:[],consoleErrors:[],sourceRequests:[],verdict:'INCOMPLETE'}
const main=JSON.parse(readFileSync(join(root,'annotated-compiled-verified/result.json'),'utf8'))
const input=join(root,'annotated-compiled-verified',main.files['applied-validation-0'].name)
const sha=b=>createHash('sha256').update(b).digest('hex'),native=file=>{const z=unzipSync(readFileSync(file)),m=JSON.parse(strFromU8(z['project.json']));return {m,steps:JSON.parse(strFromU8(z[m.reverse.stepFiles]))}}
const before=native(input),note=before.m.reverseNotes.notes[0];assert.equal(note.attachment.status,'unresolved');report.inputSha256=sha(readFileSync(input))
const check=(ok,name)=>{assert(ok,name);report.checks.push(name)}
let browser,page;const k=await OcctKernel.init()
try{
 const app=await launchApp({url:process.env.APP_URL,width:1440,height:1000,agentDataOk:false,userDataDir:join(out,'owned-profile')})
 browser=app.browser;page=app.page;report.consoleErrors=app.consoleErrors
 page.on('dialog',d=>d.accept());page.on('request',r=>{if(/^\/(src|plugins)\//.test(new URL(r.url()).pathname))report.sourceRequests.push(r.url())})
 await page.waitForSelector('[data-test=project-input]');await(await page.$('[data-test=project-input]')).uploadFile(input);await page.click('[data-test=workspace-reverse]')
 let result=null;report.savedObservations=[]
 for(let i=0;i<5;i++){
  await page.waitForFunction(text=>document.querySelectorAll('[data-test=body-row]').length===2&&[...document.querySelectorAll('[data-test=note-row]')].some(r=>r.textContent.includes(text)&&!r.querySelector('[data-test=note-anchor-unresolved]')),{timeout:90000},note.text)
  const dir=join(out,'downloads','attempt-'+i);mkdirSync(dir,{recursive:true});await(await page.createCDPSession()).send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:dir,eventsEnabled:true})
  await page.waitForSelector('[data-test=save-project]:enabled');await page.click('[data-test=save-project]')
  let saved
  for(let j=0;j<400;j++){const name=readdirSync(dir).find(n=>n.endsWith('.scanruler'));if(name){saved=join(dir,name);break}await sleep(100)}assert(saved)
  const next=native(saved),n=next.m.reverseNotes.notes[0]
  assert.equal(n.attachment.noteUuid,note.attachment.noteUuid);assert.equal(n.attachment.featureUuid,note.attachment.featureUuid);assert.equal(n.on[0].body,note.on[0].body);assert.equal(n.text,note.text)
  report.savedObservations.push({status:n.attachment.status,sha256:sha(readFileSync(saved))})
  if(n.attachment.status==='verified'){result=next;break}await sleep(250)
 }
 check(!!result,'a project saved as unresolved automatically revalidates in a fresh compiled page')
 const n=result.m.reverseNotes.notes[0];check(n.attachment.noteUuid===note.attachment.noteUuid&&n.attachment.featureUuid===note.attachment.featureUuid&&n.on[0].body===note.on[0].body,'exact note/feature/body identity survives pending-state persistence')
 check(n.at.every((v,i)=>Math.abs(v-note.at[i])<1e-8)&&n.normal.every((v,i)=>Math.abs(v-note.normal[i])<1e-8),'position and oriented normal remain unchanged')
 const f=result.m.reverse.features.find(f=>f.annotationSource?.featureUuid===n.attachment.featureUuid),shape=k.importStep(result.steps[f.file.key]),solids=k.getSubShapes(shape,'solid')
 try{check(k.isValid(shape)&&solids.length===1,'recovered annotated copy is independently valid CAD')}finally{solids.forEach(x=>k.release(x));k.release(shape)}
 check(sha(readFileSync(input))===report.inputSha256,'pending-state input file is unchanged')
 check(report.sourceRequests.length===0&&report.consoleErrors.length===0,'compiled-only browser with no application errors')
 await page.screenshot({path:join(out,'pending-reopened.png')});report.verdict='PASS'
}catch(e){report.error=String(e.stack??e);process.exitCode=1}
finally{if(browser)await browser.close();k[Symbol.dispose]();writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))}
