// SPDX-License-Identifier: AGPL-3.0-only
// Actual viewport gestures on imported STEP; independent OCCT export checks.
import { OcctKernel } from 'occt-wasm'
import * as THREE from 'three'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'
import { launchApp } from '../../../scripts/e2e-lib.mjs'
const cells = process.argv.includes('--cells')
const root = resolve('plugins/tmar-edit-surface/evidence', cells ? 'cell-selection' : 'net-selection')
mkdirSync(root, { recursive: true })
const out = mkdtempSync(join(root, 'run-')), started = performance.now(), kernel = await OcctKernel.init()
const input = resolve('plugins/tmar-edit-surface/evidence/input-solid.step')
const source = kernel.importStep(readFileSync(input, 'utf8')), faces = kernel.getSubShapes(source, 'face')
const mesh = kernel.tessellate(source), bounds = new THREE.Box3().setFromBufferAttribute(new THREE.BufferAttribute(mesh.positions, 3))
const uv = kernel.uvBounds(faces[5]), greville = [0, 1/6, 1/2, 5/6, 1]
const poles = greville.flatMap(u => greville.map(v => {
  const p = kernel.pointOnSurface(faces[5], uv.uMin + u*(uv.uMax-uv.uMin), uv.vMin + v*(uv.vMax-uv.vMin))
  return new THREE.Vector3(p.x, p.y, p.z)
}))
faces.forEach(f => kernel.release(f)); kernel.release(source)
const { browser, page, consoleErrors } = await launchApp({ url: process.env.APP_URL ?? 'http://127.0.0.1:17531/', width:1440, height:1000 })
try {
  await page.click('[data-test=workspace-reverse]')
  await page.waitForSelector('[data-test=edit-surface-entry] button', {timeout:60000})
  await page.click('[data-test=edit-surface-entry] button')
  await (await page.$('[data-test=surface-step-file]')).uploadFile(input)
  await page.waitForFunction(() => document.querySelectorAll('[data-test=surface-face] option').length===7, {timeout:60000})
  await page.select('[data-test=surface-face]', '5')
  const ready = async () => page.waitForFunction(() => document.querySelector('[data-test=surface-status]')?.textContent.includes('CAD valido') && !document.querySelector('[data-test=surface-apply]')?.disabled, {timeout:60000})
  const status = () => page.$eval('[data-test=surface-status]', e => e.textContent)
  const changed = async before => { await page.waitForFunction(p => {const s=document.querySelector('[data-test=surface-status]')?.textContent; return s?.includes('CAD valido') && s!==p}, {timeout:60000}, before); await ready() }
  const clickText = async text => {for(const b of await page.$$('.es-dialog button')) if(await b.evaluate((e,t) => e.textContent===t,text)){await b.click();return} throw Error('Missing '+text)}
  const selected = async (total, free=total) => page.waitForFunction(([t,f]) => document.querySelector('[data-test=surface-selection]')?.textContent===`${t} selezionati · ${f} modificabili`, {}, [total, free])
  await ready(); await page.select('[data-test=surface-continuity]', 'G0'); await ready()
  const r=await page.$eval('[data-test=edit-surface-viewport]',e=>{const b=e.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height}})
  const center=bounds.getCenter(new THREE.Vector3()),radius=bounds.getSize(new THREE.Vector3()).length()/2
  const camera=new THREE.PerspectiveCamera(40,r.width/r.height,radius/1000,radius*100)
  camera.position.copy(center).add(new THREE.Vector3(1.5,-1.9,1.8).multiplyScalar(radius));camera.up.set(0,0,1);camera.lookAt(center);camera.updateMatrixWorld()
  const project = p => {const q=p.clone().project(camera);return {x:r.x+(q.x+1)*r.width/2,y:r.y+(1-q.y)*r.height/2}}
  const segment = (a,b) => project(poles[a].clone().add(poles[b]).multiplyScalar(0.5))
  const click = async p => page.mouse.click(p.x,p.y)
  const edge=segment(11,12), adjacent=segment(12,13)
  const group=cells ? [6,11,12,7] : [11,12]
  const centroid=()=>group.reduce((v,i)=>v.add(poles[i]),new THREE.Vector3()).divideScalar(group.length)
  if(cells){
    await page.select('[data-test=surface-selection-mode]', 'cells')
    const corner=project(poles[0].clone().lerp(poles[6],.5))
    await click(corner); await selected(4,1)
    await clickText('Nessuno')
    await page.click('[data-test=surface-control-net]'); await click(project(centroid())); await selected(0)
    await page.click('[data-test=surface-control-net]'); await click(project(centroid())); await selected(4)
    assert(await page.$eval('[data-test=surface-undo]',e=>e.disabled))
  } else {
  await page.select('[data-test=surface-selection-mode]', 'points'); await click(edge); await selected(0)
  await page.select('[data-test=surface-selection-mode]', 'edges'); await click(edge); await selected(2)
  assert(await page.$eval('[data-test=surface-undo]',e=>e.disabled), 'Selection alone must not create an undo step')
  await page.keyboard.down('Control'); await click(adjacent); await page.keyboard.up('Control'); await selected(3)
  await page.keyboard.down('Control'); await click(adjacent); await page.keyboard.up('Control'); await selected(1)
  await clickText('Nessuno'); await selected(0)
  await page.click('[data-test=surface-control-net]'); await click(edge); await selected(0)
  await page.click('[data-test=surface-control-net]'); await page.select('[data-test=surface-selection-mode]','mixed')
  await click(project(poles[12])); await selected(1)
  await click(edge); await selected(2)
  await clickText('Blocca punti'); await selected(2,0)
  await page.mouse.move(edge.x,edge.y)
  assert.equal(await page.$eval('[data-test=edit-surface-viewport]',e=>e.style.cursor),'not-allowed')
  await page.mouse.down(); await page.mouse.move(edge.x,edge.y-20,{steps:5}); await page.mouse.up()
  assert(await page.$eval('[data-test=surface-undo]',e=>e.disabled), 'Locked segment must not deform')
  await clickText('Sblocca punti'); await selected(2)
  }
  const cdp=await page.createCDPSession()
  const exportState = async label => {
    await ready()
    const destination=join(out,label+'.step')
    if (cells) {
      // Read the real STEP download link before handing it to the OS.
      const exported = page.evaluate(() => new Promise((resolve,reject) => {
        const handler = e => {
          const a=e.target
          if (!(a instanceof HTMLAnchorElement) || !a.download.endsWith('.step')) return
          e.preventDefault(); document.removeEventListener('click',handler,true)
          fetch(a.href).then(r=>r.text()).then(resolve,reject)
        }
        document.addEventListener('click',handler,true)
      }))
      await clickText('Esporta STEP\u2026')
      writeFileSync(destination,await exported)
    } else {
    const dir=join(out,label);mkdirSync(dir);await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:dir,eventsEnabled:true})
    await clickText('Esporta STEP\u2026')
    let file; const deadline=Date.now()+60000
    while(Date.now()<deadline&&!file){file=readdirSync(dir).find(f=>f.endsWith('.step'));if(!file)await new Promise(r=>setTimeout(r,100))}
    assert(file); renameSync(join(dir,file),destination)
    }
    await ready()
    const shape=kernel.importStep(readFileSync(destination,'utf8')), fs=kernel.getSubShapes(shape,'face')
    try {
      assert(kernel.isValid(shape)); assert.equal(fs.length,6)
      const b=kernel.uvBounds(fs[5]), c=kernel.pointOnSurface(fs[5],(b.uMin+b.uMax)/2,(b.vMin+b.vMax)/2)
      const border=[]
      for(let i=0;i<=8;i++) for(const [u,v] of [[i/8,0],[i/8,1],[0,i/8],[1,i/8]]) {
        const p=kernel.pointOnSurface(fs[5],b.uMin+u*(b.uMax-b.uMin),b.vMin+v*(b.vMax-b.vMin));border.push([p.x,p.y,p.z])
      }
      return {file:label+'.step',center:[c.x,c.y,c.z],volume:kernel.getVolume(shape),border}
    } finally {fs.forEach(f=>kernel.release(f));kernel.release(shape)}
  }
  const base=await exportState('base'), before=await status()
  await page.click('[data-test=surface-move]'); await changed(before)
  const numeric=await exportState(cells?'numeric-cell':'numeric-two-poles')
  // Tensor cubic basis at the middle: N1*N2 + N2*N2 = .125+.25.
  assert(Math.abs(numeric.center[2]-base.center[2]-(cells ? 0.5625 : 0.375))<1e-8)
  for(const index of group) poles[index].z+=1
  const from=project(centroid()),to=project(centroid().add(new THREE.Vector3(0,0,1)))
  const previous=await status();await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:8});await page.mouse.up();await changed(previous)
  const dragged=await exportState(cells?'drag-cell':'drag-two-poles');assert(dragged.center[2]>numeric.center[2]+0.05)
  await page.screenshot({path:join(out,cells?'selected-cell.png':'selected-segment.png')})
  {const p=await status();await page.click('[data-test=surface-undo]');await changed(p)}
  const undone=await exportState('undo')
  {const p=await status();await page.click('[data-test=surface-redo]');await changed(p)}
  const redone=await exportState('redo')
  assert(new THREE.Vector3(...undone.center).distanceTo(new THREE.Vector3(...numeric.center))<1e-8)
  assert(new THREE.Vector3(...redone.center).distanceTo(new THREE.Vector3(...dragged.center))<1e-8)
  let maxBorderError=0
  for(const result of [numeric,dragged,undone,redone]) for(let i=0;i<base.border.length;i++) maxBorderError=Math.max(maxBorderError,new THREE.Vector3(...result.border[i]).distanceTo(new THREE.Vector3(...base.border[i])))
  assert(maxBorderError<1e-6);assert.deepEqual(consoleErrors,[])
  const report={pass:true,selectionChecks:cells?['corner cell: 4 selected, 1 free','hidden cells unpickable','interior cell: 4 free','selection creates no undo']:['points excludes segments','segment selects two poles','Ctrl add/remove shared endpoints','hidden net unpickable','mixed prioritizes poles','locked segment cannot drag','selection creates no undo'],base,numeric,dragged,undone,redone,maxBorderError,consoleErrors,elapsedMs:performance.now()-started}
  writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,pass:report.pass,selectionChecks:report.selectionChecks,elapsedMs:report.elapsedMs,maxBorderError,consoleErrors,centers:[base,numeric,dragged,undone,redone].map(({file,center,volume})=>({file,center,volume}))},null,2))
} catch(e) { writeFileSync(join(out,'failure.json'),JSON.stringify({error:String(e),stack:e.stack},null,2));await page.screenshot({path:join(out,'failure.png')});throw e }
finally {await browser.close();kernel[Symbol.dispose]()}
