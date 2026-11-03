// SPDX-License-Identifier: AGPL-3.0-only
// Public UI: feature-tile placement, icon, keyboard opening and modal isolation.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { launchApp } from '../../../scripts/e2e-lib.mjs'
assert(process.env.APP_URL, 'Supply an isolated APP_URL')
const out = resolve(process.env.OUT_DIR ?? 'e2e-out/edit-surface-entry')
mkdirSync(out, { recursive: true })
const { browser, page, consoleErrors } = await launchApp({ url: process.env.APP_URL, width: 1440, height: 1000, agentDataOk: false, userDataDir: mkdtempSync(join(out, 'owned-profile-')) })
const checks = [], ok = (condition, label) => { assert(condition, label); checks.push(label); console.log('PASS: ' + label) }
const frames = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
try {
  await page.click('[data-test=workspace-reverse]')
  await page.waitForSelector('[data-test=feature-edit-surface]:enabled', { timeout: 60000 })
  const layout = await page.evaluate(() => {
    const tile = document.querySelector('[data-test=feature-edit-surface]'), grid = tile.closest('[data-test=feature-keys]')
    const buttons = [...grid.querySelectorAll('button')], index = buttons.indexOf(tile)
    const style = getComputedStyle(tile), patchStyle = getComputedStyle(document.querySelector('[data-test=feature-network]'))
    return { count: document.querySelectorAll('[data-test=edit-surface-entry]').length, previous: buttons[index - 1]?.dataset.test, next: buttons[index + 1]?.dataset.test, text: tile.textContent, label: tile.getAttribute('aria-label'), popup: tile.getAttribute('aria-haspopup'), tooltip: tile.title, circles: tile.querySelectorAll('svg.icon circle').length, outsideGrid: [...document.querySelectorAll('[data-test=edit-surface-entry]')].filter(e => !grid.contains(e)).length, sameStyle: ['fontSize', 'fontFamily', 'padding', 'gap', 'backgroundColor'].every(k => style[k] === patchStyle[k]) }
  })
  ok(layout.count === 1 && layout.outsideGrid === 0, 'Only one Edit Surface entry, inside Create feature')
  ok(layout.previous === 'feature-network' && layout.next === 'feature-trim', 'Tile follows Patch network and precedes Trim')
  ok(layout.text.trim() === 'Edit Surface' && layout.label === 'Edit Surface' && layout.popup === 'dialog', 'Original command name and accessible dialog opener')
  ok(layout.circles === 9 && layout.tooltip.includes('poli'), 'Control-net icon has nine poles and an explanatory tooltip')
  ok(layout.sameStyle, 'Tile inherits the neighbouring feature-button styles')
  for (const width of [280, 340, 440]) {
    const size = await page.evaluate(width => {
      const panel = document.querySelector('.panel'); panel.style.width = width + 'px'
      const tile = document.querySelector('[data-test=feature-edit-surface]'), patch = document.querySelector('[data-test=feature-network]')
      const a = tile.getBoundingClientRect(), b = patch.getBoundingClientRect(), svg = tile.querySelector('svg').getBoundingClientRect()
      return { width: a.width, patchWidth: b.width, height: a.height, patchHeight: b.height, contained: svg.left >= a.left && svg.right <= a.right && svg.top >= a.top && svg.bottom <= a.bottom }
    }, width)
    ok(Math.abs(size.width - size.patchWidth) < 1 && Math.abs(size.height - size.patchHeight) < 1 && size.contained, `Grid size and icon fit at sidebar width ${width}`)
  }
  await page.evaluate(() => { document.querySelector('.panel').style.removeProperty('width'); document.querySelector('[data-test=feature-edit-surface]').scrollIntoView({ block: 'center' }) })
  await frames(); await page.screenshot({ path: join(out, 'edit-surface-feature-tile.png') })
  await page.focus('[data-test=feature-edit-surface]'); await page.keyboard.press('Enter')
  await page.waitForSelector('[data-test=edit-surface-dialog]')
  const modal = await page.$eval('[data-test=edit-surface-dialog]', e => ({ portalled: e.parentElement.parentElement === document.body, outsideGrid: !e.closest('[data-test=feature-keys]'), width: e.getBoundingClientRect().width, direction: getComputedStyle(e.querySelector('footer button')).flexDirection }))
  ok(modal.portalled && modal.outsideGrid && modal.width > 800 && modal.direction !== 'column', 'Keyboard opens full-size modal outside grid styles')
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('[data-test=edit-surface-dialog]'))
  ok(true, 'Escape closes the editor normally')
  await page.click('[data-test=feature-edit-surface]')
  await (await page.$('[data-test=surface-step-file]')).uploadFile(resolve('plugins/tmar-edit-surface/evidence/input-solid.step'))
  await page.waitForFunction(() => document.querySelectorAll('[data-test=surface-face] option').length === 7, { timeout: 60000 })
  await page.select('[data-test=surface-face]', '5')
  await page.waitForSelector('[data-test=surface-apply]:enabled', { timeout: 60000 })
  ok(true, 'Tile opens the unchanged editor and validates an imported CAD face')
  await page.screenshot({ path: join(out, 'editor-from-feature-tile.png') })
  await page.click('[aria-label="Chiudi Edit Surface"]')
  await page.waitForFunction(() => !document.querySelector('[data-test=edit-surface-dialog]'))
  for (const theme of ['light', 'dark']) {
    const iconTheme = await page.evaluate(theme => {
      document.documentElement.dataset.theme = theme
      const dot = document.querySelector('[data-test=feature-edit-surface] circle')
      return { fill: getComputedStyle(dot).fill, accent: getComputedStyle(document.querySelector('[data-test=feature-network] svg .i-adt') ?? document.querySelector('[data-test=feature-edit-surface] path.i-f')).stroke }
    }, theme)
    ok(iconTheme.fill !== 'none' && iconTheme.fill !== 'rgba(0, 0, 0, 0)', `${theme} theme retains visible icon poles`)
  }
  ok(consoleErrors.length === 0, 'No application console or page errors')
  writeFileSync(join(out, 'result.json'), JSON.stringify({ pass: true, layout, checks, consoleErrors }, null, 2))
} catch (error) {
  writeFileSync(join(out, 'failure.json'), JSON.stringify({ error: String(error), stack: error.stack, checks, consoleErrors }, null, 2))
  await page.screenshot({ path: join(out, 'failure.png') }); throw error
} finally { await browser.close() }
