// SPDX-License-Identifier: AGPL-3.0-only
// Isolated source-worker contract on a generated STEP; not host UI QA.
import assert from 'node:assert/strict'
import { launchApp } from '../../../scripts/e2e-lib.mjs'

if (process.env.SCANRULER_ISOLATED !== '1') throw Error('Requires isolated QA app')
const {browser,page,consoleErrors}=await launchApp({url:process.env.APP_URL ?? 'http://127.0.0.1:17723/'})
try {
  const result=await page.evaluate(async()=>{
    const {OcctKernel}=await import('/node_modules/occt-wasm/dist/index.js')
    const {moveSmoothCylinderPole}=await import('/plugins/tmar-edit-surface/periodic.ts')
    const k=await OcctKernel.init({wasm:'/node_modules/occt-wasm/dist/occt-wasm.wasm'})
    const primitive=k.makeCylinder(10,20),source=k.importStep(k.exportStep(primitive)),faces=k.getSubShapes(source,'face')
    const worker=new (await import('/plugins/tmar-edit-surface/editor.worker.ts?worker')).default()
    try {
      const index=faces.findIndex(f=>k.surfaceType(f)==='cylinder')
      const call=(id,request)=>new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('worker timeout')),30000)
        const handler=({data})=>{if(data.id!==id)return;clearTimeout(timer);worker.removeEventListener('message',handler);data.error?reject(Error(data.error)):resolve(data.result)}
        worker.addEventListener('message',handler);worker.postMessage({id,...request})
      })
      await call(1,{action:'open',step:k.exportStep(source)})
      const prepared=await call(2,{action:'prepareCylinder',face:index})
      const net=moveSmoothCylinderPole(prepared.net,[.2,-.1,.15])
      const preview=await call(3,{action:'previewCylinder',session:prepared.session,net})
      const validated=await call(4,{action:'evaluateCylinder',session:prepared.session,net})
      const witness=await call(8,{action:'cylinderFaceWitness',session:prepared.session,previewRevision:validated.previewRevision})
      const noteFace=k.fromBREP(witness.faceBrep),uv=k.uvBounds(noteFace)
      let point
      try {const p=k.pointOnSurface(noteFace,(uv.uMin+uv.uMax)/2,(uv.vMin+uv.vMax)/2);point=[p.x,p.y,p.z]} finally {k.release(noteFace)}
      const note=await call(9,{action:'cylinderNotePick',session:prepared.session,previewRevision:validated.previewRevision,point})
      const resolved=await call(10,{action:'cylinderNoteResolve',session:prepared.session,previewRevision:validated.previewRevision,anchor:note.anchor})
      const bad=structuredClone(net);bad.poles[0][0]+=1
      let rejected=false;try {await call(5,{action:'previewCylinder',session:prepared.session,net:bad})} catch {rejected=true}
      let noteStale=false;try {await call(11,{action:'cylinderNoteResolve',session:prepared.session,previewRevision:validated.previewRevision,anchor:note.anchor})}catch {noteStale=true}
      await call(6,{action:'open',step:k.exportStep(source)})
      let staleRejected=false;try {await call(7,{action:'evaluateCylinder',session:prepared.session,net})}catch {staleRejected=true}
      const round=k.importStep(validated.step);let valid
      try {valid=k.isValid(round)} finally {k.release(round)}
      return {kind:preview.kind,triangles:preview.mesh.triangleCount,faces:preview.faceMeshes.length,hasStep:'step' in preview,hasValid:'valid' in preview,rejected,validated:valid,staleRejected,noteStale,noteGap:Math.hypot(...point.map((x,i)=>x-resolved.at[i]))}
    } finally {worker.terminate();faces.forEach(f=>k.release(f));k.release(source);k.release(primitive);k[Symbol.dispose]()}
  })
  assert.equal(result.kind,'provisional');assert.ok(result.triangles>0)
  assert.equal(result.faces,3)
  assert.equal(result.hasStep,false);assert.equal(result.hasValid,false);assert.equal(result.rejected,true)
  assert.equal(result.validated,true)
  assert.equal(result.staleRejected,true)
  assert.equal(result.noteStale,true);assert.ok(result.noteGap<1e-6)
  assert.deepEqual(consoleErrors,[])
  console.log(JSON.stringify({status:'PASS',scope:'isolated source worker; synthetic cylinder',...result}))
} finally {await browser.close()}
