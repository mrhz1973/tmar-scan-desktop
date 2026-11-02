// SPDX-License-Identifier: AGPL-3.0-only
// Reproduce the user's route: STEP opened as Scan, no reverse CAD bodies.
// REAL_STEP stays private and is read only; never attach a user's browser tab.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { createServer } from 'vite'
import { cubeStep } from '../../../tests/stepFixtures.ts'
const root = fileURLToPath(new URL('../../../', import.meta.url))
const server = process.env.APP_URL ? null : await createServer({ root, server: { host:'127.0.0.1',port:0,open:false,watch:{ignored:['**/e2e-out/**']} } })
if(server){await server.listen();process.env.APP_URL=server.resolvedUrls.local[0]}
const { launchApp,check,fail,finish,sleep,OUT_DIR,shotPath,pixelDiff } = await import('../../../scripts/e2e-lib.mjs')
let browser,page,consoleErrors=[]
try {
  ;({browser,page,consoleErrors}=await launchApp({width:1600,height:1050,protocolTimeout:240000,agentDataOk:false,userDataDir:mkdtempSync(join(OUT_DIR,'step-scan-profile-'))}))
  page.on('dialog',d=>d.accept())
  const step=process.env.REAL_STEP?readFileSync(process.env.REAL_STEP):Buffer.from(cubeStep(20))
  const name=process.env.REAL_STEP?basename(process.env.REAL_STEP):'step-opened-as-scan.step'
  const sha=createHash('sha256').update(step).digest('hex')
  writeFileSync(shotPath('input-summary.json'),JSON.stringify({name,sha256:sha,bytes:step.length,route:'scan.open'},null,2))
  const call=(name,args={})=>page.evaluate(async(name,args)=>{const {registerCoreCommands}=await import('/src/commands/core.ts');registerCoreCommands();if(args.bytes)args.bytes=Uint8Array.from(args.bytes);const r=await(await import('/src/commands/registry.ts')).runCommand(name,args);if(r?.file?.bytes)r.file.bytes=Array.from(r.file.bytes);return r},name,args)
  const click=async(s)=>{await page.waitForSelector(s,{visible:true});await page.click(s);await sleep(200)}
  const input=async(s,v)=>{await page.$eval(s,(e,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))},String(v));await sleep(180)}
  // Crop out every toolbar and hint. A changed button is NOT edge-render proof.
  const picture=async(name)=>{await page.mouse.move(5,5);await sleep(350);const r=await page.$eval('.viewport canvas',e=>{const r=e.getBoundingClientRect();return{x:r.x+25,y:r.y+65,width:r.width-50,height:r.height-165}});const image=await page.screenshot({clip:r,encoding:'base64'});if(name)writeFileSync(shotPath(name+'.png'),Buffer.from(image,'base64'));return image}
  const redPixels=(image)=>page.evaluate(async(data)=>{const i=new Image();i.src='data:image/png;base64,'+data;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const ctx=c.getContext('2d');ctx.drawImage(i,0,0);const p=ctx.getImageData(0,0,c.width,c.height).data;let n=0;for(let k=0;k<p.length;k+=4)if(p[k]>150&&p[k+1]<110&&p[k+2]<110)n++;return n},image)
  await call('scan.open',{bytes:Array.from(step),name,units:'mm'})
  await click('[data-test=workspace-reverse]')
  await page.waitForFunction(()=>window.__re?.store.getState().kernelStatus==='ready',{timeout:180000})
  await call('view.set',{view:'iso',fit:true})
  if(await page.$('[data-test=support-card] .sc-x'))await click('[data-test=support-card] .sc-x')
  check(await page.evaluate(()=>window.__re.store.getState().bodies.length===0),'STEP is loaded ONLY as Scan, with no CAD body workaround')
  check(await page.evaluate(()=>window.__re.scene().scanDisplay()?.cadEdges?.length>0),'original STEP face boundaries survive the scan worker/import route')
  check(await page.$eval('[data-test=cad-edges-status]',e=>e.textContent.includes('STEP loaded as Scan')),'panel explains actual STEP-as-Scan support instead of the old STL warning')
  check(!(await page.$('[data-test=cad-edges-tangent]')),'native-body-only tangent setting is not falsely offered for a scan')
  await page.evaluate(()=>{const s=window.__re.scene().scanDisplay(),g=s.mesh.geometry;window.__scanBefore={mesh:s.mesh,geometry:g,material:s.mesh.material,p:g.attributes.position.array.slice(),i:g.index.array.slice(),edges:s.cadEdges}})
  await click('[data-test=zebra-quick-toggle]')
  check(await page.$eval('[data-test=zebra-target]',e=>e.value==='scan'),'Zebra analyzes Scan exactly as in the reported screenshot')
  await click('[data-test=cad-edges-reset]')
  const on=await picture('step-scan-zebra-edges-on');await click('[data-test=cad-edges-toggle]');const off=await picture('step-scan-zebra-edges-off')
  const delta=await pixelDiff(page,on,off);check(delta>.02,`actual model crop changes when STEP Scan edges toggle (${delta.toFixed(4)}%, no toolbar pixels)`)
  await click('[data-test=cad-edges-toggle]');await input('[data-test=cad-edges-color]','#ff3030');const red=await picture('step-scan-red-edges')
  const thin=await redPixels(red);check(thin>100,`changed edge color is visible on the model (${thin} red pixels)`)
  await input('[data-test=cad-edges-width]',5.5);const thick=await picture('step-scan-edges-5_5px'),thickCount=await redPixels(thick)
  check(thickCount>thin*1.4,`5.5 px creates thicker MODEL lines (${thin} -> ${thickCount} red pixels)`)
  await click('[data-test=cad-edges-reset]')
  check(await page.evaluate(()=>{const s=window.__re.scene().scanDisplay(),o=window.__scanBefore,g=s.mesh.geometry;return s.mesh===o.mesh&&g===o.geometry&&s.mesh.material===o.material&&s.cadEdges===o.edges&&g.attributes.position.array.every((v,i)=>v===o.p[i])&&g.index.array.every((v,i)=>v===o.i[i])&&!window.__re.measure.getState().wireframe}),'edge styling preserves scan buffers/material, measurement geometry and wireframe-off state')
  const hit=await page.evaluate(()=>{const h=window.__re.scene().layerHost(),r=h.canvas.getBoundingClientRect();for(const dy of [0,.15,-.15])for(const dx of [0,.15,-.15]){const x=r.x+r.width*(.5+dx),y=r.y+r.height*(.5+dy);if(h.pickScan(x,y))return{x,y}}return null})
  if(!hit)throw new Error('No scan surface under known interior camera sample')
  await click('[data-test=zebra-add-note]');await page.mouse.click(hit.x,hit.y);await page.waitForSelector('[data-test=note-text]')
  await page.type('[data-test=note-text]','STEP Scan edge review');await click('[data-test=note-keep]')
  check(await page.evaluate(()=>window.__reNotes.getState().notes.some(n=>n.text==='STEP Scan edge review'&&n.on[0]?.kind==='scan')),'local note hits the original scan through Zebra and edge layers')
  await click('[data-test=note-locate]');check(await page.$eval('[data-test=note-focus-ring]',e=>e.getBoundingClientRect().width>=50),'Go to note retains visible focus/highlight with STEP Scan edges')
  await click('[data-test=note-return-view]')
  const saved=await call('project.save');writeFileSync(shotPath('step-scan-fixture.scanruler'),Buffer.from(saved.file.bytes))
  if(!process.env.REAL_STEP)writeFileSync(join(root,'e2e-out','step-scan-fixture.scanruler'),Buffer.from(saved.file.bytes))
  await call('project.load',{bytes:saved.file.bytes,name:'step-scan-roundtrip.scanruler',discard:true})
  check(await page.evaluate(()=>window.__re.scene().scanDisplay()?.cadEdges?.length>0&&window.__reNotes.getState().notes.length===1),'project reopen regenerates original boundaries and retains the same note')
  // Resplitting only shading must not throw away the original face boundaries.
  await page.evaluate(async()=>{const {commandHost}=await import('/src/commands/host.ts');const s=window.__re.scene(),before=s.scanDisplay().cadEdges;const mesh=await commandHost().session.clientRef.current.recrease({mode:'off',angleDeg:30});s.resplitScan(mesh.positions,mesh.indices,mesh.normals,mesh.wireSlots,mesh.copyOf);window.__resplitKept=s.scanDisplay().cadEdges===before})
  check(await page.evaluate(()=>window.__resplitKept),'changing sharp-edge shading preserves CAD face boundaries')
  await page.evaluate(()=>{const s=window.__re.scene();s.setAlignment([1,0,0,0,0,1,0,0,0,0,1,0,7,-4,3,1])});await sleep(250)
  check(await page.evaluate(()=>{const s=window.__re.scene(),g=s.layerHost().scene.getObjectByName('tmar-scan-cad-edges');return g.matrix.equals(s.scanDisplay().mesh.matrixWorld)}),'scan boundary layer follows the scan alignment frame, not the reference datum')
  await page.evaluate(()=>window.__re.scene().setAlignment(null))
  await call('view.set',{section:true});await sleep(200)
  check(await page.evaluate(()=>{const s=window.__re.scene(),g=s.layerHost().scene.getObjectByName('tmar-scan-cad-edges');return g.children.every(l=>l.material.clippingPlanes===s.scanDisplay().mesh.material.clippingPlanes)}),'STEP Scan boundaries honor active section clipping')
  await call('view.set',{section:false})
  await page.evaluate(()=>window.__re.store.getState().setScanHidden(true));await sleep(200)
  check(await page.evaluate(()=>!window.__re.scene().layerHost().scene.getObjectByName('tmar-scan-cad-edges').visible),'hiding the scan hides its lines too')
  await page.evaluate(()=>window.__re.store.getState().setScanHidden(false))
  const badge=await page.$eval('[data-test=tmar-build-version]',e=>({text:e.textContent,revision:e.dataset.revision,title:e.title}))
  check(badge.text.includes('TMAR web')&&/^[a-f0-9]{40}$/.test(badge.revision),'visible TMAR badge identifies the source revision independently of upstream version')
  check(await page.$eval('[data-test=app-version]',e=>e.textContent==='v0.9.4'),'upstream ScanRuler version remains unchanged')
  await click('[data-test=tmar-build-version]')
  check(await page.$eval('[data-test=tmar-build-details]',e=>e.textContent.includes('Built:')),'TMAR badge opens Settings with build provenance')
  check(await page.$eval('[data-test=toggle-agent-link]',e=>!e.checked),'STEP Scan review leaves the agent connection disabled')
  await click('[data-test=settings-close]')
  await page.screenshot({path:shotPath('step-scan-complete.png')})
  const stl='solid test\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 10 0\nendloop\nendfacet\nendsolid test'
  await call('scan.open',{bytes:Array.from(Buffer.from(stl)),name:'mesh-only.stl',units:'mm',discard:true});await sleep(250)
  check(await page.evaluate(()=>window.__re.scene().scanDisplay()?.cadEdges===null),'replacing STEP with STL drops unavailable topology instead of drawing fake edges')
  check(await page.evaluate(()=>{const g=window.__re.scene().layerHost().scene.getObjectByName('tmar-scan-cad-edges');return!g.visible&&g.children.length===0}),'no stale STEP line buffers remain on a replacement mesh')
  if(process.env.REAL_STEP)check(createHash('sha256').update(readFileSync(process.env.REAL_STEP)).digest('hex')===sha,'authorized original STEP remains byte-for-byte unchanged')
}catch(e){fail(e.stack??String(e))}
finally{if(browser)await finish(browser,consoleErrors);if(server)await server.close()}
