// SPDX-License-Identifier: AGPL-3.0-only
// Public DOM only, against either dev or compiled HTML. Own isolated profiles;
// the intentionally inverted synthetic cube makes backface tint observable.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { importStep } from 'meshstep'
import { cubeStep } from '../tests/stepFixtures.ts'
import { launchApp, check, fail, finish, loadScan, pixelDiff, shotPath, sleep } from './e2e-lib.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const server = process.env.APP_URL ? null : await createServer({ root,
  server: { host: '127.0.0.1', port: 0, open: false, watch: { ignored: ['**/e2e-out/**'] } },
})
const dir = mkdtempSync(join(tmpdir(), 'tmar-pane-tools-'))
const mesh = importStep(cubeStep(20), { surfaceDeviation: 0.005, maxEdge: 1.2 }).mesh
for (let i = 0; i < mesh.indices.length; i += 3) {
  const first = mesh.indices[i]
  mesh.indices[i] = mesh.indices[i + 1]
  mesh.indices[i + 1] = first
}
// STL import deliberately corrects an inverted closed shell. PLY's existing
// keep-winding marker preserves this diagnostic fixture, without changing the
// importer or inspecting private app state in the browser.
const fixture = join(dir, 'synthetic-inverted-cube-with-a-deliberately-long-file-name.ply')
const lines = ['ply', 'format ascii 1.0', 'comment ScanRuler: keep winding',
  `element vertex ${mesh.positions.length / 3}`, 'property double x', 'property double y', 'property double z',
  `element face ${mesh.indices.length / 3}`, 'property list uchar uint vertex_indices', 'end_header']
for (let i = 0; i < mesh.positions.length; i += 3) lines.push(Array.from(mesh.positions.subarray(i, i + 3)).join(' '))
for (let i = 0; i < mesh.indices.length; i += 3) lines.push('3 ' + Array.from(mesh.indices.subarray(i, i + 3)).join(' '))
writeFileSync(fixture, lines.join('\n') + '\n')
const canvas = side => side === 'scan' ? '.viewslot > .viewport canvas' : '.compareview canvas'
const key = (side, kind) => `[data-test=split-${side}-${kind}]`
const kinds = ['transparent', 'wireframe', 'backfaces']
const oldKind = kind => kind === 'transparent' ? 'translucent' : kind
const menuKey = (side, kind) => `[data-test=toggle-${side === 'scan' ? '' : 'reference-'}${oldKind(kind)}]`
let browser, errors = []
try {
  if (server) await server.listen()
  for (const plugins of ['all', 'none']) {
    const url = new URL(server ? server.resolvedUrls.local[0] : process.env.APP_URL)
    if (plugins === 'none') url.searchParams.set('plugins', 'none')
    const app = await launchApp({ url: url.href, width: 1600, height: 1000,
      protocolTimeout: 120000, language: 'en', agentDataOk: false })
    browser = app.browser
    errors = app.consoleErrors
    const page = app.page
    const expect = (ok, text) => check(ok, `[plugins=${plugins}] ${text}`)
    const pressed = (side, kind) => page.$eval(key(side, kind), el => el.getAttribute('aria-pressed'))
    const state = side => page.$$eval(`[data-test=split-${side}-tools] button`, els =>
      els.map(el => el.getAttribute('aria-pressed')).join(','))
    const shot = async side => {
      await page.mouse.move(2, 2)
      await sleep(150)
      const clip = await page.$eval(canvas(side), el => {
        const r = el.getBoundingClientRect()
        // Exclude toolbar/caption, legend and gizmo pixels: UI state alone
        // must not be mistaken for a visible change of the model's material.
        return { x: Math.round(r.x + r.width * .2), y: Math.round(r.y + r.height * .2),
          width: Math.round(r.width * .6), height: Math.round(r.height * .55) }
      })
      // Keep the visible crop: beyond-viewport capture can perturb split WebGL frames.
      let png = await page.screenshot({ clip, encoding: 'base64', captureBeyondViewport: false })
      for (let attempt = 0; attempt < 8; attempt++) {
        await sleep(120)
        const next = await page.screenshot({ clip, encoding: 'base64', captureBeyondViewport: false })
        if (await pixelDiff(page, png, next) < .05) return next
        png = next
      }
      throw new Error('Viewport did not settle: ' + side)
    }
    const layout = () => page.evaluate(() => ['scan', 'reference'].every(side => {
      const holder = document.querySelector(side === 'scan' ? '.viewslot > .viewport' : '.comparehalf')
      const bar = document.querySelector(`[data-test=split-${side}-tools]`)
      const r = holder.getBoundingClientRect(), b = bar.getBoundingClientRect()
      return b.left >= r.left && b.right <= r.right + 1 && b.top >= r.top && b.bottom <= r.bottom &&
        [...bar.querySelectorAll('button')].every(button => {
          const k = button.getBoundingClientRect()
          return k.left >= b.left && k.right <= b.right && k.height >= 24 &&
            button.contains(document.elementFromPoint(k.x + k.width / 2, k.y + k.height / 2))
        })
    }))
    await page.click('[data-test=workspace-deviation]')
    await loadScan(page, fixture, { inputSelector: '[data-test=start-scan] input[type=file]', timeout: 120000, settle: 0 })
    await (await page.$('[data-test=slot-reference] input[type=file]')).uploadFile(fixture)
    await page.waitForSelector('[data-test=toggle-split]:enabled', { timeout: 120000 })
    await page.click('[data-test=toggle-split]')
    await page.waitForSelector(key('reference', 'tools'), { visible: true })
    await sleep(400)
    expect(await layout(), 'both toolbars stay inside their panes and every key is clickable')
    if (plugins === 'none') expect(!(await page.$('[data-test=zebra-quick-toggle]')), 'host controls need no optional plugins')
    for (const side of ['scan', 'reference']) {
      await page.$eval(canvas(side), el => { el.dataset.paneToolsKept = 'yes' })
      for (const kind of kinds) {
        const other = side === 'scan' ? 'reference' : 'scan'
        const before = await pressed(side, kind), otherState = await state(other)
        const ownBefore = await shot(side), otherBefore = await shot(other)
        await page.click(key(side, kind))
        await page.waitForFunction((selector, before) =>
          document.querySelector(selector)?.getAttribute('aria-pressed') !== before, {}, key(side, kind), before)
        expect(await state(other) === otherState, `${side} ${kind} does not alter the other part's switches`)
        expect(await page.$eval(menuKey(side, kind), el => el.getAttribute('aria-checked')) === await pressed(side, kind),
          `${side} ${kind} stays synchronized with its existing menu`)
        const ownChange = await pixelDiff(page, ownBefore, await shot(side))
        const otherChange = await pixelDiff(page, otherBefore, await shot(other))
        expect(ownChange > .2, `${side} ${kind} changes model pixels (${ownChange.toFixed(3)}%)`)
        expect(otherChange < 1 && ownChange > 20 * otherChange,
          `${side} ${kind} leaves the other model unchanged (${otherChange.toFixed(3)}%)`)
        await page.click(key(side, kind))
        expect(await pressed(side, kind) === before, `${side} ${kind} restores its previous setting`)
      }
    }
    // Keyboard operation and reverse synchronization (old menu -> pane key).
    await page.focus(key('scan', 'transparent'))
    await page.keyboard.press('Space')
    expect(await pressed('scan', 'transparent') === 'true', 'Space activates the focused scan shortcut')
    await page.keyboard.press('Enter')
    expect(await pressed('scan', 'transparent') === 'false', 'Enter restores the focused scan shortcut')
    await page.click('[data-test=toggle-reference-menu]')
    await page.click('[data-test=toggle-reference-wireframe]')
    expect(await pressed('reference', 'wireframe') === 'true', 'existing reference menu updates its pane shortcut')
    await page.mouse.click(2, 2)
    const beforeClose = [await state('scan'), await state('reference')].join(';')
    await page.click('[data-test=toggle-split]')
    expect(!(await page.$(key('scan', 'tools'))) && await page.$eval('[data-test=compare-half]', el => el.hidden),
      'closing split hides both pane toolbars instead of leaving active floating controls')
    await page.click('[data-test=toggle-split]')
    await page.waitForSelector(key('reference', 'tools'), { visible: true })
    expect([await state('scan'), await state('reference')].join(';') === beforeClose,
      'split close/reopen preserves the independent settings')
    expect(await page.$$eval('canvas[data-pane-tools-kept=yes]', els => els.length) === 2,
      'both original WebGL canvases survive control changes and split close/reopen')
    for (const end of ['Home', 'End', 'Enter']) {
      await page.focus('[data-test=split-view-divider]')
      await page.keyboard.press(end)
      await sleep(150)
      expect(await layout(), `both toolbars remain contained and clickable after divider ${end}`)
    }
    await page.setViewport({ width: 900, height: 800 })
    await sleep(250)
    expect(await layout(), 'controls remain accessible in constrained desktop space')
    await page.setViewport({ width: 1600, height: 1000 })
    await page.click('[data-test=open-settings]')
    await page.waitForSelector('[data-test=interface-language]')
    await page.select('[data-test=interface-language]', 'it')
    await page.waitForFunction(() => document.documentElement.lang === 'it')
    expect(await page.$eval(key('scan', 'wireframe'), el => el.getAttribute('aria-label')) === 'Scansione: Reticolo triangolare',
      'scan shortcut has an explicit Italian accessible label')
    expect(await page.$eval(key('reference', 'backfaces'), el => el.title) === 'Riferimento: Colora facce posteriori',
      'reference shortcut explains backface tint in Italian')
    await page.click('[data-test=settings-close]')
    expect(await layout(), 'Italian labels and long file names preserve control access')
    await page.screenshot({ path: shotPath(`split-view-tools-${plugins}-it.png`) })
    await finish(browser, errors)
    browser = null
  }
} catch (error) { fail(error.stack ?? String(error)); process.exitCode = 1 }
finally {
  if (browser) await finish(browser, errors)
  if (server) await server.close()
}
