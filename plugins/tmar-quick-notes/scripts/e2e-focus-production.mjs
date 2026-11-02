// SPDX-License-Identifier: AGPL-3.0-only
// Real production UI: no /src imports, development globals or agent connection.
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'
import { preview } from 'vite'
const root = fileURLToPath(new URL('../../../', import.meta.url))
const server = process.env.APP_URL ? null : await preview({ root, preview: { host: '127.0.0.1', port: 0, open: false } })
if (server) process.env.APP_URL = server.resolvedUrls.local[0]
const { launchApp, check, fail, finish, sleep, OUT_DIR, shotPath, pixelDiff } = await import('../../../scripts/e2e-lib.mjs')
let browser, page, consoleErrors = []
const scan = 'v 100 200 30\nv 140 200 30\nv 140 220 30\nv 100 220 30\nv 100 200 40\nv 140 200 40\nv 140 220 40\nv 100 220 40\nf 1 3 2\nf 1 4 3\nf 5 6 7\nf 5 7 8\nf 1 2 6\nf 1 6 5\nf 2 3 7\nf 2 7 6\nf 3 4 8\nf 3 8 7\nf 4 1 5\nf 4 5 8\n'
try {
  ;({browser, page, consoleErrors} = await launchApp({ userDataDir: mkdtempSync(join(OUT_DIR, 'focus-production-profile-')), width: 1600, height: 1000, agentDataOk: false }))
  page.on('dialog', dialog => dialog.accept())
  const drop = (data,name) => page.evaluate((data,name)=>{
    const transfer = new DataTransfer(); transfer.items.add(new File([typeof data === 'string' ? data : new Uint8Array(data)], name))
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
  },data,name)
  const click = async (selector,options) => { await page.waitForSelector(selector,{visible:true}); await page.click(selector,options); await sleep(180) }
  const visible = selector => page.$eval(selector,e=>getComputedStyle(e).display!=='none' && e.getBoundingClientRect().width>0)
  const center = selector => page.$eval(selector,e=>{const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height}})
  const centered = async id => {
    const ring = await center(`[data-test=note-focus-ring][data-note-id="${id}"]`)
    const canvas = await center('.viewport canvas')
    return Math.hypot(ring.x-canvas.x,ring.y-canvas.y)<3 && ring.w>=50
  }
  check(await page.evaluate(()=>!window.__re && !window.__reNotes), 'compiled app has no development-only CAD or note globals')
  await drop(scan,'focus-offset-box.obj')
  await page.waitForFunction(()=>document.querySelector('.file-info')?.textContent.includes('focus-offset-box.obj'))
  await page.waitForFunction(()=>document.querySelector('[data-test=save-project]')?.disabled===false)
  await page.evaluate(()=>{const original=URL.createObjectURL; URL.createObjectURL=blob=>{window.testSavedBlob=blob;return original(blob)};HTMLAnchorElement.prototype.click=function(){}})
  await click('[data-test=save-project]')
  await page.waitForFunction(()=>window.testSavedBlob instanceof Blob)
  const bytes=await page.evaluate(async()=>Array.from(new Uint8Array(await window.testSavedBlob.arrayBuffer())))
  const archive=unzipSync(Uint8Array.from(bytes)), manifest=JSON.parse(strFromU8(archive['project.json']))
  manifest.workspace='reverse'
  manifest.reverseNotes={notes:Array.from({length:40},(_,i)=>({id:i+1,text:`Production note ${i+1}`,at:[104+(i%8)*4,202+Math.floor(i/8)*3,40],normal:[0,0,1],on:i===1?[{kind:'vertex',body:999,point:[108,202,40]}]:i===2?[]:[{kind:'scan'}]}))}
  archive['project.json']=strToU8(JSON.stringify(manifest))
  const fixture=Array.from(zipSync(archive))
  await drop(fixture,'focus-fixture.scanruler')
  await page.waitForSelector('[data-note-id="40"]')
  await page.waitForFunction(()=>/ready/.test(document.querySelector('[data-test=kernel-status]')?.textContent??''),{timeout:180000})
  check(await page.$$eval('[data-test=note-row]',r=>r.length)===40,'production project loads all forty imported annotations')
  await page.$eval('[data-note-id="1"]',e=>e.scrollIntoView({block:'center'})); await sleep(150)
  const rowBefore = await center('[data-note-id="1"] [data-test=note-select]')
  await click('[data-note-id="1"] [data-test=note-select]')
  const rowAfter = await center('[data-note-id="1"] [data-test=note-select]')
  check(Math.abs(rowBefore.y-rowAfter.y)<1,'first row selection does not move the target between double-clicks')
  await click('[data-note-id="1"] [data-test=note-locate]')
  check(await centered(1),'target button visibly centers the offset scan anchor in the compiled viewport')
  check(await visible('[data-test=note-focus-ring]'),'a large focus ring is actually visible, not merely selected in the list')
  check(await page.$eval('[data-test=note-focus-feedback]',e=>e.textContent.includes('centered')),'note focus gives visible success feedback')
  await click('[data-test=note-return-view]')
  await click('[data-note-id="20"] [data-test=note-select]',{count:2})
  check(await centered(20),'real double-click centers another annotation in the production build')
  await click('[data-test=note-return-view]')
  await click('[data-test=workspace-labels]')
  await click('[data-test=toggle-notes]')
  await click('[data-note-id="7"] [data-test=note-locate]')
  check(await centered(7) && await visible('[data-test=note-label].focused'),'focus remains visible while ordinary labels and pins are off')
  check(await page.$eval('[data-test=toggle-notes]',e=>e.getAttribute('aria-pressed')==='false'),'locating one note does not enable all note pins')
  await click('[data-test=note-return-view]')
  // Reverse intentionally forbids hiding its only scan before a CAD body exists.
  // Deviation permits it; test a genuinely hidden scan instead of a disabled key.
  await click('[data-test=workspace-deviation]')
  await page.waitForSelector('[data-test=tmar-deviation-notes]')
  await click('[data-test=toggle-scan]')
  check(await page.$eval('[data-test=toggle-scan]',e=>e.getAttribute('aria-pressed')==='false'),'fixture actually hides the scan before testing saved-marker focus')
  await click('[data-note-id="1"] [data-test=note-locate]')
  check(await centered(1),'a hidden scan no longer blocks the saved note position')
  check(await page.$eval('[data-test=note-focus-feedback]',e=>/hidden/.test(e.textContent)),'hidden-target navigation is explicitly described, not silently repaired')
  check(await page.$eval('[data-test=toggle-scan]',e=>e.getAttribute('aria-pressed')==='false'),'hidden geometry remains hidden')
  await click('[data-test=note-return-view]'); await click('[data-test=toggle-scan]')
  await click('[data-test=workspace-reverse]')
  await click('[data-note-id="2"] [data-test=note-locate]')
  check(await centered(2) && await page.$eval('[data-test=note-focus-feedback]',e=>/no longer exists/.test(e.textContent)),'removed CAD references remain locatable as saved positions with a warning')
  // No Clear/Return between targets: first-click selection must not move
  // the row by removing the previous target's feedback or adding a toolbar.
  await click('[data-note-id="3"] [data-test=note-select]',{count:2})
  check(await centered(3),'legacy notes with no target record still locate their saved coordinates')
  check(await page.$eval('[data-note-id="3"]',e=>/From the project file/.test(e.textContent)),'navigation does not authorize or rewrite imported notes')
  await page.screenshot({path:shotPath('focus-production-marker.png')})
  await click('[data-test=note-return-view]')
  const collapse=await center('[data-test=notes-collapse]')
  check(collapse.h>=40 && collapse.w>=220,'Notes collapse is a full-width, large disclosure control')
  await click('[data-test=notes-collapse]'); check(!(await visible('[data-test=note-row]')),'the large header collapses Notes')
  await click('[data-test=notes-collapse]')
  const before=await page.$eval('.mid > .panel',e=>e.getBoundingClientRect().width)
  const handle=await center('[data-test=panel-resize]')
  await page.mouse.move(handle.x,handle.y);await page.mouse.down();await page.mouse.move(handle.x+150,handle.y,{steps:12});await page.mouse.up();await sleep(250)
  const after=await page.$eval('.mid > .panel',e=>e.getBoundingClientRect().width)
  check(Math.abs(after-before-150)<2,'dragging the divider really widens the left panel')
  check(await page.$$eval('[data-test=note-row]',r=>r.length)===40,'resizing leaves all notes and the project intact')
  await page.focus('[data-test=panel-resize]');await page.keyboard.press('ArrowLeft');await sleep(150)
  check(Math.abs(await page.$eval('.mid > .panel',e=>e.getBoundingClientRect().width)-(after-16))<2,'the divider also supports keyboard resizing')
  const persisted=await page.$eval('.mid > .panel',e=>e.getBoundingClientRect().width)
  await page.reload({waitUntil:'networkidle0'});await drop(fixture,'focus-fixture.scanruler');await page.waitForSelector('[data-note-id="40"]')
  check(Math.abs(await page.$eval('.mid > .panel',e=>e.getBoundingClientRect().width)-persisted)<2,'panel width persists after reloading the compiled app')
  await page.waitForFunction(()=>/ready/.test(document.querySelector('[data-test=kernel-status]')?.textContent??''),{timeout:180000})
  check(await visible('[data-test=zebra-quick-toggle]'),'Zebra has an always-visible lower-bar entry in Reverse engineer')
  const shot=()=>page.$('.viewport').then(e=>e.screenshot({encoding:'base64'}))
  const plain=await shot();await click('[data-test=zebra-quick-toggle]')
  await page.waitForFunction(()=>/Showing stripes on/.test(document.querySelector('[data-test=zebra-status]')?.textContent??''))
  const stripes=await shot()
  check((await page.$eval('[data-test=zebra-target]',e=>e.value))==='scan','Zebra selects the scan automatically when there are no CAD bodies')
  check(await pixelDiff(page,plain,stripes)>0.1,'the production Zebra button changes the rendered surface')
  await click('[data-test=zebra-quick-toggle]')
  check(await page.$eval('[data-test=zebra-enabled]',e=>!e.checked),'lower Zebra button and panel checkbox share the same state')
  await click('[data-test=open-settings]')
  check(await page.$eval('[data-test=toggle-agent-link]',e=>!e.checked),'all local operations leave the agent connection disabled')
  check(Boolean(await page.$('[data-test=panel-width-setting]')),'Settings also exposes the left-panel width')
  await click('[data-test=settings-close]')
  await page.screenshot({path:shotPath('focus-production-panel.png')})
  await page.setViewport({width:390,height:844});await sleep(250)
  check(!(await visible('[data-test=panel-resize]')),'the horizontal-width divider stays hidden in the phone layout')
  check(await page.$eval('.panel',e=>e.getBoundingClientRect().width<=391),'the saved desktop width does not break phone panels')
  await page.goto(process.env.APP_URL+'?plugins=none',{waitUntil:'networkidle0'});await page.waitForSelector('.panel')
  check(!(await page.$('[data-test=panel-resize]')),'omitting plugins restores the host without the resize extension')
} catch(error) { fail(error.stack??String(error)) }
finally { if(browser) await finish(browser,consoleErrors); if(server) await new Promise(resolve=>server.httpServer.close(resolve)) }
