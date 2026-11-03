// SPDX-License-Identifier: AGPL-3.0-only
// Observe actual validated CAD previews while the mouse remains held down.
import {launchApp} from '../../../scripts/e2e-lib.mjs'
import {PerspectiveCamera,Vector3} from 'three'
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import assert from 'node:assert/strict'
import {OcctKernel} from 'occt-wasm'

assert(process.env.APP_URL,'Supply an isolated application URL')
const root=resolve('plugins/tmar-edit-surface/evidence/live-preview');mkdirSync(root,{recursive:true})
const out=mkdtempSync(join(root,'run-'))
const {browser,page,consoleErrors}=await launchApp({url:process.env.APP_URL,width:1440,height:1000,agentDataOk:false})
const k=await OcctKernel.init()
let before=null,after=null,observed=[]
const snapshot=()=>page.$eval('[data-test=surface-status]',e=>({revision:Number(e.dataset.previewRevision),volume:Number(e.dataset.previewVolume),text:e.textContent}))
const ready=()=>page.waitForFunction(()=>document.querySelector('[data-test=surface-status]')?.textContent.includes('CAD valido')&&!document.querySelector('[data-test=surface-apply]')?.disabled,{timeout:60000})
try{
  await page.click('[data-test=workspace-reverse]');await page.waitForSelector('[data-test=edit-surface-entry] button:enabled',{timeout:60000})
  await page.click('[data-test=edit-surface-entry] button')
  await (await page.$('[data-test=surface-step-file]')).uploadFile(resolve('plugins/tmar-edit-surface/evidence/input-solid.step'))
  await page.waitForFunction(()=>document.querySelectorAll('[data-test=surface-face] option').length===7,{timeout:60000})
  await page.select('[data-test=surface-face]','5');await ready()
  before=await snapshot()
  const r=await page.$eval('[data-test=edit-surface-viewport]',e=>e.getBoundingClientRect().toJSON())
  const radius=Math.hypot(20,30,10)/2, center=new Vector3(10,15,5), camera=new PerspectiveCamera(40,r.width/r.height,radius/1000,radius*100)
  camera.position.copy(center).addScaledVector(new Vector3(1.5,-1.9,1.8),radius);camera.up.set(0,0,1);camera.lookAt(center);camera.updateMatrixWorld()
  const xy=z=>{const p=new Vector3(10,15,z).project(camera);return[r.x+(1+p.x)*r.width/2,r.y+(1-p.y)*r.height/2]}
  const start=xy(10), end=xy(13)
  await page.mouse.move(...start);await page.mouse.down()
  for(let i=1;i<=24;i++){
    await page.mouse.move(start[0]+(end[0]-start[0])*i/24,start[1]+(end[1]-start[1])*i/24)
    await new Promise(r=>setTimeout(r,50))
    observed.push(await snapshot())
  }
  await page.screenshot({path:join(out,'while-dragging.png')})
  await page.mouse.up();await ready()
  after=await snapshot()
  assert(Math.abs(after.volume-before.volume)>0.01,'The drag must change the CAD volume')
  const live=observed.filter(p=>p.revision>before.revision && Math.abs(p.volume-before.volume)>0.01)
  assert(live.length>0,'A validated CAD preview must update before the mouse is released')
  const exported=page.evaluate(()=>new Promise((resolve,reject)=>{
    const handler=e=>{if(e.target instanceof HTMLAnchorElement && e.target.download.endsWith('.step')){
      e.preventDefault();document.removeEventListener('click',handler,true);fetch(e.target.href).then(r=>r.text()).then(resolve,reject)
    }};document.addEventListener('click',handler,true)
  }))
  for(const b of await page.$$('.es-dialog button'))if(await b.evaluate(e=>e.textContent==='Esporta STEP…')){await b.click();break}
  const step=await exported, shape=k.importStep(step)
  try{assert(k.isValid(shape));assert(Math.abs(k.getVolume(shape)-after.volume)<1e-5)}finally{k.release(shape)}
  let race
  if(process.argv.includes('--race')){
    await page.click('[data-test=surface-undo]');await ready()
    assert(Math.abs((await snapshot()).volume-before.volume)<1e-5)
    await page.evaluate(()=>{
      const original=Worker.prototype.postMessage
      window.heldEvaluations=[];window.holdEvaluations=true
      Worker.prototype.postMessage=function(message,...rest){
        if(window.holdEvaluations && message?.action==='evaluate'){window.heldEvaluations.push({worker:this,message,rest});return}
        return original.call(this,message,...rest)
      }
      window.releaseEvaluation=()=>{
        const held=window.heldEvaluations.shift()
        if(!held)throw Error('No held evaluation')
        if(!window.oldEvaluationId){
          window.oldEvaluationId=held.message.id
          held.worker.addEventListener('message',e=>{if(e.data.id===window.oldEvaluationId)window.oldEvaluationReply=e.data})
        }
        original.call(held.worker,held.message,...held.rest)
      }
    })
    const distance=async value=>page.$eval('[data-test=surface-distance]',(e,v)=>{
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,String(v));e.dispatchEvent(new Event('input',{bubbles:true}))
    },value)
    await distance(-50);await page.click('[data-test=surface-move]')
    await page.waitForFunction(()=>window.heldEvaluations?.length===1,{timeout:60000})
    await distance(53);await page.click('[data-test=surface-move]')
    assert(await page.$eval('[data-test=surface-apply]',e=>e.disabled),'Apply must stay disabled while geometry is pending')
    await page.evaluate(()=>window.releaseEvaluation())
    await page.waitForFunction(()=>window.oldEvaluationReply && window.heldEvaluations?.length===1,{timeout:60000})
    const old=await page.evaluate(()=>window.oldEvaluationReply)
    assert.match(old.error,/interseca|attraversa|normale|singolare/)
    assert(await page.$eval('[data-test=surface-apply]',e=>e.disabled),'An obsolete failure must not enable Apply')
    assert.match((await snapshot()).text,/Aggiornamento/)
    await page.evaluate(()=>{window.holdEvaluations=false;window.releaseEvaluation()})
    await ready()
    const final=await snapshot()
    assert(final.volume>before.volume+0.01,'The latest valid edit must win after the obsolete failure')
    // A valid result calculated with the previous continuity setting must
    // not be displayed as the new setting's result or enable Apply.
    await page.evaluate(()=>{delete window.oldEvaluationId;delete window.oldEvaluationReply;window.holdEvaluations=true})
    const priorMode=await snapshot()
    await distance(1);await page.click('[data-test=surface-move]')
    await page.waitForFunction(()=>window.heldEvaluations?.length===1,{timeout:60000})
    await page.select('[data-test=surface-continuity]','G0')
    await page.waitForFunction(()=>document.querySelector('[data-test=surface-apply]')?.disabled)
    await page.evaluate(()=>window.releaseEvaluation())
    await page.waitForFunction(()=>window.oldEvaluationReply && window.heldEvaluations?.length===1,{timeout:60000})
    assert.equal(await page.evaluate(()=>window.oldEvaluationReply.error),undefined)
    assert.equal((await snapshot()).revision,priorMode.revision,'Old continuity result must not replace the displayed preview')
    assert(await page.$eval('[data-test=surface-apply]',e=>e.disabled))
    await page.evaluate(()=>{window.holdEvaluations=false;window.releaseEvaluation()});await ready()
    assert.equal(await page.$eval('[data-test=surface-continuity]',e=>e.value),'G0')
    // Closing during a pending evaluation must leave the editor closed.
    await page.evaluate(()=>{delete window.oldEvaluationId;delete window.oldEvaluationReply;window.holdEvaluations=true})
    await distance(1);await page.click('[data-test=surface-move]')
    await page.waitForFunction(()=>window.heldEvaluations?.length===1,{timeout:60000})
    await page.click('[aria-label="Chiudi Edit Surface"]')
    await page.waitForFunction(()=>!document.querySelector('[data-test=edit-surface-dialog]'))
    await page.evaluate(()=>{window.holdEvaluations=false;window.releaseEvaluation()})
    assert.equal(await page.$('[data-test=edit-surface-dialog]'),null)
    race={heldWorkerRequests:true,obsoleteError:old.error,applyDisabledWhilePending:true,finalVolume:final.volume,oldModeResultIgnored:true,closeWhilePending:true}
  }
  assert.deepEqual(consoleErrors,[])
  const result={pass:true,before,after,liveCount:live.length,firstLive:live[0],samples:observed.length,race,consoleErrors}
  writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({out,...result}))
}catch(error){writeFileSync(join(out,'failure.json'),JSON.stringify({error:String(error),stack:error.stack,before,after,observed,consoleErrors},null,2));await page.screenshot({path:join(out,'failure.png')});throw error}
finally{await browser.close();k[Symbol.dispose]()}
