// SPDX-License-Identifier: AGPL-3.0-only
// Public UI only against the compiled bundle, with a disposable browser profile.
import { mkdtempSync,writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { preview } from 'vite'
import { unzipSync } from 'fflate'
import { noisySheet } from './fixture.mjs'
const root=fileURLToPath(new URL('../../../',import.meta.url))
const server=process.env.APP_URL?null:await preview({root,preview:{host:'127.0.0.1',port:0,open:false}})
if(server)process.env.APP_URL=server.resolvedUrls.local[0]
const {launchApp,check,fail,finish,sleep,OUT_DIR,shotPath,pixelDiff}=await import('../../../scripts/e2e-lib.mjs')
let browser,page,consoleErrors=[]
try{
 ;({browser,page,consoleErrors}=await launchApp({width:1600,height:1050,protocolTimeout:180000,agentDataOk:false,userDataDir:mkdtempSync(join(OUT_DIR,'mesh-production-profile-'))}))
 page.on('dialog',d=>d.accept())
 const click=async s=>{await page.waitForSelector(s,{visible:true});await page.click(s);await sleep(180)}
 const drop=async(bytes,name)=>page.evaluate((bytes,name)=>{const dt=new DataTransfer();dt.items.add(new File([new Uint8Array(bytes)],name));window.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}))},Array.from(bytes),name)
 const shot=async()=>{await page.mouse.move(5,5);await sleep(250);const r=await page.$eval('.viewport',e=>{const b=e.getBoundingClientRect();return{x:b.x+20,y:b.y+55,width:b.width-40,height:b.height-155}});return page.screenshot({clip:r,encoding:'base64'})}
 const intensity=async n=>{await page.$eval('[data-test=smooth-intensity]',(el,n)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,String(n));el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))},n);await sleep(150)}
 const count=()=>page.$eval('[data-test=mark-count]',e=>Number(e.textContent.replace(/[^0-9]/g,'')))
 const settled=async n=>{await page.waitForFunction(n=>document.querySelectorAll('[data-test=pending-edit]').length===n&&!document.querySelector('[data-test=smooth-scan]')?.disabled,{timeout:180000},n);await sleep(150)}
 check(await page.evaluate(()=>!window.__re&&!window.__reNotes),'compiled Mesh review uses no development hooks')
 check(await page.$eval('[data-test=tmar-build-version]',e=>!!e.dataset.revision),'compiled header identifies the TMAR build')
 const fixture=noisySheet();await drop(fixture.bytes,'review-smooth.ply')
 await page.waitForFunction(()=>document.querySelector('[data-test=save-project]')?.disabled===false,{timeout:120000})
 await click('[data-test=workspace-mesh]');await page.waitForSelector('[data-test=mesh-review-notes]')
 if(await page.$('[data-test=support-card] .sc-x'))await click('[data-test=support-card] .sc-x')
 const before=await shot();await click('[data-test=zebra-quick-toggle]')
 check(await pixelDiff(page,before,await shot())>1,'compiled Mesh Zebra changes model pixels')
 const center=await page.$eval('.viewport canvas',e=>{const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})
 await click('[data-test=quick-note]');await page.mouse.click(center.x,center.y);await page.waitForSelector('[data-test=note-text]')
 await page.type('[data-test=note-text]','Compiled mesh review');await click('[data-test=note-keep]')
 check(await page.$eval('[data-test=note-row-text]',e=>e.textContent.includes('Compiled mesh review')),'compiled Mesh note creation works with Zebra')
 await click('[data-test=note-locate]')
 check(await page.$eval('[data-test=note-focus-ring]',e=>e.getBoundingClientRect().width>=50),'compiled Mesh note focuses and highlights')
 await click('[data-test=note-return-view]');await click('[data-test=zebra-quick-toggle]')
 await click('[data-test=mesh-tool-smooth]');await click('[data-test=smooth-scope-marked]')
 await click('[data-test=mark-window]')
 const box=await page.$eval('.viewport canvas',e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})
 await page.mouse.move(box.x+box.w*.4,box.y+box.h*.35);await page.mouse.down();await page.mouse.move(box.x+box.w*.6,box.y+box.h*.6,{steps:16});await page.mouse.up();await sleep(300)
 const selected=await count();check(selected>30,'compiled Window tool selects a partial smooth region')
 if(!selected)throw new Error('No marked vertices from actual Window drag')
 await click('[data-test=mark-navigate]');await intensity(40)
 check(await page.$eval('[data-test=smooth-intensity-value]',e=>e.textContent==='40%'),'compiled Smooth exposes 0–100% intensity')
 await click('[data-test=smooth-scan]');await settled(1)
 check(await count()===selected,'compiled first Smooth retains the selected region')
 await click('[data-test=smooth-scan]');await settled(2)
 check(await count()===selected,'compiled second Smooth reuses the selection without a new drag')
 check(await page.$$eval('[data-test=pending-edit]',els=>els.every(e=>e.textContent.includes('40%'))),'compiled edit list records the applied intensity for both passes')
 await intensity(0);check(await page.$eval('[data-test=smooth-scan]',e=>e.disabled),'compiled 0% disables an empty Smooth operation');await intensity(40)
 await page.screenshot({path:shotPath('mesh-smooth-production.png')})
 await page.evaluate(()=>{window.__savedBlobs=[];const make=URL.createObjectURL.bind(URL);URL.createObjectURL=b=>{if(b instanceof Blob)b.arrayBuffer().then(a=>window.__savedBlobs.push(Array.from(new Uint8Array(a))));return make(b)}})
 await click('[data-test=save-project]');await page.waitForFunction(()=>window.__savedBlobs.some(b=>b[0]===80&&b[1]===75),{timeout:120000})
 const bytes=await page.evaluate(()=>window.__savedBlobs.find(b=>b[0]===80&&b[1]===75)),archive=unzipSync(Uint8Array.from(bytes))
 const manifest=Object.entries(archive).filter(([k])=>k.endsWith('.json')).map(([,v])=>{try{return JSON.parse(new TextDecoder().decode(v))}catch{return null}}).find(v=>v?.mesh?.smooth)
 check(manifest?.mesh.smooth.strength===.4,'compiled project stores Smooth intensity')
 check(Object.values(archive).some(v=>Buffer.from(v).equals(fixture.bytes)),'compiled smoothing keeps the exact original scan source in the project')
 writeFileSync(shotPath('mesh-production-roundtrip.scanruler'),Buffer.from(bytes))
 await page.reload({waitUntil:'networkidle0'});await drop(bytes,'mesh-production-roundtrip.scanruler');await page.waitForFunction(()=>document.querySelector('[data-test=save-project]')?.disabled===false,{timeout:120000})
 await click('[data-test=workspace-mesh]')
 if(!await page.$('[data-test=smooth-intensity]'))await click('[data-test=mesh-tool-smooth]')
 check(await page.$eval('[data-test=smooth-intensity]',e=>Number(e.value)===40),'compiled reload restores intensity')
 check((await page.$$('[data-test=pending-edit]')).length===2,'compiled reload keeps both Smooth operations')
 check(await page.$eval('[data-test=note-row-text]',e=>e.textContent.includes('Compiled mesh review')),'compiled reload retains the shared note')
 await click('[data-test=open-settings]')
 check(await page.$eval('[data-test=toggle-agent-link]',e=>!e.checked),'compiled note and smoothing operations do not enable agents')
 await click('[data-test=settings-close]')
 await page.goto(process.env.APP_URL+'?plugins=none',{waitUntil:'networkidle0'})
 check(!(await page.$('[data-test=mesh-review-notes]'))&&!(await page.$('[data-test=smooth-intensity]')),'host remains usable without optional plugins')
}catch(e){fail(e.stack??String(e))}
finally{if(browser)await finish(browser,consoleErrors);if(server)await new Promise(r=>{server.httpServer.close(r);server.httpServer.closeAllConnections()})}
