// SPDX-License-Identifier: AGPL-3.0-only
// Public compiled UI only: direct STEP scan import, real model-crop pixels and archive roundtrip.
import { readFileSync,writeFileSync,readdirSync,mkdtempSync } from 'node:fs'
import { join,basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { unzipSync,strFromU8 } from 'fflate'
import { preview } from 'vite'
import { cubeStep } from '../../../tests/stepFixtures.ts'
const root=fileURLToPath(new URL('../../../',import.meta.url))
const server=process.env.APP_URL?null:await preview({root,preview:{host:'127.0.0.1',port:0,open:false}})
if(server)process.env.APP_URL=server.resolvedUrls.local[0]
const {launchApp,check,fail,finish,sleep,OUT_DIR,shotPath,pixelDiff}=await import('../../../scripts/e2e-lib.mjs')
let browser,page,consoleErrors=[]
try {
  ;({browser,page,consoleErrors}=await launchApp({width:1700,height:1050,protocolTimeout:240000,agentDataOk:false,userDataDir:mkdtempSync(join(OUT_DIR,'step-prod-profile-'))}))
  page.on('dialog',d=>d.accept())
  const bytes=process.env.REAL_STEP?readFileSync(process.env.REAL_STEP):Buffer.from(cubeStep(20)),name=process.env.REAL_STEP?basename(process.env.REAL_STEP):'scan-route.step'
  const hash=b=>createHash('sha256').update(b).digest('hex'),before=hash(bytes)
  const click=async(s)=>{await page.waitForSelector(s,{visible:true});await page.click(s);await sleep(220)}
  const drop=(data,name)=>page.evaluate((bytes,name)=>{const d=new DataTransfer();d.items.add(new File([new Uint8Array(bytes)],name));window.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:d}))},Array.from(data),name)
  const shot=async(name)=>{await page.mouse.move(5,5);await sleep(350);const clip=await page.$eval('.viewport canvas',e=>{const r=e.getBoundingClientRect();return{x:r.x+25,y:r.y+65,width:r.width-50,height:r.height-165}});const img=await page.screenshot({clip,encoding:'base64'});if(name)writeFileSync(shotPath(name+'.png'),Buffer.from(img,'base64'));return img}
  const input=async(s,v)=>{await page.$eval(s,(e,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))},String(v));await sleep(200)}
  const downloads=mkdtempSync(join(OUT_DIR,'step-prod-downloads-')),cdp=await browser.target().createCDPSession()
  await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads})
  check(await page.evaluate(()=>!window.__re&&!window.__reNotes),'production test has no development state hooks')
  const badge=await page.$eval('[data-test=tmar-build-version]',e=>({revision:e.dataset.revision,dirty:e.dataset.dirty,text:e.textContent}))
  check(/^[a-f0-9]{40}$/.test(badge.revision)&&badge.text.includes('TMAR web'),'compiled header exposes TMAR source version separately')
  if(process.env.EXPECTED_SOURCE_REV)check(badge.revision===process.env.EXPECTED_SOURCE_REV&&badge.dirty==='false','badge matches the exact clean source used for this preview')
  await click('[data-test=workspace-reverse]');await drop(bytes,name)
  await page.waitForFunction(()=>document.querySelector('[data-test=cad-edges-status]')?.textContent.includes('STEP loaded as Scan'),{timeout:180000})
  if(await page.$('[data-test=support-card] .sc-x'))await click('[data-test=support-card] .sc-x')
  check((await page.$$('[data-test=body-row]')).length===0,'direct STEP file drop stays a Scan, not a silently imported CAD body')
  await click('[data-test=zebra-quick-toggle]')
  check(await page.$eval('[data-test=zebra-target]',e=>e.value==='scan'),'compiled Zebra uses Scan like the reported screenshot')
  await click('[data-test=cad-edges-reset]');const on=await shot('compiled-step-scan-edges-on');await click('[data-test=cad-edges-toggle]');const off=await shot('compiled-step-scan-edges-off')
  check(await pixelDiff(page,on,off)>.02,'compiled STEP Scan edges change the MODEL crop, not just the checkbox')
  await click('[data-test=cad-edges-toggle]');await input('[data-test=cad-edges-color]','#ff3030');const red=await shot('compiled-step-scan-red')
  check(await pixelDiff(page,on,red)>.02,'compiled edge color is visible on the loaded Scan')
  await input('[data-test=cad-edges-width]',5.5);const thick=await shot('compiled-step-scan-5_5px')
  check(await pixelDiff(page,red,thick)>.02,'compiled 5.5 px width visibly increases Scan edge thickness')
  await click('[data-test=cad-edges-reset]');await click('[data-test=zebra-add-note]')
  const p=await page.$eval('.viewport canvas',e=>{const r=e.getBoundingClientRect();return{x:r.x+r.width*.5,y:r.y+r.height*.5}})
  await page.mouse.click(p.x,p.y);await page.waitForSelector('[data-test=note-text]',{visible:true})
  await page.type('[data-test=note-text]','Compiled STEP-as-Scan note');await click('[data-test=note-keep]');await click('[data-test=note-locate]')
  check(await page.$eval('[data-test=note-focus-ring]',e=>e.getBoundingClientRect().width>=50),'compiled note placement and focus remain usable with edges and Zebra')
  await click('[data-test=note-return-view]');await click('[data-test=save-project]')
  let project
  for(let i=0;i<300;i++){const f=readdirSync(downloads).find(f=>f.endsWith('.scanruler'));if(f){project=readFileSync(join(downloads,f));break}await sleep(100)}
  if(!project)throw new Error('Project download missing')
  const archive=unzipSync(project),manifest=JSON.parse(strFromU8(archive['project.json']))
  check(hash(archive[manifest.scan.member])===before,'downloaded project keeps the exact original STEP source bytes')
  check(manifest.reverseNotes.notes.some(n=>n.text==='Compiled STEP-as-Scan note'&&n.on[0]?.kind==='scan'),'downloaded annotation remains attached to Scan')
  await drop(project,'compiled-scan-roundtrip.scanruler');await page.waitForFunction(()=>document.querySelector('[data-test=save-project]')?.disabled===false)
  check(await page.$eval('[data-test=cad-edges-status]',e=>e.textContent.includes('STEP loaded as Scan')),'compiled project reload restores STEP boundary availability')
  await click('[data-test=tmar-build-version]');await page.waitForSelector('[data-test=tmar-build-details]')
  check(await page.$eval('[aria-label="TMAR source revision"]',e=>e.value)===badge.revision,'Settings reports the identical TMAR build revision')
  check(await page.$eval('[data-test=toggle-agent-link]',e=>!e.checked),'compiled review does not enable agent access')
  await click('[data-test=settings-close]')
  if(await page.$eval('[data-test=zebra-enabled]',e=>!e.checked))await click('[data-test=zebra-quick-toggle]')
  await page.screenshot({path:shotPath('compiled-step-scan-complete.png')})
  await page.setViewport({width:700,height:900});await sleep(300)
  check(await page.$eval('[data-test=tmar-build-version]',e=>{const r=e.getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth}),'TMAR version remains visible when the top bar compacts')
  await page.goto(process.env.APP_URL+'?plugins=none',{waitUntil:'networkidle0'})
  check(!(await page.$('[data-test=tmar-build-version]'))&&!(await page.$('[data-test=cad-edges-toggle]')),'host remains usable with optional display and build plugins disabled')
  if(process.env.REAL_STEP)check(hash(readFileSync(process.env.REAL_STEP))===before,'source STEP is unchanged after compiled tests')
}catch(e){fail(e.stack??String(e))}
finally{if(browser)await finish(browser,consoleErrors);if(server)await new Promise(r=>{server.httpServer.close(r);server.httpServer.closeAllConnections()})}
