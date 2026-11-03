// SPDX-License-Identifier: AGPL-3.0-only
// Public compiled UI only: load/save the native annotated project, inspect ZIP,
// export CAD and read it independently. No source imports or injected controller.
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
import { unzipSync, strFromU8 } from 'fflate'
import { OcctKernel } from 'occt-wasm'
import { launchApp } from '../../../scripts/e2e-lib.mjs'
assert.equal(process.env.SCANRULER_ISOLATED,'1')
const url=new URL(process.env.APP_URL??'');assert.equal(url.href,'http://127.0.0.1:17724/')
const out=process.env.OUT_DIR,input=process.env.ANNOTATED_PROJECT
assert(out&&isAbsolute(out)&&input&&isAbsolute(input))
mkdirSync(out,{recursive:true});const downloads=join(out,'downloads');mkdirSync(downloads)
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const inputBytes=readFileSync(input),inputHash=hash(inputBytes)
const manifest=JSON.parse(strFromU8(unzipSync(inputBytes)['project.json']))
const expected=manifest.reverseNotes.notes.find(n=>n.attachment)
assert(expected&&expected.attachment.status==='verified')
const report={scope:'Compiled production app UI; existing annotated native project load/save/reload and independent CAD export',checks:[],consoleErrors:[],inputHash,verdict:'INCOMPLETE'}
const check=(ok,label)=>{assert(ok,label);report.checks.push(label);console.log('PASS',label)}
const k=await OcctKernel.init();let browser,page
const waitFile=async suffix=>{for(let i=0;i<400;i++){const file=readdirSync(downloads).find(f=>f.endsWith(suffix));if(file)return join(downloads,file);await new Promise(r=>setTimeout(r,100))}throw Error('Missing download '+suffix)}
try{
 const app=await launchApp({url:url.href,width:1440,height:1000,agentDataOk:false,userDataDir:join(out,'owned-browser-profile'),protocolTimeout:120000})
 browser=app.browser;page=app.page;report.consoleErrors=app.consoleErrors;page.on('dialog',d=>d.accept())
 const cdp=await page.createCDPSession();await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,eventsEnabled:true})
 await page.waitForSelector('[data-test=project-input]');await(await page.$('[data-test=project-input]')).uploadFile(input)
 await page.click('[data-test=workspace-reverse]')
 await page.waitForFunction(()=>document.querySelectorAll('[data-test=body-row]').length===2,{timeout:90000})
 await page.waitForFunction(text=>document.body.textContent.includes(text)&&!document.querySelector('[data-test=note-anchor-unresolved]'),{timeout:90000},expected.text)
 check(true,'compiled app displays persisted note text with no unresolved anchor warning after CAD validation')
 const visibility=await page.$$eval('[data-test=body-visible]',buttons=>buttons.map(b=>b.classList.contains('off')))
 check(visibility.length===2&&visibility[0]&&!visibility[1],'compiled reopen retains hidden original and visible annotated copy')
 await page.screenshot({path:join(out,'compiled-reopened.png')})
 await page.waitForSelector('[data-test=save-project]:enabled');await page.click('[data-test=save-project]')
 const saved=await waitFile('.scanruler'),savedBytes=readFileSync(saved),savedArchive=unzipSync(savedBytes)
 const output=JSON.parse(strFromU8(savedArchive['project.json'])),note=output.reverseNotes.notes.find(n=>n.attachment?.noteUuid===expected.attachment.noteUuid)
 report.resavedNote=note;report.savedHash=hash(savedBytes)
 check(!!note&&note.text===expected.text&&note.attachment.status==='verified'&&note.attachment.featureUuid===expected.attachment.featureUuid,'compiled resave keeps UUID, text and revalidated CAD attachment')
 check(JSON.stringify(note.at)===JSON.stringify(expected.at)&&JSON.stringify(note.normal)===JSON.stringify(expected.normal),'pin position and oriented normal survive compiled reopen/resave')
 // Show the preserved original only AFTER checking saved visibility; export both.
 await page.$$eval('[data-test=body-visible]',buttons=>buttons.filter(b=>b.classList.contains('off')).forEach(b=>b.click()))
 await page.waitForSelector('[data-test=export-body]:enabled',{timeout:60000});await page.click('[data-test=export-body]')
 await page.waitForSelector('[data-test=export-body-save]:enabled');await page.click('[data-test=export-body-save]')
 const exported=await waitFile('.step'),shape=k.importStep(readFileSync(exported,'utf8')),solids=k.getSubShapes(shape,'solid')
 try{report.geometry={valid:k.isValid(shape),solids:solids.length,volumes:solids.map(s=>k.getVolume(s)).sort((a,b)=>a-b)}
  check(report.geometry.valid&&solids.length===2&&Math.abs(report.geometry.volumes[0]-6000)<1e-6&&Math.abs(report.geometry.volumes[1]-7200)<1e-6,'compiled export independently verifies the original and annotated copy as two valid solids')
 }finally{solids.forEach(s=>k.release(s));k.release(shape)}
 check(hash(readFileSync(input))===inputHash,'source project file is byte-for-byte unchanged')
 check(report.consoleErrors.length===0,'zero compiled app console errors')
 report.verdict='PASS'
}catch(error){report.error=String(error?.stack??error);process.exitCode=1;console.error(report.error);if(page)await page.screenshot({path:join(out,'failure.png')}).catch(()=>{})}
finally{if(browser)await browser.close();k[Symbol.dispose]();writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))}
