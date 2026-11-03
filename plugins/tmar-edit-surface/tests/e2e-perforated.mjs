// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Vector3, PerspectiveCamera, Box3, BufferAttribute } from 'three'
import { OcctKernel } from 'occt-wasm'
import { launchApp } from '../../../scripts/e2e-lib.mjs'

const chamfer=process.argv.includes('--chamfer')
const reopen=process.argv.includes('--reopen')
const root=resolve('plugins/tmar-edit-surface/evidence',chamfer?'trimmed-outer':'perforated')
mkdirSync(root,{recursive:true})
const out=mkdtempSync(join(root,'run-')), k=await OcctKernel.init()
function testPlate() {
  const vertices=[[0,0],[48,0],[48,48],[12,48],[0,36]].map(([x,y])=>({x,y,z:0}))
  const handles=[]
  if(chamfer){
    const edges=vertices.map((v,i)=>k.makeLineEdge(v,vertices[(i+1)%vertices.length]))
    const wire=k.makeWire(edges),face=k.makeFace(wire)
    handles.push(...edges,wire,face)
  }
  const box=chamfer?k.extrude(handles.at(-1),0,0,10):k.makeBox(48,48,10), drill=k.makeCylinder(3,14), positioned=k.translate(drill,12,12,-2)
  const shape=k.cut(box,positioned)
  try { return k.exportStep(shape) } finally { [shape,positioned,drill,box,...handles].forEach(h=>k.release(h)) }
}
const input=reopen ? join(root,'run-tYwpbn','drilled-edit.step') : join(out,'drilled-input.step')
if (!reopen) writeFileSync(input,testPlate())
const base=k.importStep(readFileSync(input,'utf8')), fs=k.getSubShapes(base,'face')
const top=fs.findIndex(f=>{
  if (reopen) return k.surfaceType(f).toLowerCase().includes('spline')
  const b=k.getBoundingBox(f)
  return Math.abs(b.zmin-10)<1e-6 && Math.abs(b.zmax-10)<1e-6
})
assert(top>=0)
const volume=k.getVolume(base)
const {browser,page,consoleErrors}=await launchApp({url:process.env.APP_URL??'http://127.0.0.1:17531/',width:1440,height:1000})
try {
  await page.click('[data-test=workspace-reverse]')
  await page.waitForSelector('[data-test=edit-surface-entry] button')
  await page.click('[data-test=edit-surface-entry] button')
  await (await page.$('[data-test=surface-step-file]')).uploadFile(input)
  await page.waitForFunction(n=>document.querySelectorAll('[data-test=surface-face] option').length===n,{},fs.length+1)
  await page.select('[data-test=surface-face]',String(top))
  const ready=()=>page.waitForFunction(()=>document.querySelector('[data-test=surface-apply]')?.disabled===false)
  await ready()
  const r=await page.$eval('[data-test=edit-surface-viewport]',e=>e.getBoundingClientRect().toJSON())
  const bounds=new Box3()
  for(const f of fs) {
    const mesh=k.tessellate(f,{linearDeflection:.08,angularDeflection:.15})
    bounds.union(new Box3().setFromBufferAttribute(new BufferAttribute(mesh.positions,3)))
  }
  const radius=bounds.getSize(new Vector3()).length()/2, center=bounds.getCenter(new Vector3())
  const cam=new PerspectiveCamera(40,r.width/r.height,radius/1000,radius*100)
  cam.position.copy(center).add(new Vector3(1.5,-1.9,1.8).multiplyScalar(radius))
  cam.up.set(0,0,1);cam.lookAt(center);cam.updateMatrixWorld()
  const project=z=>{const q=new Vector3(chamfer?30:36,(chamfer||reopen)?30:36,z).project(cam);return [r.x+(1+q.x)*r.width/2,r.y+(1-q.y)*r.height/2]}
  await page.mouse.move(...project(10));await page.mouse.down()
  await page.mouse.move(...project(12),{steps:6});await page.mouse.up()
  await ready()
  assert.equal(await page.$eval('[data-test=surface-selection]',e=>e.textContent),'1 selezionati · 1 modificabili')
  await page.screenshot({path:join(out,'edit-drilled-face.png')})
  await page.evaluate(()=>document.addEventListener('click',e=>{
    if(e.target instanceof HTMLAnchorElement && e.target.download.endsWith('.step')){
      e.preventDefault();window.stepExport=fetch(e.target.href).then(r=>r.text())
    }
  },true))
  const exportButton=await page.$$('.es-dialog button')
  for(const button of exportButton) if(await button.evaluate(e=>e.textContent.startsWith('Esporta STEP'))) { await button.click();break }
  await page.waitForFunction(()=>!!window.stepExport)
  const result=await page.evaluate(()=>window.stepExport)
  writeFileSync(join(out,'drilled-edit.step'),result)
  const edited=k.importStep(result), faces=k.getSubShapes(edited,'face')
  try {
    assert(k.isValid(edited));assert.equal(faces.length,fs.length);assert(k.getVolume(edited)>volume+1)
    const wires=k.getSubShapes(faces[top],'wire')
    assert.equal(wires.length,2);wires.forEach(w=>k.release(w))
    let maxRimError=0
    for(let i=0;i<72;i++){
      const angle=i*Math.PI/36,q={x:12+3*Math.cos(angle),y:12+3*Math.sin(angle),z:10}
      const uv=k.uvFromPoint(faces[top],q),p=k.pointOnSurface(faces[top],uv.u,uv.v)
      maxRimError=Math.max(maxRimError,Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z))
    }
    let maxChamferError=0
    if(chamfer){
      const outer=k.outerWire(faces[top]), edges=k.getSubShapes(outer,'edge')
      try {
        assert.equal(edges.length,5)
        for(let i=0;i<=32;i++){
          const q={x:12*i/32,y:36+12*i/32,z:10}, vertex=k.makeVertex(q.x,q.y,q.z)
          try {
            const uv=k.uvFromPoint(faces[top],q), p=k.pointOnSurface(faces[top],uv.u,uv.v)
            maxChamferError=Math.max(maxChamferError,k.distanceBetween(outer,vertex),Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z))
          } finally { k.release(vertex) }
        }
        assert(maxChamferError<1e-7)
      } finally {edges.forEach(e=>k.release(e));k.release(outer)}
    }
    assert(maxRimError<1e-7);assert.deepEqual(consoleErrors,[])
    const report={reopen,...(chamfer?{outerEdges:5,chamferSamples:33,maxChamferError}:{}),inputVolume:volume,editedVolume:k.getVolume(edited),faces:faces.length,wires:2,rimSamples:72,maxRimError}
    writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2));console.log(out, report)
  } finally { faces.forEach(f=>k.release(f));k.release(edited) }
} finally { await browser.close();[...fs,base].forEach(h=>k.release(h));k[Symbol.dispose]() }
