// SPDX-License-Identifier: AGPL-3.0-only
// Owned server/profile only. REAL_STEP optionally tests a local authorized file;
// input bytes and screenshots remain ignored, never embedded in the repository.
import { mkdtempSync,readFileSync,writeFileSync } from 'node:fs'
import { join,basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { createServer } from 'vite'
import { importStep,writeBinarySTL } from 'meshstep'
const root=fileURLToPath(new URL('../../../',import.meta.url))
const server=process.env.APP_URL?null:await createServer({root,server:{host:'127.0.0.1',port:0,open:false,watch:{ignored:['**/e2e-out/**']}}})
if(server){await server.listen();process.env.APP_URL=server.resolvedUrls.local[0]}
const {launchApp,check,fail,finish,sleep,OUT_DIR,shotPath,pixelDiff}=await import('../../../scripts/e2e-lib.mjs')
let browser,page,consoleErrors=[]
try {
  ;({browser,page,consoleErrors}=await launchApp({width:1600,height:1050,protocolTimeout:240000,agentDataOk:false,userDataDir:mkdtempSync(join(OUT_DIR,'cad-edges-profile-'))}))
  page.on('dialog',d=>d.accept())
  const call=(name,args={})=>page.evaluate(async(name,args)=>{
    const {registerCoreCommands}=await import('/src/commands/core.ts');registerCoreCommands()
    if(args.bytes)args.bytes=Uint8Array.from(args.bytes)
    const out=await(await import('/src/commands/registry.ts')).runCommand(name,args)
    if(out?.file?.bytes)out.file.bytes=Array.from(out.file.bytes)
    return out
  },name,args)
  const click=async(s)=>{await page.waitForSelector(s,{visible:true});await page.click(s);await sleep(180)}
  const shot=async(name)=>{await page.mouse.move(5,5);await sleep(220);const el=await page.$('.viewport');const image=await el.screenshot({encoding:'base64'});if(name)writeFileSync(shotPath(name+'.png'),Buffer.from(image,'base64'));return image}
  const sameIsometric=async()=>{await page.evaluate(()=>{const scene=window.__re.scene(),pose=scene.captureView();pose.dir.set(1,-1,Math.sqrt(2/3)).normalize();pose.up.set(0,0,1);scene.restoreView(pose)});await call('view.set',{fit:true});await sleep(500)}
  const input=async(selector,value)=>{await page.$eval(selector,(el,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))},String(value));await sleep(150)}
  await click('[data-test=workspace-reverse]')
  await page.waitForFunction(()=>window.__re?.store.getState().kernelStatus==='ready',{timeout:180000})
  let step,name
  if(process.env.REAL_STEP){step=readFileSync(process.env.REAL_STEP);name=basename(process.env.REAL_STEP);await call('reverse.import.step',{bytes:Array.from(step),name})}
  else {
    await call('reverse.feature.add',{features:[{kind:'sketch',name:'Profile',plane:{kind:'world',axis:'z'},sketch:{shapes:[{kind:'rectangle',id:1,center:[0,0],size:[40,20],fixed:true}]}},{kind:'extrude',name:'Block',sketchId:'Profile',extent:{kind:'distance',from:0,to:15},op:'new'}]})
    await call('reverse.feature.add',{feature:{kind:'fillet',name:'Round',body:'Block',edges:[{between:[[0,0,1],[1,0,0]]}],radius:2}})
    const saved=await call('reverse.export.step');step=Buffer.from(saved.file.bytes);name='rounded-fixture.step'
  }
  await page.evaluate(()=>{window.__edgeExpectedBodies=window.__re.store.getState().bodies.length})
  writeFileSync(shotPath('input-summary.json'),JSON.stringify({name,bytes:step.length,sha256:createHash('sha256').update(step).digest('hex')},null,2))
  const scan=Buffer.from(writeBinarySTL(importStep(step.toString('utf8'),{surfaceDeviation:.02,maxEdge:2}).mesh))
  // The first scan may retain existing CAD. Never import a second coincident
  // copy: overlap diagnostics would cover Zebra and invalidate visual checks.
  await call('scan.open',{bytes:Array.from(scan),name:'same-shape-scan.stl',units:'mm',discard:true})
  if(await page.evaluate(()=>window.__re.store.getState().bodies.length===0)) await call('reverse.import.step',{bytes:Array.from(step),name})
  await page.evaluate(()=>window.__re.store.getState().setScanHidden(true))
  await call('view.set',{view:'iso',fit:true});await sameIsometric()
  await page.evaluate(()=>{window.__edgeOriginal=[...window.__re.reScene().bodyMeshes.values()].map(mesh=>({mesh,geometry:mesh.geometry,material:mesh.material,positions:Array.from(mesh.geometry.attributes.position.array),indices:Array.from(mesh.geometry.index.array)}));window.__featureBefore=JSON.stringify(window.__re.store.getState().features)})
  check(Boolean(await page.$('[data-test=cad-edges-toggle]')),'CAD edges are accessible from the lower Reverse bar')
  await click('[data-test=zebra-quick-toggle]')
  await page.waitForFunction(()=>/Showing stripes/.test(document.querySelector('[data-test=zebra-status]')?.textContent??''))
  check(await page.evaluate(()=>window.__re.store.getState().bodies.length===(window.__edgeExpectedBodies??window.__re.store.getState().bodies.length)), 'fixture contains no duplicate imported bodies')
  if(await page.$('[data-test=support-card] .sc-x'))await click('[data-test=support-card] .sc-x')
  const on=await shot('body-zebra-edges-on')
  await click('[data-test=cad-edges-toggle]');const off=await shot('body-zebra-edges-off')
  check(await pixelDiff(page,on,off)>.02,'CAD face/fillet edges visibly survive Zebra and can be switched off')
  await click('[data-test=cad-edges-toggle]')
  await input('[data-test=cad-edges-color]','#ff3030');const red=await shot('body-zebra-red-edges')
  check(await pixelDiff(page,on,red)>.02,'CAD edge color changes the rendered lines')
  await input('[data-test=cad-edges-width]',5);const thick=await shot('body-zebra-thick-edges')
  check(await pixelDiff(page,red,thick)>.02,'CAD edge width changes screen-space line thickness')
  await page.select('[data-test=cad-edges-tangent]','removed');const noTangent=await shot()
  await page.select('[data-test=cad-edges-tangent]','visible');const tangent=await shot()
  check(await pixelDiff(page,noTangent,tangent)>.01,'fillet tangent boundaries are controlled separately from sharp edges')
  await click('[data-test=cad-edges-reset]');await shot('body-zebra-default')
  check(await page.evaluate(()=>!window.__re.measure.getState().wireframe),'CAD edges never enable the internal scan triangle wireframe')
  check(await page.evaluate(()=>window.__edgeOriginal.every(o=>o.mesh.geometry===o.geometry&&o.mesh.material===o.material&&JSON.stringify(Array.from(o.geometry.attributes.position.array))===JSON.stringify(o.positions)&&JSON.stringify(Array.from(o.geometry.index.array))===JSON.stringify(o.indices))&&JSON.stringify(window.__re.store.getState().features)===window.__featureBefore),'edge/Zebra style changes preserve exact body buffers, materials and feature records')
  const point=await page.evaluate(()=>{
    const picks=window.__re.reScene().bodyPicks, project=picks.screenProjection()
    for(const {mesh} of window.__edgeOriginal){const p=mesh.geometry.attributes.position,index=mesh.geometry.index;for(let t=0;t<index.count;t+=Math.max(3,Math.floor(index.count/1200/3)*3)){
      const i=index.getX(t),j=index.getX(t+1),k=index.getX(t+2),v=[(p.getX(i)+p.getX(j)+p.getX(k))/3,(p.getY(i)+p.getY(j)+p.getY(k))/3,(p.getZ(i)+p.getZ(j)+p.getZ(k))/3]
      const [x,y]=project(...v),hit=picks.faceAt(x,y);if(hit)return{x,y}
    }}return null
  })
  if(!point)throw new Error('No visible CAD face for picking')
  await page.mouse.click(point.x,point.y);await sleep(180)
  check(await page.evaluate(()=>!!window.__re.store.getState().selection),'face selection remains active with Zebra and CAD edges')
  await click('[data-test=zebra-add-note]');await page.mouse.click(point.x,point.y);await page.waitForSelector('[data-test=note-text]')
  await page.type('[data-test=note-text]','CAD edge review note');await click('[data-test=note-keep]')
  const noteId=await page.evaluate(()=>window.__reNotes.getState().notes.find(n=>n.text==='CAD edge review note')?.id)
  check(Number.isFinite(noteId),'CAD notes still anchor through the Zebra/edge display')
  await click(`[data-note-id="${noteId}"] [data-test=note-locate]`)
  check(Boolean(await page.$(`[data-test=note-focus-ring][data-note-id="${noteId}"]`)),'note focus/highlight remains visible with CAD edges')
  await click('[data-test=note-return-view]')
  const savedProject=await call('project.save')
  await call('project.load',{bytes:savedProject.file.bytes,name:'edges-roundtrip.scanruler',discard:true})
  await page.waitForFunction(()=>!window.__re.store.getState().building,{timeout:180000})
  check(await page.evaluate(()=>window.__reNotes.getState().notes.some(n=>n.text==='CAD edge review note')),'CAD note survives save/reopen without changing its target')
  await call('deviation.open_reference',{bytes:Array.from(step),name,units:'mm'})
  await page.evaluate(async()=>{const {useDeviation}=await import('/src/state/deviationStore.ts');useDeviation.setState({showScan:false,showNominal:true,nominalSeeThrough:false,nominalMesh:false})})
  await call('view.set',{view:'iso',fit:true});await sameIsometric()
  check(await page.evaluate(()=>window.__re.scene().referenceDisplay()?.cadEdges?.length>0),'STEP reference retains genuine face boundary metadata through the worker')
  await page.evaluate(()=>{const r=window.__re.scene().referenceDisplay();window.__refOriginal={mesh:r.mesh,geometry:r.mesh.geometry,edges:r.cadEdges,positions:Array.from(r.mesh.geometry.attributes.position.array)}})
  await click('[data-test=zebra-quick-toggle]')
  check(await page.$eval('[data-test=zebra-target]',e=>e.value==='reference'),'Deviation Zebra explicitly targets the loaded reference')
  const refOn=await shot('reference-zebra-edges-on');await click('[data-test=cad-edges-toggle]');const refOff=await shot('reference-zebra-edges-off')
  check(await pixelDiff(page,refOn,refOff)>.02,'STEP reference face boundaries are visibly drawn over Zebra')
  await click('[data-test=cad-edges-toggle]');await input('[data-test=cad-edges-color]','#ff3030');await input('[data-test=cad-edges-width]',5)
  check(await pixelDiff(page,refOn,await shot('reference-zebra-custom-edges'))>.02,'reference edge color and thickness are adjustable')
  await click('[data-test=cad-edges-reset]')
  check(await page.evaluate(()=>{const r=window.__re.scene().referenceDisplay(),o=window.__refOriginal;return r.mesh===o.mesh&&r.mesh.geometry===o.geometry&&r.cadEdges===o.edges&&JSON.stringify(Array.from(o.geometry.attributes.position.array))===JSON.stringify(o.positions)}),'reference display does not move or modify measurement geometry')
  check(await page.$eval('[data-test=zebra-add-note]',e=>e.disabled),'reference-only view does not pretend scan notes can anchor on the reference')
  await call('view.set',{section:true});await sleep(250)
  check(await pixelDiff(page,refOn,await shot('reference-zebra-clipped'))>.1,'section clipping changes the visible reference and its edge layer together')
  check(await page.evaluate(()=>{const scene=window.__re.scene(),ref=scene.referenceDisplay(),group=scene.layerHost().scene.getObjectByName('tmar-reference-cad-edges');return group.children.every(l=>l.material.clippingPlanes===ref.mesh.material.clippingPlanes)}),'reference lines use the exact active clipping planes')
  await call('view.set',{section:false})
  await page.evaluate(async()=>{const {useDeviation}=await import('/src/state/deviationStore.ts');useDeviation.setState({showScan:true})});await sleep(250)
  await click('[data-test=quick-note]')
  const center=await page.$eval('.viewport canvas',e=>{const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})
  await page.mouse.click(center.x,center.y);await page.waitForSelector('[data-test=note-text]')
  await page.type('[data-test=note-text]','Deviation scan note with CAD edges');await click('[data-test=note-keep]')
  check(await page.evaluate(()=>window.__reNotes.getState().notes.some(n=>n.text==='Deviation scan note with CAD edges'&&n.on[0]?.kind==='scan')),'Deviation scan-side note placement still works while reference Zebra and edges are active')
  await page.evaluate(async()=>{const {useDeviation}=await import('/src/state/deviationStore.ts');useDeviation.setState({showScan:false})})
  const roundtrip=await call('project.save')
  writeFileSync(shotPath('cad-edges-fixture.scanruler'),Buffer.from(roundtrip.file.bytes))
  if(!process.env.REAL_STEP)writeFileSync(join(root,'e2e-out','cad-edges-fixture.scanruler'),Buffer.from(roundtrip.file.bytes))
  await call('project.load',{bytes:roundtrip.file.bytes,name:'reference-edges-roundtrip.scanruler',discard:true})
  await page.waitForFunction(()=>!window.__re.store.getState().building,{timeout:180000})
  check(await page.evaluate(()=>window.__re.scene().referenceDisplay()?.cadEdges?.length>0&&window.__reNotes.getState().notes.length===2),'STEP boundaries are recovered from the source and both notes survive project reopen')
  await page.evaluate(async()=>{const {useDeviation}=await import('/src/state/deviationStore.ts');useDeviation.setState({split:true})});await sleep(220)
  check(Boolean(await page.$('[data-test=zebra-deviation-blocked]')),'split view remains explicitly guarded, not silently misrendered')
  await page.evaluate(async()=>{const {useDeviation}=await import('/src/state/deviationStore.ts');useDeviation.setState({split:false})});await sleep(220)
  check(await page.$eval('[data-test=zebra-enabled]',e=>!e.checked),'returning from split view starts with Zebra off')
  check(await page.evaluate(async()=>!(await import('/src/state/prefsStore.ts')).usePrefs.getState().agentLink),'all edge/annotation operations leave the agent connection disabled')
  await page.screenshot({path:shotPath('cad-edges-complete.png')})
} catch(e){fail(e.stack??String(e))}
finally{if(browser)await finish(browser,consoleErrors);if(server)await server.close()}
