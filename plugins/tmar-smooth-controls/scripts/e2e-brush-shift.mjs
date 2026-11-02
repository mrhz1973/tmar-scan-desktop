// SPDX-License-Identifier: AGPL-3.0-only
// Real pointer gestures, not mesh.mark. PRODUCTION=1 uses only the built UI.
import { mkdtempSync,writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer,preview } from 'vite'
import { noisySheet } from '../../tmar-mesh-review/scripts/fixture.mjs'
const root=fileURLToPath(new URL('../../../',import.meta.url)),prod=process.env.PRODUCTION==='1'
const server=process.env.APP_URL?null:prod?await preview({root,preview:{host:'127.0.0.1',port:0,open:false}}):await createServer({root,server:{host:'127.0.0.1',port:0,open:false,watch:{ignored:['**/e2e-out/**']}}})
if(server){if(!prod)await server.listen();process.env.APP_URL=server.resolvedUrls.local[0]}
const {launchApp,check,fail,finish,sleep,OUT_DIR,shotPath,pixelDiff}=await import('../../../scripts/e2e-lib.mjs')
let browser,page,consoleErrors=[]
try{
 ;({browser,page,consoleErrors}=await launchApp({width:1600,height:1050,agentDataOk:false,userDataDir:mkdtempSync(join(OUT_DIR,'brush-shift-profile-'))}))
 page.on('dialog',d=>d.accept())
 const click=async s=>{await page.waitForSelector(s,{visible:true});await page.click(s);await sleep(160)}
 const drop=async name=>{const bytes=noisySheet().bytes;await page.evaluate((bytes,name)=>{const dt=new DataTransfer();dt.items.add(new File([new Uint8Array(bytes)],name));window.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}))},Array.from(bytes),name);await page.waitForFunction(()=>document.querySelector('[data-test=save-project]')?.disabled===false,{timeout:120000});await sleep(200)}
 const rect=()=>page.$eval('.viewport canvas',e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})
 const count=()=>page.$eval('[data-test=mark-count]',e=>Number(e.textContent.replace(/[^0-9]/g,'')))
 const shot=async()=>{await page.mouse.move(4,4);await sleep(160);const r=await rect();return page.screenshot({clip:{x:r.x+20,y:r.y+55,width:r.w-40,height:r.h-150},encoding:'base64'})}
 const state=()=>page.evaluate(async()=>{const scene=(await import('/src/commands/host.ts')).sceneOf(),m=(await import('/plugins/mesh-tools/state/meshStore.ts')).useMeshTools.getState(),mark=(await import('/src/state/markStore.ts')).useMark.getState();return{ids:Array.from(scene.paintedVertices()),positions:Array.from(scene.scanMesh().positions),original:Array.from(scene.scanGeometry().attributes.position.array),scope:m.smoothScope,gesture:mark.gesture,pending:m.pending}})
 const drag=async(r,x0,y0,x1,y1,button='left')=>{await page.mouse.move(r.x+r.w*x0,r.y+r.h*y0);await page.mouse.down({button});await page.mouse.move(r.x+r.w*x1,r.y+r.h*y1,{steps:16});await page.mouse.up({button});await sleep(200)}
 const settled=async n=>{await page.waitForFunction(n=>document.querySelectorAll('[data-test=pending-edit]').length===n&&!document.querySelector('.busyoverlay'),{timeout:120000},n);await sleep(300)}
 if(prod)check(await page.evaluate(()=>!window.__re&&!window.__reNotes),'compiled regression uses no application development hooks')
 for(const gesture of ['brush','window','lasso']){
  await drop(`smooth-${gesture}.ply`);await click('[data-test=workspace-mesh]');if(!await page.$('[data-test=smooth-tool]'))await click('[data-test=mesh-tool-smooth]')
  await page.$eval('[data-test=mesh-tool-smooth]',e=>e.blur());await page.keyboard.press('1');await sleep(200)
  await click('[data-test=smooth-scope-marked]')
  check((await page.$$('[data-test=pending-edit]')).length===0,`${gesture}: selecting Marked region does not apply Smooth`)
  check(await page.$eval('[data-test=smooth-scan]',e=>e.disabled),`${gesture}: an empty region cannot smooth the whole part`)
  await click(`[data-test=mark-${gesture}]`);const r=await rect()
  if(gesture==='brush')await drag(r,.46,.5,.56,.5)
  else if(gesture==='window')await drag(r,.44,.4,.6,.6)
  else{await page.mouse.move(r.x+r.w*.44,r.y+r.h*.4);await page.mouse.down();for(const[x,y]of[[.6,.4],[.6,.6],[.44,.6],[.44,.4]])await page.mouse.move(r.x+r.w*x,r.y+r.h*y,{steps:8});await page.mouse.up();await sleep(250)}
  const selected=await count(),before=prod?null:await state()
  check(selected>5&&selected<2401,`${gesture}: actual pointer gesture marks a proper subset (${selected})`)
  if(!selected)throw new Error(`${gesture}: fixture not marked`)
  await click('[data-test=smooth-scan]');await settled(1)
  check(await count()===selected&&!await page.$eval('[data-test=smooth-scan]',e=>e.disabled),`${gesture}: first Smooth retains marking and the Apply button stays enabled`)
  check(await page.$eval(`[data-test=mark-${gesture}]`,e=>e.getAttribute('aria-pressed')==='true'),`${gesture}: Smooth keeps the chosen marking tool, not an automatic Navigate`)
  const first=prod?null:await state()
  await click('[data-test=smooth-scan]');await settled(2)
  check(await count()===selected&&!await page.$eval('[data-test=smooth-scan]',e=>e.disabled),`${gesture}: second Smooth needs no extra brush dab or reselection`)
  if(!prod){const after=await state(),mask=new Set(before.ids);check(JSON.stringify(after.ids)===JSON.stringify(before.ids),`${gesture}: exact selected vertex IDs survive both passes`);check(after.positions.every((x,i)=>mask.has(Math.floor(i/3))||Object.is(x,before.positions[i])),`${gesture}: every unselected coordinate stays unchanged`);check(first.positions.some((x,i)=>x!==before.positions[i])&&after.positions.some((x,i)=>x!==first.positions[i]),`${gesture}: both regional passes actually move selected geometry`);check(JSON.stringify(after.original)===JSON.stringify(before.original),`${gesture}: the original scan in use stays unchanged`);writeFileSync(shotPath(`${gesture}-verification.json`),JSON.stringify({selected,region:after.pending.map(p=>p.region),outsideChanged:after.positions.filter((x,i)=>!mask.has(Math.floor(i/3))&&!Object.is(x,before.positions[i])).length},null,2))}
  const kept=await count()
  for(const button of ['left','right']){
   const beforeView=await shot();await page.keyboard.down('Shift');await sleep(80)
   check(await page.$eval('[data-test=mark-navigate]',e=>e.getAttribute('aria-pressed')==='true'),`${gesture}/${button}: holding Shift visibly activates temporary Navigate`)
   await drag(await rect(),.5,.5,.56,.54,button);const movedView=await shot()
   check(await pixelDiff(page,beforeView,movedView)>.03,`${gesture}/${button}: Shift navigation changes the model view`)
   check(await count()===kept,`${gesture}/${button}: navigation never paints or erases the retained region`)
   await page.keyboard.up('Shift');await sleep(100)
   check(await page.$eval(`[data-test=mark-${gesture}]`,e=>e.getAttribute('aria-pressed')==='true'),`${gesture}/${button}: releasing Shift restores the same marking tool`)
  }
  await page.screenshot({path:shotPath(`${gesture}-repeat-shift.png`)})
  // Clear remains explicit; no ghost selection or fallback to full smoothing.
  await click('[data-test=mark-clear]');check(await count()===0&&await page.$eval('[data-test=smooth-scan]',e=>e.disabled),`${gesture}: Clear marking removes the area and disables regional Smooth`)
 }
 // A closed 3D object checks that the back/side surfaces do not move either.
 if(!prod){
  const {noisyBoxScan}=await import('../../../scripts/e2e-fixtures.mjs'),box=noisyBoxScan({seed:11,noise:.03,holes:false})
  await page.evaluate(async bytes=>{(await import('/src/commands/core.ts')).registerCoreCommands();await(await import('/src/commands/registry.ts')).runCommand('scan.open',{bytes:new Uint8Array(bytes),name:'closed-brush-box.stl',units:'mm',discard:true})},Array.from(box.bytes))
  await click('[data-test=workspace-mesh]');if(!await page.$('[data-test=smooth-tool]'))await click('[data-test=mesh-tool-smooth]');await click('[data-test=smooth-scope-marked]');await click('[data-test=mark-brush]');await page.$eval('[data-test=mark-brush]',e=>e.blur());await page.keyboard.press('1');await sleep(200)
  await drag(await rect(),.46,.5,.56,.5);const before=await state(),selected=new Set(before.ids)
  check(selected.size>5&&selected.size<before.positions.length/3,'closed STL: a brush selects only part of the actual 3D scan')
  for(let n=1;n<=2;n++){await click('[data-test=smooth-scan]');await settled(n)}
  const after=await state()
  check(JSON.stringify(after.ids)===JSON.stringify(before.ids)&&await count()===before.ids.length,'closed STL: two Smooth applications retain the exact brush selection')
  check(after.positions.every((x,i)=>selected.has(Math.floor(i/3))||Object.is(x,before.positions[i])),'closed STL: every unselected side/back vertex remains bit-identical')
  check(after.positions.some((x,i)=>x!==before.positions[i]),'closed STL: the selected surface really changes')
  check(JSON.stringify(after.original)===JSON.stringify(before.original),'closed STL: the original scan remains unchanged')
 }
 // A Shift arriving during a brush stroke must stop paint before the camera moves.
 await drop('midstroke.ply');await click('[data-test=workspace-mesh]');if(!await page.$('[data-test=smooth-tool]'))await click('[data-test=mesh-tool-smooth]');await click('[data-test=smooth-scope-marked]');await click('[data-test=mark-brush]');await page.$eval('[data-test=mark-brush]',e=>e.blur());await page.keyboard.press('1');await sleep(150)
 const r=await rect();await page.mouse.move(r.x+r.w*.48,r.y+r.h*.5);await page.mouse.down();await page.mouse.move(r.x+r.w*.51,r.y+r.h*.5,{steps:10});await sleep(100);await page.keyboard.down('Shift');await sleep(100);const mid=await count();await page.mouse.move(r.x+r.w*.65,r.y+r.h*.62,{steps:15});await page.mouse.up();await sleep(120)
 check(await count()===mid&&mid>0,'Shift pressed during an active brush stroke stops painting before navigation')
 await page.keyboard.up('Shift');await sleep(100);check(await page.$eval('[data-test=mark-brush]',e=>e.getAttribute('aria-pressed')==='true'),'mid-stroke Shift release does not require rearming Brush')
 await click('[data-test=open-settings]');check(await page.$eval('[data-test=toggle-agent-link]',e=>!e.checked),'regional smoothing and navigation never enable agent access');await click('[data-test=settings-close]')
}catch(e){fail(e.stack??String(e))}
finally{if(browser)await finish(browser,consoleErrors);if(server){if(prod)await new Promise(r=>{server.httpServer.close(r);server.httpServer.closeAllConnections()});else await server.close()}}
