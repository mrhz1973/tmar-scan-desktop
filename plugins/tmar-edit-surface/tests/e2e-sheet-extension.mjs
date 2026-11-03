// SPDX-License-Identifier: AGPL-3.0-only
import {launchApp} from '../../../scripts/e2e-lib.mjs'
import {OcctKernel} from 'occt-wasm'
import {PerspectiveCamera,Vector3} from 'three'
import {join,resolve} from 'node:path'
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs'
import assert from 'node:assert/strict'
const project=process.argv.includes('--project')
const moved=process.argv.includes('--moved')
const hostSource=process.argv.includes('--host-source')
const chain=project || process.argv.includes('--chain')
const direct=process.argv.includes('--direct')
const cancelFirst=process.argv.includes('--cancel')
const pending=process.argv.includes('--pending')
const reject=process.argv.includes('--reject')
assert(!cancelFirst || direct, '--cancel requires --direct')
assert(!reject || (direct && !pending), '--reject requires --direct without --pending')
assert(!moved || (project && hostSource), '--moved requires --project --host-source')
const k=await OcctKernel.init(),box=k.makeBox(20,30,10),fs=k.getSubShapes(box,'face')
const root=resolve('plugins/tmar-edit-surface/evidence/duplicate-edge');mkdirSync(root,{recursive:true})
const out=mkdtempSync(join(root,'run-')), input=join(out,'sheet.step')
writeFileSync(input,k.exportStep(fs[5]));fs.forEach(f=>k.release(f));k.release(box)
const {browser,page,consoleErrors}=await launchApp({url:process.env.APP_URL,width:1440,height:1000})
try {
  await page.click('[data-test=workspace-reverse]')
  await page.waitForSelector('[data-test=edit-surface-entry] button')
  if(project)await page.waitForFunction(()=>window.__re?.store.getState().kernelStatus==='ready',{timeout:60000})
  if(project)await page.evaluate(async ({step,moved,hostSource})=>{
    const {runCommand,listCommands}=await import('/src/commands/registry.ts')
    if(hostSource && !listCommands().some(c=>c.name==='reverse.body.edit_source')) throw Error('Current CAD source command is absent')
    await runCommand('reverse.import.step',{bytes:new TextEncoder().encode(step),name:'Original sheet.step'})
    if(moved) {
      const body=window.__re.store.getState().bodies[0].id
      await runCommand('reverse.feature.add',{feature:{kind:'moveBody',bodies:[body],translate:[40,0,0]}})
    }
  },{step:readFileSync(input,'utf8'),moved,hostSource})
  await page.click('[data-test=edit-surface-entry] button')
  if(project) await page.click('[data-test=surface-load-body]')
  else await (await page.$('[data-test=surface-step-file]')).uploadFile(input)
  await page.waitForFunction(()=>document.querySelectorAll('[data-test=surface-face] option').length===2)
  await page.select('[data-test=surface-face]','0');await page.waitForFunction(()=>document.querySelector('[data-test=strip-open]')?.disabled===false)
  if(direct) {
    await page.click('[data-test=surface-axis-0]')
    await page.waitForFunction(()=>Number(document.querySelector('[data-test=edit-surface-viewport]')?.dataset.directEdges)>0)
  } else {
    await page.click('[data-test=strip-open]');await page.waitForSelector('[data-test=strip-axis-0]');await page.click('[data-test=strip-axis-0]')
  }
  const r=await page.$eval('[data-test=edit-surface-viewport]',e=>e.getBoundingClientRect().toJSON())
  const offset=moved?40:0
  const rad=Math.hypot(20,30)/2, c=new Vector3(10+offset,15,10),camera=new PerspectiveCamera(40,r.width/r.height,rad/1000,rad*100)
  camera.position.copy(c).addScaledVector(new Vector3(1.5,-1.9,1.8),rad);camera.up.set(0,0,1);camera.lookAt(c);camera.updateMatrixWorld()
  const xy=(x,z=10)=>{const q=new Vector3(x+offset,15,z).project(camera);return[r.x+(1+q.x)*r.width/2,r.y+(1-q.y)*r.height/2]}
  if(pending)await page.evaluate(()=>{
    const original=Worker.prototype.postMessage
    window.stripCalls=0;window.heldStrip=null;window.holdStrip=true
    Worker.prototype.postMessage=function(message,...rest){
      if(message?.action==='duplicateSheetEdge'){
        window.stripCalls++
        if(window.holdStrip){window.heldStrip={worker:this,message,rest};return}
      }
      return original.call(this,message,...rest)
    }
    window.releaseStrip=()=>{const h=window.heldStrip;window.holdStrip=false;original.call(h.worker,h.message,...h.rest)}
  })
  if(reject)await page.evaluate(()=>{
    const original=Worker.prototype.postMessage
    window.rejectNextStrip=true
    Worker.prototype.postMessage=function(message,...rest){
      if(window.rejectNextStrip && message?.action==='duplicateSheetEdge'){
        window.rejectNextStrip=false
        return original.call(this,{...message,delta:[0,0,0]},...rest)
      }
      return original.call(this,message,...rest)
    }
  })
  if(direct) {
    const selectHandle=async()=>{
      await page.waitForFunction(()=>Number(document.querySelector('[data-test=edit-surface-viewport]')?.dataset.directEdges)>0)
      await page.mouse.click(...xy(20));await page.waitForSelector('[data-test=strip-direct-handle]',{visible:true})
      const h=await page.$eval('[data-test=strip-direct-handle]',e=>e.getBoundingClientRect().toJSON())
      return [h.x+h.width/2,h.y+h.height/2]
    }
    const restored=async()=>{
      await page.waitForSelector('[data-test=surface-axis-0]')
      assert.equal(await page.$('[data-test=strip-export]'),null,'An aborted D gesture must return to the face editor')
      if(pending)assert.equal(await page.evaluate(()=>window.stripCalls),0)
    }
    let start=await selectHandle(),a=xy(20),b=xy(25)
    if(await page.$('[data-test=surface-zebra]')){
      await page.click('[data-test=surface-zebra]');await page.click('[data-test=surface-note-add]')
      assert.equal(await page.$('[data-test=strip-direct-handle]'),null,'D must not intercept note placement')
      await page.click('[data-test=surface-note-add]');await page.click('[data-test=surface-zebra]')
      start=await selectHandle()
    }
    await page.mouse.click(...start);await restored()
    if(cancelFirst) {
      start=await selectHandle()
      await page.mouse.move(...start);await page.mouse.down()
      await page.mouse.move(start[0]+b[0]-a[0],start[1]+b[1]-a[1],{steps:8})
      await page.waitForFunction(()=>document.querySelector('[data-test=strip-result]')?.textContent==='Anteprima striscia')
      await page.$eval('[data-test=edit-surface-viewport]',div=>div.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:1,pointerType:'mouse'})))
      await page.mouse.up();await restored()
    }
    start=await selectHandle()
    await page.screenshot({path:join(out,'direct-handle.png')})
    await page.mouse.move(...start);await page.mouse.down()
    await page.mouse.move(start[0]+b[0]-a[0],start[1]+b[1]-a[1],{steps:8})
    await page.waitForFunction(()=>document.querySelector('[data-test=strip-result]')?.textContent==='Anteprima striscia')
    await page.screenshot({path:join(out,'direct-preview.png')});await page.mouse.up()
  } else {
    await page.mouse.move(...xy(20));await page.mouse.down();await page.mouse.move(...xy(25),{steps:8});await page.mouse.up()
  }
  if(reject) {
    await page.waitForFunction(()=>document.querySelector('[data-test=surface-status]')?.textContent.includes('diverso da zero'))
    assert(await page.$eval('[data-test=strip-export]',e=>e.disabled))
    assert(await page.$eval('[data-test=strip-undo]',e=>e.disabled))
    await page.mouse.move(...xy(20));await page.mouse.down();await page.mouse.move(...xy(25),{steps:8});await page.mouse.up()
  }
  if(pending) {
    await page.waitForFunction(()=>window.heldStrip!==null)
    assert(await page.$eval('[data-test=strip-undo]',e=>e.disabled))
    await page.mouse.move(...xy(20));await page.mouse.down();await page.mouse.move(...xy(25),{steps:5});await page.mouse.up()
    assert.equal(await page.evaluate(()=>window.stripCalls),1,'A pending operation must block a second drag')
    await page.evaluate(()=>window.releaseStrip())
  }
  await page.waitForFunction(()=>document.querySelector('[data-test=strip-export]')?.disabled===false)
  const accepted=await page.$eval('[data-test=strip-result]',e=>e.textContent)
  await page.click('[data-test=strip-undo]')
  assert(await page.$eval('[data-test=strip-export]',e=>e.disabled))
  await page.click('[data-test=strip-redo]')
  assert.equal(await page.$eval('[data-test=strip-result]',e=>e.textContent),accepted)
  if(chain){
    await page.click('[data-test=strip-axis-2]')
    await page.mouse.move(...xy(25));await page.mouse.down()
    await page.mouse.move(...xy(25,14),{steps:8});await page.mouse.up()
    await page.waitForFunction(()=>document.querySelector('[data-test=surface-status]')?.textContent.includes('3 facce cucite'))
    await page.click('[data-test=strip-undo]')
    assert.equal(await page.$eval('[data-test=strip-result]',e=>e.textContent),accepted)
    assert.match(await page.$eval('[data-test=surface-status]',e=>e.textContent),/2 facce cucite/)
    await page.click('[data-test=strip-redo]')
    assert.match(await page.$eval('[data-test=surface-status]',e=>e.textContent),/3 facce cucite/)
  }
  await page.screenshot({path:join(out,'dragged-strip.png')})
  await page.evaluate(()=>document.addEventListener('click',e=>{
    if(e.target instanceof HTMLAnchorElement && e.target.download.endsWith('.step')){
      e.preventDefault();window.file=fetch(e.target.href).then(r=>r.text())
    }
  },true))
  await page.click('[data-test=strip-export]');await page.waitForFunction(()=>!!window.file)
  const step=await page.evaluate(()=>window.file);writeFileSync(join(out,'extended.step'),step)
  const shape=k.importStep(step), faces=k.getSubShapes(shape,'face')
  try{
    assert(k.isValid(shape));assert.equal(faces.length,chain?3:2)
    const bounds=k.getBoundingBox(shape)
    assert(Math.abs(bounds.xmin-offset)<1e-6, 'Editor must use the current placed CAD, including Move body')
    const areas=faces.map(f=>k.getSurfaceArea(f)).sort((a,b)=>a-b)
    assert(Math.abs(areas.at(-1)-600)<1e-7)
    assert(Math.abs(areas.at(-2)-150)<2)
    if(chain)assert(Math.abs(areas[0]-120)<2)
    const edgeLists=faces.map(f=>k.getSubShapes(f,'edge'))
    let sharedEdges=0
    try {
      edgeLists.forEach((edges,i)=>edgeLists.slice(i+1).forEach(other=>{
        sharedEdges+=edges.filter(x=>other.some(y=>k.isSame(x,y))).length
      }))
    } finally {edgeLists.flat().forEach(e=>k.release(e))}
    assert.equal(sharedEdges,chain?2:1)
    let projectResult
    if(project){
      const bodyCount=(p,count)=>p.waitForFunction(n=>window.__re?.store.getState().bodies.length===n &&
        !document.querySelector('[data-test=edit-surface-dialog]') && !window.__re.store.getState().building,{timeout:30000},count)
      await page.click('[data-test=surface-apply]');await bodyCount(page,2)
      await page.waitForSelector('[data-test=undo]:enabled')
      await page.click('[data-test=undo]')
      await bodyCount(page,1)
      await page.waitForSelector('[data-test=redo]:enabled')
      await page.click('[data-test=redo]')
      await bodyCount(page,2)
      await page.evaluate(()=>document.addEventListener('click',e=>{
        if(e.target instanceof HTMLAnchorElement && e.target.download.endsWith('.scanruler')){
          e.preventDefault();window.savedProject=fetch(e.target.href).then(r=>r.arrayBuffer()).then(b=>Array.from(new Uint8Array(b)))
        }
      },true))
      await page.click('[data-test=save-project]');await page.waitForFunction(()=>!!window.savedProject)
      const file=join(out,'extended-sheet.scanruler')
      writeFileSync(file,Buffer.from(await page.evaluate(()=>window.savedProject)))
      const reopened=await browser.newPage()
      try{
        reopened.on('pageerror',e=>consoleErrors.push(e.message))
        await reopened.goto(process.env.APP_URL)
        await reopened.waitForSelector('[data-test=project-input]')
        await (await reopened.$('[data-test=project-input]')).uploadFile(file)
        await reopened.click('[data-test=workspace-reverse]');await bodyCount(reopened,2)
        const restored=await reopened.evaluate(()=>{
          const {features,stepFiles,bodies}=window.__re.store.getState()
          if(bodies.length!==2 || !bodies.every(b=>b.surface))throw Error('Expected two restored CAD sheets')
          return features.filter(f=>f.kind==='import').map(f=>stepFiles[f.file.key])
        })
        const measured=restored.map(text=>{
          const body=k.importStep(text), surfaces=k.getSubShapes(body,'face'), solids=k.getSubShapes(body,'solid')
          try{
            assert(k.isValid(body));assert.equal(solids.length,0)
            return surfaces.map(s=>k.getSurfaceArea(s)).sort((a,b)=>a-b)
          }finally{[...surfaces,...solids,body].forEach(h=>k.release(h))}
        }).sort((a,b)=>a.length-b.length)
        assert.deepEqual(measured.map(xs=>xs.length),[1,3]);assert(Math.abs(measured[0][0]-600)<1e-7)
        for(let i=0;i<areas.length;i++)assert(Math.abs(measured[1][i]-areas[i])<1e-6)
        await reopened.click('[data-test=edit-surface-entry] button')
        const copyId=await reopened.evaluate(()=>window.__re.store.getState().bodies.find(b=>b.faces===3).id)
        await reopened.select('[data-test=surface-body]',String(copyId))
        await reopened.click('[data-test=surface-load-body]')
        await reopened.waitForFunction(()=>document.querySelectorAll('[data-test=surface-face] option').length===4)
        await reopened.select('[data-test=surface-face]','0')
        await reopened.waitForSelector('[data-test=strip-open]:enabled')
        projectResult={sourceLoadedFromProject:true,hostSource,moved,exportXmin:bounds.xmin,reopenedEditableFaces:3,toolbarUndoEnabled:true,toolbarRedoEnabled:true,undoBodyCount:1,redoBodyCount:2,reopenedBodyAreas:measured}
      }finally{await reopened.close()}
    }
    assert.deepEqual(consoleErrors,[])
    console.log(out,areas)
    writeFileSync(join(out,'result.json'),JSON.stringify({valid:true,areas,sharedEdges,chain,direct,cancelFirst,pending,reject,consoleErrors,projectResult}))
  }finally{faces.forEach(f=>k.release(f));k.release(shape)}
}catch(error){console.error('Edit Surface QA:',error,await page.evaluate(()=>({kernel:window.__re?.store.getState().kernelStatus,bodies:window.__re?.store.getState().bodies.length,status:document.querySelector('[data-test=surface-status]')?.textContent,dialog:document.querySelector('.es-dialog')?.innerText?.slice(-900)})));throw error}finally{await browser.close();k[Symbol.dispose]()}
