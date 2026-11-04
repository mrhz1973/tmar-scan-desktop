// SPDX-License-Identifier: AGPL-3.0-only
// Ordinary compiled UI; load a synthetic baseline, edit, Undo/Redo and native reload.
import assert from 'node:assert/strict'
import {mkdirSync,mkdtempSync,readFileSync,readdirSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {join,isAbsolute} from 'node:path'
import {unzipSync,strFromU8} from 'fflate'
import {OcctKernel} from 'occt-wasm'
assert.equal(process.env.SCANRULER_ISOLATED,'1');assert.equal(process.env.APP_URL,'http://127.0.0.1:17741/')
const root=process.env.OUT_DIR,input=process.env.NETWORK_PROJECT
assert(root&&isAbsolute(root)&&input&&isAbsolute(input));mkdirSync(root,{recursive:true})
const out=mkdtempSync(join(root,'compiled-network-'));process.env.SHOT_DIR=out
const {launchApp,sleep}=await import('../../../scripts/e2e-lib.mjs')
const {exportBodyStep}=await import('./lib.mjs')
const hash=b=>createHash('sha256').update(b).digest('hex')
const inputHash=hash(readFileSync(input)),native=file=>JSON.parse(strFromU8(unzipSync(readFileSync(file))['project.json']))
const feature=m=>m.reverse.features.find(f=>f.kind==='network')
assert.equal(feature(native(input)).nodes.length,9);assert(feature(native(input)).nodes.every(n=>!n.offset))
const report={scope:'Compiled public UI numeric node/grip movement, project Undo/Redo, Save/Load and independent STEP; source-made synthetic baseline; no browser source imports',checks:[],consoleErrors:[],sourceRequests:[],verdict:'INCOMPLETE',inputHash}
const check=(v,s)=>{assert(v,s);report.checks.push(s);console.log('PASS',s)}
const waitFile=async(dir,suffix)=>{for(let i=0;i<600;i++){const f=readdirSync(dir).find(n=>n.endsWith(suffix));if(f)return join(dir,f);await sleep(100)}throw Error('Missing '+suffix)}
const k=await OcctKernel.init();let browser,page
const observe=p=>{p.on('dialog',d=>d.accept());p.on('pageerror',e=>report.consoleErrors.push(String(e)));p.on('request',r=>{if(/^\/(src|plugins)\/.*\.(tsx?|mjs)$/.test(new URL(r.url()).pathname))report.sourceRequests.push(r.url())})}
const load=async file=>{await page.waitForSelector('[data-test=project-input]');await(await page.$('[data-test=project-input]')).uploadFile(file);await page.click('[data-test=workspace-reverse]');await page.waitForSelector('[data-test=body-row]',{timeout:120000});await page.waitForSelector('[data-test=save-project]:enabled',{timeout:120000})}
const save=async name=>{const dir=join(out,'downloads',name);mkdirSync(dir,{recursive:true});await(await page.createCDPSession()).send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:dir,eventsEnabled:true});await page.waitForSelector('[data-test=save-project]:enabled');await page.click('[data-test=save-project]');return await waitFile(dir,'.scanruler')}
const fill=async(sel,v)=>{await page.click(sel,{clickCount:3});await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');await page.type(sel,String(v));await page.keyboard.press('Tab')}
const ready=()=>page.waitForSelector('[data-test=network-create]:enabled',{timeout:120000})
try{
 const app=await launchApp({url:process.env.APP_URL,width:1440,height:1000,agentDataOk:false,userDataDir:join(out,'owned-profile'),protocolTimeout:180000})
 browser=app.browser;page=app.page;report.consoleErrors=app.consoleErrors;observe(page);await load(input)
 await page.waitForSelector('[data-test=feature-row] [data-test=edit-element]:enabled',{timeout:120000});await page.click('[data-test=feature-row] [data-test=edit-element]');await page.waitForSelector('[data-test=network-point-motion]');await ready()
 const fits=await page.$eval('[data-test=network-point-motion]',e=>e.scrollWidth<=e.clientWidth+1)
 check(fits,'3D control fieldset fits the narrow column without horizontal clipping')
 await page.select('[data-test=network-point-target]','node:5');await page.select('[data-test=network-point-mode]','normal')
 await fill('[data-test=network-point-distance]',.4);await page.click('[data-test=network-point-move]');await page.waitForFunction(()=>Math.abs(Number(document.querySelector('[data-test=network-point-offset-2]')?.value)-.4)<1e-6&&!document.querySelector('[data-test=network-create]')?.disabled,{timeout:120000});await ready()
 check(Math.abs(Number(await page.$eval('[data-test=network-point-offset-2]',e=>e.value))-.4)<1e-6,'compiled normal movement produces the requested node displacement')
 await page.click('[data-test=network-undo]');await page.waitForFunction(()=>Number(document.querySelector('[data-test=network-point-offset-2]')?.value)===0&&!document.querySelector('[data-test=network-create]')?.disabled,{timeout:120000});await ready()
 check(Number(await page.$eval('[data-test=network-point-offset-2]',e=>e.value))===0,'compiled local Undo restores the node anchor')
 await page.click('[data-test=network-redo]');await page.waitForFunction(()=>Math.abs(Number(document.querySelector('[data-test=network-point-offset-2]')?.value)-.4)<1e-6&&!document.querySelector('[data-test=network-create]')?.disabled,{timeout:120000});await ready()
 check(Math.abs(Number(await page.$eval('[data-test=network-point-offset-2]',e=>e.value))-.4)<1e-6,'compiled local Redo restores the 3D displacement')
 await page.select('[data-test=network-point-target]','grip:8:0');await fill('[data-test=network-point-offset-2]',-.2);await ready()
 check(Number(await page.$eval('[data-test=network-point-offset-2]',e=>e.value))===-.2,'compiled shared-curve grip accepts a negative off-scan component')
 check(await page.$eval('[data-test=network-point-snap-status]',e=>e.textContent.includes('non sono ancora disponibili')),'compiled UI does not claim a 3D proximity magnet')
 await page.screenshot({path:join(out,'compiled-edit.png')});await page.click('[data-test=network-create]');await page.waitForSelector('[data-test=network-editor]',{hidden:true})
 const applied=await save('applied'),a=feature(native(applied))
 check(!!a.nodes.find(n=>n.id===5).offset&&!!a.curves.find(c=>c.id===8).viaOffsets[0],'compiled Save persists node and grip offsets')
 await page.waitForSelector('[data-test=undo]:enabled',{timeout:120000});await page.click('[data-test=undo]');await page.waitForSelector('[data-test=redo]:enabled');const undone=await save('undone'),u=feature(native(undone))
 check(u.nodes.every(n=>!n.offset)&&u.curves.every(c=>!c.viaOffsets),'one project Undo restores the original network, without removing its CAD')
 await page.click('[data-test=redo]');const redone=await save('redone'),rd=feature(native(redone))
 check(JSON.stringify(rd.nodes)===JSON.stringify(a.nodes)&&JSON.stringify(rd.curves)===JSON.stringify(a.curves),'one project Redo restores all explicit 3D targets')
 page=await browser.newPage();observe(page);await page.goto(process.env.APP_URL,{waitUntil:'networkidle0'});await load(redone)
 const reopened=await save('reopened'),rr=feature(native(reopened))
 check(JSON.stringify(rr.nodes)===JSON.stringify(a.nodes)&&JSON.stringify(rr.curves)===JSON.stringify(a.curves),'fresh compiled page rebuilds and resaves the exact offsets')
 const dir=join(out,'downloads','export');mkdirSync(dir,{recursive:true});await(await page.createCDPSession()).send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:dir,eventsEnabled:true})
 await exportBodyStep(page);const file=await waitFile(dir,'.step'),shape=k.importStep(readFileSync(file,'utf8')),faces=k.getSubShapes(shape,'face')
 try{check(k.isValid(shape)&&faces.length===4,'compiled export independently reimports as a valid four-face CAD sheet')}finally{faces.forEach(f=>k.release(f));k.release(shape)}
 check(report.sourceRequests.length===0,'compiled browser loads no source modules or injected controller')
 check(report.consoleErrors.length===0,'zero compiled application errors')
 check(hash(readFileSync(input))===inputHash,'synthetic baseline project is unchanged')
 report.files={applied:{sha256:hash(readFileSync(applied))},redone:{sha256:hash(readFileSync(redone))},reopened:{sha256:hash(readFileSync(reopened))},step:{sha256:hash(readFileSync(file))}}
 await page.screenshot({path:join(out,'compiled-reopened.png')});report.verdict='PASS'
}catch(e){report.error=String(e.stack??e);console.error(report.error);process.exitCode=1;if(page)await page.screenshot({path:join(out,'failure.png')}).catch(()=>{})}
finally{if(browser)await browser.close();k[Symbol.dispose]();writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,...report}))}
