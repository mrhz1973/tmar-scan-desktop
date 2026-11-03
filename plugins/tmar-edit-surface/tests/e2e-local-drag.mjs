// SPDX-License-Identifier: AGPL-3.0-only
import { OcctKernel } from 'occt-wasm'
import * as THREE from 'three'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'
import { launchApp } from '../../../scripts/e2e-lib.mjs'
const root = resolve('plugins/tmar-edit-surface/evidence/local-drag')
mkdirSync(root, { recursive: true })
const out = mkdtempSync(join(root, 'run-')), started = performance.now(), kernel = await OcctKernel.init()
const box = kernel.makeBox(20, 30, 10), rotated = kernel.rotate(box, { point: {x:0,y:0,z:0}, direction: {x:1,y:0,z:0} }, 0.6)
const input = join(out, 'rotated-input.step'); writeFileSync(input, kernel.exportStep(rotated))
const mesh = kernel.tessellate(rotated), bounds = new THREE.Box3().setFromBufferAttribute(new THREE.BufferAttribute(mesh.positions,3))
const faceList = kernel.getSubShapes(rotated, 'face'), top = faceList[5], uv = kernel.uvBounds(top)
const p = kernel.pointOnSurface(top, (uv.uMin+uv.uMax)/2,(uv.vMin+uv.vMax)/2), normal = kernel.surfaceNormal(top,(uv.uMin+uv.uMax)/2,(uv.vMin+uv.vMax)/2)
const originalPoint = new THREE.Vector3(p.x,p.y,p.z), n = new THREE.Vector3(normal.x,normal.y,normal.z)
faceList.forEach(f=>kernel.release(f)); kernel.release(rotated); kernel.release(box)
const { browser, page, consoleErrors } = await launchApp({ url: process.env.APP_URL ?? 'http://127.0.0.1:17531/', width:1440,height:1000 })
try {
  await page.click('[data-test=workspace-reverse]'); await page.waitForSelector('[data-test=edit-surface-entry] button',{timeout:60000}); await page.click('[data-test=edit-surface-entry] button')
  await (await page.$('[data-test=surface-step-file]')).uploadFile(input)
  await page.waitForFunction(()=>document.querySelectorAll('[data-test=surface-face] option').length===7,{timeout:60000})
  await page.select('[data-test=surface-face]','5')
  const ready = async()=>page.waitForFunction(()=>document.querySelector('[data-test=surface-status]')?.textContent.includes('CAD valido')&&!document.querySelector('[data-test=surface-apply]')?.disabled,{timeout:60000})
  const status = ()=>page.$eval('[data-test=surface-status]',e=>e.textContent)
  const changed = async before=>{await page.waitForFunction(p=>{const s=document.querySelector('[data-test=surface-status]')?.textContent;return s?.includes('CAD valido')&&s!==p},{timeout:60000},before);await ready()}
  const clickText = async text=>{for(const b of await page.$$('.es-dialog button')) if(await b.evaluate((e,t)=>e.textContent===t,text)){await b.click();return} throw Error('Missing '+text)}
  await ready(); await clickText('Seleziona liberi'); await page.select('[data-test=surface-drag-mode]','local'); await page.click('[data-test=surface-axis-2]')
  const cdp=await page.createCDPSession()
  const exportState = async label=>{
    const dir=join(out,label);mkdirSync(dir);await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:dir,eventsEnabled:true})
    await clickText('Esporta STEP…')
    let file;const deadline=Date.now()+60000
    while(Date.now()<deadline&&!file){file=readdirSync(dir).find(f=>f.endsWith('.step'));if(!file)await new Promise(r=>setTimeout(r,100))}
    assert(file);const destination=join(out,label+'.step');renameSync(join(dir,file),destination);await ready()
    const shape=kernel.importStep(readFileSync(destination,'utf8')),faces=kernel.getSubShapes(shape,'face')
    try{assert(kernel.isValid(shape));assert.equal(faces.length,6);const b=kernel.uvBounds(faces[5]),p=kernel.pointOnSurface(faces[5],(b.uMin+b.uMax)/2,(b.vMin+b.vMax)/2);return{file:label+'.step',center:[p.x,p.y,p.z],volume:kernel.getVolume(shape)}}
    finally{faces.forEach(f=>kernel.release(f));kernel.release(shape)}
  }
  const base=await exportState('base'), before=await status();await page.click('[data-test=surface-move]');await changed(before)
  const numeric=await exportState('numeric-local-N'), numericDelta=new THREE.Vector3(...numeric.center).sub(new THREE.Vector3(...base.center))
  // A midpoint pole of this refined bicubic contributes 1/4 at the surface center.
  assert(Math.abs(numericDelta.length()-0.25)<1e-8);assert(Math.abs(numericDelta.clone().normalize().dot(n))>1-1e-9)
  assert(numericDelta.toArray().filter(x=>Math.abs(x)>0.01).length===2)
  const r=await page.$eval('[data-test=edit-surface-viewport]',e=>{const b=e.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height}})
  const center=bounds.getCenter(new THREE.Vector3()),radius=bounds.getSize(new THREE.Vector3()).length()/2
  const camera=new THREE.PerspectiveCamera(40,r.width/r.height,radius/1000,radius*100)
  camera.position.copy(center).add(new THREE.Vector3(1.5,-1.9,1.8).multiplyScalar(radius));camera.up.set(0,0,1);camera.lookAt(center);camera.updateMatrixWorld()
  const pole=originalPoint.clone().add(numericDelta.clone().multiplyScalar(4)),project=q=>{const s=q.clone().project(camera);return{x:r.x+(s.x+1)*r.width/2,y:r.y+(1-s.y)*r.height/2}}
  const handle=process.argv.includes('--arrow')
  const grip=handle ? pole.clone().addScaledVector(n.clone().multiplyScalar(Math.sign(numericDelta.dot(n))),radius*0.20) : pole
  const from=project(grip),to=project(grip.clone().addScaledVector(n,1.5))
  if (handle) {
    const origin=project(pole)
    assert(Math.hypot(from.x-origin.x,from.y-origin.y)>8)
    await page.mouse.move(from.x,from.y)
    assert.equal(await page.$eval('[data-test=edit-surface-viewport]',e=>e.style.cursor),'grab')
  }
  await page.screenshot({path:join(out,'before-drag.png')})
  const previous=await status();await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:10});await page.mouse.up();await changed(previous)
  const dragged=await exportState('drag-local-N'),delta=new THREE.Vector3(...dragged.center).sub(new THREE.Vector3(...numeric.center))
  assert(delta.length()>0.01);assert(delta.clone().cross(n).length()<1e-8,'Drag follows the tilted local normal')
  await page.screenshot({path:join(out,'local-drag.png')})
  {const previous=await status();await page.click('[data-test=surface-undo]');await changed(previous)}
  const undone=await exportState('undo');assert(new THREE.Vector3(...undone.center).distanceTo(new THREE.Vector3(...numeric.center))<1e-8)
  {const previous=await status();await page.click('[data-test=surface-redo]');await changed(previous)}
  const redone=await exportState('redo');assert(new THREE.Vector3(...redone.center).distanceTo(new THREE.Vector3(...dragged.center))<1e-8)
  assert.equal(consoleErrors.length,0,JSON.stringify(consoleErrors))
  const result={pass:true,handle,base,numeric,numericDelta:numericDelta.toArray(),dragged,delta:delta.toArray(),normal:n.toArray(),from,to,undone,redone,consoleErrors,elapsedMs:performance.now()-started}
  writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({out,...result},null,2))
}catch(e){writeFileSync(join(out,'failure.json'),JSON.stringify({error:String(e),stack:e.stack},null,2));await page.screenshot({path:join(out,'failure.png')});throw e}
finally{await browser.close();kernel[Symbol.dispose]()}
