// SPDX-License-Identifier: AGPL-3.0-only
// Real mouse drags and independent OCCT readback of the exported CAD surface.
import { OcctKernel } from 'occt-wasm'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'
import { launchApp } from '../../../scripts/e2e-lib.mjs'
const root = resolve('plugins/tmar-edit-surface/evidence/controls')
mkdirSync(root, { recursive: true })
const out = mkdtempSync(join(root, 'run-')), started = performance.now()
const { browser, page, consoleErrors } = await launchApp({ url: process.env.APP_URL ?? 'http://127.0.0.1:17531/', width: 1440, height: 1000 })
const kernel = await OcctKernel.init()
try {
  await page.click('[data-test=workspace-reverse]')
  await page.waitForSelector('[data-test=edit-surface-entry] button', { timeout: 60000 })
  await page.click('[data-test=edit-surface-entry] button')
  await (await page.$('[data-test=surface-step-file]')).uploadFile(resolve('plugins/tmar-edit-surface/evidence/input-solid.step'))
  await page.waitForFunction(() => document.querySelectorAll('[data-test=surface-face] option').length === 7, { timeout: 60000 })
  await page.select('[data-test=surface-face]', '5')
  const ready = async () => page.waitForFunction(() => document.querySelector('[data-test=surface-status]')?.textContent.includes('CAD valido') && !document.querySelector('[data-test=surface-apply]')?.disabled, { timeout: 60000 })
  const clickText = async text => { for (const b of await page.$$('.es-dialog button')) if (await b.evaluate((e, t) => e.textContent === t, text)) { await b.click(); return } throw Error('Missing button: ' + text) }
  const set = async (selector, value) => page.$eval(selector, (e, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, String(value)); e.dispatchEvent(new Event('input', { bubbles: true })) }, value)
  const status = () => page.$eval('[data-test=surface-status]', e => e.textContent)
  const changed = async previous => { await page.waitForFunction(p => { const s = document.querySelector('[data-test=surface-status]')?.textContent; return s?.includes('CAD valido') && s !== p }, { timeout: 60000 }, previous); await ready() }
  await ready(); await clickText('Seleziona liberi'); await set('[data-test=surface-distance]', 6)
  const initial = await status(); await page.click('[data-test=surface-move]'); await changed(initial)
  const baseStatus = await status()
  await page.screenshot({ path: join(out, 'base.png') })
  const cdp = await page.createCDPSession()
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: out, eventsEnabled: true })
  const exportShape = async label => {
    const downloadDir = join(out, label.replaceAll(' ', '-')); mkdirSync(downloadDir)
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir, eventsEnabled: true })
    await clickText('Esporta STEP…')
    let file; const deadline = Date.now() + 60000
    while (Date.now() < deadline && !file) { file = readdirSync(downloadDir).find(f => f.endsWith('.step')); if (!file) await new Promise(r => setTimeout(r, 100)) }
    assert(file, 'STEP downloaded: ' + label)
    const archived = label.replaceAll(' ', '-') + '.step'
    renameSync(join(downloadDir, file), join(out, archived)); file = archived
    await ready()
    const shape = kernel.importStep(readFileSync(join(out, file), 'utf8'))
    assert(kernel.isValid(shape), label + ' is valid CAD')
    const faces = kernel.getSubShapes(shape, 'face')
    const top = faces.find(f => { const uv = kernel.uvBounds(f); return kernel.pointOnSurface(f, (uv.uMin + uv.uMax)/2, (uv.vMin + uv.vMax)/2).z > 10 })
    assert(top, 'deformed top face found')
    const uv = kernel.uvBounds(top), center = kernel.pointOnSurface(top, (uv.uMin+uv.uMax)/2, (uv.vMin+uv.vMax)/2), volume = kernel.getVolume(shape)
    faces.forEach(f => kernel.release(f)); kernel.release(shape)
    return { file, center, volume }
  }
  const base = await exportShape('base')
  const canvas = await page.$('[data-test=edit-surface-viewport] canvas')
  const imageBefore = await canvas.screenshot()
  await page.click('[data-test=surface-control-net]')
  assert.equal(await page.$eval('[data-test=surface-control-net]', e => e.getAttribute('aria-pressed')), 'false')
  await set('[data-test=surface-transparency]', 0.5)
  await page.screenshot({ path: join(out, 'transparent-no-net.png') })
  assert(!Buffer.from(await canvas.screenshot()).equals(Buffer.from(imageBefore)), 'Display controls change the rendered image')
  assert.equal(await status(), baseStatus, 'Display controls do not recalculate geometry')
  await set('[data-test=surface-transparency]', 0); await page.click('[data-test=surface-control-net]')
  // A restored render must preserve camera, cage, and body, not silently reframe.
  assert(Buffer.from(await canvas.screenshot()).equals(Buffer.from(imageBefore)), 'Restoring display controls preserves the exact camera/render')
  const drag = async () => { const prev = await status(); await page.mouse.move(867, 308); await page.mouse.down(); await page.mouse.move(867, 278, { steps: 10 }); await page.mouse.up(); await changed(prev) }
  await drag(); const full = await exportShape('100 percent drag')
  { const beforeUndo = await status(); await page.click('[data-test=surface-undo]'); await changed(beforeUndo) }; assert.equal(await status(), baseStatus)
  await set('[data-test=surface-drag-strength]', 0.5)
  await drag(); const half = await exportShape('50 percent drag')
  const fullDelta = full.center.z - base.center.z, halfDelta = half.center.z - base.center.z
  assert(Math.abs(fullDelta) > 0.01); assert(Math.abs(halfDelta/fullDelta - 0.5) < 1e-7, 'Half drag strength halves the CAD displacement')
  await page.screenshot({ path: join(out, 'half-drag.png') })
  { const beforeUndo = await status(); await page.click('[data-test=surface-undo]'); await changed(beforeUndo) }
  await set('[data-test=surface-smooth-strength]', 0.25)
  let prev = await status(); await page.click('[data-test=surface-smooth]'); await changed(prev)
  const smoothQuarter = await exportShape('25 percent smoothing')
  assert(Math.abs((smoothQuarter.center.z-10)/(base.center.z-10) - 0.75) < 1e-7)
  { const beforeUndo = await status(); await page.click('[data-test=surface-undo]'); await changed(beforeUndo) }
  await set('[data-test=surface-smooth-strength]', 0.75)
  prev = await status(); await page.click('[data-test=surface-smooth]'); await changed(prev)
  const smoothThreeQuarter = await exportShape('75 percent smoothing')
  assert(Math.abs((smoothThreeQuarter.center.z-10)/(base.center.z-10) - 0.25) < 1e-7)
  assert.equal(consoleErrors.length, 0, JSON.stringify(consoleErrors))
  const report = { pass: true, base, full, half, fullDelta, halfDelta, dragRatio: halfDelta/fullDelta, smoothQuarter, smoothThreeQuarter, displayRestoredExactly: true, consoleErrors, elapsedMs: performance.now()-started }
  writeFileSync(join(out, 'result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ out, ...report }, null, 2))
} catch(e) { writeFileSync(join(out, 'failure.json'), JSON.stringify({error:String(e),stack:e.stack},null,2)); await page.screenshot({ path: join(out, 'failure.png') }); console.log('UI', await page.$eval('body', e => e.innerText.slice(-4000))); throw e }
finally { await browser.close(); kernel[Symbol.dispose]() }
