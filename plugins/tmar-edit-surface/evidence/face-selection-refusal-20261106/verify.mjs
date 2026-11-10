import assert from 'node:assert/strict'
import {writeFileSync,mkdtempSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {createServer} from 'vite'
import puppeteer from 'puppeteer-core'
const out=mkdtempSync(resolve('plugins/tmar-edit-surface/evidence/face-selection-refusal-20261106/run-'))
const report={scope:'source modules + actual OCCT WASM worker, generated STEP; no host UI or user project',commit:'6b052ead5a59871e46a5c125c38e2044d9f65f34',verdict:'INCOMPLETE'}
let server,browser
try {
 server=await createServer({cacheDir:join(out,'vite-cache'),server:{host:'127.0.0.1',port:0,strictPort:true},plugins:[{name:'isolated-qa-page',configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url==='/__qa.html'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Isolated source worker QA</title>')}else next()})}}]})
 await server.listen()
 const port=server.httpServer.address().port
 browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,userDataDir:join(out,'owned-browser-profile'),args:['--disable-background-networking','--disable-sync','--no-first-run','--no-default-browser-check']})
 const page=await browser.newPage(),errors=[]
 page.on('pageerror',e=>errors.push(String(e)))
 await page.goto(`http://127.0.0.1:${port}/__qa.html`,{waitUntil:'domcontentloaded'})
 report.result=await page.evaluate(async()=>{
  const check=(value,message)=>{if(!value)throw Error(message)}
  const {OcctKernel}=await import('/node_modules/occt-wasm/dist/index.js')
  const {SurfaceRuntime}=await import('/plugins/tmar-edit-surface/surfaceRuntime.ts')
  const {SurfaceDraft}=await import('/plugins/tmar-edit-surface/surfaceDraft.ts')
  const {changeSurfaceFace}=await import('/plugins/tmar-edit-surface/faceSelection.ts')
  const {SurfaceWorkerRequestError}=await import('/plugins/tmar-edit-surface/workerClient.ts')
  const k=await OcctKernel.init({wasm:'/node_modules/occt-wasm/dist/occt-wasm.wasm'})
  const runtime=new SurfaceRuntime(),draft=new SurfaceDraft(runtime)
  const handles=[]
  const own=h=>(handles.push(h),h)
  try {
   const box=own(k.makeBox(20,30,10)),pin=own(k.makeCylinder(3,11)),moved=own(k.translate(pin,10,15,9)),body=own(k.fuse(box,moved))
   const step=k.exportStep(body),source=own(k.importStep(step)),faces=k.getSubShapes(source,'face');handles.push(...faces)
   check(k.isValid(source),'invalid fixture')
   const bottom=faces.findIndex(f=>{const b=k.uvBounds(f);return k.surfaceType(f)==='plane'&&Math.abs(k.pointOnSurface(f,(b.uMin+b.uMax)/2,(b.vMin+b.vMax)/2).z)<1e-8})
   const opened=await runtime.worker.ask({action:'open',step})
   const refused=opened.faces.find(f=>f.kind==='cylinder'&&f.reason)
   check(bottom>=0&&refused,'fixture must contain editable plane and unsupported cylinder')
   const net=await runtime.worker.ask({action:'select',face:bottom})
   draft.install(net,{face:bottom});draft.setSelection([12])
   const ready=async()=>{const until=Date.now()+60000;while(Date.now()<until){const s=draft.getSnapshot();if(s.error)throw Error(s.error);if(s.validNet===s.net&&!s.calculating)return s;await new Promise(r=>setTimeout(r,50))}throw Error('preview timeout')}
   await ready()
   const edited=structuredClone(draft.getSnapshot().net);edited.poles[12][2]-=.2;draft.commit(edited)
   await ready();draft.setLocks([12]);await ready()
   const before=draft.getSnapshot(),history=runtime.history.current,notes=[{text:'Nota QA da conservare',anchor:{u:.5,v:.5}}]
   let currentNotes=notes,activeFace=bottom,invalidated=false,rejection
   try {await changeSurfaceFace({select:()=>runtime.worker.ask({action:'select',face:refused.index}),current:()=>true,install:n=>{draft.install(n);activeFace=refused.index;currentNotes=[]},invalidate:()=>{invalidated=true;draft.reset()}})}catch(e){check(e instanceof SurfaceWorkerRequestError,'expected explicit worker CAD refusal');rejection=e.message}
   check(rejection,'select unexpectedly succeeded')
   check(!invalidated&&draft.getSnapshot()===before,'draft snapshot changed on select refusal')
   check(runtime.history.current===history&&currentNotes===notes&&activeFace===bottom,'history/notes/face changed')
   check(before.canUndo&&before.validNet===before.net,'preview/history not retained')
   const witness=await runtime.worker.ask({action:'finalFaceWitness',previewRevision:before.preview.previewRevision})
   check(witness.faceBrep.length>0,'previous worker preview lost')
   // Unlock explicitly, then continue editing the same CAD face after refusal.
   draft.setLocks([]);await ready()
   const next=structuredClone(draft.getSnapshot().net);next.poles[12][2]-=.1;draft.commit(next)
   const after=await ready()
   check(after.net.poles[12][2]===next.poles[12][2],'second edit lost')
   check(after.preview.previewRevision>before.preview.previewRevision,'no new actual CAD preview')
   const exported=await draft.evaluateForExport(),round=own(k.importStep(exported.step))
   check(k.isValid(round),'exported STEP invalid')
   const solids=k.getSubShapes(round,'solid'),roundFaces=k.getSubShapes(round,'face');handles.push(...solids,...roundFaces)
   check(solids.length===1&&roundFaces.length===faces.length,'topology count changed')
   const delta=k.getVolume(round)-k.getVolume(source)
   check(Math.abs(delta)>1e-6,'no independent CAD volume change')
   return {bottomFace:bottom,refusedFace:refused.index,refusal:rejection,retainedExactSnapshot:true,retainedHistory:true,retainedNotes:true,retainedWorkerWitness:true,firstPoleZ:before.net.poles[12][2],secondPoleZ:after.net.poles[12][2],firstPreviewRevision:before.preview.previewRevision,secondPreviewRevision:after.preview.previewRevision,exportValid:true,solidCount:solids.length,faceCount:roundFaces.length,volumeChangeMm3:delta,sourceStep:step,exportedStep:exported.step}
  }finally{draft.dispose();runtime.dispose();handles.reverse().forEach(h=>k.release(h));k[Symbol.dispose]()}
 })
 assert.deepEqual(errors,[])
 writeFileSync(join(out,'synthetic-source.step'),report.result.sourceStep)
 writeFileSync(join(out,'after-refusal-edit.step'),report.result.exportedStep)
 delete report.result.sourceStep;delete report.result.exportedStep
 report.verdict='PASS'
}catch(e){report.error=String(e.stack??e);process.exitCode=1}
finally{if(browser)await browser.close();if(server)await server.close();writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,...report}))}
