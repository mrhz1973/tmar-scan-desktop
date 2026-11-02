// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtempSync,writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { noisySheet } from '../../tmar-mesh-review/scripts/fixture.mjs'
const root=fileURLToPath(new URL('../../../',import.meta.url))
const server=process.env.APP_URL?null:await createServer({root,server:{host:'127.0.0.1',port:0,open:false,watch:{ignored:['**/e2e-out/**']}}})
if(server){await server.listen();process.env.APP_URL=server.resolvedUrls.local[0]}
const {launchApp,check,fail,finish,sleep,OUT_DIR,shotPath}=await import('../../../scripts/e2e-lib.mjs')
let browser,page,consoleErrors=[]
try{
 ;({browser,page,consoleErrors}=await launchApp({width:1600,height:1050,protocolTimeout:180000,agentDataOk:false,userDataDir:mkdtempSync(join(OUT_DIR,'smooth-profile-'))}))
 page.on('dialog',d=>d.accept())
 const call=(name,args={})=>page.evaluate(async(name,args)=>{
  const {registerCoreCommands}=await import('/src/commands/core.ts');registerCoreCommands();if(args.bytes)args.bytes=Uint8Array.from(args.bytes)
  const out=await(await import('/src/commands/registry.ts')).runCommand(name,args)
  if(out?.file?.bytes)out.file.bytes=Array.from(out.file.bytes);return out
 },name,args)
 const click=async s=>{await page.waitForSelector(s,{visible:true});await page.click(s);await sleep(140)}
 const intensity=async value=>{await page.$eval('[data-test=smooth-intensity]',(el,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,String(value));el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))},value);await sleep(120)}
 const settle=async n=>{await page.waitForFunction(n=>document.querySelectorAll('[data-test=pending-edit]').length===n&&!document.querySelector('[data-test=smooth-scan]')?.disabled,{timeout:120000},n);await sleep(180)}
 const fixture=noisySheet();await call('scan.open',{bytes:Array.from(fixture.bytes),name:'smooth-noisy-sheet.ply',units:'mm',discard:true})
 await call('mesh.mark',{for:'smooth',region:{box:{min:[-8,-8,-1],max:[8,8,1]}}});await call('view.set',{view:'top',fit:true})
 await page.evaluate(async()=>{window.__smoothStore=(await import('/plugins/mesh-tools/state/meshStore.ts')).useMeshTools;const m=window.__smoothStore.getState();m.setSmoothSize(2);m.setSmoothLimit(.1);window.__smoothBefore=Array.from(window.__re.scene().scanDisplay().mesh.geometry.attributes.position.array);window.__smoothMarked=Array.from(window.__re.scene().paintedVertices())})
 check(await page.evaluate(()=>window.__smoothMarked.length>0&&window.__smoothMarked.length<window.__smoothBefore.length/3),'partial region selected on the original mesh')
 check(await page.$eval('[data-test=smooth-intensity]',e=>Number(e.value)===100),'Smooth intensity initially preserves the original 100% behavior')
 await intensity(50)
 check(await page.evaluate(()=>JSON.stringify(Array.from(window.__re.scene().scanDisplay().mesh.geometry.attributes.position.array))===JSON.stringify(window.__smoothBefore)&&window.__smoothStore.getState().pending.length===0),'moving intensity slider does not perform an edit')
 await click('[data-test=smooth-scan]');await settle(1)
 check(await page.evaluate(()=>JSON.stringify(Array.from(window.__re.scene().paintedVertices()))===JSON.stringify(window.__smoothMarked)),'first Smooth keeps the exact selected vertex IDs, not just their count')
 check(await page.$eval('[data-test=smooth-scan]',e=>!e.disabled),'the same Smooth button is ready to reapply without reselecting')
 check(await page.evaluate(()=>window.__smoothStore.getState().pending[0].strength===.5&&window.__smoothStore.getState().pending[0].region===window.__smoothMarked.length),'edit history records applied intensity and retained region size')
 await page.evaluate(()=>{window.__smoothFirst=Array.from(window.__re.scene().scanDisplay().mesh.geometry.attributes.position.array)})
 check(await page.evaluate(()=>window.__smoothFirst.some((v,i)=>Math.abs(v-window.__smoothBefore[i])>1e-6)),'first Smooth really changes the edited copy')
 await click('[data-test=smooth-scan]');await settle(2)
 check(await page.evaluate(()=>JSON.stringify(Array.from(window.__re.scene().paintedVertices()))===JSON.stringify(window.__smoothMarked)),'second Smooth again retains the same selected region')
 await page.evaluate(()=>{window.__smoothSecond=Array.from(window.__re.scene().scanDisplay().mesh.geometry.attributes.position.array)})
 check(await page.evaluate(()=>window.__smoothSecond.some((v,i)=>Math.abs(v-window.__smoothFirst[i])>1e-7)),'second application performs additional smoothing on the same region')
 check(await page.evaluate(()=>{const selected=new Set(window.__smoothMarked);return window.__smoothSecond.every((v,i)=>selected.has(Math.floor(i/3))||v===window.__smoothBefore[i])}),'vertices outside the marked region remain unchanged after repeated smoothing')
 check(await page.evaluate(()=>JSON.stringify(Array.from(window.__re.scene().scanGeometry().attributes.position.array))===JSON.stringify(window.__smoothBefore)),'original scan in use is unchanged until explicit Use for analysis')
 await page.screenshot({path:shotPath('smooth-selection-retained.png')})
 await intensity(0)
 check(await page.$eval('[data-test=smooth-scan]',e=>e.disabled),'0% disables the no-op Smooth action')
 check(await page.evaluate(()=>window.__smoothStore.getState().pending.length===2),'0% creates no empty edit history entry')
 await intensity(50)
 // Slider settings have their own undo entries. Locate the two geometry steps
 // directly with history checkpoints captured by the history store, not keyboard guesses.
 await page.evaluate(async()=>{const {undo,useHistory}=await import('/src/state/historyStore.ts');let n=0;while(window.__smoothStore.getState().pending.length===2&&n++<6)await undo()})
 await page.waitForFunction(()=>window.__smoothStore.getState().pending.length===1)
 check(await page.evaluate(()=>JSON.stringify(Array.from(window.__re.scene().scanDisplay().mesh.geometry.attributes.position.array))===JSON.stringify(window.__smoothFirst)),'Undo restores the exact first smoothing result')
 await call('history.redo');await sleep(200)
 check(await page.evaluate(()=>window.__smoothStore.getState().pending.length===2&&JSON.stringify(Array.from(window.__re.scene().scanDisplay().mesh.geometry.attributes.position.array))===JSON.stringify(window.__smoothSecond)),'Redo restores the exact second smoothing result')
 await call('mesh.mark',{for:'smooth',region:{box:{min:[-8,-8,-1],max:[8,8,1]}}})
 await click('[data-test=mark-clear]')
 check(await page.$eval('[data-test=mark-count]',e=>e.textContent.startsWith('0')),'Clear marking explicitly removes the retained selection')
 await intensity(35)
 const saved=await call('project.save');writeFileSync(join(root,'e2e-out','smooth-repeat-fixture.scanruler'),Buffer.from(saved.file.bytes))
 await call('project.load',{bytes:saved.file.bytes,name:'smooth-repeat-roundtrip.scanruler',discard:true})
 await page.waitForFunction(()=>!window.__re.measure.getState().busy)
 await click('[data-test=workspace-mesh]');await click('[data-test=mesh-tool-smooth]')
 if(!await page.$('[data-test=smooth-intensity]'))await click('[data-test=mesh-tool-smooth]')
 check(await page.$eval('[data-test=smooth-intensity]',e=>Number(e.value)===35),'saved projects restore the chosen smoothing intensity')
 check(await page.evaluate(()=>window.__smoothStore.getState().pending.length===2),'saved projects retain both pending Smooth applications')
 check(await page.evaluate(async()=>!(await import('/src/state/prefsStore.ts')).usePrefs.getState().agentLink),'Smooth and marking controls do not enable an agent')
}catch(e){fail(e.stack??String(e))}
finally{if(browser)await finish(browser,consoleErrors);if(server)await server.close()}
