// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Vector3, PerspectiveCamera, Box3, BufferAttribute } from 'three'
import { OcctKernel } from 'occt-wasm'
import { launchApp, pixelDiff } from '../../../scripts/e2e-lib.mjs'

const note=process.argv.includes('--note')
const zebra=note || process.argv.includes('--zebra')
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
  await page.evaluate(()=>{
    window.noteResolveReplies=[]
    const post=Worker.prototype.postMessage
    Worker.prototype.postMessage=function(message,...rest){
      if(message?.action==='noteResolve'){
        const worker=this,id=message.id,revision=message.previewRevision
        const receive=event=>{
          if(event.data?.id!==id)return
          worker.removeEventListener('message',receive)
          window.noteResolveReplies.push({revision,ok:typeof event.data.error!=='string',result:event.data.result})
        }
        worker.addEventListener('message',receive)
      }
      return post.call(this,message,...rest)
    }
  })
  await page.click('[data-test=edit-surface-entry] button')
  await (await page.$('[data-test=surface-step-file]')).uploadFile(input)
  await page.evaluate(()=>document.addEventListener('click',e=>{
    if(e.target instanceof HTMLAnchorElement && e.target.download.endsWith('.step')){
      e.preventDefault();window.stepExport=fetch(e.target.href).then(r=>r.text())
    }
  },true))
  await page.waitForFunction(n=>document.querySelectorAll('[data-test=surface-face] option').length===n,{},fs.length+1)
  await page.select('[data-test=surface-face]',String(top))
  const ready=()=>page.waitForFunction(()=>document.querySelector('[data-test=surface-apply]')?.disabled===false)
  await ready()
  const r=await page.$eval('[data-test=edit-surface-viewport]',e=>e.getBoundingClientRect().toJSON())
  const differences={}
  const shot = async () => {
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    return page.screenshot({clip:{x:r.x,y:r.y,width:r.width,height:r.height-55},encoding:'base64'})
  }
  if(zebra){
    const normal=await shot()
    await page.click('[data-test=surface-zebra]')
    const horizontal=await shot()
    differences.enable=await pixelDiff(page,normal,horizontal)
    await page.click('.es-dialog details:has([data-test=surface-zebra-direction]) summary')
    await page.select('[data-test=surface-zebra-direction]','vertical')
    differences.orientation=await pixelDiff(page,horizontal,await shot())
    await page.click('[data-test=surface-zebra]')
    differences.restore=await pixelDiff(page,normal,await shot())
    assert(differences.enable>1 && differences.orientation>1 && differences.restore<0.1,JSON.stringify(differences))
    await page.click('[data-test=surface-zebra]')
  }
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
  const noteText='Controllare il raccordo vicino al foro'
  let noteStart, noteEnd
  if(note){
    await page.click('[data-test=surface-note-add]')
    await page.mouse.click(...project(10))
    await page.waitForSelector('[data-test=surface-note-text]')
    await page.type('[data-test=surface-note-text]',noteText)
    noteStart=await page.$eval('[data-test=surface-note-position]',e=>e.textContent)
    assert(await page.$eval('[data-test=surface-apply]',e=>e.disabled))
  }
  await page.mouse.move(...project(10));await page.mouse.down()
  await page.mouse.move(...project(12),{steps:6});await page.mouse.up()
  if(note){
    await page.waitForFunction(start=>{
      const label=document.querySelector('[data-test=surface-note-position]')?.textContent
      return label?.endsWith(' mm') && label!==start
    },{},noteStart)
    noteEnd=await page.$eval('[data-test=surface-note-position]',e=>e.textContent)
    assert.equal(await page.$eval('[data-test=surface-note-text]',e=>e.value),noteText)
    await page.screenshot({path:join(out,'zebra-note.png')})
    assert.equal(await page.$eval('[data-test=surface-zebra]',e=>e.getAttribute('aria-pressed')), 'true')
    const beforeRevision=await page.$eval('[data-test=surface-status]',e=>e.dataset.previewRevision)
    await page.evaluate(()=>{window.stepExport=null;window.noteResolveReplies=[]})
    const buttons=await page.$$('.es-dialog button')
    for(const button of buttons) if(await button.evaluate(e=>e.textContent.startsWith('Esporta STEP'))) { await button.click();break }
    await page.waitForFunction(old=>{
      const status=document.querySelector('[data-test=surface-status]')
      const position=document.querySelector('[data-test=surface-note-position]')?.textContent??''
      return !!window.stepExport && status?.dataset.previewRevision!==old &&
        status?.textContent?.includes('CAD valido') && position.endsWith(' mm') &&
        window.noteResolveReplies.some(reply=>reply.revision===Number(status.dataset.previewRevision)&&reply.ok)
    },{},beforeRevision)
    noteEnd=await page.$eval('[data-test=surface-note-position]',e=>e.textContent)
    assert.equal(await page.$eval('[data-test=surface-note-text]',e=>e.value),noteText)
    assert(noteEnd.endsWith(' mm'))
    assert.equal(await page.$eval('[data-test=surface-zebra]',e=>e.getAttribute('aria-pressed')), 'true')
    const resolved=await page.evaluate(()=>window.noteResolveReplies.find(reply=>
      reply.revision===Number(document.querySelector('[data-test=surface-status]').dataset.previewRevision)&&reply.ok))
    assert.equal(resolved.revision,Number(await page.$eval('[data-test=surface-status]',e=>e.dataset.previewRevision)))
    assert.equal(resolved.result.at.length,3)
    assert.equal(resolved.result.normal.length,3)
    assert.equal(await page.$$('.es-dialog button').then(async bs=>{
      for(const b of bs) if(await b.evaluate(e=>e.textContent==='Rimuovi nota 1')) return true
      return false
    }),true)
    const noteDraftExport=await page.evaluate(()=>window.stepExport)
    assert(noteDraftExport.startsWith('ISO-10303-21'))
    assert.equal(await page.$eval('[data-test=surface-apply]',e=>e.disabled),true)
    for(const b of await page.$$('.es-dialog button')) if(await b.evaluate(e=>e.textContent==='Rimuovi nota 1')){await b.click();break}
  }
  await ready()
  assert.equal(await page.$eval('[data-test=surface-selection]',e=>e.textContent),'1 selezionati · 1 modificabili')
  await page.screenshot({path:join(out,'edit-drilled-face.png')})
  await page.evaluate(()=>{window.stepExport=null})
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
    const report={reopen,...(note?{noteStart,noteEnd}:{}),...(zebra?{zebraPixelDifferences:differences}:{}),...(chamfer?{outerEdges:5,chamferSamples:33,maxChamferError}:{}),inputVolume:volume,editedVolume:k.getVolume(edited),faces:faces.length,wires:2,rimSamples:72,maxRimError}
    writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2));console.log(out, report)
  } finally { faces.forEach(f=>k.release(f));k.release(edited) }
} finally { await browser.close();[...fs,base].forEach(h=>k.release(h));k[Symbol.dispose]() }
