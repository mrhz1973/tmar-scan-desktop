// SPDX-License-Identifier: AGPL-3.0-only
// Own server/profile; generated boxes only. No user tabs or real agent connection.
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
const root = fileURLToPath(new URL('../../../', import.meta.url))
const server = !process.env.APP_URL ? await createServer({ root, server: { host: '127.0.0.1', port: 0, open: false, watch: { ignored: ['**/e2e-out/**'] } } }) : null
if (server) { await server.listen(); process.env.APP_URL = server.resolvedUrls.local[0] }
const { launchApp, check, fail, finish, sleep, OUT_DIR, shotPath } = await import('../../../scripts/e2e-lib.mjs')
const downloads = mkdtempSync(join(OUT_DIR, 'usability-'))
let browser, page, consoleErrors = []
const box = () => {
  const points = [[-2,-2,0],[42,-2,0],[42,22,0],[-2,22,0],[-2,-2,14],[42,-2,14],[42,22,14],[-2,22,14]]
  const faces = [[0,3,2],[0,2,1],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]]
  const bytes = Buffer.alloc(84 + faces.length * 50); bytes.writeUInt32LE(faces.length,80)
  faces.forEach((f,i) => f.forEach((v,k) => points[v].forEach((x,j) => bytes.writeFloatLE(x,84+i*50+12+k*12+j*4))))
  return Array.from(bytes)
}
try {
  // Keep this explicitly owned profile with ignored diagnostics. This avoids
  // Windows racing Puppeteer's automatic temporary-profile deletion on close.
  const profile = mkdtempSync(join(OUT_DIR, 'usability-profile-'))
  ;({ browser, page, consoleErrors } = await launchApp({ width: 1600, height: 1100, protocolTimeout: 180_000, userDataDir: profile }))
  page.on('dialog', (d) => d.accept())
  console.log('ENV', process.platform, process.version, await browser.version())
  const cdp = await browser.target().createCDPSession()
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads })
  const call = (name, input = {}) => page.evaluate(async (name, input) => {
    const { registerCoreCommands } = await import('/src/commands/core.ts'); registerCoreCommands()
    if (input.bytes) input.bytes = Uint8Array.from(input.bytes)
    const result = await (await import('/src/commands/registry.ts')).runCommand(name, input)
    if (result?.file?.bytes) result.file.bytes = Array.from(result.file.bytes)
    return result
  }, name, input)
  const click = async (sel, options) => { await page.waitForSelector(sel); await page.click(sel, options); await sleep(80) }
  const modifiedClick = async (sel, key) => { await page.keyboard.down(key); await click(sel); await page.keyboard.up(key) }
  const download = async (extension) => {
    for (let i = 0; i < 400; i++) { const file = readdirSync(downloads).find((f) => f.endsWith(extension)); if (file) return readFileSync(join(downloads,file)); await sleep(100) }
    throw new Error('Missing download ' + extension)
  }
  await call('scan.open', { name: 'usability-synthetic.stl', bytes: box(), units: 'mm' })
  await click('[data-test=workspace-reverse]')
  await page.waitForFunction(() => /ready/.test(document.querySelector('[data-test=kernel-status]')?.textContent ?? ''), { timeout: 180_000 })
  const block = async (name, x) => {
    const pts = [[x,0],[x+40,0],[x+40,20],[x,20]]
    await call('reverse.feature.add', { feature: { kind: 'sketch', name: name+' profile', plane: {kind:'world',axis:'z'}, sketch: {
      entities: pts.map((a,i)=>({ id:i+1,kind:'line',a,b:pts[(i+1)%4] })),
      constraints: pts.map((_,i)=>({kind:'coincident',p:{entity:i+1,at:'b'},q:{entity:(i+1)%4+1,at:'a'}})),
    } } })
    await call('reverse.feature.add', { feature: {kind:'extrude', name, sketchId:name+' profile', extent:{kind:'distance',from:0,to:10},op:'new'} })
  }
  await block('First', 0); await block('Second', 60)
  const ids = await page.evaluate(()=>window.__re.store.getState().bodies.map(b=>b.id))
  const group = (name) => `[data-feature-category="${name}"]`
  const featureRows = await page.$$eval(group('sketches')+' [data-test=feature-select-row]', rows=>rows.map(r=>r.dataset.featureId))
  const frow = (n) => `${group('sketches')} [data-feature-id="${featureRows[n]}"] .name`
  const selected = (name) => page.$$eval(group(name)+' [data-test=feature-select-row][aria-selected=true]',r=>r.length)
  await click(frow(0)); await modifiedClick(frow(1),'Control')
  check(await selected('sketches') === 2 && await selected('bodies') === 0, 'feature Ctrl-click selects within Sketches only')
  await click(frow(0)); await modifiedClick(frow(1),'Shift')
  check(await selected('sketches') === 2 && await selected('bodies') === 0, 'feature Shift-click uses the category range, not interleaved body operations')
  await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); await sleep(100)
  check(await selected('sketches') === 2 && await selected('bodies') === 0, 'Ctrl+A selects only the focused feature category')
  await click(group('sketches')+' [data-test=features-show]')
  const historyBefore = await page.evaluate(async()=>(await import('/src/state/historyStore.ts')).useHistory.getState().past.length)
  await page.evaluate(()=>{const r=window.__re.store.getState();window.__categoryBodies=r.bodies;window.__categoryHidden=r.hiddenBodies;window.__categoryBuild=r.buildVersion})
  await click(group('sketches')+' [data-test=features-hide]')
  check(await page.evaluate(()=>{const r=window.__re.store.getState();return r.bodies===window.__categoryBodies && r.hiddenBodies===window.__categoryHidden && r.buildVersion===window.__categoryBuild && r.bodies.every(b=>b.visible) && r.features.filter(f=>f.kind==='sketch').every(f=>!f.visible) && r.features.every(f=>!f.suppressed)}), 'hiding every sketch preserves body identities, visibility, build version and suppression')
  check(await page.evaluate(async()=>(await import('/src/state/historyStore.ts')).useHistory.getState().past.length) === historyBefore+1, 'category visibility is one history step')
  await call('history.undo')
  await page.waitForFunction(()=>!window.__re.store.getState().building)
  check(await page.evaluate(()=>window.__re.store.getState().bodies.every(b=>b.visible) && window.__re.store.getState().features.filter(f=>f.kind==='sketch').every(f=>f.visible)), 'one undo restores sketches without hiding bodies')
  await page.waitForFunction(async () => !(await import('/src/state/historyStore.ts')).useHistory.getState().importing)
  await click(group('bodies')+' [data-test=features-select-all]')
  const bodyHistory=await page.evaluate(async()=>(await import('/src/state/historyStore.ts')).useHistory.getState().past.length)
  await click(group('bodies')+' [data-test=features-hide]')
  check(await page.evaluate(()=>window.__re.store.getState().bodies.every(b=>!b.visible) && window.__re.store.getState().features.filter(f=>f.kind==='sketch').every(f=>f.visible)), 'explicit Body-category hide leaves all sketches visible')
  check(await page.evaluate(async()=>(await import('/src/state/historyStore.ts')).useHistory.getState().past.length)===bodyHistory+1, 'body-category visibility remains one undo step')
  await call('history.undo'); await page.waitForFunction(()=>!window.__re.store.getState().building)
  check(await page.evaluate(()=>window.__re.store.getState().bodies.every(b=>b.visible)), 'one undo restores the hidden body outputs')
  await page.waitForFunction(async () => !(await import('/src/state/historyStore.ts')).useHistory.getState().importing)
  await click(group('sketches')+' [data-test=features-select-all]')
  await click('[data-test=features-collapse]'); await click('[data-test=features-collapse]')
  check(await selected('sketches') === 2, 'collapsing Features preserves category selection')

  check(!(await page.$('[data-test=export-body-step]')) && !(await page.$('[data-test=export-body-stl]')), 'the default panel has one Export body entry point')
  await page.evaluate(id=>window.__re.store.getState().setListSelection({bodies:[id],folders:[]}),ids[0])
  await click('[data-test=export-body]')
  await page.select('[data-test=body-stl-scope]','selected')
  await page.select('[data-test=body-export-format]','step'); await click('[data-test=export-body-save]')
  const step = await download('.step')
  check(step.toString('utf8').startsWith('ISO-10303-21;') && step.toString('utf8').includes('MANIFOLD_SOLID_BREP'), 'unified export downloads an actual CAD STEP')
  await click('[data-test=export-body]'); await page.select('[data-test=body-export-format]','stl'); await click('[data-test=export-body-save]')
  const stl = await download('.stl'), count = stl.readUInt32LE(80), max=[-Infinity,-Infinity,-Infinity]
  for(let i=0;i<count;i++)for(let v=0;v<3;v++)for(let k=0;k<3;k++)max[k]=Math.max(max[k],stl.readFloatLE(84+i*50+12+v*12+k*4))
  check(count === 12 && JSON.stringify(max)==='[40,20,10]', 'unified STL contains the selected CAD body, not scan or second body')

  await click('[data-test=open-settings]'); await page.select('[data-test=note-shortcut]','q'); await click('[data-test=settings-close]')
  await page.mouse.click(900,120); await page.keyboard.press('q'); await sleep(150)
  check(await page.evaluate(()=>window.__reNotes.getState().placing), 'configured Q shortcut arms a local note')
  await page.keyboard.press('Escape')
  await call('view.set', {view:'top',fit:true})
  await page.evaluate(() => {
    const n=window.__reNotes.getState()
    n.load(Array.from({length:40},(_,i)=>({id:i+1,text:'Synthetic note '+(i+1),at:[5+(i%8)*4,3+Math.floor(i/8)*3,14],normal:[0,0,1],on:[{kind:'scan'}]})))
  })
  await sleep(150)
  const row=(id)=>`[data-note-id="${id}"] [data-test=note-select]`
  await click(row(1)); await modifiedClick(row(5),'Control')
  check(await page.$$eval('[data-test=note-row][aria-selected=true]',r=>r.length)===2,'notes support individual and Ctrl selection without opening the editor')
  check(!(await page.$('[data-test=note-card]')),'single-click never opens or overwrites a note draft')
  await modifiedClick(row(40),'Shift')
  check(await page.$$eval('[data-test=note-row][aria-selected=true]',r=>r.length)===36,'Shift selects a note range across a long scrolled list')
  await click('[data-test=notes-select-all]')
  check(await page.$$eval('[data-test=note-row][aria-selected=true]',r=>r.length)===40,'Select all includes all 40 notes')
  await click('[data-test=notes-clear-selection]')
  const camera = () => page.evaluate(() => {
    const view=window.__re.scene().viewLink(); return {target:view.target.toArray(),position:view.camera.position.toArray(),zoom:view.camera.zoom,extents:view.extents()}
  })
  const oldCamera=await camera()
  await click(row(20),{count:2}); await sleep(200)
  const focus=await camera()
  check(focus.target.every((v,i)=>Math.abs(v-[17,9,14][i])<1e-6), `double-click frames the actual note anchor: ${JSON.stringify(focus.target)}`)
  check(Boolean(await page.$('[data-note-id="20"].tmar-focused')), 'the focused note row is highlighted')
  await click('[data-test=note-return-view]')
  const back=await camera()
  check(JSON.stringify(back.target)===JSON.stringify(oldCamera.target) && Math.abs(back.zoom-oldCamera.zoom)<1e-9 && JSON.stringify(back.extents)===JSON.stringify(oldCamera.extents),'Return restores camera target, framing and zoom')
  await click('[data-test=workspace-labels]')
  await page.evaluate(()=>window.__reNotes.getState().setPinsShown(false))
  await click('[data-note-id="7"] [data-test=note-locate]')
  check(await page.evaluate(()=>!window.__reNotes.getState().pinsShown && document.querySelectorAll('[data-test=note-label].focused').length===1),'target button temporarily highlights only its note without enabling all pins')
  check(await page.evaluate(()=>getComputedStyle(document.querySelector('[data-test=note-label].focused')).display!=='none'),'focused note remains readable with Labels off')
  await click('[data-test=note-return-view]')
  await click('[data-note-id="1"] [data-test=note-edit]')
  const typedBefore=await page.$eval('[data-test=note-text]',e=>e.value)
  await page.type('[data-test=note-text]','q')
  const typed = await page.$eval('[data-test=note-text]',e=>e.value)
  check(typed !== typedBefore && await page.evaluate(()=>!window.__reNotes.getState().placing),'the note shortcut does not steal text input')
  await click('[data-test=notes-collapse]')
  check((await page.$eval('[data-test=note-text]',e=>e.value))===typed,'collapsing Notes keeps an unsaved draft intact')
  await page.keyboard.press('Escape'); await click('[data-test=notes-collapse]')
  await click(row(2)); await modifiedClick(row(4),'Control'); await click('[data-test=notes-delete-selected]')
  check(await page.evaluate(()=>window.__reNotes.getState().notes.length===38 && window.__reNotes.getState().notes.some(n=>n.id===3)),'Delete selected removes only the explicit selected notes')
  // CAD anchors use the existing topology, not guessed coordinates.
  const described = await call('reverse.body.describe', {body: ids[0]})
  const top = described.bodies[0].faceList.find(f => f.normal?.[2] === 1)
  if (!top) throw new Error('Synthetic CAD top face missing')
  const added = await call('reverse.note.add', { body: ids[0], faces: [top.index], text: 'Synthetic CAD focus' })
  const cadId = added.note.id
  const cadAt = await page.evaluate(id => window.__reNotes.getState().notes.find(n => n.id === id).at, cadId)
  await click(`[data-note-id="${cadId}"] [data-test=note-locate]`)
  const cadView = await camera()
  check(cadView.target.every((v,i) => Math.abs(v-cadAt[i])<1e-6), 'target button locates a verified CAD face anchor')
  await click('[data-test=note-return-view]')
  await page.evaluate(id => window.__re.store.getState().setBodiesVisible([id],false), ids[0])
  await click(`[data-note-id="${cadId}"] [data-test=note-locate]`)
  check((await camera()).target.every((v,i) => Math.abs(v-cadAt[i])<1e-6) && await page.evaluate(id => !window.__re.store.getState().bodies.find(b=>b.id===id).visible && /hidden/.test(window.__re.measure.getState().statusText), ids[0]), 'a hidden CAD target shows its saved note position with a warning, without revealing geometry')
  await page.evaluate(([body,note]) => { window.__re.store.getState().setBodiesVisible([body],true); window.__reNotes.getState().removeNote(note) }, [ids[0],cadId])
  // Switching workspaces must not lose per-workspace text/pin preferences.
  await click('[data-test=workspace-mesh]')
  check(Boolean(await page.$('[data-test=workspace-labels]')), 'Mesh Tools exposes a lower-bar Labels key')
  await click('[data-test=workspace-labels]')
  check(await page.$$eval('[data-test=note-label]', labels => labels.every(e => getComputedStyle(e).display === 'none')), 'Labels off actually hides note text in Mesh Tools')
  await click('[data-test=workspace-note-pins]')
  check(await page.evaluate(() => !window.__reNotes.getState().pinsShown), 'Mesh Tools can separately hide note markers without deleting records')
  await click('[data-test=workspace-reverse]')
  check(await page.evaluate(() => !window.__re.measure.getState().showLabels), 'returning to Reverse restores its own Labels preference')
  await click('[data-test=workspace-mesh]')
  check(await page.evaluate(() => !window.__re.measure.getState().showLabels && !window.__reNotes.getState().pinsShown), 'Mesh Tools restores its own hidden label/pin preference')
  await click('[data-test=workspace-reverse]')
  await page.screenshot({path:shotPath('usability-reverse.png')})

  await page.evaluate(id=>window.__re.store.getState().setBodiesVisible([id],false),ids[1])
  await call('reverse.body.compare_in_deviation')
  await page.waitForSelector('[data-test=tmar-deviation-notes]')
  check(await page.evaluate(async()=>!(await import('/src/state/prefsStore.ts')).usePrefs.getState().agentLink),'Deviation notes are available with the agent connection off')
  check((await page.$eval('[data-test=workspace-labels]',b=>b.getAttribute('aria-pressed')))==='true','Deviation has an independent Labels preference')
  await click('[data-test=workspace-labels]')
  check(await page.evaluate(()=>document.querySelector('.viewport')?.classList.contains('nolabels')),'Labels control hides viewport text in Deviation')
  await page.keyboard.press('q'); await sleep(150)
  check(await page.evaluate(()=>window.__reNotes.getState().placing),'the shortcut also arms a note in Deviation')
  await page.keyboard.press('Escape')
  const saved=await call('project.save'); const bytes=Array.from(saved.file.bytes)
  await call('project.load',{bytes,name:'synthetic-usability.scanruler',discard:true})
  check(await page.evaluate(()=>window.__reNotes.getState().notes.length===38 && window.__reNotes.getState().notes.every(n=>n.fromFile===true)),'save/reopen preserves local notes and imported provenance')
  await click('[data-test=open-settings]')
  check((await page.$eval('[data-test=note-shortcut]',e=>e.value))==='q','shortcut preference remains selected after reopening a project')
  await click('[data-test=settings-close]')
  await page.screenshot({path:shotPath('usability-deviation.png')})
  await page.goto(process.env.APP_URL+'?plugins=none',{waitUntil:'domcontentloaded'})
  await page.waitForSelector('.panel')
  check(!(await page.$('[data-test=tmar-body-export]')),'host still starts with all plugins disabled')
} catch (error) { fail(error.stack ?? String(error)) }
finally { if(browser) await finish(browser,consoleErrors); if(server) await server.close() }
