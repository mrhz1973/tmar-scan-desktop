// SPDX-License-Identifier: AGPL-3.0-only
// Disposable profile/server only. No live user tabs or source model edits.
import { mkdtempSync,writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { noisySheet } from './fixture.mjs'
const root=fileURLToPath(new URL('../../../',import.meta.url))
const server=process.env.APP_URL?null:await createServer({root,server:{host:'127.0.0.1',port:0,open:false,watch:{ignored:['**/e2e-out/**']}}})
if(server){await server.listen();process.env.APP_URL=server.resolvedUrls.local[0]}
const {launchApp,check,fail,finish,sleep,OUT_DIR,shotPath,pixelDiff,MOD}=await import('../../../scripts/e2e-lib.mjs')
let browser,page,consoleErrors=[]
try{
 ;({browser,page,consoleErrors}=await launchApp({width:1600,height:1050,protocolTimeout:180000,agentDataOk:false,userDataDir:mkdtempSync(join(OUT_DIR,'mesh-review-profile-'))}))
 page.on('dialog',d=>d.accept())
 const call=(name,args={})=>page.evaluate(async(name,args)=>{
  const {registerCoreCommands}=await import('/src/commands/core.ts');registerCoreCommands();if(args.bytes)args.bytes=Uint8Array.from(args.bytes)
  const out=await(await import('/src/commands/registry.ts')).runCommand(name,args)
  if(out?.file?.bytes)out.file.bytes=Array.from(out.file.bytes);return out
 },name,args)
 const click=async s=>{await page.waitForSelector(s,{visible:true});await page.click(s);await sleep(180)}
 const shot=async name=>{await page.mouse.move(5,5);await sleep(250);const r=await page.$eval('.viewport',e=>{const b=e.getBoundingClientRect();return{x:b.x+20,y:b.y+55,width:b.width-40,height:b.height-155}});const image=await page.screenshot({clip:r,encoding:'base64'});if(name)writeFileSync(shotPath(name+'.png'),Buffer.from(image,'base64'));return image}
 const fixture=noisySheet();await call('scan.open',{bytes:Array.from(fixture.bytes),name:'review-noisy-sheet.ply',units:'mm',discard:true})
 await call('mesh.show',{scan:true,piece:false,bodies:[]});await call('view.set',{view:'top',fit:true})
 await page.waitForSelector('[data-test=mesh-review-notes]')
 if(await page.$('[data-test=support-card] .sc-x'))await click('[data-test=support-card] .sc-x')
 check(!!await page.$('[data-test=quick-note]'),'Mesh Tools exposes the shared local Note button and list')
 await page.evaluate(()=>{const s=window.__re.scene(),m=s.scanDisplay().mesh;window.__meshBefore={mesh:m,geometry:m.geometry,material:m.material,p:Array.from(m.geometry.attributes.position.array),i:Array.from(m.geometry.index.array)}})
 const plain=await shot('mesh-plain');await click('[data-test=zebra-quick-toggle]')
 await page.waitForFunction(()=>/1 visible object/.test(document.querySelector('[data-test=zebra-status]')?.textContent??''))
 check(await pixelDiff(page,plain,await shot('mesh-zebra'))>1,'Zebra changes actual mesh pixels, not only a control')
 check(await page.$eval('[data-test=zebra-target]',e=>e.options[e.selectedIndex].text==='Scan in use'),'Mesh Zebra identifies the actual scan target')
 const center=await page.$eval('.viewport canvas',e=>{const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})
 await click('[data-test=zebra-add-note]');await page.mouse.click(center.x,center.y);await page.waitForSelector('[data-test=note-text]')
 await page.type('[data-test=note-text]','Mesh Zebra review');await click('[data-test=note-keep]')
 check(await page.evaluate(()=>window.__reNotes.getState().notes[0]?.on[0]?.kind==='scan'),'Mesh note anchors to the visible scan with Zebra enabled')
 await page.mouse.click(8,8);await page.keyboard.press('n');await page.mouse.click(center.x+80,center.y+30);await page.waitForSelector('[data-test=note-text]')
 await page.type('[data-test=note-text]','Second local mesh note');await click('[data-test=note-keep]')
 check(await page.evaluate(()=>window.__reNotes.getState().notes.length===2),'configured Note shortcut works inside Mesh Tools')
 await click('[data-test=note-row]:nth-child(1) [data-test=note-row-text]')
 await page.keyboard.down(MOD);await click('[data-test=note-row]:nth-child(2) [data-test=note-row-text]');await page.keyboard.up(MOD)
 check(await page.$eval('[data-test=notes-selected-count]',e=>e.textContent.includes('2 selected')),'Mesh notes reuse Ctrl/Cmd multi-selection')
 await click('[data-test=note-locate]')
 check(await page.$eval('[data-test=note-focus-ring]',e=>getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().width>=50),'Mesh Go to note centers and highlights its viewport marker')
 await click('[data-test=note-return-view]')
 await click('[data-test=workspace-labels]')
 check(await page.evaluate(()=>window.__reNotes.getState().notes.length===2),'hiding labels keeps both note records')
 await click('[data-test=workspace-labels]')
 await click('[data-test=zebra-quick-toggle]')
 check(await page.evaluate(()=>{const o=window.__meshBefore;return o.mesh.geometry===o.geometry&&o.mesh.material===o.material&&JSON.stringify(Array.from(o.geometry.attributes.position.array))===JSON.stringify(o.p)&&JSON.stringify(Array.from(o.geometry.index.array))===JSON.stringify(o.i)&&!o.mesh.children.some(x=>x.name==='tmar-zebra-overlay')}),'Zebra and note actions leave source geometry/material untouched and remove overlays on exit')
 const saved=await call('project.save');writeFileSync(join(root,'e2e-out','mesh-review-fixture.scanruler'),Buffer.from(saved.file.bytes))
 await call('project.load',{bytes:saved.file.bytes,name:'mesh-review-roundtrip.scanruler',discard:true});await page.waitForSelector('[data-test=mesh-review-notes]')
 check(await page.evaluate(()=>window.__reNotes.getState().notes.length===2),'both Mesh notes survive project save/reopen')
 await click('[data-test=zebra-quick-toggle]');await click('[data-test=mesh-tool-delete]')
 check(await page.$eval('[data-test=zebra-quick-toggle]',e=>e.disabled&&e.getAttribute('aria-pressed')==='false'),'active mesh edit tools suspend Zebra without altering the selected tool')
 check(await page.$eval('[data-test=note-add]',e=>e.disabled),'note placement cannot steal a delete/marking tool click')
 await call('mesh.show',{scan:true,piece:false,bodies:[]})
 await call('mesh.reduce',{tolerance:.15,maxTriangles:1200});await sleep(300)
 await click('[data-test=zebra-quick-toggle]')
 check(await page.$eval('[data-test=zebra-target]',e=>e.options[e.selectedIndex].text.includes('Reduced')),'Zebra can inspect the reduced mesh instead of the hidden original')
 check(await page.evaluate(async()=>{const {meshSceneOf}=await import('/plugins/mesh-tools/viewer/meshScene.ts');const s=window.__re.scene(),g=meshSceneOf(s).reducedGeometry();return s.layerHost().partGroup.children.some(o=>o.geometry===g&&o.children.some(c=>c.name==='tmar-zebra-overlay'))}),'Zebra is attached to the actual reduced preview geometry')
 check(await page.$eval('[data-test=zebra-add-note]',e=>e.disabled),'reduced-preview notes are explicitly guarded against false scan anchors')
 await call('mesh.show',{scan:true,reduced:false});await sleep(250)
 check(await page.$eval('[data-test=note-add]',e=>!e.disabled),'returning to the scan re-enables note placement')
 await call('mesh.smooth',{size:2,limit:.05,strength:.5});await call('mesh.show',{scan:true,deviation:true});await sleep(600)
 await click('[data-test=zebra-quick-toggle]')
 check(await page.$eval('[data-test=zebra-target]',e=>e.options[e.selectedIndex].text.includes('Edited copy')),'Zebra identifies the edited copy without adopting it for analysis')
 check(await page.evaluate(()=>{const s=window.__re.scene();return s.showingEdited()&&s.scanDisplay().mesh.children.some(c=>c.name==='tmar-zebra-overlay'&&c.geometry===s.scanDisplay().mesh.geometry)}),'Zebra follows the edited copy instead of querying the hidden original geometry')
 check(await page.$eval('[data-test=zebra-add-note]',e=>e.disabled),'edited-preview insertion is guarded rather than mislabeled as an original scan note')
 await click('[data-test=zebra-quick-toggle]')
 check(await page.evaluate(async()=>{const {useMeshTools}=await import('/plugins/mesh-tools/state/meshStore.ts');return useMeshTools.getState().copyDeviation&&useMeshTools.getState().pending.length===1}),'turning Zebra off retains the numerical deviation setting and pending edit')
 await click('[data-test=workspace-reverse]');await sleep(250)
 check(await page.evaluate(()=>!window.__re.scene().scanDisplay().mesh.children.some(c=>c.name==='tmar-zebra-overlay')),'leaving Mesh Tools removes its inspection overlay')
 check(await page.evaluate(async()=>!(await import('/src/state/prefsStore.ts')).usePrefs.getState().agentLink),'Mesh review never enables an agent connection')
 await page.screenshot({path:shotPath('mesh-review-complete.png')})
}catch(e){fail(e.stack??String(e))}
finally{if(browser)await finish(browser,consoleErrors);if(server)await server.close()}
