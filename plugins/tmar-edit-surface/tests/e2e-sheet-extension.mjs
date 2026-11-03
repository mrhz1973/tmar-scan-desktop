// SPDX-License-Identifier: AGPL-3.0-only
import {launchApp} from '../../../scripts/e2e-lib.mjs'
import {OcctKernel} from 'occt-wasm'
import {PerspectiveCamera,Vector3} from 'three'
import {join,resolve} from 'node:path'
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs'
import assert from 'node:assert/strict'
const chain=process.argv.includes('--chain')
const k=await OcctKernel.init(),box=k.makeBox(20,30,10),fs=k.getSubShapes(box,'face')
const root=resolve('plugins/tmar-edit-surface/evidence/duplicate-edge');mkdirSync(root,{recursive:true})
const out=mkdtempSync(join(root,'run-')), input=join(out,'sheet.step')
writeFileSync(input,k.exportStep(fs[5]));fs.forEach(f=>k.release(f));k.release(box)
const {browser,page,consoleErrors}=await launchApp({url:process.env.APP_URL,width:1440,height:1000})
try {
  await page.click('[data-test=workspace-reverse]');await page.waitForSelector('[data-test=edit-surface-entry] button');await page.click('[data-test=edit-surface-entry] button')
  await (await page.$('[data-test=surface-step-file]')).uploadFile(input)
  await page.waitForFunction(()=>document.querySelectorAll('[data-test=surface-face] option').length===2)
  await page.select('[data-test=surface-face]','0');await page.waitForFunction(()=>document.querySelector('[data-test=strip-open]')?.disabled===false)
  await page.click('[data-test=strip-open]');await page.waitForSelector('[data-test=strip-axis-0]');await page.click('[data-test=strip-axis-0]')
  const r=await page.$eval('[data-test=edit-surface-viewport]',e=>e.getBoundingClientRect().toJSON())
  const rad=Math.hypot(20,30)/2, c=new Vector3(10,15,10),camera=new PerspectiveCamera(40,r.width/r.height,rad/1000,rad*100)
  camera.position.copy(c).addScaledVector(new Vector3(1.5,-1.9,1.8),rad);camera.up.set(0,0,1);camera.lookAt(c);camera.updateMatrixWorld()
  const xy=(x,z=10)=>{const q=new Vector3(x,15,z).project(camera);return[r.x+(1+q.x)*r.width/2,r.y+(1-q.y)*r.height/2]}
  await page.mouse.move(...xy(20));await page.mouse.down();await page.mouse.move(...xy(25),{steps:8});await page.mouse.up()
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
    assert.deepEqual(consoleErrors,[])
    console.log(out,areas)
    writeFileSync(join(out,'result.json'),JSON.stringify({valid:true,areas,sharedEdges,chain,consoleErrors}))
  }finally{faces.forEach(f=>k.release(f));k.release(shape)}
}finally{await browser.close();k[Symbol.dispose]()}
