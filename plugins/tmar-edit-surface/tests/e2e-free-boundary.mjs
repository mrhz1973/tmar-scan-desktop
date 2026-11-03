// SPDX-License-Identifier: AGPL-3.0-only
// Actual pointer drag and independent STEP readback of a free sheet edge.
import { launchApp } from '../../../scripts/e2e-lib.mjs'
import { OcctKernel } from 'occt-wasm'
import { PerspectiveCamera,Vector3 } from 'three'
import { mkdirSync,mkdtempSync,readFileSync,writeFileSync } from 'node:fs'
import { join,resolve } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'

assert(process.env.APP_URL,'Supply an isolated application URL')
const project=process.argv.includes('--project')
const root=resolve('plugins/tmar-edit-surface/evidence/free-boundary');mkdirSync(root,{recursive:true})
const out=mkdtempSync(join(root,'run-')), kernel=await OcctKernel.init()
const box=kernel.makeBox(20,30,10), boxFaces=kernel.getSubShapes(box,'face')
const input=join(out,'original.step');writeFileSync(input,kernel.exportStep(boxFaces[5]));boxFaces.forEach(f=>kernel.release(f));kernel.release(box)
const {browser,page,consoleErrors}=await launchApp({url:process.env.APP_URL,width:1440,height:1000,agentDataOk:false,userDataDir:mkdtempSync(join(tmpdir(),'edit-surface-free-'))})
try{
  await page.click('[data-test=workspace-reverse]')
  await page.waitForSelector('[data-test=edit-surface-entry] button:enabled',{timeout:60000})
  if(project){
    await page.waitForFunction(()=>window.__re?.store.getState().kernelStatus==='ready',{timeout:60000})
    await page.evaluate(async step=>{
      const {runCommand}=await import('/src/commands/registry.ts')
      await runCommand('reverse.import.step',{bytes:new TextEncoder().encode(step),name:'Original sheet.step'})
    },readFileSync(input,'utf8'))
  }
  await page.click('[data-test=edit-surface-entry] button')
  if(project) await page.click('[data-test=surface-load-body]')
  else await (await page.$('[data-test=surface-step-file]')).uploadFile(input)
  await page.waitForFunction(()=>document.querySelectorAll('[data-test=surface-face] option').length===2,{timeout:60000})
  await page.select('[data-test=surface-face]','0')
  await page.waitForSelector('[data-test=surface-free-boundary]:enabled',{timeout:60000})
  await page.waitForFunction(()=>document.querySelector('[data-test=surface-status]')?.textContent.includes('CAD valido') && !document.querySelector('[data-test=surface-free-boundary]').disabled,{timeout:60000})
  await page.click('[data-test=surface-free-boundary]')
  await page.waitForFunction(()=>document.querySelector('[data-test=surface-free-boundary]')?.checked,{timeout:60000})
  await page.waitForFunction(()=>document.querySelector('[data-test=surface-status]')?.textContent.includes('spostamento bordo'),{timeout:60000})
  await page.select('[data-test=surface-selection-mode]','edges')
  const rect=await page.$eval('[data-test=edit-surface-viewport]',e=>e.getBoundingClientRect().toJSON())
  const radius=Math.hypot(20,30)/2, center=new Vector3(10,15,10)
  const camera=new PerspectiveCamera(40,rect.width/rect.height,radius/1000,radius*100)
  camera.position.copy(center).addScaledVector(new Vector3(1.5,-1.9,1.8),radius);camera.up.set(0,0,1);camera.lookAt(center);camera.updateMatrixWorld()
  const xy=(x,y,z)=>{const p=new Vector3(x,y,z).project(camera);return[rect.x+(1+p.x)*rect.width/2,rect.y+(1-p.y)*rect.height/2]}
  const start=xy(20,10,10), end=xy(20,10,12)
  await page.mouse.click(...start)
  await page.waitForFunction(()=>document.querySelector('[data-test=surface-selection]')?.textContent.includes('2 selezionati · 2 modificabili'))
  const clickText=async text=>{for(const b of await page.$$('.es-dialog button'))if(await b.evaluate((e,t)=>e.textContent===t,text)){await b.click();return}throw Error('Missing button '+text)}
  await clickText('Blocca punti')
  await page.waitForFunction(()=>document.querySelector('[data-test=surface-selection]')?.textContent.includes('2 selezionati · 0 modificabili'))
  await clickText('Sblocca punti')
  await page.mouse.move(...start);await page.mouse.down();await page.mouse.move(...end,{steps:10});await page.mouse.up()
  await page.waitForFunction(()=>{
    const status=document.querySelector('[data-test=surface-status]')?.textContent
    const displacement=Number(status?.match(/spostamento bordo ([\d.e+-]+) mm/)?.[1])
    return status?.includes('CAD valido') && Number.isFinite(displacement) && displacement>0.01
  },{timeout:60000})
  const movedStatus=await page.$eval('[data-test=surface-status]',e=>e.textContent)
  await page.screenshot({path:join(out,'moved-edge.png')})
  const exported=page.evaluate(()=>new Promise((resolve,reject)=>{
    const handler=e=>{
      if(!(e.target instanceof HTMLAnchorElement) || !e.target.download.endsWith('.step'))return
      e.preventDefault();document.removeEventListener('click',handler,true)
      fetch(e.target.href).then(r=>r.text()).then(resolve,reject)
    }
    document.addEventListener('click',handler,true)
  }))
  await clickText('Esporta STEP…')
  const text=await exported, shape=kernel.importStep(text), faces=kernel.getSubShapes(shape,'face'), solids=kernel.getSubShapes(shape,'solid')
  try{
    assert(kernel.isValid(shape));assert.equal(faces.length,1);assert.equal(solids.length,0)
    assert.equal(kernel.surfaceType(faces[0]),'bspline')
    const bounds=kernel.getBoundingBox(shape)
    assert(bounds.zmax>10.2,'The selected free boundary moved in Z')
    writeFileSync(join(out,'moved.step'),text)
    await page.click('[data-test=surface-free-boundary]')
    await page.waitForFunction(()=>document.querySelector('[data-test=surface-status]')?.textContent.includes('Annulla prima gli spostamenti'))
    assert(await page.$eval('[data-test=surface-free-boundary]',e=>e.checked))
    await page.click('[data-test=surface-undo]')
    await page.waitForFunction(()=>{
      const status=document.querySelector('[data-test=surface-status]')?.textContent
      const displacement=Number(status?.match(/spostamento bordo ([\d.e+-]+) mm/)?.[1])
      return status?.includes('CAD valido') && Number.isFinite(displacement) && displacement<1e-9
    },{timeout:60000})
    await page.click('[data-test=surface-redo]')
    await page.waitForFunction(s=>document.querySelector('[data-test=surface-status]')?.textContent===s,{timeout:60000},movedStatus)
    let projectResult
    if(project){
      const bodyCount=(p,count)=>p.waitForFunction(n=>window.__re?.store.getState().bodies.length===n &&
        !document.querySelector('[data-test=edit-surface-dialog]') && !window.__re.store.getState().building,{timeout:60000},count)
      await page.click('[data-test=surface-apply]');await bodyCount(page,2)
      await page.waitForSelector('[data-test=undo]:enabled');await page.click('[data-test=undo]');await bodyCount(page,1)
      await page.waitForSelector('[data-test=redo]:enabled');await page.click('[data-test=redo]');await bodyCount(page,2)
      await page.evaluate(()=>document.addEventListener('click',e=>{
        if(e.target instanceof HTMLAnchorElement && e.target.download.endsWith('.scanruler')){
          e.preventDefault();window.savedProject=fetch(e.target.href).then(r=>r.arrayBuffer()).then(b=>Array.from(new Uint8Array(b)))
        }
      },true))
      await page.click('[data-test=save-project]');await page.waitForFunction(()=>!!window.savedProject)
      const projectFile=join(out,'free-boundary.scanruler')
      writeFileSync(projectFile,Buffer.from(await page.evaluate(()=>window.savedProject)))
      const reopened=await browser.newPage()
      try{
        reopened.on('pageerror',e=>consoleErrors.push(e.message))
        await reopened.goto(process.env.APP_URL);await reopened.waitForSelector('[data-test=project-input]')
        await (await reopened.$('[data-test=project-input]')).uploadFile(projectFile)
        await reopened.click('[data-test=workspace-reverse]');await bodyCount(reopened,2)
        const restored=await reopened.evaluate(()=>{
          const {features,stepFiles,bodies}=window.__re.store.getState()
          if(bodies.length!==2 || !bodies.every(b=>b.surface))throw Error('Expected two restored CAD sheets')
          return features.filter(f=>f.kind==='import').map(f=>stepFiles[f.file.key])
        })
        const readbacks=restored.map(source=>{
          const body=kernel.importStep(source), surfaces=kernel.getSubShapes(body,'face'), solids=kernel.getSubShapes(body,'solid')
          try{
            assert(kernel.isValid(body));assert.equal(surfaces.length,1);assert.equal(solids.length,0)
            return kernel.getBoundingBox(body).zmax
          }finally{[...surfaces,...solids,body].forEach(h=>kernel.release(h))}
        }).sort((a,b)=>a-b)
        assert(Math.abs(readbacks[0]-10)<1e-5);assert(Math.abs(readbacks[1]-bounds.zmax)<1e-5)
        await reopened.click('[data-test=edit-surface-entry] button')
        const editedId=await reopened.evaluate(()=>window.__re.store.getState().bodies.at(-1).id)
        await reopened.select('[data-test=surface-body]',String(editedId));await reopened.click('[data-test=surface-load-body]')
        await reopened.waitForFunction(()=>document.querySelectorAll('[data-test=surface-face] option').length===2,{timeout:60000})
        await reopened.select('[data-test=surface-face]','0')
        await reopened.waitForSelector('[data-test=surface-free-boundary]:enabled',{timeout:60000})
        projectResult={hostApply:true,undoBodyCount:1,redoBodyCount:2,reopenedBodyCount:2,zmax:readbacks,reopenedEditable:true}
      }finally{await reopened.close()}
    }
    assert.deepEqual(consoleErrors,[])
    writeFileSync(join(out,'result.json'),JSON.stringify({pass:true,actualPointerDrag:true,lockedPoles:true,undoRedo:true,closedSolidCount:solids.length,faceCount:faces.length,surface:'bspline',bounds,movedStatus,projectResult,consoleErrors},null,2))
    console.log(JSON.stringify({out,bounds,movedStatus,projectResult,consoleErrors}))
  }finally{[...faces,...solids,shape].forEach(h=>kernel.release(h))}
}catch(error){writeFileSync(join(out,'failure.json'),JSON.stringify({error:String(error),stack:error.stack,consoleErrors},null,2));await page.screenshot({path:join(out,'failure.png')});throw error}
finally{await browser.close();kernel[Symbol.dispose]()}
