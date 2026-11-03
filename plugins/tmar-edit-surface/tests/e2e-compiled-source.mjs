// SPDX-License-Identifier: AGPL-3.0-only
// Qualify Carica corpo on the compiled app with an actual saved project.
import { launchApp } from '../../../scripts/e2e-lib.mjs'
import { OcctKernel } from 'occt-wasm'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'

assert(process.env.APP_URL && process.env.CAD_PROJECT, 'Supply compiled APP_URL and CAD_PROJECT')
const root=resolve('plugins/tmar-edit-surface/evidence/current-source');mkdirSync(root,{recursive:true})
const out=mkdtempSync(join(root,'run-')), kernel=await OcctKernel.init()
const {browser,page,consoleErrors}=await launchApp({url:process.env.APP_URL,width:1440,height:1000,agentDataOk:false,userDataDir:mkdtempSync(join(tmpdir(),'edit-surface-compiled-'))})
const results=[]
try{
  for(const expectedFaces of [1,3]){
    const tab=expectedFaces===1?page:await browser.newPage()
    try{
      if(tab!==page){tab.on('pageerror',e=>consoleErrors.push(e.message));await tab.goto(process.env.APP_URL)}
      await tab.waitForSelector('[data-test=project-input]')
      await (await tab.$('[data-test=project-input]')).uploadFile(resolve(process.env.CAD_PROJECT))
      await tab.click('[data-test=workspace-reverse]')
      await tab.waitForSelector('[data-test=edit-surface-entry] button:enabled',{timeout:90000})
      await tab.click('[data-test=edit-surface-entry] button')
      await tab.waitForFunction(()=>document.querySelectorAll('[data-test=surface-body] option').length===2,{timeout:60000})
      const options=await tab.$$eval('[data-test=surface-body] option',xs=>xs.map(x=>({value:x.value,name:x.textContent})))
      // Imports remain ordered in this saved project: original, then sewn copy.
      await tab.select('[data-test=surface-body]',options[expectedFaces===1?0:1].value)
      await tab.click('[data-test=surface-load-body]')
      await tab.waitForFunction(n=>document.querySelectorAll('[data-test=surface-face] option').length===n+1,{timeout:60000},expectedFaces)
      await tab.select('[data-test=surface-face]','0')
      await tab.waitForSelector('[data-test=strip-open]:enabled',{timeout:60000})
      const exported=tab.evaluate(()=>new Promise((resolve,reject)=>{
        const handler=e=>{
          if(!(e.target instanceof HTMLAnchorElement) || !e.target.download.endsWith('.step'))return
          e.preventDefault();document.removeEventListener('click',handler,true)
          fetch(e.target.href).then(r=>r.text()).then(resolve,reject)
        }
        document.addEventListener('click',handler,true)
      }))
      let clicked=false
      for(const button of await tab.$$('.es-dialog button'))if(await button.evaluate(e=>e.textContent==='Esporta STEP…')){await button.click();clicked=true;break}
      assert(clicked,'STEP export button')
      const text=await exported,shape=kernel.importStep(text),faces=kernel.getSubShapes(shape,'face'),solids=kernel.getSubShapes(shape,'solid')
      try{
        const bounds=kernel.getBoundingBox(shape)
        assert(kernel.isValid(shape));assert.equal(faces.length,expectedFaces);assert.equal(solids.length,0)
        assert(Math.abs(bounds.xmin-40)<1e-6,'the current moved CAD is loaded')
        if(expectedFaces===1)assert(Math.abs(bounds.xmax-60)<1e-6)
        results.push({expectedFaces,bounds,area:kernel.getSurfaceArea(shape),name:options[expectedFaces===1?0:1].name})
        writeFileSync(join(out,`body-${expectedFaces}.step`),text)
      }finally{[...faces,...solids,shape].forEach(h=>kernel.release(h))}
      await tab.screenshot({path:join(out,`body-${expectedFaces}.png`)})
    }finally{if(tab!==page)await tab.close()}
  }
  assert.deepEqual(consoleErrors,[])
  writeFileSync(join(out,'result.json'),JSON.stringify({pass:true,scope:'compiled application, saved project and actual STEP downloads',results,consoleErrors},null,2))
  console.log(JSON.stringify({out,results,consoleErrors}))
}catch(error){writeFileSync(join(out,'failure.json'),JSON.stringify({error:String(error),stack:error.stack,results,consoleErrors},null,2));await page.screenshot({path:join(out,'failure.png')});throw error}
finally{await browser.close();kernel[Symbol.dispose]()}
