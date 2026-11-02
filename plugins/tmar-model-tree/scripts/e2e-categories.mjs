// SPDX-License-Identifier: AGPL-3.0-only
// Synthetic data in an owned browser profile/server; never attach a user tab.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
const root = fileURLToPath(new URL('../../../', import.meta.url))
const server = process.env.APP_URL ? null : await createServer({ root, server: { host: '127.0.0.1', port: 0, open: false, watch: { ignored: ['**/e2e-out/**'] } } })
if (server) { await server.listen(); process.env.APP_URL = server.resolvedUrls.local[0] }
const { launchApp, check, fail, finish, sleep, OUT_DIR, shotPath, MOD } = await import('../../../scripts/e2e-lib.mjs')
let browser, page, consoleErrors = []
const scan = 'v 0 0 0\nv 40 0 0\nv 40 30 0\nv 0 30 0\nv 0 0 20\nv 40 0 20\nv 40 30 20\nv 0 30 20\nf 1 3 2\nf 1 4 3\nf 5 6 7\nf 5 7 8\nf 1 2 6\nf 1 6 5\nf 2 3 7\nf 2 7 6\nf 3 4 8\nf 3 8 7\nf 4 1 5\nf 4 5 8\n'
const sketch = (name, x = 0, plane = { kind: 'world', axis: 'z' }) => ({ kind: 'sketch', name, plane,
  sketch: { shapes: [{ kind: 'rectangle', id: 1, center: [x, 0], size: [12, 8], fixed: true }] } })
try {
  ;({ browser, page, consoleErrors } = await launchApp({ width: 1600, height: 1100, protocolTimeout: 180000, agentDataOk: false, userDataDir: mkdtempSync(join(OUT_DIR, 'categories-profile-')) }))
  page.on('dialog', (d) => d.accept())
  const call = (name, args = {}) => page.evaluate(async (name, args) => {
    const { registerCoreCommands } = await import('/src/commands/core.ts'); registerCoreCommands()
    if (args.bytes) args.bytes = Uint8Array.from(args.bytes)
    const result = await (await import('/src/commands/registry.ts')).runCommand(name, args)
    if (result?.file?.bytes) result.file.bytes = Array.from(result.file.bytes)
    return result
  }, name, args)
  const click = async (s, options) => { await page.waitForSelector(s, { visible: true }); await page.click(s, options); await sleep(160) }
  const ready = () => page.waitForFunction(async () => {
    const r = window.__re.store.getState(), h = (await import('/src/state/historyStore.ts')).useHistory.getState()
    return !r.building && !h.importing && !h.restoring
  }, { timeout: 180000 })
  const group = (g) => `[data-feature-category="${g}"]`
  const selected = (g) => page.$$eval(group(g)+' [aria-selected=true][data-test=feature-select-row]', rows => rows.map(r => Number(r.dataset.featureId)))
  const names = (g) => page.$$eval(group(g)+' [data-test=feature-select-row] .name', rows => rows.map(r => r.textContent))
  const nameOf = async (name) => page.evaluate(name => window.__re.store.getState().features.find(f => f.name === name)?.id, name)
  const row = (g, id) => `${group(g)} [data-feature-id="${id}"]`
  const snapshot = () => page.evaluate(() => {
    const r=window.__re.store.getState(); return { ids:r.features.map(f=>f.id), hidden:r.hiddenBodies, bodies:r.bodies.map(b=>({id:b.id,visible:b.visible,surface:!!b.surface})), sketches:r.features.filter(f=>f.kind==='sketch').map(f=>({id:f.id,visible:f.visible})), build:r.buildVersion, notes:window.__reNotes.getState().notes }
  })
  const modified = async (selector,key) => { await page.keyboard.down(key); await click(selector); await page.keyboard.up(key) }
  await call('scan.open', { name:'category-fixture.obj', bytes:Array.from(new TextEncoder().encode(scan)), units:'mm' })
  await click('[data-test=workspace-reverse]')
  await page.waitForFunction(() => /ready/.test(document.querySelector('[data-test=kernel-status]')?.textContent??''), {timeout:180000})
  await call('reverse.feature.add', { features:[sketch('Profile A'),{kind:'extrude',name:'Solid A',sketchId:'Profile A',extent:{kind:'distance',from:0,to:10},op:'new'},sketch('Profile B',30),{kind:'extrude',name:'Solid B',sketchId:'Profile B',extent:{kind:'distance',from:0,to:7},op:'new'}] })
  const section = await call('section.cut', { across:'XY', offset:5, name:'Section fixture' })
  await call('reverse.feature.add', { feature:sketch('Section profile',0,{kind:'section',id:section.section.id}) })
  await call('reverse.feature.add', { feature:{kind:'sheet',name:'Surface fixture',sketchId:'Profile B',from:0,to:6} })
  await click('[data-test=workspace-reverse]'); await ready()
  await page.evaluate(() => window.__reNotes.getState().load([{id:1,text:'Category preservation note',at:[20,15,20],normal:[0,0,1],on:[{kind:'scan'}]}]))
  check((await names('sketches')).join('|')==='Profile A|Profile B','ordinary sketches appear once in their category and in original relative order')
  check((await names('sections')).join('|')==='Section profile','section-based sketches have a separate category')
  check((await names('surfaces')).join('|')==='Surface fixture','surface operations are not mixed with solid operations')
  check((await names('bodies')).join('|')==='Solid A|Solid B','solid operations have a separate group from sketches')
  check(await page.$eval('[data-test=feature-build-history]',e=>!e.open),'chronological history is separately collapsible, initially closed')
  check(await page.$$eval('[data-test=feature-selection] > #tmar-features-content > .toolrow',e=>e.length)===0,'there is no global mixed-category Select All/Hide toolbar')
  await click(group('sketches')+' [data-test=features-select-all]'); await click(group('sketches')+' [data-test=features-show]')
  await click(group('sections')+' [data-test=features-select-all]'); await click(group('sections')+' [data-test=features-show]')
  const before = await snapshot()
  await click(group('sketches')+' [data-test=features-hide]')
  const after = await snapshot()
  check(JSON.stringify(before.bodies)===JSON.stringify(after.bodies) && JSON.stringify(before.hidden)===JSON.stringify(after.hidden),'hiding every ordinary sketch preserves all solid and surface body visibility')
  check(JSON.stringify(before.ids)===JSON.stringify(after.ids) && before.build===after.build && JSON.stringify(before.notes)===JSON.stringify(after.notes),'category visibility never changes build order, build version or note records')
  check(await page.evaluate(()=>window.__re.store.getState().features.find(f=>f.name==='Section profile').visible),'hiding ordinary sketches leaves section sketches visible')
  await click(group('sections')+' [data-test=features-hide]')
  check(await page.evaluate(()=>window.__re.measure.getState().sections.some(s=>s.name==='Section fixture' && s.visible)),'hiding section sketches does not hide the source section')
  await call('history.undo'); await ready()
  check(await page.evaluate(()=>window.__re.store.getState().features.find(f=>f.name==='Section profile').visible),'Undo restores the section category independently')
  await click(group('surfaces')+' [data-test=features-select-all]'); await click(group('surfaces')+' [data-test=features-hide]')
  check(await page.evaluate(()=>{const b=window.__re.store.getState().bodies;return b.filter(b=>b.surface).every(b=>!b.visible)&&b.filter(b=>!b.surface).every(b=>b.visible)}),'Surface Hide cannot hide solid bodies')
  await call('history.undo'); await ready()
  await click(group('bodies')+' [data-test=features-select-all]'); await click(group('bodies')+' [data-test=features-hide]')
  check(await page.evaluate(()=>{const b=window.__re.store.getState().bodies;return b.filter(b=>!b.surface).every(b=>!b.visible)&&b.filter(b=>b.surface).every(b=>b.visible)}),'Body Hide cannot hide surface bodies')
  await call('history.undo'); await ready()
  const a = await nameOf('Profile A'), b = await nameOf('Profile B'), solidA = await nameOf('Solid A'), sectionId = await nameOf('Section profile')
  await click(row('sketches',a)+' .name'); await modified(row('sketches',b)+' .name',MOD)
  await click(row('sections',sectionId)+' .name')
  check((await selected('sketches')).length===2 && (await selected('sections')).length===1,'selection is independent in different categories')
  await click(row('sketches',a)+' .name'); await modified(row('sketches',b)+' .name','Shift')
  check((await selected('sketches')).join(',')===[a,b].join(',') && !(await selected('sketches')).includes(solidA),'Shift range follows sketch order, not interleaved CAD history')
  await click('[data-test=category-collapse-sketches]'); await click('[data-test=category-collapse-sketches]')
  check((await selected('sketches')).length===2,'collapsing one category preserves its selection')
  await call('reverse.feature.add',{feature:sketch('Late profile',60)})
  check((await selected('sketches')).length===2,'newly generated features do not automatically join an existing selection')
  // Actual editing uses the native row handler, not a cloned recipe.
  await click(row('bodies',solidA)+' [data-test=edit-element]')
  await page.waitForSelector('[data-test=extrude-cancel]',{visible:true})
  check(await page.$eval(group('sketches')+' [data-test=features-hide]',e=>e.disabled),'category bulk actions are locked during native feature editing')
  await sleep(900); await click('[data-test=extrude-cancel]'); await ready()
  check((await snapshot()).ids.includes(solidA),'canceling native row editing retains the original feature identity')
  // Suppression is still the native, explicit build action, never Hide.
  const solidB=await nameOf('Solid B')
  await click(group('bodies')+' [data-test=features-clear]')
  await click(row('bodies',solidB)+' [data-test=feature-suppress]'); await ready()
  await click(row('bodies',solidB)+' .name')
  check(await page.$eval(row('bodies',solidB)+' [data-test=feature-row]',e=>e.dataset.suppressed==='true'),'suppressed native feature rows remain represented in their category')
  check(await page.$eval(group('bodies')+' [data-test=features-hide]',e=>e.disabled),'a selected suppressed operation has no bulk visibility permission')
  await click(row('bodies',solidB)+' [data-test=feature-unsuppress]'); await ready()
  check(await page.evaluate(()=>window.__re.store.getState().bodies.filter(b=>!b.surface).length===2),'native grouped-row unsuppress restores its solid without changing feature order')
  // Deleting only an unused profile through its native row leaves the bodies.
  const late=await nameOf('Late profile'), beforeDelete=await snapshot()
  await click(row('sketches',late)+' button[title="Delete Late profile"]'); await ready()
  check(!(await snapshot()).ids.includes(late) && JSON.stringify((await snapshot()).bodies)===JSON.stringify(beforeDelete.bodies),'native grouped-row deletion removes only the unused profile')
  const historyIds=(await snapshot()).ids
  await click('[data-test=feature-build-history] > summary')
  check(await page.$$eval('[data-test=feature-build-history] [data-test=feature-row]',rows=>rows.map(r=>r.querySelector('.name')?.textContent).join('|'))===await page.evaluate(()=>window.__re.store.getState().features.map(f=>f.name).join('|')),'original chronological rows retain CAD build order, independently from grouped order')
  await call('reverse.feature.rollback',{to:2}); await ready()
  check(await page.$$eval('[data-test=feature-category] [data-test=feature-row-rolled]',r=>r.length)===historyIds.length-2,'rolled-back operations remain represented in their categories')
  check((await names('sketches')).includes('Profile B') && (await names('bodies')).includes('Solid B'),'rollback never drops categorized rows')
  await click('[data-test=rollback-end]'); await ready()
  check(JSON.stringify((await snapshot()).ids)===JSON.stringify(historyIds),'native To end restores the exact chronological sequence')
  await click('[data-test=playback-start]'); await page.waitForSelector('[data-test=playback-bar]',{visible:true})
  check(await page.$eval('[data-test=feature-build-history]',e=>e.open),'playback remains in the original chronology, not category order')
  await click('[data-test=playback-stop]'); await ready()
  check(JSON.stringify((await snapshot()).ids)===JSON.stringify(historyIds),'stopping playback restores the existing feature order')
  if(await page.$eval('[data-test=feature-build-history]',e=>e.open)) await click('[data-test=feature-build-history] > summary')
  // A long category uses the full ID list, not only currently visible rows.
  await call('reverse.feature.add',{features:Array.from({length:40},(_,i)=>sketch(`Long profile ${i+1}`,i*2))})
  const first=await nameOf('Long profile 1'), last=await nameOf('Long profile 40')
  await click(row('sketches',first)+' .name'); await modified(row('sketches',last)+' .name','Shift')
  check((await selected('sketches')).length===40,'Shift selects all forty rows across a scrolled category')
  const bodySelectionBefore = await selected('bodies')
  await page.keyboard.down(MOD);await page.keyboard.press('a');await page.keyboard.up(MOD);await sleep(150)
  check((await selected('sketches')).length===42 && JSON.stringify(await selected('bodies'))===JSON.stringify(bodySelectionBefore),'focused Ctrl/Cmd+A selects the whole category without changing the independent body-category selection')
  await click(group('sketches')+' [data-test=features-hide]')
  check(await page.evaluate(()=>window.__re.store.getState().bodies.filter(b=>!b.surface).every(b=>b.visible)),'forty-profile bulk hide leaves the completed solids visible')
  const saved=await call('project.save'), noteBefore=JSON.stringify((await snapshot()).notes.map(({fromFile,...n})=>n))
  writeFileSync(join(root,'e2e-out','categories-fixture.scanruler'), Buffer.from(saved.file.bytes))
  await call('project.load',{bytes:Array.from(saved.file.bytes),name:'categories-roundtrip.scanruler',discard:true}); await ready()
  check((await names('sketches')).length===42 && (await names('sections')).length===1 && (await names('bodies')).length===2,'save/reopen restores categorized feature identities without duplication')
  check(JSON.stringify((await snapshot()).notes.map(({fromFile,...n})=>n))===noteBefore,'notes survive category changes and project round trip')
  await click('[data-test=category-collapse-sketches]')
  await page.screenshot({path:shotPath('categories-complete.png')})
  await page.goto(process.env.APP_URL+'?plugins=none',{waitUntil:'networkidle0'})
  check(!(await page.$('[data-test=feature-category]')),'host still starts with all plugins omitted')
} catch(error) { fail(error.stack??String(error)) }
finally { if(browser) await finish(browser,consoleErrors); if(server) await server.close() }
