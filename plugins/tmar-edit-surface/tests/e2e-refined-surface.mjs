// SPDX-License-Identifier: AGPL-3.0-only
// Curved rational STEP -> exact refinement -> UI edit -> portable project -> STEP.
import { OcctKernel } from 'occt-wasm'
import { mkdirSync, mkdtempSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'
import { surfaceTable, signature, replaceSurface } from '../brep.ts'
import { launchApp } from '../../../scripts/e2e-lib.mjs'

const root = resolve('plugins/tmar-edit-surface/evidence/refined-roundtrip')
mkdirSync(root, { recursive: true })
const out = mkdtempSync(join(root, 'run-')), started = performance.now()
const k = await OcctKernel.init(), box = k.makeBox(20, 30, 10), faces = k.getSubShapes(box, 'face')
const top = faces.find(f => { const b = k.uvBounds(f); return Math.abs(k.pointOnSurface(f, (b.uMin+b.uMax)/2, (b.vMin+b.vMax)/2).z-10)<1e-8 })
assert(top)
const b = k.uvBounds(top), own = surfaceTable(k.toBREP(top)).find(r => r.kind === 1)
const text = k.toBREP(box), record = surfaceTable(text).find(r => signature(r) === signature(own))
const poles = [], weights = []
for (let u=0;u<4;u++) for (let v=0;v<4;v++) {
  const p=k.pointOnSurface(top,b.uMin+(b.uMax-b.uMin)*u/3,b.vMin+(b.vMax-b.vMin)*v/3), interior=u>0&&u<3&&v>0&&v<3
  poles.push([p.x,p.y,p.z+(interior?0.2*u+0.1*v:0)])
  weights.push(interior?1+0.13*u+0.07*v:1)
}
const net={nu:4,nv:4,du:3,dv:3,poles,weights,rational:[1,1],ku:[b.uMin,b.uMax],kv:[b.vMin,b.vMax],mu:[4,4],mv:[4,4]}
const raw=k.fromBREP(replaceSurface(text,record,net)), fixture=k.fixShape(raw)
assert(k.isValid(fixture))
const input=join(out,'curved-rational.step'), originalVolume=k.getVolume(fixture)
writeFileSync(input,k.exportStep(fixture))
k.release(fixture);k.release(raw);faces.forEach(f=>k.release(f));k.release(box)
const url=process.env.APP_URL??'http://127.0.0.1:17531/'
const {browser,page,consoleErrors}=await launchApp({url,width:1440,height:1000})
let reopened
try {
  await page.click('[data-test=workspace-reverse]')
  await page.waitForSelector('[data-test=edit-surface-entry] button',{timeout:60000})
  await page.click('[data-test=edit-surface-entry] button')
  await (await page.$('[data-test=surface-step-file]')).uploadFile(input)
  await page.waitForFunction(()=>document.querySelectorAll('[data-test=surface-face] option').length===7,{timeout:60000})
  const index=await page.$eval('[data-test=surface-face]',e=>[...e.options].find(o=>!o.disabled&&/bspline/i.test(o.textContent))?.value)
  assert(index,'Imported STEP exposes a B-spline face')
  await page.select('[data-test=surface-face]',index)
  await page.waitForFunction(()=>document.querySelector('[data-test=surface-status]')?.textContent.includes('CAD valido'),{timeout:60000})
  assert(await page.$eval('.es-dialog',e=>e.textContent.includes('Reticolo arricchito')))
  await page.screenshot({path:join(out,'before.png')})
  const buttons=await page.$$('.es-dialog button')
  for(const button of buttons) if(await button.evaluate(e=>e.textContent==='Seleziona liberi')) await button.click()
  assert(await page.$eval('[data-test=surface-selection]',e=>e.textContent.includes('1 modificabili')))
  const previous=await page.$eval('[data-test=surface-status]',e=>e.textContent)
  await page.$eval('[data-test=surface-distance]',e=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'3');e.dispatchEvent(new Event('input',{bubbles:true}))})
  await page.click('[data-test=surface-move]')
  await page.waitForFunction(p=>{const s=document.querySelector('[data-test=surface-status]')?.textContent;return s?.includes('CAD valido')&&s!==p},{timeout:60000},previous)
  const editedStatus=await page.$eval('[data-test=surface-status]',e=>e.textContent)
  await page.screenshot({path:join(out,'edited.png')})
  await page.click('[data-test=surface-apply]')
  await page.waitForFunction(()=>!document.querySelector('[data-test=edit-surface-dialog]')&&window.__re?.store.getState().bodies.length===1&&!window.__re.store.getState().building,{timeout:60000})
  const exportStep=p=>p.evaluate(async()=>{const{runCommand}=await import('/src/commands/registry.ts');const r=await runCommand('reverse.export.step',{bodies:window.__re.store.getState().bodies.map(b=>b.id)});return new TextDecoder().decode(r.file.bytes)})
  const applied=await exportStep(page), shape=k.importStep(applied)
  assert(k.isValid(shape));const editedVolume=k.getVolume(shape);assert(editedVolume>originalVolume+1)
  writeFileSync(join(out,'edited.step'),applied)
  const cdp=await page.createCDPSession()
  await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:out,eventsEnabled:true})
  await page.click('[data-test=save-project]')
  const deadline=Date.now()+60000
  let saved
  while(Date.now()<deadline&&!saved){saved=readdirSync(out).find(f=>f.endsWith('.scanruler'));if(!saved)await new Promise(r=>setTimeout(r,100))}
  assert(saved,'Portable project downloaded')
  reopened=await browser.newPage()
  reopened.on('pageerror',e=>consoleErrors.push('reopen: '+e.message))
  reopened.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())})
  await reopened.goto(url)
  await reopened.waitForSelector('[data-test=project-input]')
  await (await reopened.$('[data-test=project-input]')).uploadFile(join(out,saved))
  await reopened.click('[data-test=workspace-reverse]')
  await reopened.waitForFunction(()=>window.__re?.store.getState().bodies.length===1&&!window.__re.store.getState().building,{timeout:60000})
  const result=await exportStep(reopened), roundtrip=k.importStep(result)
  assert(k.isValid(roundtrip));const roundtripVolume=k.getVolume(roundtrip)
  assert(Math.abs(roundtripVolume-editedVolume)<1e-6)
  const a=k.getSubShapes(shape,'face'), c=k.getSubShapes(roundtrip,'face')
  assert.equal(a.length,c.length)
  let maxError=0
  for(let f=0;f<a.length;f++){const uv=k.uvBounds(a[f]);for(let i=0;i<=8;i++)for(let j=0;j<=8;j++){
    const u=uv.uMin+(uv.uMax-uv.uMin)*i/8,v=uv.vMin+(uv.vMax-uv.vMin)*j/8
    const p=k.pointOnSurface(a[f],u,v),q=k.pointOnSurface(c[f],u,v)
    maxError=Math.max(maxError,Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z))
  }}
  assert(maxError<1e-8)
  await reopened.screenshot({path:join(out,'reopened.png')})
  writeFileSync(join(out,'reopened.step'),result)
  a.forEach(f=>k.release(f));c.forEach(f=>k.release(f));k.release(shape);k.release(roundtrip)
  assert.equal(consoleErrors.length,0,JSON.stringify(consoleErrors))
  const report={pass:true,originalVolume,editedVolume,roundtripVolume,maxError,editedStatus,project:saved,consoleErrors,elapsedMs:performance.now()-started}
  writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,...report},null,2))
} catch(e){await (reopened??page).screenshot({path:join(out,'failure.png')});console.log('UI',await (reopened??page).$eval('body',e=>e.innerText.slice(-5000)));console.log('ERRORS',consoleErrors);throw e}
finally{await browser.close();k[Symbol.dispose]()}
