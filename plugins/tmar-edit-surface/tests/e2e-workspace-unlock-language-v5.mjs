// SPDX-License-Identifier: AGPL-3.0-only
// Synthetic box only: V5 workspace lock explainers and global language propagation.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve, isAbsolute, sep } from 'node:path'
import { OcctKernel } from 'occt-wasm'
import { launchApp } from '../../../scripts/e2e-lib.mjs'

assert.equal(process.env.SCANRULER_ISOLATED,'1')
const url=process.env.APP_URL
assert.equal(url,'http://127.0.0.1:18944/')
const base=resolve(process.env.TMAR_V5_UX_FIX_QA_OUT||'')
assert(isAbsolute(base)&&!base.toLowerCase().startsWith(resolve(process.cwd()).toLowerCase()+sep))
mkdirSync(base,{recursive:true})
const output=mkdtempSync(join(base,'v5-lock-locale-'))
const report={schema:'TMAR_V5_G1_INNER_UNLOCK_GLOBAL_LANG_V1',scope:'Isolated synthetic 6-face closed CAD solid',verdict:'INCOMPLETE',checks:[],errors:[],output}
const save=()=>writeFileSync(join(output,'receipt.json'),JSON.stringify(report,null,2)+'\n')
const check=(ok,msg)=>{assert(ok,msg);report.checks.push(msg);console.log('PASS '+msg);save()}
const k=await OcctKernel.init()
let body,browser,page,errors=[]
try{
 body=k.makeBox(20,30,10)
 check(k.isValid(body),'synthetic source CAD solid valid')
 const step=k.exportStep(body)
 const app=await launchApp({url,width:1440,height:1000,agentDataOk:false,userDataDir:join(output,'profile'),protocolTimeout:120000})
 browser=app.browser;page=app.page;errors=app.consoleErrors
 page.on('dialog',d=>void d.accept())
 await page.click('[data-test=workspace-reverse]')
 await page.waitForFunction(()=>window.__re?.store.getState().kernelStatus==='ready',{timeout:60000})
 await page.evaluate(async text=>{const {runCommand}=await import('/src/commands/registry.ts')
  await runCommand('reverse.import.step',{bytes:new TextEncoder().encode(text),name:'synthetic-ux-g0.step'})},step)
 await page.waitForFunction(()=>window.__re?.store.getState().bodies.length===1&&!window.__re?.store.getState().building,{timeout:60000})
 await page.click('[data-test=feature-edit-surface]')
 await page.waitForSelector('[data-test=workspace-surface-parameters]',{timeout:30000})
 await page.waitForFunction(()=>document.querySelectorAll('[data-test=surface-face] option').length>1,{timeout:60000})
 const options=await page.$$eval('[data-test=surface-face] option',items=>items.map(x=>({value:x.value,disabled:x.disabled})))
 const face=options.find(x=>x.value==='5'&&!x.disabled)??options.find(x=>x.value!==''&&!x.disabled)
 assert(face,'editable synthetic face available')
 await page.select('[data-test=surface-face]',face.value)
 await page.waitForFunction(async()=>{
   const {useWorkspaceEditor}=await import('/src/plugins/workspaceEditors.ts')
   const c=useWorkspaceEditor.getState().controller
   return c?.getPanelState().net?.poles.length===25&&!c.getPanelState().calculating
 },{timeout:60000})
 await page.evaluate(async()=>{
   const {useWorkspaceEditor}=await import('/src/plugins/workspaceEditors.ts')
   const c=useWorkspaceEditor.getState().controller
   if(c.getPanelState().continuity!=='G1')throw Error('G1 default changed')
   c.selectPoints([6],false)
 })
 await page.click('[data-test=workspace-surface-tool-select]')
 await page.waitForSelector('[data-test=surface-locked-selection-reason]',{visible:true,timeout:9000})
 check((await page.$eval('[data-test=surface-point-policy]',e=>e.textContent)).includes('1/25'),'G1 clearly shows one movable point of 25')
 check((await page.$eval('[data-test=surface-locked-selection-reason]',e=>e.textContent)).includes('G1'),'selected protected interior ring explains G1 constraint')
 check(Boolean(await page.$('[data-test=surface-unlock-selected-inner]')),'clear one-click unlock for protected interior point')
 await page.click('[data-test=surface-unlock-selected-inner]')
 await page.waitForFunction(async()=>{
   const {useWorkspaceEditor}=await import('/src/plugins/workspaceEditors.ts')
   const c=useWorkspaceEditor.getState().controller
   return c?.getPanelState().continuity==='G0'&&!c.getViewState().locked.includes(6)
 },{timeout:15000})
 check((await page.$eval('[data-test=surface-point-policy]',e=>e.textContent)).includes('9/25'),'G0 unlocks nine interior points with boundaries fixed')
 await page.waitForFunction(async()=>{
   const {sceneOf}=await import('/src/commands/host.ts')
   const cage=sceneOf().layerHost().partGroup.getObjectByName('tmar-edit-surface-cage')
   return cage?.children.filter(x=>x.userData.gizmoPole===6).length===3
 },{timeout:12000})
 const selectedAfter=await page.evaluate(async()=>{
   const {useWorkspaceEditor}=await import('/src/plugins/workspaceEditors.ts')
   const c=useWorkspaceEditor.getState().controller
   const v=c.getViewState()
   const cage=(await import('/src/commands/host.ts')).sceneOf().layerHost().partGroup.getObjectByName('tmar-edit-surface-cage')
   return {selected:v.selected,locked:v.locked.includes(6),gizmos:cage?.children.filter(x=>x.userData.gizmoPole===6).length||0}
 })
 console.log('G0_AFTER_UNLOCK '+JSON.stringify(selectedAfter))
 check(selectedAfter.selected.includes(6)&&!selectedAfter.locked&&selectedAfter.gizmos===3,'selected interior ring point now displays X/Y/Z handles')
 const before=JSON.stringify(selectedAfter.selected)
 await page.evaluate(async()=>{const {setLanguage}=await import('/src/i18n/index.ts');setLanguage('en')})
 await page.waitForFunction(()=>document.querySelector('[data-test=workspace-surface-parameters]')?.textContent.includes('Movable points'),{timeout:5000})
 check((await page.$eval('[data-test=workspace-surface-language]',e=>e.value))==='en','global Settings language propagates to Edit Surface selector')
 check((await page.$eval('[data-test=workspace-editor-dock] header',e=>e.textContent)).includes('Edit in main viewport'),'host Edit Surface header follows global English')
 check((await page.$eval('[data-test=feature-edit-surface]',e=>e.title)).includes('Edit the control points'),'Edit Surface launcher tooltip follows English')
 check((await page.$eval('[data-test=surface-point-policy]',e=>e.textContent)).includes('Edges fixed'),'protected-point explanation switches to English')
 await page.click('[data-test=workspace-surface-tool-edges]')
 check((await page.$eval('[data-test=surface-continuity]',e=>e.options[e.selectedIndex].textContent)).includes('Keep boundaries fixed'),'English technical dropdown is translated')
 await page.click('[data-test=workspace-surface-tool-move]')
 check((await page.$eval('[data-test=surface-drag-mode]',e=>e.options[e.selectedIndex].textContent)).includes('World'),'English drag direction is translated')
 const after=await page.evaluate(async()=>{
   const {useWorkspaceEditor}=await import('/src/plugins/workspaceEditors.ts')
   return JSON.stringify(useWorkspaceEditor.getState().controller.getViewState().selected)
 })
 check(after===before,'global language switch preserves CAD pole selection')
 // Verify the user-visible language selector also switches back without closing the editor.
 await page.select('[data-test=workspace-surface-language]','it')
 await page.waitForFunction(()=>document.querySelector('[data-test=workspace-surface-language]')?.value==='it',{timeout:5000})
 check((await page.$eval('[data-test=workspace-surface-language]',e=>e.value))==='it','Italian returns without editor reload')
 check(errors.length===0,'no browser JavaScript errors')
 report.verdict='PASS'
}catch(e){report.verdict='FAIL';report.errors.push(String(e?.stack??e));process.exitCode=1;
 if(page)try{await page.screenshot({path:join(output,'failure.png')})}catch{}}
finally{report.completedAtUtc=new Date().toISOString();report.browserErrors=errors;save();if(browser)try{await browser.close()}catch{};if(body)k.release(body);k[Symbol.dispose]();console.log(JSON.stringify({verdict:report.verdict,checks:report.checks.length,errors:report.errors,output},null,2))}
