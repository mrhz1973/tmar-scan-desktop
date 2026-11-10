// SPDX-License-Identifier: AGPL-3.0-only
// Synthetic source QA. Fixture is seeded explicitly; subsequent UI/mouse are real.
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdirSync,mkdtempSync,readFileSync,readdirSync,writeFileSync} from 'node:fs'
import {isAbsolute,join,relative,resolve,sep} from 'node:path'
import {unzipSync,strFromU8} from 'fflate'
import {OcctKernel} from 'occt-wasm'
assert.equal(process.env.SCANRULER_ISOLATED,'1')
assert.equal(process.env.APP_URL,'http://127.0.0.1:17740/')
const root=process.env.OUT_DIR;assert(root&&isAbsolute(root))
const rel=relative(resolve(process.cwd()),resolve(root));assert(rel&&(rel.startsWith('..'+sep)||isAbsolute(rel)))
mkdirSync(root,{recursive:true});const out=mkdtempSync(join(root,'source-network-'));process.env.SHOT_DIR=out
const {launchApp,loadScan,sleep}=await import('../../../scripts/e2e-lib.mjs')
const {openReverse,reverseHelpers,exportBodyStep}=await import('./lib.mjs')
const hash=b=>createHash('sha256').update(b).digest('hex')
const triangles=[]
for(let y=0;y<40;y++)for(let x=0;x<40;x++){
 const a=[x,y,0],b=[x+1,y,0],c=[x+1,y+1,0],d=[x,y+1,0];triangles.push([a,b,c],[a,c,d])
}
const bytes=Buffer.alloc(84+triangles.length*50);bytes.write('TMAR synthetic network QA',0);bytes.writeUInt32LE(triangles.length,80)
triangles.forEach((t,i)=>{const at=84+i*50;bytes.writeFloatLE(1,at+8);t.flat().forEach((v,k)=>bytes.writeFloatLE(v,at+12+k*4))})
const scanPath=join(out,'synthetic-plane.stl');writeFileSync(scanPath,bytes)
const nodes=[],curves=[],cells=[];const id=(x,y)=>y*3+x+1
for(let y=0;y<3;y++)for(let x=0;x<3;x++)nodes.push({id:id(x,y),at:[5+x*15,5+y*15,0]})
for(let y=0;y<3;y++)for(let x=0;x<2;x++)curves.push({id:curves.length+1,from:id(x,y),to:id(x+1,y),via:[[12.5+x*15,5+y*15,0]]})
for(let y=0;y<2;y++)for(let x=0;x<3;x++)curves.push({id:curves.length+1,from:id(x,y),to:id(x,y+1),via:[[5+x*15,12.5+y*15,0]]})
for(let y=0;y<2;y++)for(let x=0;x<2;x++)cells.push({seed:[12.5+x*15,12.5+y*15,0],corners:[id(x,y),id(x+1,y),id(x+1,y+1),id(x,y+1)]})
const spec={nodes,curves,cells,spans:{},fit:{smoothness:.001},nextId:100,name:'Synthetic 3D Patch Network'}
const report={scope:'Synthetic source app; fixture seeded explicitly, later controls/pointer operations real',checks:[],consoleErrors:[],verdict:'INCOMPLETE'}
const check=(v,label)=>{assert(v,label);report.checks.push(label);console.log('PASS',label)}
let browser,page;const k=await OcctKernel.init()
const native=file=>JSON.parse(strFromU8(unzipSync(readFileSync(file))['project.json']))
const waitDownload=async(dir,suffix)=>{for(let i=0;i<600;i++){const f=readdirSync(dir).find(n=>n.endsWith(suffix));if(f)return join(dir,f);await sleep(100)}throw Error('Download timeout '+suffix)}
try{
 const app=await launchApp({url:process.env.APP_URL,width:1440,height:1000,agentDataOk:false,userDataDir:join(out,'owned-profile'),protocolTimeout:180000})
 browser=app.browser;page=app.page;report.consoleErrors=app.consoleErrors;page.on('dialog',d=>d.accept())
 const {screen}=reverseHelpers(page)
 await loadScan(page,scanPath);await openReverse(page);await page.click('[data-test=feature-network]')
 await page.evaluate(async spec=>{
  const {useReverse}=await import('/plugins/reverse/state/reStore.ts')
  const {useStore}=await import('/src/state/store.ts')
  const {sceneOf}=await import('/src/commands/host.ts')
  const {reverseSession}=await import('/plugins/reverse/app/reSession.ts')
  const {networkLayerIf}=await import('/plugins/reverse/viewer/networkLayer.ts')
  window.networkPointQa={re:useReverse,store:useStore,scene:sceneOf(),reverseSession,networkLayerIf}
  useReverse.getState().editNetwork(d=>({...d,...spec}))
  sceneOf().viewFrom('iso');sceneOf().fitToView()
 },spec)
 const ready=()=>page.waitForFunction(()=>window.networkPointQa.re.getState().preview.status==='ok',{timeout:120000})
 await ready();await page.waitForSelector('[data-test=network-create]:enabled');await page.click('[data-test=network-create]')
 await page.waitForFunction(()=>{const s=window.networkPointQa.re.getState();return !s.building&&s.bodies.length===1},{timeout:120000})
 const save=async name=>{
  const dir=join(out,'downloads',name);mkdirSync(dir,{recursive:true});const cdp=await page.createCDPSession()
  await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:dir,eventsEnabled:true})
  await page.waitForSelector('[data-test=save-project]:enabled');await page.click('[data-test=save-project]')
  return await waitDownload(dir,'.scanruler')
 }
 const fixture=await save('baseline');report.fixture={path:fixture,sha256:hash(readFileSync(fixture))}
 await page.evaluate(()=>{const s=window.networkPointQa.re.getState();s.editFeature(s.features.find(f=>f.kind==='network').id)})
 await page.waitForSelector('[data-test=network-point-motion]');await ready()
 const state=()=>page.evaluate(()=>{const q=window.networkPointQa,s=q.re.getState(),d=s.featureDraft;return {nodes:d.nodes,curves:d.curves,cells:d.cells,history:d.history.length,future:d.future.length,active:!!d.motionActive,preview:s.preview.status,report:s.preview.network,camera:JSON.stringify([q.scene.layerHost().camera().position.toArray(),q.scene.layerHost().camera().quaternion.toArray()])}})
 const scanBefore=await state(),scanFrom=await screen(scanBefore.nodes.find(n=>n.id===5).at),scanTo=await screen([20.8,20.4,0])
 await page.mouse.move(...scanFrom);await sleep(100);await page.mouse.down();await page.mouse.move(...scanTo,{steps:8});await page.mouse.up();await ready()
 const projected=(await state()).nodes.find(n=>n.id===5)
 check(!projected.offset&&Math.abs(projected.at[2])<1e-6&&Math.hypot(projected.at[0]-20,projected.at[1]-20)>.2,'existing on-scan pointer mode projects the point onto the mesh without a 3D offset')
 await page.click('[data-test=network-undo]');await ready()
 const original=await state()
 const fill=async(sel,value)=>{await page.click(sel,{clickCount:3});await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');await page.type(sel,String(value));await page.keyboard.press('Tab')}
 await page.select('[data-test=network-point-target]','node:5');await page.select('[data-test=network-point-mode]','normal')
 await fill('[data-test=network-point-distance]',.6);await page.click('[data-test=network-point-move]');await ready()
 let moved=await state(),node=moved.nodes.find(n=>n.id===5)
 check(Math.abs(node.offset.direction[2]*node.offset.distance-.6)<1e-6,'normal numeric movement persists a signed off-scan node target')
 check(moved.history===original.history+1,'numeric movement creates exactly one local Undo')
 const unchanged=JSON.stringify([moved.nodes,moved.curves,moved.cells])
 await page.select('[data-test=network-point-mode]','x');await page.select('[data-test=network-point-mode]','y')
 const same=await state();check(JSON.stringify([same.nodes,same.curves,same.cells])===unchanged,'changing the motion axis never reinterprets or moves the point')
 await fill('[data-test=network-point-offset-0]',.15);await ready();await fill('[data-test=network-point-offset-1]',-.1);await ready()
 await page.select('[data-test=network-point-mode]','z')
 const before=await state();node=before.nodes.find(n=>n.id===5)
 const pos=node.at.map((v,i)=>v+node.offset.direction[i]*node.offset.distance),from=await screen(pos),to=await screen([pos[0],pos[1],pos[2]+.8])
 await page.mouse.move(...from);await sleep(150);await page.mouse.down();await page.mouse.move(...to,{steps:12});await sleep(200)
 check((await state()).active&&await page.$eval('[data-test=network-create]',e=>e.disabled),'captured 3D drag blocks Create without disabling live preview')
 const during=await state()
 await page.evaluate(()=>{const c=document.querySelector('.viewport canvas');c.dispatchEvent(new PointerEvent('pointermove',{pointerId:999,clientX:20,clientY:20,bubbles:true}))})
 check(JSON.stringify((await state()).nodes)===JSON.stringify(during.nodes),'a second pointer cannot change the active gesture')
 await page.keyboard.down('Control');await page.keyboard.press('z');await page.keyboard.up('Control')
 check(JSON.stringify((await state()).nodes)===JSON.stringify(during.nodes)&&(await state()).history===during.history&&(await state()).active,'Ctrl+Z cannot interrupt an active 3D gesture; Escape owns cancellation')
 check(await page.$eval('[data-test=undo]',e=>e.disabled)&&await page.$eval('[data-test=network-undo]',e=>e.disabled),'global and local Undo controls are disabled during the captured gesture')
 await page.keyboard.press('Escape');await page.mouse.up();await ready()
 check(JSON.stringify((await state()).nodes)===JSON.stringify(before.nodes)&&(await state()).history===before.history,'Escape restores the entire pre-drag node state and history')
 await page.mouse.move(...from);await sleep(150);await page.mouse.down();await page.mouse.move(...to,{steps:12});await page.mouse.up();await ready()
 const dragged=await state();check(dragged.history===before.history+1&&!dragged.active,'a completed pointer drag contributes one local Undo and releases capture')
 check(dragged.nodes.find(n=>n.id===5).offset.distance>node.offset.distance,'real pointer drag changes the 3D target')
 check(dragged.camera===before.camera,'editing a point does not rotate or reset the shared camera')
 await page.click('[data-test=network-undo]');await ready();check(JSON.stringify((await state()).nodes)===JSON.stringify(before.nodes),'local Undo restores the exact previous 3D targets')
 await page.click('[data-test=network-redo]');await ready();check(JSON.stringify((await state()).nodes)===JSON.stringify(dragged.nodes),'local Redo restores the exact completed drag')
 await page.select('[data-test=network-point-target]','grip:8:0');await fill('[data-test=network-point-offset-2]',.3);await ready()
 check(Math.abs((await state()).curves.find(c=>c.id===8).viaOffsets[0].distance-.3)<1e-6,'an internal shared-curve grip can leave the scan too')
 check(await page.$eval('[data-test=network-point-snap-status]',e=>e.textContent.includes('non sono ancora disponibili')),'UI distinguishes scan projection from unimplemented 3D scan/CAD magnet')
 const desired=await state();await page.screenshot({path:join(out,'points-3d.png')})
 await page.click('[data-test=network-create]')
 await page.waitForFunction(()=>{const s=window.networkPointQa.re.getState();return !s.featureDraft&&!s.building&&s.bodies.length===1},{timeout:120000})
 const saved=await save('moved'),data=native(saved),stored=data.reverse.features.find(f=>f.kind==='network')
 check(JSON.stringify(stored.nodes)===JSON.stringify(desired.nodes)&&JSON.stringify(stored.curves)===JSON.stringify(desired.curves),'native save contains all node/grip offsets, not a flattened preview')
 report.saved={path:saved,sha256:hash(readFileSync(saved))}
 page=await browser.newPage();page.on('dialog',d=>d.accept());page.on('pageerror',e=>report.consoleErrors.push(String(e)))
 await page.goto(process.env.APP_URL,{waitUntil:'networkidle0'});await (await page.$('[data-test=project-input]')).uploadFile(saved);await openReverse(page)
 await page.waitForSelector('[data-test=body-row]',{timeout:120000})
 await page.evaluate(async()=>{window.networkPointReopen={re:(await import('/plugins/reverse/state/reStore.ts')).useReverse,session:(await import('/plugins/reverse/app/reSession.ts')).reverseSession}})
 await page.waitForFunction(()=>{const s=window.networkPointReopen.re.getState();return !s.building&&s.bodies.length===1&&s.results[s.features[0].id]?.status==='ok'},{timeout:120000})
 const reopened=await page.evaluate(()=>{const s=window.networkPointReopen.re.getState();return {feature:s.features.find(f=>f.kind==='network'),result:s.results[s.features[0].id],body:s.bodies[0]}})
 check(JSON.stringify(reopened.feature.nodes)===JSON.stringify(stored.nodes)&&JSON.stringify(reopened.feature.curves)===JSON.stringify(stored.curves),'fresh-page rebuild retains node and grip targets')
 check(reopened.body.faces===4&&reopened.result.network.worstGap<.005,'reopened CAD keeps four sewn faces with measured shared gap below 0.005 mm')
 const dir=join(out,'downloads','export');mkdirSync(dir,{recursive:true});await(await page.createCDPSession()).send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:dir,eventsEnabled:true})
 await exportBodyStep(page);const stepFile=await waitDownload(dir,'.step'),shape=k.importStep(readFileSync(stepFile,'utf8')),faces=k.getSubShapes(shape,'face')
 try{check(k.isValid(shape)&&faces.length===4,'independent OCCT validates the exported four-face CAD sheet')}finally{faces.forEach(f=>k.release(f));k.release(shape)}
 // A separate synthetic three-sided cell exercises the derived internal centre.
 page=await browser.newPage();page.on('dialog',d=>d.accept());page.on('pageerror',e=>report.consoleErrors.push(String(e)))
 await page.goto(process.env.APP_URL,{waitUntil:'networkidle0'});await loadScan(page,scanPath);await openReverse(page)
 await page.click('[data-test=feature-network]')
 await page.evaluate(async()=>{
  const re=(await import('/plugins/reverse/state/reStore.ts')).useReverse
  window.centreQa=re
  re.getState().editNetwork(d=>({...d,nodes:[{id:1,at:[5,5,0]},{id:2,at:[35,5,0]},{id:3,at:[20,35,0]}],
    curves:[{id:1,from:1,to:2,via:[]},{id:2,from:2,to:3,via:[]},{id:3,from:3,to:1,via:[]}],
    cells:[{seed:[20,15,0],corners:[1,2,3]}],spans:{},fit:{smoothness:.001},nextId:10,placing:null}))
 })
 const centreReady=()=>page.waitForFunction(()=>window.centreQa.getState().preview.status==='ok',{timeout:120000})
 await centreReady();report.centreBaseline=await page.evaluate(()=>{const s=window.centreQa.getState();return {patches:s.preview.network.patches.length,failed:s.preview.network.failed,refused:s.preview.network.refused}});console.log('CENTRE_BASELINE',JSON.stringify(report.centreBaseline));await page.select('[data-test=network-point-target]','centre:0');await page.select('[data-test=network-point-mode]','normal')
 await fill('[data-test=network-point-distance]',.5);await page.click('[data-test=network-point-move]');await centreReady()
 let centre=await page.evaluate(()=>{const s=window.centreQa.getState();return {cell:s.featureDraft.cells[0],history:s.featureDraft.history.length,report:s.preview.network}})
 check(Math.abs(centre.cell.centreOffset.distance-.5)<1e-6,'derived internal centre has a persistent normal displacement')
 report.centreDiagnostic={cell:centre.cell,centres:centre.report.centres,patches:centre.report.patches.length};console.log('CENTRE_DIAGNOSTIC',JSON.stringify(report.centreDiagnostic))
 check(centre.report.patches.length===report.centreBaseline.patches&&report.centreBaseline.patches>0&&Math.abs(centre.report.centres[0].at[2]-.5)<1e-4,'internal centre preview is lifted without losing any baseline-produced patch')
 report.centreLimit='This planar triangular fixture already produces only two patches before movement; this UI case is not a qualification of all three sectors. The separate curved-cap OCCT test checks three sewn faces.'
 await page.click('[data-test=network-undo]');await centreReady()
 check(await page.evaluate(()=>!window.centreQa.getState().featureDraft.cells[0].centreOffset),'internal centre Undo removes only its explicit offset')
 await page.click('[data-test=network-redo]');await centreReady()
 check(await page.evaluate(()=>Math.abs(window.centreQa.getState().featureDraft.cells[0].centreOffset.distance-.5)<1e-6),'internal centre Redo restores the normal displacement')
 await page.click('[data-test=network-create]');await page.waitForFunction(()=>{const s=window.centreQa.getState();return !s.building&&!s.featureDraft&&s.bodies.length===1},{timeout:120000})
 const centreSaved=await save('centre');check(Math.abs(native(centreSaved).reverse.features[0].cells[0].centreOffset.distance-.5)<1e-6,'native save retains the derived-centre displacement')
 report.centre={sha256:hash(readFileSync(centreSaved)),faces:centre.report.patches.length}
 check(hash(readFileSync(scanPath))===hash(bytes),'synthetic scan input is byte-for-byte unchanged')
 check(report.consoleErrors.length===0,'no application console errors')
 report.reopened={faces:reopened.body.faces,worstGap:reopened.result.network.worstGap,worstAngle:reopened.result.network.worstAngle}
 await page.screenshot({path:join(out,'reopened.png')});report.verdict='PASS'
}catch(e){report.error=String(e.stack??e);console.error(report.error);process.exitCode=1;if(page)await page.screenshot({path:join(out,'failure.png')}).catch(()=>{})}
finally{if(browser)await browser.close();k[Symbol.dispose]();writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,...report}))}
