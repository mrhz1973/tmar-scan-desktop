// SPDX-License-Identifier: AGPL-3.0-only
// Public compiled UI only. First generate the synthetic fixture with e2e-categories.mjs.
import { mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync, strFromU8 } from 'fflate'
import { preview } from 'vite'
const root = fileURLToPath(new URL('../../../', import.meta.url))
const fixture = readFileSync(join(root, 'e2e-out', 'categories-fixture.scanruler'))
const manifestOf = bytes => JSON.parse(strFromU8(unzipSync(Uint8Array.from(bytes))['project.json']))
const original = manifestOf(fixture)
if (original.scan?.fileName !== 'category-fixture.obj' || original.reverseNotes?.notes[0]?.text !== 'Category preservation note') throw new Error('Only the generated category fixture is allowed')
const server = process.env.APP_URL ? null : await preview({ root, preview: { host: '127.0.0.1', port: 0, open: false } })
if (server) process.env.APP_URL = server.resolvedUrls.local[0]
const { launchApp, check, fail, finish, sleep, OUT_DIR, shotPath, MOD } = await import('../../../scripts/e2e-lib.mjs')
let browser, page, consoleErrors = []
try {
  ;({ browser, page, consoleErrors } = await launchApp({ userDataDir: mkdtempSync(join(OUT_DIR, 'category-production-')), width: 1600, height: 1100, agentDataOk: false }))
  page.on('dialog', d => d.accept())
  const click = async (selector, options) => { await page.waitForSelector(selector, { visible: true }); await page.click(selector, options); await sleep(160) }
  const drop = async () => page.evaluate(data => {
    const transfer = new DataTransfer(); transfer.items.add(new File([new Uint8Array(data)], 'synthetic-categories.scanruler'))
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
  }, Array.from(fixture))
  const group = name => `[data-feature-category="${name}"]`
  const selectAll = async name => { await click(group(name)+' [data-test=features-select-all]') }
  const selectCount = name => page.$$eval(group(name)+' [data-test=feature-select-row][aria-selected=true]', rows => rows.length)
  const bodyVisibility = () => page.$$eval('[data-test=body-row]', rows => rows.map(r => ({ id: r.dataset.body, shown: !r.querySelector('[data-test=body-visible]').classList.contains('off') })))
  const save = async () => {
    await page.evaluate(() => {
      window.__categoryDownloaded = null
      if (!window.__categoryCaptureInstalled) {
        const create = URL.createObjectURL
        URL.createObjectURL = function (blob) { window.__categoryDownloaded = blob; return create.call(this, blob) }
        HTMLAnchorElement.prototype.click = function () {}
        window.__categoryCaptureInstalled = true
      }
    })
    await click('[data-test=save-project]')
    await page.waitForFunction(() => window.__categoryDownloaded instanceof Blob)
    return manifestOf(await page.evaluate(async () => Array.from(new Uint8Array(await window.__categoryDownloaded.arrayBuffer()))))
  }
  await drop()
  await page.waitForFunction(() => document.querySelectorAll('[data-test=body-row]').length === 3, { timeout: 180000 })
  await page.waitForSelector(group('sketches'))
  check(await page.evaluate(() => !window.__re && !window.__reNotes), 'compiled category check has no development-only state hooks')
  check(await page.$$eval(group('sketches')+' [data-test=feature-select-row]', r => r.length) === 42, 'compiled UI groups all 42 ordinary sketches')
  check(await page.$$eval(group('sections')+' [data-test=feature-select-row]', r => r.length) === 1, 'compiled UI keeps the section sketch separate')
  check(await page.$$eval(group('surfaces')+' [data-test=feature-select-row]', r => r.length) === 1 && await page.$$eval(group('bodies')+' [data-test=feature-select-row]', r => r.length) === 2, 'compiled UI separates surface and solid operations')
  const initialBodies = await bodyVisibility()
  check(initialBodies.length === 3 && initialBodies.every(b => b.shown), 'fixture has three actually visible current bodies')
  await click('[data-note-id="1"] [data-test=note-select]')
  await selectAll('sketches'); await click(group('sketches')+' [data-test=features-show]')
  const shown = await save()
  check((await selectCount('sketches')) === 42, 'Save Project preserves the active feature-category selection')
  check(await page.$eval('[data-note-id="1"]', e => e.getAttribute('aria-selected') === 'true'), 'Save Project also preserves local note selection')
  await click(group('sketches')+' [data-test=features-hide]')
  const hidden = await save()
  const ordinary = f => f.kind === 'sketch' && f.plane.kind !== 'section'
  check(shown.reverse.features.filter(ordinary).every(f => f.visible) && hidden.reverse.features.filter(ordinary).every(f => !f.visible), 'real compiled Show/Hide changes only ordinary sketch records in saved projects')
  check(JSON.stringify(initialBodies) === JSON.stringify(await bodyVisibility()) && JSON.stringify(shown.reverse.hiddenBodies ?? []) === JSON.stringify(hidden.reverse.hiddenBodies ?? []), 'hiding all sketches keeps every current body visible and preserves saved hidden-body IDs')
  check(JSON.stringify(shown.reverse.features.filter(f => !ordinary(f))) === JSON.stringify(hidden.reverse.features.filter(f => !ordinary(f))), 'section and body feature records are unchanged by compiled sketch Hide')
  check(JSON.stringify(hidden.reverseNotes.notes) === JSON.stringify(original.reverseNotes.notes), 'compiled category operations preserve all note text, anchors and targets')
  check((await selectCount('sketches')) === 42 && (await selectCount('bodies')) === 0, 'compiled Select All does not select another category')
  await click('[data-test=category-collapse-sketches]'); await click('[data-test=category-collapse-sketches]')
  check((await selectCount('sketches')) === 42, 'large category header preserves selection through collapse')
  await click(group('sketches')+' [data-test=features-clear]')
  const ids = hidden.reverse.features.filter(ordinary).map(f => f.id), first = ids.at(-40), last = ids.at(-1)
  await click(group('sketches')+` [data-feature-id="${first}"] .name`)
  await page.keyboard.down('Shift'); await click(group('sketches')+` [data-feature-id="${last}"] .name`); await page.keyboard.up('Shift')
  check((await selectCount('sketches')) === 40 && (await selectCount('bodies')) === 0, 'real compiled Shift selection spans forty scrolled rows in only one category')
  await page.keyboard.down(MOD); await page.keyboard.press('a'); await page.keyboard.up(MOD); await sleep(100)
  check((await selectCount('sketches')) === 42 && (await selectCount('sections')) === 0, 'compiled focused Ctrl/Cmd+A includes no section sketch or body operation')
  await click('[data-test=category-collapse-sketches]')
  await selectAll('bodies'); await click(group('bodies')+' [data-test=features-hide]')
  const bodyHidden = await save()
  const solidIds = bodyHidden.reverse.features.filter(f => f.kind === 'extrude').map(f => f.id)
  const surfaceId = bodyHidden.reverse.features.find(f => f.kind === 'sheet').id
  check(solidIds.every(id => bodyHidden.reverse.hiddenBodies.includes(id)) && !bodyHidden.reverse.hiddenBodies.includes(surfaceId), 'compiled solid-operation Hide changes only solids, keeping the surface visible')
  await click(group('bodies')+' [data-test=features-show]')
  await selectAll('surfaces'); await click(group('surfaces')+' [data-test=features-hide]')
  const surfaceHidden = await save()
  check(surfaceHidden.reverse.hiddenBodies.includes(surfaceId) && solidIds.every(id => !surfaceHidden.reverse.hiddenBodies.includes(id)), 'compiled surface Hide keeps both solids visible')
  await click(group('surfaces')+' [data-test=features-show]')
  await click('[data-test=zebra-quick-toggle]')
  await page.waitForFunction(() => /Showing stripes on/.test(document.querySelector('[data-test=zebra-status]')?.textContent ?? ''))
  check(await page.$eval('[data-test=zebra-enabled]', e => e.checked), 'integrated Zebra still works after category visibility changes')
  await click('[data-note-id="1"] [data-test=note-locate]')
  await page.waitForSelector('[data-test=note-focus-ring][data-note-id="1"]', { visible: true })
  check(await page.$eval('[data-test=zebra-enabled]', e => e.checked), 'compiled note focus and highlight remain available with Zebra active')
  await click('[data-test=note-return-view]'); await click('[data-test=zebra-quick-toggle]')
  await page.screenshot({ path: shotPath('categories-production.png') })
  await selectAll('bodies')
  await drop()
  await page.waitForFunction(() => /Project opened/.test(document.querySelector('.strip')?.textContent ?? ''), { timeout: 180000 })
  check((await selectCount('bodies')) === 0 && await page.$eval('[data-note-id="1"]', e => e.getAttribute('aria-selected') === 'false'), 'reopening the same project still clears transient selections for the replaced document')
  await page.reload({ waitUntil: 'networkidle0' }); await drop()
  await page.waitForFunction(() => document.querySelectorAll('[data-test=body-row]').length === 3, { timeout: 180000 })
  check(await page.$eval('[data-test=category-collapse-sketches]', e => e.getAttribute('aria-expanded') === 'false'), 'category collapse preference survives a fresh compiled page')
  await click('[data-test=open-settings]')
  check(await page.$eval('[data-test=toggle-agent-link]', e => !e.checked), 'compiled category and note actions leave the agent connection disabled')
  await click('[data-test=settings-close]')
} catch (error) { fail(error.stack ?? String(error)) }
finally { if (browser) await finish(browser, consoleErrors); if (server) await new Promise(r => { server.httpServer.close(r); server.httpServer.closeAllConnections() }) }
