// SPDX-License-Identifier: AGPL-3.0-only
// Documentation capture: real UI, generated demo geometry, an owned browser profile.
// Writes only ignored output. Publishing reviewed images is a separate operation.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { createServer } from 'vite'
import { importStep, writeBinarySTL } from 'meshstep'
import { noisySheet } from '../plugins/tmar-mesh-review/scripts/fixture.mjs'
const root=fileURLToPath(new URL('../',import.meta.url)),out=join(root,'e2e-out','readme-gallery')
mkdirSync(out,{recursive:true});process.env.OUT_DIR=out
const server=await createServer({root,server:{host:'127.0.0.1',port:0,open:false,watch:{ignored:['**/e2e-out/**']}}})
await server.listen();process.env.APP_URL=server.resolvedUrls.local[0]
const {launchApp,sleep}=await import('../scripts/e2e-lib.mjs')
let browser,page;const images=[]
try {
 const app=await launchApp({width:1720,height:1080,agentDataOk:false,protocolTimeout:240000,userDataDir:mkdtempSync(join(out,'owned-profile-'))})
 ;({browser,page}=app);page.on('dialog',d=>d.accept())
 await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:'light'}])
 assert.equal(await page.$eval('html',e=>e.dataset.theme),'dark')
 const source=await page.$eval('[data-test=tmar-build-version]',e=>e.dataset.revision)
 const call=(name,args={})=>page.evaluate(async(name,args)=>{const {registerCoreCommands}=await import('/src/commands/core.ts');registerCoreCommands();if(args.bytes)args.bytes=Uint8Array.from(args.bytes);const r=await(await import('/src/commands/registry.ts')).runCommand(name,args);if(r?.file?.bytes)r.file.bytes=Array.from(r.file.bytes);return r},name,args)
 const click=async s=>{await page.waitForSelector(s,{visible:true});await page.click(s);await sleep(220)}
 const field=async(s,v)=>{await page.$eval(s,(e,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,String(v));e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))},v);await sleep(180)}
 const show=async s=>{await page.$eval(s,e=>e.scrollIntoView({block:'start'}));await sleep(300)}
 const capture=async(name,title,description)=>{await page.mouse.move(1670,50);await sleep(400);assert.equal(await page.$eval('html',e=>e.dataset.theme),'dark');await page.screenshot({path:join(out,name+'.png')});images.push({name,title,description,source,synthetic:true});console.log('CAPTURED '+name)}
 await page.evaluate(async()=>{(await import('/src/state/prefsStore.ts')).usePrefs.getState().setSupportCard(false)})
 await click('[data-test=workspace-reverse]')
 await page.waitForFunction(()=>window.__re?.store.getState().kernelStatus==='ready',{timeout:180000})
 await call('reverse.feature.add',{features:[{kind:'sketch',name:'Base profile',plane:{kind:'world',axis:'z'},sketch:{shapes:[{kind:'rectangle',id:1,center:[0,0],size:[40,24],fixed:true}]}},{kind:'extrude',name:'Demo block',sketchId:'Base profile',extent:{kind:'distance',from:0,to:15},op:'new'}]})
 await call('reverse.feature.add',{feature:{kind:'fillet',name:'Edge fillet R2',body:'Demo block',edges:[{between:[[0,0,1],[1,0,0]]}],radius:2}})
 const step=await call('reverse.export.step'),scan=writeBinarySTL(importStep(Buffer.from(step.file.bytes).toString('utf8'),{surfaceDeviation:.02,maxEdge:2}).mesh)
 await call('scan.open',{bytes:Array.from(new Uint8Array(scan)),name:'demo-rounded-block.stl',units:'mm',discard:true})
 if(await page.evaluate(()=>!window.__re.store.getState().bodies.length))await call('reverse.import.step',{bytes:step.file.bytes,name:'demo-rounded-block.step'})
 await click('[data-test=workspace-reverse]');await page.evaluate(()=>window.__re.store.getState().setScanHidden(true));await call('view.set',{view:'iso',fit:true})
 await click('[data-test=zebra-quick-toggle]');await page.waitForFunction(()=>/Showing stripes/.test(document.querySelector('[data-test=zebra-status]')?.textContent??''))
 await field('[data-test=cad-edges-color]','#ffbd66');await field('[data-test=cad-edges-width]',2.5)
 await show('[data-test=tmar-zebra]');await capture('cad-edges-zebra','CAD edges with Zebra','Face and fillet boundaries over reflected stripes on a synthetic CAD block; no triangle wireframe.')
 await call('deviation.open_reference',{bytes:step.file.bytes,name:'demo-rounded-block.step',units:'mm'})
 await page.evaluate(async()=>{(await import('/src/state/deviationStore.ts')).useDeviation.setState({showScan:false,showNominal:true,nominalSeeThrough:false,nominalMesh:false})})
 await call('view.set',{view:'iso',fit:true});await click('[data-test=zebra-quick-toggle]');await show('[data-test=tmar-zebra]')
 await capture('step-reference-zebra','STEP reference inspection','Surface Deviation with Zebra and CAD boundaries on a STEP reference; reference-side note placement is not claimed.')
 await click('[data-test=workspace-reverse]');await page.evaluate(()=>window.__re.store.getState().setScanHidden(true))
 const sketch=(name,x,plane={kind:'world',axis:'z'})=>({kind:'sketch',name,plane,sketch:{shapes:[{kind:'rectangle',id:1,center:[x,0],size:[10,8],fixed:true}]}})
 await call('reverse.feature.add',{features:[sketch('Guide profile A',30),sketch('Guide profile B',45),{kind:'sheet',name:'Surface guide',sketchId:'Guide profile A',from:0,to:6}]})
 const section=await call('section.cut',{across:'XY',offset:6,name:'Cross-section guide'})
 await call('reverse.feature.add',{feature:sketch('Section profile',0,{kind:'section',id:section.section.id})})
 await click('[data-test=workspace-reverse]');await call('view.set',{view:'iso',fit:true})
 await click('[data-feature-category=sketches] [data-test=features-select-all]')
 await page.evaluate(()=>{const s=window.__re.scene(),v=s.captureView();v.zoom*=.8;s.restoreView(v)});await show('[data-test=feature-selection]');await capture('feature-categories','Category-scoped feature selection','Sketches, section profiles, surfaces and solid operations have separate selection and visibility controls.')
 await page.evaluate(()=>{const m=window.__re.measure;m.getState().setViewTheme('studio');m.setState({sections:m.getState().sections.map(s=>({...s,visible:false}))});const r=window.__re.store.getState();r.setScanHidden(false);window.__galleryBodies=r.bodies.map(b=>({id:b.id,visible:b.visible}));window.__re.store.setState({bodies:r.bodies.map(b=>({...b,visible:false}))});window.__reNotes.getState().load([{id:1,text:'Inspect the upper face before accepting the result.',at:[0,0,15],normal:[0,0,1],on:[{kind:'scan'}]},{id:2,text:'Check the transition into the rounded edge.',at:[18,0,14],normal:[0,0,1],on:[{kind:'scan'}]},{id:3,text:'Review this side wall and its boundary.',at:[0,-12,8],normal:[0,-1,0],on:[{kind:'scan'}]},{id:4,text:'Keep the original datum face unchanged.',at:[-10,0,15],normal:[0,0,1],on:[{kind:'scan'}]}]);window.__reNotes.getState().showLocalNotes()})
 await call('view.set',{view:'iso',fit:true});await click('[data-note-id="1"] [data-test=note-select]');await page.keyboard.down('Control');await click('[data-note-id="3"] [data-test=note-select]');await page.keyboard.up('Control')
 await click('[data-note-id="1"] [data-test=note-locate]');await page.evaluate(()=>{const s=window.__re.scene(),v=s.captureView();v.zoom*=.55;s.restoreView(v)});await show('[data-test=note-list]')
 await capture('notes-focus','Local notes and Go to note','Multi-selection, large collapse header and a visible target reticle for a saved scan note; no agent connection.')
 await click('[data-test=note-return-view]');await call('view.set',{view:'iso',fit:true});await click('[data-test=workspace-labels]')
 await capture('label-controls','Workspace label controls','Text labels hidden with the lower-bar Labels control; saved note records and marker visibility remain independent.')
 await click('[data-test=workspace-labels]')
 await page.evaluate(()=>{const r=window.__re.store.getState();window.__re.store.setState({bodies:r.bodies.map(b=>({...b,visible:window.__galleryBodies.find(o=>o.id===b.id)?.visible??true}))});r.setScanHidden(true)})
 await click('[data-test=export-body]');await page.select('[data-test=body-export-format]','stl')
 await capture('unified-export','One STEP/STL export dialog','The same Export body command offers a file-format choice, body scope and STL tessellation tolerance.')
 await click('[aria-label="Close export"]')
 await call('scan.open',{bytes:Array.from(noisySheet().bytes),name:'demo-noisy-surface.ply',units:'mm',discard:true})
 await page.evaluate(()=>window.__reNotes.getState().load([]));await click('[data-test=workspace-mesh]');await call('view.set',{view:'iso',fit:true})
 await click('[data-test=zebra-quick-toggle]');await show('[data-test=tmar-zebra]')
 await capture('mesh-zebra','Mesh Tools Zebra inspection','Reflected-stripe inspection on a generated noisy scan; numerical Deviation is a separate tool.')
 await click('[data-test=zebra-quick-toggle]');await click('[data-test=mesh-tool-smooth]');await click('[data-test=smooth-scope-marked]');await call('view.set',{view:'top',fit:true});await click('[data-test=mark-brush]')
 const p=await page.$eval('.viewport canvas',e=>{const b=e.getBoundingClientRect();return{x:b.x+b.width*.5,y:b.y+b.height*.5}})
 await page.mouse.move(p.x-90,p.y);await page.mouse.down();await page.mouse.move(p.x+70,p.y,{steps:24});await page.mouse.up();await sleep(250)
 await field('[data-test=smooth-intensity]',45)
 for(let n=1;n<=2;n++){await click('[data-test=smooth-scan]');await page.waitForFunction(n=>document.querySelectorAll('[data-test=pending-edit]').length===n&&!document.querySelector('[data-test=smooth-scan]').disabled,{timeout:120000},n)}
 await show('[data-test=smooth-tool]');await capture('regional-smooth','Repeatable regional Smooth','Two actual Smooth applications at 45% intensity retain the painted area and keep Brush selected.')
 await page.keyboard.down('Shift');await capture('shift-navigation','Hold Shift to navigate','Temporary Navigate feedback while Brush is selected; releasing Shift returns to the same marking tool.')
 await page.keyboard.up('Shift')
 await click('[data-test=open-settings]');await show('[data-test=ui-theme-dark]')
 await capture('dark-settings','Dark by default','The default Dark interface is selected even with a light OS preference. Manual Light and System choices remain available.')
 await show('[data-test=note-shortcut-settings]');await capture('review-settings','Review workflow settings','Configurable Note shortcut, left-panel width and the exact TMAR build identification in Settings.')
 await click('[data-test=settings-close]')
 assert.equal(await page.evaluate(async()=> (await import('/src/state/prefsStore.ts')).usePrefs.getState().agentLink),false)
 assert.equal(app.consoleErrors.filter(e=>!/favicon|Download the React DevTools/i.test(e)).length,0,JSON.stringify(app.consoleErrors))
 // Thumbnails are reduced-size copies, with no retouching/cropping of the originals.
 const thumbnailPage=await browser.newPage()
 for(const image of [...images,{name:'zebra-real-part',path:join(root,'docs/images/zebra-tubo-finale-review-20261102.png')}]){
  const path=image.path??join(out,image.name+'.png'),bytes=readFileSync(path)
  const thumb=await thumbnailPage.evaluate(async b64=>{const img=new Image();img.src='data:image/png;base64,'+b64;await img.decode();const c=document.createElement('canvas');c.width=480;c.height=Math.round(img.height*c.width/img.width);const g=c.getContext('2d');g.imageSmoothingQuality='high';g.drawImage(img,0,0,c.width,c.height);return c.toDataURL('image/png').split(',')[1]},bytes.toString('base64'))
  writeFileSync(join(out,'thumb-'+image.name+'.png'),Buffer.from(thumb,'base64'))
  if(!image.path){image.sha256=createHash('sha256').update(bytes).digest('hex');image.bytes=bytes.length}
 }
 writeFileSync(join(out,'manifest.json'),JSON.stringify({capturedAt:new Date().toISOString(),source,platform:process.platform,browser:await browser.version(),images},null,2))
 console.log('GALLERY_READY '+images.length+' full screenshots and '+(images.length+1)+' thumbnails; source='+source)
}catch(e){console.error(e);if(page)await page.screenshot({path:join(out,'capture-failure.png')}).catch(()=>{});process.exitCode=1}
finally{if(browser)await browser.close();await server.close()}
