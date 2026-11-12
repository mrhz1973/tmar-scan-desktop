// SPDX-License-Identifier: AGPL-3.0-only
// Host Versione 5 workspace panel QA only. Synthetic CAD in a dedicated browser profile.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve, isAbsolute, sep } from 'node:path'
import { OcctKernel } from 'occt-wasm'
import { launchApp } from '../../../scripts/e2e-lib.mjs'

assert.equal(process.env.SCANRULER_ISOLATED, '1', 'Isolated browser required')
const url = process.env.APP_URL
assert.equal(url, 'http://127.0.0.1:17729/', 'Dedicated V5 test port required')
const base = resolve(process.env.TMAR_V5_PALETTE_QA_OUT || '')
assert(isAbsolute(base) && !base.toLowerCase().startsWith(resolve(process.cwd()).toLowerCase()+sep), 'External evidence directory required')
mkdirSync(base, { recursive: true })
const output = mkdtempSync(join(base, 'v5-tools-'))
const result = { schema:'TMAR_EDIT_SURFACE_V5_WORKSPACE_PALETTE_QA_V1', startedAt:new Date().toISOString(),
  host:'ScanRuler 0.11.1 TMAR Versione 5', scope:'isolated synthetic STEP, workspace host controls only',
  verdict:'INCOMPLETE', checks:[], errors:[], output }
const save = () => writeFileSync(join(output,'receipt.json'), JSON.stringify(result,null,2)+'\n')
function check(ok, name) { assert(ok,name); result.checks.push(name); console.log('PASS '+name); save() }
const kernel = await OcctKernel.init()
let box, browser, page, consoleErrors=[]
try {
  box=kernel.makeBox(20,30,10)
  const step=kernel.exportStep(box)
  check(kernel.isValid(box),'native synthetic source is valid')
  const a=await launchApp({url,width:1440,height:1000,agentDataOk:false,language:'',userDataDir:join(output,'browser-profile'),protocolTimeout:120000})
  browser=a.browser;page=a.page;consoleErrors=a.consoleErrors
  page.on('dialog', d=>void d.accept())
  await page.click('[data-test=workspace-reverse]')
  await page.waitForFunction(()=>window.__re?.store.getState().kernelStatus==='ready',{timeout:60000})
  await page.evaluate(async data=>{
    const {runCommand}=await import('/src/commands/registry.ts')
    await runCommand('reverse.import.step',{bytes:new TextEncoder().encode(data),name:'synthetic-v5-palette.step'})
  },step)
  await page.waitForFunction(()=>window.__re?.store.getState().bodies.length===1&&!window.__re?.store.getState().building,{timeout:60000})
  check((await page.$eval('[data-test=feature-edit-surface]',el=>el.disabled))===false,'V5 workspace Edit Surface is enabled')
  await page.click('[data-test=feature-edit-surface]')
  await page.waitForSelector('[data-test=workspace-surface-parameters]',{timeout:30000})
  check(Boolean(await page.$('[data-test=workspace-surface-parameters]')),'actual V5 workspace panel opened')
  const buttons=await page.$$eval('[data-test=workspace-surface-tool-grid] button',nodes=>nodes.map(el=>el.getAttribute('data-test')))
  check(buttons.length===6 && buttons.includes('workspace-surface-tool-move'),'six tool buttons shown in real workspace')
  const currentLang=await page.$eval('[data-test=workspace-surface-language]',el=>el.value)
  check(currentLang==='it','Italian initially selected')
  await page.waitForFunction(()=>document.querySelectorAll('[data-test=surface-face] option').length>1,{timeout:60000})
  const options=await page.$$eval('[data-test=surface-face] option',els=>els.map(el=>({value:el.value,disabled:el.disabled})))
  const chosen=options.find(x=>x.value==='5'&&!x.disabled) ?? options.find(x=>x.value!==''&&!x.disabled)
  assert(chosen,'CAD face available in V5')
  await page.select('[data-test=surface-face]',chosen.value)
  await page.waitForFunction(()=>!!document.querySelector('[data-test=surface-continuity]'),{timeout:60000})
  check(true,'V5 workspace CAD face selection completed')
  for(const tool of ['select','move','modify','edges','analysis','history']){
    await page.click('[data-test=workspace-surface-tool-'+tool+']')
    const displayed=await page.evaluate(()=>{
      const root=document.querySelector('[data-test=workspace-surface-parameters]')
      return [...root.querySelectorAll('[data-tool-group]')].filter(el=>getComputedStyle(el).display!=='none').map(el=>el.dataset.toolGroup)
    })
    check(displayed.length>0 && displayed.every(name=>name===tool),'only '+tool+' controls are visible')
  }
  await page.click('[data-test=workspace-surface-tool-edges]')
  check((await page.$eval('[data-test=surface-continuity]',el=>el.value))==='G1','V5 G1 protection remains selected')
  await page.click('[data-test=workspace-surface-tool-select]')
  const lockedPole=await page.evaluate(async()=>{
    const {useWorkspaceEditor}=await import('/src/plugins/workspaceEditors.ts')
    const controller=useWorkspaceEditor.getState().controller,view=controller.getViewState()
    const index=view.net.poles.findIndex((_,i)=>view.locked.includes(i))
    if(index<0)throw Error('Expected one protected G1 pole')
    controller.selectPoints([index],false)
    return index
  })
  await page.waitForSelector('[data-test=surface-locked-selection-reason]',{timeout:10000})
  check((await page.$eval('[data-test=surface-locked-selection-reason]',el=>el.textContent)).includes('G1'),
    'selected protected G1 pole '+(lockedPole+1)+' explains its lock without unlocking CAD')
  await page.evaluate(async()=>{
    const {useWorkspaceEditor}=await import('/src/plugins/workspaceEditors.ts')
    useWorkspaceEditor.getState().controller.selectAllFree()
  })
  await page.click('[data-test=workspace-surface-tool-move]')
  const before=await page.$eval('[data-test=surface-drag-mode]',el=>el.value)
  check(before==='axis','world XYZ gizmo is the default while local U/V/N stays selectable')
  await page.$eval('[data-test=surface-distance]',el=>{
    const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set
    set.call(el,'0.125');el.dispatchEvent(new Event('input',{bubbles:true}))
  })
  await page.select('[data-test=workspace-surface-language]','en')
  await page.waitForFunction(()=>document.querySelector('[data-test=workspace-surface-tool-move]')?.textContent.includes('Move'),{timeout:5000})
  check((await page.$eval('[data-test=surface-distance]',el=>el.value))==='0.125','language changes without losing the numeric draft')
  check((await page.$eval('[data-test=workspace-surface-tool-history]',el=>el.textContent)).includes('History'),'English tool labels update in place')
  await page.select('[data-test=workspace-surface-language]','it')
  check((await page.$eval('[data-test=workspace-surface-tool-history]',el=>el.textContent)).includes('Cronologia'),'Italian tool labels restore immediately')
  const actions=await page.evaluate(()=>[...document.querySelectorAll('button')].filter(el=>['Applica','Annulla'].includes(el.textContent?.trim())).map(el=>({text:el.textContent?.trim(),visible:el.getBoundingClientRect().height>0})))
  check(actions.some(x=>x.text==='Applica'&&x.visible)&&actions.some(x=>x.text==='Annulla'&&x.visible),'V5 host Apply and Cancel remain visible')
  check(consoleErrors.length===0,'no JavaScript console errors')
  result.verdict='PASS'
} catch(error) {
  result.verdict='FAIL';result.errors.push(String(error?.stack??error));process.exitCode=1
  if(page)try{await page.screenshot({path:join(output,'failure.png')})}catch{}
} finally {
  result.completedAt=new Date().toISOString();result.consoleErrors=consoleErrors;save()
  if(browser)try{await browser.close()}catch{}
  if(box)kernel.release(box)
  kernel[Symbol.dispose]()
  console.log(JSON.stringify({verdict:result.verdict,checks:result.checks.length,errors:result.errors,output},null,2))
}