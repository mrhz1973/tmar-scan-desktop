// SPDX-License-Identifier: AGPL-3.0-only
// UI-only smoke test for an isolated production bundle, synthetic STEP only.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

if (process.env.SCANRULER_ISOLATED !== '1') throw Error('SCANRULER_ISOLATED=1 is required.')
const url = new URL(process.env.APP_URL ?? '')
if (url.href !== 'http://127.0.0.1:17528/') throw Error('Use the dedicated compiled QA server on port 17528.')
const root = process.env.EDIT_SURFACE_QA_OUT
if (!root || !isAbsolute(root)) throw Error('EDIT_SURFACE_QA_OUT must be an absolute folder.')
const fromApp = relative(resolve(process.cwd()), resolve(root))
if (!fromApp || (!fromApp.startsWith('..' + sep) && fromApp !== '..' && !isAbsolute(fromApp)))
  throw Error('Evidence must be outside the app checkout.')
mkdirSync(root, { recursive: true })
const out = mkdtempSync(join(root, 'compiled-')), downloads = join(out, 'downloads')
mkdirSync(downloads)
process.env.SHOT_DIR = out
const { OcctKernel } = await import('occt-wasm')
const { launchApp } = await import('../../../scripts/e2e-lib.mjs')
const kernel = await OcctKernel.init(), box = kernel.makeBox(20,30,10)
const input = join(out, 'synthetic-input.step')
try { writeFileSync(input, kernel.exportStep(box)) } finally { kernel.release(box) }
const report = { scope: 'compiled app, UI only, synthetic STEP, saved and reopened project', checks: [], consoleErrors: [], verdict: 'INCOMPLETE' }
const check = (value, label) => { assert(value, label); report.checks.push(label); console.log('PASS', label) }
const waitDownload = async suffix => {
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    const file = readdirSync(downloads).find(name => name.toLowerCase().endsWith(suffix))
    if (file) return join(downloads,file)
    await new Promise(r => setTimeout(r,100))
  }
  throw Error(`Download ${suffix} non completato`)
}
let browser, page, reopened
try {
  const app = await launchApp({ url: url.href, width: 1440, height: 1000, agentDataOk: false,
    userDataDir: join(out, 'owned-browser-profile'), protocolTimeout: 120000 })
  browser = app.browser; page = app.page; report.consoleErrors = app.consoleErrors
  page.on('dialog', dialog => dialog.accept())
  const cdp = await page.createCDPSession()
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true })
  await page.click('[data-test=workspace-reverse]')
  await page.waitForSelector('[data-test=feature-import]:enabled', { timeout: 120000 })
  await (await page.$('[data-test=feature-import-file]')).uploadFile(input)
  await page.waitForSelector('[data-test=import-create]:enabled', { timeout: 120000 })
  await page.click('[data-test=import-create]')
  await page.waitForSelector('[data-test=feature-edit-surface]:enabled', { timeout: 120000 })
  await page.click('[data-test=feature-edit-surface]')
  await page.waitForSelector('[data-test=workspace-surface-parameters]', { timeout: 120000 })
  check(!await page.$('[data-test=edit-surface-dialog]'), 'compiled editor opens in the shared workspace')
  const face = await page.$eval('[data-test=surface-face]', select =>
    [...select.options].find(option => option.value !== '' && !option.disabled && /plane/i.test(option.textContent))?.value)
  assert(face !== undefined, 'No editable planar face in the synthetic STEP')
  await page.select('[data-test=surface-face]', face)
  await page.waitForSelector('[data-test=workspace-editor-apply]:enabled', { timeout: 120000 })
  const free = await page.evaluateHandle(() => [...document.querySelectorAll('[data-test=workspace-surface-parameters] button')].find(e => e.textContent === 'Seleziona liberi'))
  await free.asElement().click()
  await page.select('[data-test=surface-drag-mode]', 'local')
  await page.click('[data-test=surface-axis-2]')
  await page.$eval('[data-test=surface-distance]', element => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, '0.05')
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.click('[data-test=surface-move]')
  await page.waitForSelector('[data-test=surface-undo]:enabled', { timeout: 120000 })
  await page.waitForSelector('[data-test=workspace-editor-apply]:enabled', { timeout: 120000 })
  await page.screenshot({ path: join(out, 'edited.png') })
  await page.click('[data-test=workspace-editor-apply]')
  await page.waitForFunction(() => !document.querySelector('[data-test=workspace-editor-dock]'), { timeout: 120000 })
  await page.waitForFunction(() => document.querySelectorAll('[data-test=body-row]').length === 2, { timeout: 120000 })
  check(true, 'compiled UI applies one modified CAD copy')
  await page.waitForSelector('[data-test=save-project]:enabled', { timeout: 60000 })
  await page.click('[data-test=save-project]')
  const project = await waitDownload('.scanruler')
  reopened = await browser.newPage()
  reopened.on('pageerror', error => report.consoleErrors.push(`reopen: ${error.message}`))
  await reopened.goto(url.href, { waitUntil: 'domcontentloaded' })
  await reopened.waitForSelector('[data-test=project-input]', { timeout: 60000 })
  await (await reopened.$('[data-test=project-input]')).uploadFile(project)
  await reopened.click('[data-test=workspace-reverse]')
  await reopened.waitForFunction(() => document.querySelectorAll('[data-test=body-row]').length === 2, { timeout: 120000 })
  check(true, 'saved project reopens with both bodies in the compiled app')
  await reopened.waitForSelector('[data-test=export-body]:enabled', { timeout: 120000 })
  await reopened.click('[data-test=export-body]')
  await reopened.waitForSelector('[data-test=export-body-save]:enabled')
  await reopened.click('[data-test=export-body-save]')
  const exported = await waitDownload('.step')
  const shape = kernel.importStep(readFileSync(exported, 'utf8')), solids = kernel.getSubShapes(shape, 'solid')
  try {
    const volumes = solids.map(solid => kernel.getVolume(solid)).sort((a,b) => a-b)
    report.geometry = { valid: kernel.isValid(shape), solids: solids.length, volumes }
    check(report.geometry.valid && solids.length === 2 && volumes.some(v => Math.abs(v-6000) < 1e-5) &&
      volumes.some(v => Math.abs(v-6000) > 1e-4), 'reopened project exports two valid, geometrically distinct CAD solids')
  } finally { solids.forEach(solid => kernel.release(solid)); kernel.release(shape) }
  check(report.consoleErrors.length === 0, 'no browser application errors')
  report.verdict = 'PASS'
} catch (error) {
  report.error = String(error?.stack ?? error)
  if (reopened ?? page) try { await (reopened ?? page).screenshot({ path: join(out, 'failure.png') }) } catch { /* Preserve failure. */ }
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  kernel[Symbol.dispose]()
  writeFileSync(join(out, 'result.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ out, ...report }))
}
