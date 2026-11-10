// SPDX-License-Identifier: AGPL-3.0-only
// Isolated browser worker restart; does not open or modify a user project.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { launchApp } from '../../../scripts/e2e-lib.mjs'

assert.equal(process.env.SCANRULER_ISOLATED,'1','Requires an isolated QA host')
const url=new URL(process.env.APP_URL ?? '')
assert.equal(url.href,'http://127.0.0.1:17933/','Only the dedicated QA origin is allowed')
const path=process.env.SURFACE_QA_STEP
assert(path && isAbsolute(path) && /\.st(?:ep|p)$/i.test(path),'Absolute STEP path required')
const input=readFileSync(path),hash=data=>createHash('sha256').update(data).digest('hex'),before=hash(input)
const {browser,page,consoleErrors}=await launchApp({url:url.href,agentDataOk:false})
try {
  const result=await page.evaluate(async text=>{
    const {OcctKernel}=await import('/node_modules/occt-wasm/dist/index.js')
    const WorkerClass=(await import('/plugins/tmar-edit-surface/editor.worker.ts?worker')).default
    const k=await OcctKernel.init({wasm:'/node_modules/occt-wasm/dist/occt-wasm.wasm'})
    const imported=k.importStep(text),solids=k.getSubShapes(imported,'solid')
    let worker,serial=0
    const call=request=>new Promise((resolve,reject)=>{
      const id=++serial,timer=setTimeout(()=>reject(Error('worker timeout')),90000)
      const handler=({data})=>{if(data.id!==id)return;clearTimeout(timer);worker.removeEventListener('message',handler);data.error?reject(Error(data.error)):resolve(data.result)}
      worker.addEventListener('message',handler);worker.postMessage({id,...request})
    })
    try {
      if(solids.length<1) throw Error('No solid in STEP')
      const step=k.exportStep(solids[0])
      worker=new WorkerClass()
      await call({action:'open',step})
      const picked=await call({action:'selectAdaptiveExperimental',face:7})
      const net=structuredClone(picked.net),index=picked.witnessPole
      net.poles[index][0]+=.02
      const checked=await call({action:'evaluateAdaptiveExperimental',net,continuity:'G1',selection:picked.selection})
      const locks=[{index,point:[...net.poles[index]]}]
      const recipe=await call({action:'createAdaptiveLockedRecipe',net,continuity:'G1',locks,bodyId:'isolated-qa',selection:picked.selection})
      worker.terminate()
      worker=new WorkerClass()
      const replay=await call({action:'replayAdaptiveLockedRecipe',step,recipe,bodyId:'isolated-qa'})
      const restored=await call({action:'restoreAdaptiveLockedRecipe',step,recipe,bodyId:'isolated-qa'})
      const valid=await call({action:'evaluateAdaptiveExperimental',net:restored.net,continuity:'G1',selection:restored.selection})
      return {initialValid:checked.valid,replayValid:replay.valid,step:!!replay.step,restoredValid:valid.valid,
        point:restored.net.poles[index],locked:restored.lockSnapshots,expected:locks,version:recipe.version}
    } finally {worker?.terminate();solids.forEach(s=>k.release(s));k.release(imported);k[Symbol.dispose]()}
  },input.toString('utf8'))
  assert.equal(result.initialValid,true);assert.equal(result.replayValid,true);assert.equal(result.step,true)
  assert.equal(result.restoredValid,true);assert.equal(result.version,8)
  assert.deepEqual(result.locked,result.expected);assert.deepEqual(result.point,result.expected[0].point)
  assert.equal(hash(readFileSync(path)),before,'Source file changed')
  assert.deepEqual(consoleErrors,[])
  console.log(JSON.stringify({status:'PASS',scope:'isolated browser, two real workers, LEGO STEP, no project UI',sourceUnchanged:true}))
} finally {await browser.close()}
