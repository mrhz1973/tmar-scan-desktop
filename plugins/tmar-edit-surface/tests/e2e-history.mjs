// SPDX-License-Identifier: AGPL-3.0-only
// Real UI history on imported CAD; STEP results are checked independently.
import { launchApp } from '../../../scripts/e2e-lib.mjs'
import { OcctKernel } from 'occt-wasm'
import { PerspectiveCamera, Vector3 } from 'three'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

assert(process.env.APP_URL, 'Supply an isolated application URL')
const root=resolve('plugins/tmar-edit-surface/evidence/history'); mkdirSync(root,{recursive:true})
const out=mkdtempSync(join(root,'run-'))
const input=resolve('plugins/tmar-edit-surface/evidence/input-solid.step')
const sheet=resolve('plugins/tmar-edit-surface/evidence/free-boundary/compiled-20261103/original.step')
const k=await OcctKernel.init(), shape=k.importStep(readFileSync(input,'utf8')), faces=k.getSubShapes(shape,'face')
const uv=k.uvBounds(faces[5]), fractions=[0,1/6,1/2,5/6,1]
const poles=fractions.flatMap(u=>fractions.map(v=>{
  const p=k.pointOnSurface(faces[5],uv.uMin+u*(uv.uMax-uv.uMin),uv.vMin+v*(uv.vMax-uv.vMin))
  return new Vector3(p.x,p.y,p.z)
}))
faces.forEach(f=>k.release(f)); k.release(shape)
const {browser,page,consoleErrors}=await launchApp({url:process.env.APP_URL,width:1440,height:1000,agentDataOk:false})
const ready=()=>page.waitForFunction(()=>document.querySelector('[data-test=surface-status]')?.textContent.includes('CAD valido') && !document.querySelector('[data-test=surface-apply]')?.disabled,{timeout:60000})
const selected=(total,free)=>page.waitForFunction(([t,f])=>document.querySelector('[data-test=surface-selection]')?.textContent===`${t} selezionati · ${f} modificabili`,{timeout:60000},[total,free])
const info=()=>page.$eval('[data-test=surface-status]',e=>({revision:Number(e.dataset.previewRevision),volume:Number(e.dataset.previewVolume),text:e.textContent}))
const clickText=async text=>{for(const b of await page.$$('.es-dialog button'))if(await b.evaluate((e,t)=>e.textContent===t,text)){await b.click();return}throw Error('Missing button '+text)}
const clickUndo=()=>page.click('[data-test=surface-undo]')
const clickRedo=()=>page.click('[data-test=surface-redo]')
const chord=async key=>{await page.keyboard.down('Control');await page.keyboard.press(key);await page.keyboard.up('Control')}
const mode=()=>page.$eval('[data-test=surface-continuity]',e=>e.value)
const project=async (p,center,radius)=>{
  const r=await page.$eval('[data-test=edit-surface-viewport]',e=>e.getBoundingClientRect().toJSON())
  const camera=new PerspectiveCamera(40,r.width/r.height,radius/1000,radius*100)
  camera.position.copy(center).addScaledVector(new Vector3(1.5,-1.9,1.8),radius);camera.up.set(0,0,1);camera.lookAt(center);camera.updateMatrixWorld()
  const q=p.clone().project(camera);return [r.x+(q.x+1)*r.width/2,r.y+(1-q.y)*r.height/2]
}
const open=async (file,index,count)=>{
  await page.click('[data-test=edit-surface-entry] button')
  await (await page.$('[data-test=surface-step-file]')).uploadFile(file)
  await page.waitForFunction(n=>document.querySelectorAll('[data-test=surface-face] option').length===n,{timeout:60000},count)
  await page.select('[data-test=surface-face]',String(index));await ready()
}
const exported=async()=>{
  const value=page.evaluate(()=>new Promise((resolve,reject)=>{
    const handler=e=>{if(e.target instanceof HTMLAnchorElement && e.target.download.endsWith('.step')){
      e.preventDefault();document.removeEventListener('click',handler,true);fetch(e.target.href).then(r=>r.text()).then(resolve,reject)
    }};document.addEventListener('click',handler,true)
  }))
  await clickText('Esporta STEP…');return value
}
let result={}
try{
  await page.click('[data-test=workspace-reverse]');await page.waitForSelector('[data-test=edit-surface-entry] button:enabled',{timeout:60000})
  await open(input,5,7)
  const center=new Vector3(10,15,5),radius=Math.hypot(20,30,10)/2
  await page.mouse.click(...await project(poles[12],center,radius));await selected(1,1)
  const initial=await info()
  await clickText('Blocca punti');await selected(1,0)
  assert(!(await page.$eval('[data-test=surface-undo]',e=>e.disabled)),'Lock must create an undoable action')
  await chord('z');await selected(1,1)
  assert.deepEqual(await info(),initial,'Undoing a lock must not recalculate the CAD surface')
  await chord('y');await selected(1,0)
  assert.deepEqual(await info(),initial,'Redoing a lock must not recalculate the CAD surface')
  await clickText('Sblocca punti');await selected(1,1)
  await page.click('[data-test=surface-move]');await ready()
  const moved=await info();assert(moved.volume>initial.volume+0.01)
  await clickText('Blocca punti');await selected(1,0)
  await clickUndo();await selected(1,1);assert.deepEqual(await info(),moved)
  await clickUndo();await ready();assert(Math.abs((await info()).volume-initial.volume)<1e-6);await selected(1,1)
  await clickRedo();await ready();assert(Math.abs((await info()).volume-moved.volume)<1e-6);await selected(1,1)
  await clickRedo();await selected(1,0);assert(Math.abs((await info()).volume-moved.volume)<1e-6)
  await clickUndo();await selected(1,1)
  assert(!(await page.$eval('[data-test=surface-redo]',e=>e.disabled)))
  await clickText('Blocca punti');await selected(1,0)
  assert(await page.$eval('[data-test=surface-redo]',e=>e.disabled),'New action must discard redo')
  await clickText('Blocca punti');await clickUndo();await selected(1,1)
  assert(Math.abs((await info()).volume-moved.volume)<1e-6,'A no-op lock must not create an extra history step')
  const step=await exported(), checked=k.importStep(step)
  try{assert(k.isValid(checked));assert(Math.abs(k.getVolume(checked)-moved.volume)<1e-5)}finally{k.release(checked)}
  // Lock history cannot make a still-pending geometry safe to apply.
  await page.evaluate(()=>{
    const post=Worker.prototype.postMessage;window.heldHistoryEvaluations=[];window.holdHistoryEvaluation=true
    Worker.prototype.postMessage=function(message,...rest){
      if(window.holdHistoryEvaluation && message?.action==='evaluate'){window.heldHistoryEvaluations.push({worker:this,message,rest});return}
      return post.call(this,message,...rest)
    }
    window.releaseHistoryEvaluation=()=>{const held=window.heldHistoryEvaluations.shift();if(!held)throw Error('No held evaluation');post.call(held.worker,held.message,...held.rest)}
  })
  await page.click('[data-test=surface-move]')
  await page.waitForFunction(()=>window.heldHistoryEvaluations?.length===1,{timeout:60000})
  await clickText('Blocca punti');await selected(1,0);await clickUndo();await selected(1,1)
  assert(await page.$eval('[data-test=surface-apply]',e=>e.disabled),'Lock undo must not enable pending geometry')
  await page.evaluate(()=>{window.holdHistoryEvaluation=false;window.releaseHistoryEvaluation()});await ready()
  assert((await info()).volume>moved.volume+0.01)
  result.solid={initialVolume:initial.volume,movedVolume:moved.volume,lockUndoNoRecalculation:true,mixedUndoRedo:true,redoDiscarded:true,noOpIgnored:true,pendingApplyBlocked:true,validStep:true}

  // A mode change and the geometries created under it must be restored together.
  await page.click('[aria-label="Chiudi Edit Surface"]');await open(input,5,7)
  await page.select('[data-test=surface-continuity]','G0');await ready()
  await page.mouse.click(...await project(poles[7],center,radius));await selected(1,1)
  const beforeModeMove=await info();await page.click('[data-test=surface-move]');await ready()
  const g0Moved=await info();assert(Math.abs(g0Moved.volume-beforeModeMove.volume)>0.01)
  await page.select('[data-test=surface-continuity]','G1')
  assert.equal(await mode(),'G0');assert.match((await info()).text,/Ripristina prima/)
  await clickUndo();await ready();assert.equal(await mode(),'G0')
  assert(Math.abs((await info()).volume-beforeModeMove.volume)<1e-6)
  await clickUndo();await ready();assert.equal(await mode(),'G1')
  await clickRedo();await ready();assert.equal(await mode(),'G0')
  await clickRedo();await ready();assert.equal(await mode(),'G0')
  assert(Math.abs((await info()).volume-g0Moved.volume)<1e-6)
  result.continuity={g0MoveVolume:g0Moved.volume,protectedG1Refused:true,modeAndShapeUndoRedo:true}

  // A failed load must never allow Ctrl+Z to resurrect a different worker document.
  await clickText('Blocca punti');await selected(1,0)
  await page.evaluate(()=>{
    const post=Worker.prototype.postMessage;window.evaluationCount=0;window.invalidateNextOpen=true
    Worker.prototype.postMessage=function(message,...rest){
      if(message?.action==='evaluate')window.evaluationCount++
      if(window.invalidateNextOpen && message?.action==='open'){window.invalidateNextOpen=false;return post.call(this,{...message,step:'not a STEP file'},...rest)}
      return post.call(this,message,...rest)
    }
  })
  page.once('dialog',dialog=>dialog.accept())
  await clickText('Cambia faccia / corpo')
  await page.waitForFunction(()=>!window.invalidateNextOpen && document.querySelector('[data-test=surface-step-file]') && document.querySelector('[data-test=surface-status]')?.textContent && !document.querySelector('[data-test=surface-status]').textContent.includes('Elaborazione'),{timeout:60000})
  const failureText=(await info()).text
  assert(!failureText.includes('ultimo risultato valido'),'A failed load with no preview must not claim one is visible')
  await page.evaluate(()=>{window.evaluationCount=0})
  await chord('z');await chord('y')
  await new Promise(r=>setTimeout(r,250))
  assert.equal(await page.$('[data-test=surface-selection]'),null)
  assert(await page.$eval('[data-test=surface-apply]',e=>e.disabled))
  assert.equal(await page.evaluate(()=>window.evaluationCount),0,'Stale history must not trigger CAD evaluation')
  result.failedLoad={message:failureText,oldHistoryNotRestored:true,staleEvaluations:0}

  // Free-boundary mode, manual locks and the moved edge return in the right order.
  await (await page.$('[data-test=surface-step-file]')).uploadFile(sheet)
  await page.waitForFunction(()=>document.querySelectorAll('[data-test=surface-face] option').length===2,{timeout:60000})
  await page.select('[data-test=surface-face]','0');await ready()
  assert(await page.$eval('[data-test=surface-undo]',e=>e.disabled),'A new STEP must start with empty history')
  await selected(0,0)
  await page.click('[data-test=surface-free-boundary]');await ready()
  await page.select('[data-test=surface-selection-mode]','edges')
  await page.mouse.click(...await project(new Vector3(20,10,10),new Vector3(10,15,10),Math.hypot(20,30)/2));await selected(2,2)
  await clickText('Blocca punti');await selected(2,0)
  await clickUndo();await selected(2,2);await clickRedo();await selected(2,0);await clickUndo();await selected(2,2)
  await page.click('[data-test=surface-move]');await ready()
  const edgeMoved=await info();assert.match(edgeMoved.text,/spostamento bordo/)
  await page.click('[data-test=surface-free-boundary]')
  assert(await page.$eval('[data-test=surface-free-boundary]',e=>e.checked));assert.match((await info()).text,/Annulla prima/)
  await clickUndo();await ready();assert(await page.$eval('[data-test=surface-free-boundary]',e=>e.checked))
  await clickUndo();await ready();assert(!(await page.$eval('[data-test=surface-free-boundary]',e=>e.checked)))
  await clickRedo();await ready();assert(await page.$eval('[data-test=surface-free-boundary]',e=>e.checked))
  await clickRedo();await ready();assert.equal((await info()).text,edgeMoved.text)
  const editedSheet=k.importStep(await exported()), sheetFaces=k.getSubShapes(editedSheet,'face'), sheetSolids=k.getSubShapes(editedSheet,'solid')
  try{assert(k.isValid(editedSheet));assert.equal(sheetFaces.length,1);assert.equal(sheetSolids.length,0);assert(k.getBoundingBox(editedSheet).zmax>10.1)}
  finally{sheetFaces.forEach(f=>k.release(f));sheetSolids.forEach(s=>k.release(s));k.release(editedSheet)}
  await page.screenshot({path:join(out,'free-boundary-history.png')})
  result.freeBoundary={edgeMoved:edgeMoved.text,lockUndoRedo:true,modeAndGeometryUndoRedo:true,validStep:true}
  await clickText('Blocca punti');await selected(2,0)
  await page.evaluate(()=>{window.invalidateNextOpen=true})
  page.once('dialog',dialog=>dialog.accept());await clickText('Cambia faccia / corpo')
  await page.waitForFunction(()=>!window.invalidateNextOpen && document.querySelector('[data-test=surface-step-file]') && !document.querySelector('[data-test=surface-status]')?.textContent.includes('Elaborazione'),{timeout:60000})
  await page.evaluate(()=>{window.evaluationCount=0});await chord('z');await chord('y');await new Promise(r=>setTimeout(r,250))
  assert.equal(await page.$('[data-test=surface-selection]'),null)
  assert(await page.$eval('[data-test=surface-apply]',e=>e.disabled));assert.equal(await page.evaluate(()=>window.evaluationCount),0)
  result.failedFreeBoundaryLoad={oldHistoryNotRestored:true,staleEvaluations:0}
  assert.deepEqual(consoleErrors,[]);result={pass:true,...result,consoleErrors}
  writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({out,...result}))
}catch(error){writeFileSync(join(out,'failure.json'),JSON.stringify({error:String(error),stack:error.stack,result,consoleErrors},null,2));await page.screenshot({path:join(out,'failure.png')});throw error}
finally{await browser.close();k[Symbol.dispose]()}
