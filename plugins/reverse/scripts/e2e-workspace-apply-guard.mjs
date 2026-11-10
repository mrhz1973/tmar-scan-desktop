// SPDX-License-Identifier: AGPL-3.0-only
// Isolated UI reproduction: actual plugin snapshot + real host and STEP kernel.
// Never connect to an author's browser/profile or server.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { OcctKernel } from 'occt-wasm'
import { launchApp } from '../../../scripts/e2e-lib.mjs'
const url = new URL(process.env.APP_URL ?? '')
assert(process.env.SCANRULER_ISOLATED === '1' && url.hostname === '127.0.0.1' && ['17661','17662'].includes(url.port), 'Owned QA server only')
const out = resolve(process.env.OUT_DIR ?? 'e2e-out/apply-guard/run')
mkdirSync(out, {recursive:true})
const downloads=join(out,'downloads'); mkdirSync(downloads)
const k=await OcctKernel.init(), box=k.makeBox(20,30,10), input=join(out,'synthetic-box.step')
try {writeFileSync(input,k.exportStep(box))} finally {k.release(box)}
const report={label:process.env.QA_LABEL ?? 'unspecified',url:url.href,checks:[],exceptions:[],consoleErrors:[],verdict:'FAIL'}
let browser, page
const check=(ok,name)=>{assert(ok,name);report.checks.push(name);console.log('PASS',name)}
try {
  const app=await launchApp({url:url.href,width:1440,height:1000,agentDataOk:false,userDataDir:join(out,'owned-profile'),protocolTimeout:90000})
  browser=app.browser;page=app.page;report.consoleErrors=app.consoleErrors
  page.on('dialog',d=>d.accept())
  const cdp=await page.createCDPSession()
  await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,eventsEnabled:true})
  await page.click('[data-test=workspace-reverse]')
  await page.waitForSelector('[data-test=feature-import]:enabled',{timeout:90000})
  await (await page.$('[data-test=feature-import-file]')).uploadFile(input)
  await page.waitForSelector('[data-test=import-create]:enabled',{timeout:90000});await page.click('[data-test=import-create]')
  await page.waitForSelector('[data-test=feature-edit-surface]:enabled',{timeout:90000});await page.click('[data-test=feature-edit-surface]')
  await page.waitForSelector('[data-test=workspace-surface-parameters]',{timeout:90000})
  check(!await page.$('[data-test=edit-surface-dialog]'),'real author controller in existing workspace')
  const face=await page.$eval('[data-test=surface-face]',s=>[...s.options].find(o=>o.value!==''&&!o.disabled&&/plane/i.test(o.textContent))?.value)
  assert(face!==undefined,'Editable plane required');await page.select('[data-test=surface-face]',face)
  await page.waitForSelector('[data-test=workspace-editor-apply]:enabled',{timeout:90000})
  const free=await page.evaluateHandle(()=>[...document.querySelectorAll('[data-test=workspace-surface-parameters] button')].find(e=>e.textContent==='Seleziona liberi'))
  await free.asElement().click();await page.select('[data-test=surface-drag-mode]','local');await page.click('[data-test=surface-axis-2]')
  await page.$eval('[data-test=surface-distance]',e=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'0.05');e.dispatchEvent(new Event('input',{bubbles:true}))})
  await page.click('[data-test=surface-move]')
  await page.waitForSelector('[data-test=surface-undo]:enabled',{timeout:90000})
  await page.waitForSelector('[data-test=workspace-editor-apply]:enabled',{timeout:90000})
  await page.screenshot({path:join(out,'before-apply.png')})
  check(true,'validated numeric normal movement before Apply')
  // Capture caught exceptions without weakening guards or changing the transaction.
  await cdp.send('Debugger.enable')
  cdp.on('Debugger.paused',async event=>{
    try {
      const description=event.data?.description ?? ''
      if(/sorgente CAD|documento|source|Viewport lease/i.test(description)) {
        const item={description,frames:event.callFrames.map(f=>({name:f.functionName,url:f.url,line:f.location.lineNumber+1,column:f.location.columnNumber}))}
        const frame=event.callFrames.find(f=>f.functionName==='assertCurrent')
        if(frame) {
          const values=await cdp.send('Debugger.evaluateOnCallFrame',{callFrameId:frame.callFrameId,expression:`({kernelChanged:session.client()!==client,documentChanged:now.documentEpoch!==before.documentEpoch,buildChanged:now.buildVersion!==before.buildVersion,building:now.building,featuresChanged:now.features!==before.features,stepsChanged:now.stepFiles!==before.stepFiles,parametersChanged:now.parameters!==before.parameters,elementsChanged:scan.elements!==model.elements,sectionsChanged:scan.sections!==model.sections})`,returnByValue:true,silent:true})
          item.guard=values.result?.value ?? values.exceptionDetails?.text
        }
        report.exceptions.push(item)
      }
    } finally {await cdp.send('Debugger.resume').catch(()=>{})}
  })
  await cdp.send('Debugger.setPauseOnExceptions',{state:'all'})
  await page.click('[data-test=workspace-editor-apply]')
  await page.waitForFunction(()=>!document.querySelector('[data-test=workspace-editor-dock]') || /sorgente CAD|cambiata|Pacchetto CAD/.test(document.querySelector('[data-slot="workspace.editor.status"]')?.textContent??''),{timeout:45000})
  await cdp.send('Debugger.setPauseOnExceptions',{state:'none'})
  report.after=await page.evaluate(()=>({open:!!document.querySelector('[data-test=workspace-editor-dock]'),status:document.querySelector('[data-slot="workspace.editor.status"]')?.textContent??'',bodies:document.querySelectorAll('[data-test=body-row]').length}))
  await page.screenshot({path:join(out,'after-apply.png')})
  check(!report.after.open&&report.after.bodies===2,'Apply creates one copy and closes editor without stale-source error')
  await page.click('[data-test=undo]');await page.waitForFunction(()=>document.querySelectorAll('[data-test=body-row]').length===1,{timeout:60000})
  await page.waitForSelector('[data-test=redo]:enabled',{timeout:60000});await page.click('[data-test=redo]')
  await page.waitForFunction(()=>document.querySelectorAll('[data-test=body-row]').length===2,{timeout:60000})
  check(true,'project toolbar Undo/Redo removes/restores only copy')
  await page.waitForSelector('[data-test=save-project]:enabled',{timeout:60000});await page.click('[data-test=save-project]')
  let project
  for(let i=0;i<300;i++){project=readdirSync(downloads).find(f=>f.endsWith('.scanruler'));if(project)break;await new Promise(r=>setTimeout(r,100))}
  assert(project,'Project downloaded')
  page=await browser.newPage();page.on('pageerror',e=>report.consoleErrors.push(`reopen: ${e.message}`));page.on('dialog',d=>d.accept())
  await page.goto(url.href,{waitUntil:'domcontentloaded'});await page.waitForSelector('[data-test=project-input]')
  await (await page.$('[data-test=project-input]')).uploadFile(join(downloads,project))
  await page.click('[data-test=workspace-reverse]')
  await page.waitForFunction(()=>document.querySelectorAll('[data-test=body-row]').length===2,{timeout:90000})
  check(true,'saved project reopens with original and copy in a fresh page')
  await page.screenshot({path:join(out,'reopened.png')})
  await page.waitForSelector('[data-test=export-body]:enabled',{timeout:90000});await page.click('[data-test=export-body]')
  await page.waitForSelector('[data-test=export-body-save]:enabled');await page.click('[data-test=export-body-save]')
  let step
  for(let i=0;i<300;i++){step=readdirSync(downloads).find(f=>f.endsWith('.step'));if(step)break;await new Promise(r=>setTimeout(r,100))}
  assert(step,'STEP downloaded');const shape=k.importStep(readFileSync(join(downloads,step),'utf8')),solids=k.getSubShapes(shape,'solid')
  try {report.geometry={valid:k.isValid(shape),solids:solids.length,volumes:solids.map(s=>k.getVolume(s))};check(report.geometry.valid&&solids.length===2&&report.geometry.volumes.some(v=>Math.abs(v-6000)<1e-5)&&report.geometry.volumes.some(v=>Math.abs(v-6000)>1e-4),'independent OCCT validates original and deformed copy')}
  finally {solids.forEach(s=>k.release(s));k.release(shape)}
  check(report.exceptions.length===0,'no source guard exceptions during publication')
  check(report.consoleErrors.length===0,'zero application console errors')
  report.verdict='PASS'
} catch(e) {report.error=String(e?.stack??e);process.exitCode=1;console.error(report.error);if(page)await page.screenshot({path:join(out,'failure.png')}).catch(()=>{})}
finally {if(browser)await browser.close();k[Symbol.dispose]();writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))}
