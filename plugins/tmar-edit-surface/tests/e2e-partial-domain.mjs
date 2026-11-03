// SPDX-License-Identifier: AGPL-3.0-only
// Real UI drag on an imported STEP with a curved, partially trimmed NURBS.
import { launchApp } from '../../../scripts/e2e-lib.mjs'
import { OcctKernel } from 'occt-wasm'
import { Box3, BufferAttribute, PerspectiveCamera, Vector3 } from 'three'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

assert(process.env.APP_URL,'Supply an isolated application URL')
const root=resolve('plugins/tmar-edit-surface/evidence/partial-domain');mkdirSync(root,{recursive:true})
const out=mkdtempSync(join(root,'run-')), input=join(root,'input-curved.step')
const k=await OcctKernel.init(), original=k.importStep(readFileSync(input,'utf8')), originalFaces=k.getSubShapes(original,'face')
const faceIndex=originalFaces.findIndex(f=>k.surfaceType(f)==='bspline')
assert(faceIndex>=0)
const mesh=k.tessellate(original,{linearDeflection:0.08,angularDeflection:0.15})
const box=new Box3().setFromBufferAttribute(new BufferAttribute(mesh.positions,3)),center=box.getCenter(new Vector3()),radius=box.getSize(new Vector3()).length()/2
const {browser,page,consoleErrors}=await launchApp({url:process.env.APP_URL,width:1440,height:1000,agentDataOk:false})
const status=()=>page.$eval('[data-test=surface-status]',e=>({text:e.textContent,volume:Number(e.dataset.previewVolume)}))
const ready=()=>page.waitForFunction(()=>document.querySelector('[data-test=surface-status]')?.textContent.includes('CAD valido')&&!document.querySelector('[data-test=surface-apply]')?.disabled,{timeout:60000})
try{
  await page.click('[data-test=workspace-reverse]');await page.waitForSelector('[data-test=edit-surface-entry] button:enabled',{timeout:60000})
  await page.click('[data-test=edit-surface-entry] button')
  await (await page.$('[data-test=surface-step-file]')).uploadFile(input)
  await page.waitForFunction(n=>document.querySelectorAll('[data-test=surface-face] option').length===n,{timeout:60000},originalFaces.length+1)
  assert(!(await page.$eval(`[data-test=surface-face] option[value="${faceIndex}"]`,e=>e.disabled)),'The trimmed face must be selectable')
  await page.select('[data-test=surface-face]',String(faceIndex));await ready()
  assert(await page.$('.es-hint'))
  assert.equal(await page.$('[data-test=surface-free-boundary]'),null,'A trimmed solid face must not expose a free boundary')
  const before=await status(),r=await page.$eval('[data-test=edit-surface-viewport]',e=>e.getBoundingClientRect().toJSON())
  const camera=new PerspectiveCamera(40,r.width/r.height,radius/1000,radius*100)
  camera.position.copy(center).addScaledVector(new Vector3(1.5,-1.9,1.8),radius);camera.up.set(0,0,1);camera.lookAt(center);camera.updateMatrixWorld()
  const xy=p=>{const q=p.clone().project(camera);return[r.x+(1+q.x)*r.width/2,r.y+(1-q.y)*r.height/2]}
  const hidden=await page.$eval('[data-test=edit-surface-viewport]',e=>Number(e.dataset.hiddenPoles));assert(hidden>0)
  // A hidden, automatically protected control point and its adjacent cage
  // elements must not be selected by point/segment/cell picking.
  for(const [mode,point] of [['points',[-9,24,10]],['edges',[-9,25.5,10]],['cells',[-7.5,25.5,10]]]){
    await page.select('[data-test=surface-selection-mode]',mode)
    const target=xy(new Vector3(...point));assert(target[0]>r.x&&target[0]<r.x+r.width&&target[1]>r.y&&target[1]<r.y+r.height)
    await page.mouse.click(...target)
    assert.match(await page.$eval('[data-test=surface-selection]',e=>e.textContent),/^0 selezionati/)
  }
  await page.select('[data-test=surface-selection-mode]','points')
  const start=xy(new Vector3(24,24,10.5)),end=xy(new Vector3(24,24,12))
  await page.mouse.move(...start);await page.mouse.down();await page.mouse.move(...end,{steps:12});await page.mouse.up()
  await page.waitForFunction(v=>{const e=document.querySelector('[data-test=surface-status]');return e?.textContent.includes('CAD valido')&&Number(e.dataset.previewVolume)>v+0.01&&!document.querySelector('[data-test=surface-apply]')?.disabled},{timeout:60000},before.volume)
  const after=await status();await page.screenshot({path:join(out,'edited.png')})
  const download=page.evaluate(()=>new Promise((resolve,reject)=>{
    const handler=e=>{if(e.target instanceof HTMLAnchorElement&&e.target.download.endsWith('.step')){
      e.preventDefault();document.removeEventListener('click',handler,true);fetch(e.target.href).then(r=>r.text()).then(resolve,reject)
    }};document.addEventListener('click',handler,true)
  }))
  for(const b of await page.$$('.es-dialog button'))if(await b.evaluate(e=>e.textContent==='Esporta STEP…')){await b.click();break}
  const step=await download;writeFileSync(join(out,'edited.step'),step)
  const result=k.importStep(step),newFaces=k.getSubShapes(result,'face'),oldWire=k.outerWire(originalFaces[faceIndex]),newWire=k.outerWire(newFaces[faceIndex]),edges=k.getSubShapes(oldWire,'edge')
  try{
    assert(k.isValid(result));assert.equal(newFaces.length,originalFaces.length)
    assert(Math.abs(k.getVolume(result)-after.volume)<1e-4)
    let maxBoundaryDistance=0
    for(const edge of edges){const t=k.curveParameters(edge);for(let i=0;i<=24;i++){
      const p=k.curvePointAtParam(edge,t.first+(t.last-t.first)*i/24),v=k.makeVertex(p.x,p.y,p.z)
      try{maxBoundaryDistance=Math.max(maxBoundaryDistance,k.distanceBetween(v,newWire))}finally{k.release(v)}
    }}
    assert(maxBoundaryDistance<1e-6)
    assert.deepEqual(consoleErrors,[])
    const report={pass:true,faceIndex,poles:729,hiddenProtectedPoles:hidden,hiddenPickingExcluded:true,beforeVolume:before.volume,afterVolume:after.volume,maxBoundaryDistance,validStep:true,consoleErrors}
    writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,...report}))
  }finally{edges.forEach(e=>k.release(e));k.release(oldWire);k.release(newWire);newFaces.forEach(f=>k.release(f));k.release(result)}
}catch(error){writeFileSync(join(out,'failure.json'),JSON.stringify({error:String(error),stack:error.stack,consoleErrors},null,2));await page.screenshot({path:join(out,'failure.png')});throw error}
finally{await browser.close();originalFaces.forEach(f=>k.release(f));k.release(original);k[Symbol.dispose]()}
