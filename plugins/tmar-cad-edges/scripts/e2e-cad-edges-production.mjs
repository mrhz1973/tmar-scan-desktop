// SPDX-License-Identifier: AGPL-3.0-only
// Compiled UI only. Run the synthetic dev scenario first to create the fixture.
import { readFileSync,mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { preview } from 'vite'
const root=fileURLToPath(new URL('../../../',import.meta.url))
const server=process.env.APP_URL?null:await preview({root,preview:{host:'127.0.0.1',port:0,open:false}})
if(server)process.env.APP_URL=server.resolvedUrls.local[0]
const {launchApp,check,fail,finish,sleep,OUT_DIR,shotPath,pixelDiff}=await import('../../../scripts/e2e-lib.mjs')
let browser,page,consoleErrors=[]
try {
  ;({browser,page,consoleErrors}=await launchApp({width:1600,height:1050,agentDataOk:false,userDataDir:mkdtempSync(join(OUT_DIR,'edge-production-profile-'))}))
  page.on('dialog',d=>d.accept())
  check(await page.evaluate(()=>!window.__re&&!window.__reNotes),'CAD edge production test uses no development hooks')
  const bytes=Array.from(readFileSync(join(root,'e2e-out','cad-edges-fixture.scanruler')))
  const load=()=>page.evaluate(bytes=>{const d=new DataTransfer();d.items.add(new File([new Uint8Array(bytes)],'edge-production.scanruler'));window.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:d}))},bytes)
  const click=async(s)=>{await page.waitForSelector(s,{visible:true});await page.click(s);await sleep(240)}
  const shot=async()=>{await page.mouse.move(5,5);await sleep(300);return(await page.$('.viewport')).screenshot({encoding:'base64'})}
  const width=async()=>{await page.focus('[data-test=cad-edges-width]');await page.keyboard.press('End');await sleep(240)}
  await load();await page.waitForFunction(()=>document.querySelector('[data-test=cad-edges-status]')?.textContent.includes('Face boundaries'),{timeout:180000})
  await page.waitForFunction(()=>document.querySelector('[data-test=save-project]')?.disabled===false)
  if(await page.$('[data-test=support-card] .sc-x'))await click('[data-test=support-card] .sc-x')
  await click('[data-test=zebra-quick-toggle]')
  check(await page.$eval('[data-test=zebra-target]',e=>e.value==='reference'),'compiled Deviation exposes reference Zebra')
  const on=await shot();await click('[data-test=cad-edges-toggle]');const off=await shot()
  check(await pixelDiff(page,on,off)>.02,'compiled STEP reference shows real edge pixels with Zebra')
  await click('[data-test=cad-edges-toggle]');await width()
  check(await pixelDiff(page,on,await shot())>.02,'compiled reference edge width visibly changes')
  await click('[data-test=workspace-reverse]');await page.waitForFunction(()=>/ready/.test(document.querySelector('[data-test=kernel-status]')?.textContent??''),{timeout:180000})
  if(await page.$eval('[data-test=toggle-scan]',e=>e.getAttribute('aria-pressed')==='true'))await click('[data-test=toggle-scan]')
  await click('[data-test=zebra-quick-toggle]')
  const body=await shot();await click('[data-test=cad-edges-toggle]')
  check(await pixelDiff(page,body,await shot())>.02,'compiled CAD body edges remain visible over Zebra')
  await click('[data-test=cad-edges-toggle]')
  await click('[data-test=note-locate]')
  check(await page.$eval('[data-test=note-focus-ring]',e=>getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().width>=50),'compiled Go to note still highlights the actual viewport marker')
  await click('[data-test=open-settings]')
  check(await page.$eval('[data-test=toggle-agent-link]',e=>!e.checked),'compiled border and note operations do not enable agents')
  await click('[data-test=settings-close]')
  await page.reload({waitUntil:'networkidle0'});await load();await page.waitForSelector('[data-test=cad-edges-width]')
  check(await page.$eval('[data-test=cad-edges-width]',e=>Number(e.value)===6),'CAD edge thickness persists in the browser after reload')
  await page.screenshot({path:shotPath('cad-edges-production.png')})
  await page.goto(process.env.APP_URL+'?plugins=none',{waitUntil:'networkidle0'})
  check(!(await page.$('[data-test=cad-edges-toggle]')),'compiled host starts with the optional plugins disabled')
} catch(e){fail(e.stack??String(e))}
finally{if(browser)await finish(browser,consoleErrors);if(server)await new Promise(r=>{server.httpServer.close(r);server.httpServer.closeAllConnections()})}
