// SPDX-License-Identifier: AGPL-3.0-only
// A real host mutation while the separate editor worker is opening a STEP.
import { launchApp } from '../../../scripts/e2e-lib.mjs'
import { OcctKernel } from 'occt-wasm'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'

assert(process.env.APP_URL, 'Supply the isolated development APP_URL')
const legacy=process.argv.includes('--legacy-mismatch')
const root=resolve('plugins/tmar-edit-surface/evidence/current-source')
mkdirSync(root,{recursive:true})
const out=mkdtempSync(join(root,'run-'))
const kernel=await OcctKernel.init(), box=kernel.makeBox(20,30,10), faces=kernel.getSubShapes(box,'face')
const sheet=kernel.exportStep(faces[5]);faces.forEach(f=>kernel.release(f));kernel.release(box)
const {browser,page,consoleErrors}=await launchApp({url:process.env.APP_URL,width:1440,height:1000,agentDataOk:false,userDataDir:mkdtempSync(join(tmpdir(),'edit-surface-source-'))})
try {
  await page.click('[data-test=workspace-reverse]')
  await page.waitForFunction(()=>window.__re?.store.getState().kernelStatus==='ready',{timeout:60000})
  const bodyId=await page.evaluate(async ({step,legacy})=>{
    const {listCommands,runCommand}=await import('/src/commands/registry.ts')
    const available=listCommands().some(c=>c.name==='reverse.body.edit_source')
    if(available===legacy)throw Error('The selected host does not match the intended test')
    await runCommand('reverse.import.step',{name:'Sheet.step',bytes:new TextEncoder().encode(step)})
    return window.__re.store.getState().bodies[0].id
  },{step:sheet,legacy})
  if(legacy){
    // Simulate a corrupted saved resource while keeping the same feature and
    // face count. A different but valid planar STEP must not be trusted.
    const other=kernel.makeBox(25,30,10), otherFaces=kernel.getSubShapes(other,'face')
    const altered=kernel.exportStep(otherFaces[5]);otherFaces.forEach(f=>kernel.release(f));kernel.release(other)
    await page.evaluate(async step=>{
      const {useReverse}=await import('/plugins/reverse/state/reStore.ts')
      const state=useReverse.getState(), feature=state.features.find(f=>f.kind==='import')
      useReverse.setState({stepFiles:{...state.stepFiles,[feature.file.key]:step}})
    },altered)
    await page.click('[data-test=edit-surface-entry] button')
    await page.click('[data-test=surface-load-body]')
    await page.waitForFunction(()=>document.querySelector('[data-test=surface-status]')?.textContent.includes('non corrisponde al riferimento'),{timeout:60000})
    assert.equal(await page.$$eval('[data-test=surface-face] option',options=>options.length),1)
    assert.deepEqual(consoleErrors,[])
    writeFileSync(join(out,'result.json'),JSON.stringify({pass:true,legacy:true,alteredStepRefused:true,emptyFaceList:true,consoleErrors},null,2))
    await page.screenshot({path:join(out,'refused-corrupt-source.png')})
    console.log(JSON.stringify({out,legacy:true,alteredStepRefused:true,consoleErrors}))
  } else {
  await page.evaluate(()=>{
    const original=Worker.prototype.postMessage
    window.holdEditorOpen=true
    Worker.prototype.postMessage=function(message,...rest){
      if(window.holdEditorOpen && message?.action==='open'){
        const worker=this
        window.releaseEditorOpen=()=>{window.holdEditorOpen=false;original.call(worker,message,...rest)}
      }else original.call(this,message,...rest)
    }
  })
  await page.click('[data-test=edit-surface-entry] button')
  await page.click('[data-test=surface-load-body]')
  await page.waitForFunction(()=>typeof window.releaseEditorOpen==='function',{timeout:60000})
  const moved=await page.evaluate(async body=>{
    const {runCommand}=await import('/src/commands/registry.ts')
    await runCommand('reverse.feature.add',{feature:{kind:'moveBody',bodies:[body],translate:[40,0,0]}})
    return window.__re.store.getState().bodies.find(b=>b.id===body).box
  },bodyId)
  assert(Math.abs(moved.min[0]-40)<1e-6)
  await page.evaluate(()=>window.releaseEditorOpen())
  await page.waitForFunction(()=>document.querySelector('[data-test=surface-status]')?.textContent.includes('Il progetto è cambiato'),{timeout:60000})
  assert.equal(await page.$$eval('[data-test=surface-face] option',options=>options.length),1)
  assert.equal(await page.$eval('[data-test=surface-load-body]',e=>e.disabled),false)
  await page.screenshot({path:join(out,'refused-stale-source.png')})
  await page.click('[aria-label="Chiudi Edit Surface"]')
  await page.click('[data-test=edit-surface-entry] button')
  await page.click('[data-test=surface-load-body]')
  await page.waitForFunction(()=>document.querySelectorAll('[data-test=surface-face] option').length===2,{timeout:60000})
  await page.select('[data-test=surface-face]','0')
  await page.waitForSelector('[data-test=strip-open]:enabled')
  const exported=page.evaluate(()=>new Promise((resolve,reject)=>{
    const handler=e=>{
      if(!(e.target instanceof HTMLAnchorElement) || !e.target.download.endsWith('.step'))return
      e.preventDefault();document.removeEventListener('click',handler,true)
      fetch(e.target.href).then(r=>r.text()).then(resolve,reject)
    }
    document.addEventListener('click',handler,true)
  }))
  for(const button of await page.$$('.es-dialog button')) if(await button.evaluate(e=>e.textContent==='Esporta STEP…')){await button.click();break}
  const step=await exported, shape=kernel.importStep(step)
  try {
    const bounds=kernel.getBoundingBox(shape)
    assert(kernel.isValid(shape));assert(Math.abs(bounds.xmin-40)<1e-6);assert(Math.abs(bounds.xmax-60)<1e-6)
    writeFileSync(join(out,'retry-moved.step'),step)
    assert.deepEqual(consoleErrors,[])
    writeFileSync(join(out,'result.json'),JSON.stringify({pass:true,heldWorkerOpen:true,actualMove:[40,0,0],staleRefused:true,emptyFaceList:true,retryBounds:bounds,consoleErrors},null,2))
    console.log(JSON.stringify({out,staleRefused:true,retryBounds:bounds,consoleErrors}))
  }finally{kernel.release(shape)}
  }
}catch(error){
  writeFileSync(join(out,'failure.json'),JSON.stringify({error:String(error),stack:error.stack,consoleErrors},null,2))
  await page.screenshot({path:join(out,'failure.png')});throw error
}finally{await browser.close();kernel[Symbol.dispose]()}
