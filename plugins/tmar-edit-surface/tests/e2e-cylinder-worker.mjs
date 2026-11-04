// SPDX-License-Identifier: AGPL-3.0-only
// Isolated source-worker contract on a generated STEP; not host UI QA.
import assert from 'node:assert/strict'
import { launchApp } from '../../../scripts/e2e-lib.mjs'

if (process.env.SCANRULER_ISOLATED !== '1') throw Error('Requires isolated QA app')
const {browser,page,consoleErrors}=await launchApp({url:process.env.APP_URL ?? 'http://127.0.0.1:17723/'})
try {
  const result=await page.evaluate(async()=>{
    const {OcctKernel}=await import('/node_modules/occt-wasm/dist/index.js')
    const {prepareCylinder}=await import('/plugins/tmar-edit-surface/cylinderPreparation.ts')
    const {moveSmoothCylinderPole}=await import('/plugins/tmar-edit-surface/periodic.ts')
    const k=await OcctKernel.init({wasm:'/node_modules/occt-wasm/dist/occt-wasm.wasm'})
    const primitive=k.makeCylinder(10,20),source=k.importStep(k.exportStep(primitive)),faces=k.getSubShapes(source,'face')
    const worker=new (await import('/plugins/tmar-edit-surface/editor.worker.ts?worker')).default()
    try {
      const index=faces.findIndex(f=>k.surfaceType(f)==='cylinder'),prepared=prepareCylinder(k,source,index)
      const net=moveSmoothCylinderPole(prepared.net,[.2,-.1,.15])
      const call=(id,net,action='previewCylinder')=>new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('worker timeout')),30000)
        const handler=({data})=>{if(data.id!==id)return;clearTimeout(timer);worker.removeEventListener('message',handler);data.error?reject(Error(data.error)):resolve(data.result)}
        worker.addEventListener('message',handler);worker.postMessage({id,action,prepared,net,face:index})
      })
      const preview=await call(1,net)
      const validated=await call(3,net,'evaluateCylinder')
      const bad=structuredClone(net);bad.poles[0][0]+=1
      let rejected=false;try {await call(2,bad)} catch {rejected=true}
      const round=k.importStep(validated.step);let valid
      try {valid=k.isValid(round)} finally {k.release(round)}
      return {kind:preview.kind,triangles:preview.mesh.triangleCount,hasStep:'step' in preview,hasValid:'valid' in preview,rejected,validated:valid}
    } finally {worker.terminate();faces.forEach(f=>k.release(f));k.release(source);k.release(primitive);k[Symbol.dispose]()}
  })
  assert.equal(result.kind,'provisional');assert.ok(result.triangles>0)
  assert.equal(result.hasStep,false);assert.equal(result.hasValid,false);assert.equal(result.rejected,true)
  assert.equal(result.validated,true)
  assert.deepEqual(consoleErrors,[])
  console.log(JSON.stringify({status:'PASS',scope:'isolated source worker; synthetic cylinder',...result}))
} finally {await browser.close()}
