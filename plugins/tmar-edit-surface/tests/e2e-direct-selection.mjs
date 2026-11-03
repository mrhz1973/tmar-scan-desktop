// SPDX-License-Identifier: AGPL-3.0-only
// Actual mouse gestures on an imported solid in an isolated application.
import { launchApp } from '../../../scripts/e2e-lib.mjs'
import { OcctKernel } from 'occt-wasm'
import { Box3, BufferAttribute, PerspectiveCamera, Vector3 } from 'three'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

assert(process.env.APP_URL, 'Supply an isolated application URL')
const baseline = process.env.DIRECT_BASELINE === '1'
const root=resolve('plugins/tmar-edit-surface/evidence/direct-selection')
mkdirSync(root,{recursive:true})
const out=mkdtempSync(join(root,'run-')),input=resolve('plugins/tmar-edit-surface/evidence/input-solid.step')
const k=await OcctKernel.init(),shape=k.importStep(readFileSync(input,'utf8')),faces=k.getSubShapes(shape,'face')
const uv=k.uvBounds(faces[5]),fractions=[0,1/6,1/2,5/6,1]
const poles=fractions.flatMap(u=>fractions.map(v=>{
  const p=k.pointOnSurface(faces[5],uv.uMin+u*(uv.uMax-uv.uMin),uv.vMin+v*(uv.vMax-uv.vMin))
  return new Vector3(p.x,p.y,p.z)
}))
const mesh=k.tessellate(shape),bounds=new Box3().setFromBufferAttribute(new BufferAttribute(mesh.positions,3))
faces.forEach(f=>k.release(f));k.release(shape);k[Symbol.dispose]()
const {browser,page,consoleErrors}=await launchApp({url:process.env.APP_URL,width:1440,height:1000,agentDataOk:false})
try {
  await page.click('[data-test=workspace-reverse]')
  await page.waitForSelector('[data-test=edit-surface-entry] button:enabled',{timeout:60000})
  await page.click('[data-test=edit-surface-entry] button')
  await (await page.$('[data-test=surface-step-file]')).uploadFile(input)
  await page.waitForFunction(()=>document.querySelectorAll('[data-test=surface-face] option').length===7,{timeout:60000})
  await page.select('[data-test=surface-face]','5')
  const ready=()=>page.waitForFunction(()=>document.querySelector('[data-test=surface-status]')?.textContent.includes('CAD valido')&&!document.querySelector('[data-test=surface-apply]')?.disabled,{timeout:60000})
  await ready();await page.select('[data-test=surface-continuity]','G0');await ready()
  assert.equal(await page.$eval('[data-test=edit-surface-viewport]',e=>Number(e.dataset.directEdges)),0,'A solid face must not offer free-edge duplication')
  const mode=await page.$eval('[data-test=surface-selection-mode]',e=>e.value)
  const rect=await page.$eval('[data-test=edit-surface-viewport]',e=>e.getBoundingClientRect().toJSON())
  const center=bounds.getCenter(new Vector3()),radius=bounds.getSize(new Vector3()).length()/2
  const camera=new PerspectiveCamera(40,rect.width/rect.height,radius/1000,radius*100)
  camera.position.copy(center).addScaledVector(new Vector3(1.5,-1.9,1.8),radius)
  camera.up.set(0,0,1);camera.lookAt(center);camera.updateMatrixWorld()
  const xy=p=>{const q=p.clone().project(camera);return[rect.x+(1+q.x)*rect.width/2,rect.y+(1-q.y)*rect.height/2]}
  const canvas=await page.$('[data-test=edit-surface-viewport] canvas')
  const frame=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
  const empty=[rect.x+24,rect.y+24], end=[rect.x+56,rect.y+48]
  await page.mouse.move(...empty);await frame()
  const before=await canvas.screenshot()
  await page.mouse.down();await page.mouse.move(...end,{steps:8});await page.mouse.up();await frame()
  const after=await canvas.screenshot(),emptyLeftDragChanged=!Buffer.from(before).equals(Buffer.from(after))
  if (baseline) {
    const report={baseline:true,defaultMode:mode,emptyLeftDragChanged,consoleErrors}
    writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,...report}))
  } else {
    assert.equal(mode,'auto');assert.equal(emptyLeftDragChanged,false,'Left drag on empty space must not rotate the camera')
    const clear=async()=>{for(const b of await page.$$('.es-dialog button'))if(await b.evaluate(e=>e.textContent==='Nessuno')){await b.click();return}throw Error('Missing Nessuno')}
    const selected=(n)=>page.waitForFunction(n=>document.querySelector('[data-test=surface-selection]')?.textContent.startsWith(n+' selezionati'),{timeout:10000},n)
    const hover=()=>page.$eval('[data-test=edit-surface-viewport]',e=>e.dataset.hoverKind||'')
    const move=async(p,kind)=>{await page.mouse.move(...xy(p));await frame();assert.equal(await hover(),kind)}
    await move(poles[12],'point');await page.screenshot({path:join(out,'hover-point.png')})
    await page.mouse.click(...xy(poles[12]));await selected(1);await clear();await selected(0)
    const edge=poles[11].clone().add(poles[12]).multiplyScalar(.5)
    await move(edge,'edge');await page.screenshot({path:join(out,'hover-edge.png')})
    await page.mouse.click(...xy(edge));await selected(2);await clear();await selected(0)
    const cell=[6,11,12,7].reduce((p,i)=>p.add(poles[i]),new Vector3()).multiplyScalar(.25)
    await move(cell,'cell');await page.screenshot({path:join(out,'hover-cell.png')})
    await page.mouse.click(...xy(cell));await selected(4)
    await page.keyboard.down('Control');await page.mouse.click(...xy(cell));await page.keyboard.up('Control');await selected(0)
    const volume=await page.$eval('[data-test=surface-status]',e=>Number(e.dataset.previewVolume))
    const from=xy(poles[12]),to=xy(poles[12].clone().add(new Vector3(0,0,1)))
    await page.mouse.move(...from);await page.mouse.down();await page.mouse.move(...to,{steps:8});await page.mouse.up()
    await page.waitForFunction(v=>{const s=document.querySelector('[data-test=surface-status]');return s?.textContent.includes('CAD valido')&&Number(s.dataset.previewVolume)>v+.01&&!document.querySelector('[data-test=surface-apply]')?.disabled},{timeout:60000},volume)
    await page.click('[data-test=surface-undo]')
    await page.waitForFunction(v=>{const s=document.querySelector('[data-test=surface-status]');return s?.textContent.includes('CAD valido')&&Math.abs(Number(s.dataset.previewVolume)-v)<1e-5},{timeout:60000},volume)
    await page.mouse.move(...from);await page.mouse.down();await page.mouse.move(...to,{steps:5})
    await page.$eval('[data-test=edit-surface-viewport] canvas',canvas=>canvas.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:1,pointerType:'mouse'})))
    await page.mouse.up()
    await page.waitForFunction(v=>{const s=document.querySelector('[data-test=surface-status]');return s?.textContent.includes('CAD valido')&&Math.abs(Number(s.dataset.previewVolume)-v)<1e-5},{timeout:60000},volume)
    await clear();await selected(0)
    await move(poles[0],'point');await page.mouse.down();await page.mouse.move(rect.x+rect.width+10,rect.y+rect.height/2);await page.mouse.up()
    await clear();await selected(0)
    await page.mouse.move(...empty);await frame();assert.equal(await hover(),'')
    const beforeOrbit=await canvas.screenshot()
    await page.mouse.down({button:'middle'});await page.mouse.move(...end,{steps:8});await page.mouse.up({button:'middle'});await frame()
    const afterOrbit=await canvas.screenshot();assert(!Buffer.from(beforeOrbit).equals(Buffer.from(afterOrbit)),'Middle drag must rotate the view')
    await page.mouse.move(...empty);await page.mouse.down({button:'right'});await page.mouse.move(...end,{steps:8});await page.mouse.up({button:'right'});await frame()
    const afterPan=await canvas.screenshot();assert(!Buffer.from(afterOrbit).equals(Buffer.from(afterPan)),'Right drag must pan the view')
    await page.mouse.wheel({deltaY:-100});await frame()
    const afterZoom=await canvas.screenshot();assert(!Buffer.from(afterPan).equals(Buffer.from(afterZoom)),'Wheel must zoom the view')
    assert.deepEqual(consoleErrors,[])
    const report={pass:true,defaultMode:mode,emptyLeftDragChanged,pointEdgeCellHoverAndSelection:true,ctrlToggle:true,directDragAndUndo:true,pointerCancelRestored:true,lockedReleaseOutside:true,middleDragRotates:true,rightDragPans:true,wheelZooms:true,consoleErrors}
    writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,...report}))
  }
} catch(error) {
  writeFileSync(join(out,'failure.json'),JSON.stringify({error:String(error),stack:error.stack,consoleErrors},null,2))
  await page.screenshot({path:join(out,'failure.png')});throw error
} finally {await browser.close()}
