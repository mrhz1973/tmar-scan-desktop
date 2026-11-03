// SPDX-License-Identifier: AGPL-3.0-only
// Real mouse drags and independent OCCT readback of the exported CAD surface.
import { OcctKernel } from 'occt-wasm'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'
import { launchApp } from '../../../scripts/e2e-lib.mjs'
const root = resolve('plugins/tmar-edit-surface/evidence/screen-drag')
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
  await page.select('[data-test=surface-drag-mode]', 'screen')
  const dragScreen = async () => {
    const previous = await status()
    await page.mouse.move(867, 308); await page.mouse.down()
    await page.mouse.move(843, 290, { steps: 10 }); await page.mouse.up()
    await changed(previous)
  }
  await dragScreen()
  const screen = await exportShape('screen drag')
  const delta = ['x','y','z'].map(k => screen.center[k] - base.center[k])
  const depthChange = (delta[0]*1.5 - delta[1]*1.9 + delta[2]*1.8) / Math.hypot(1.5,1.9,1.8)
  assert(Math.hypot(...delta) > 0.01, 'Screen drag deforms the exported CAD')
  assert(Math.abs(depthChange) < 1e-8, 'Screen drag preserves depth along the original view direction')
  assert(delta.filter(v => Math.abs(v)>1e-5).length >= 2, 'Screen drag is not restricted to a world axis')
  await page.screenshot({ path: join(out, 'screen-drag.png') })
  const beforeUndo = await status(); await page.click('[data-test=surface-undo]'); await changed(beforeUndo)
  const undone = await exportShape('undo screen drag')
  for (const k of ['x','y','z']) assert(Math.abs(undone.center[k]-base.center[k]) < 1e-8)
  const beforeRedo = await status(); await page.click('[data-test=surface-redo]'); await changed(beforeRedo)
  const redone = await exportShape('redo screen drag')
  for (const k of ['x','y','z']) assert(Math.abs(redone.center[k]-screen.center[k]) < 1e-8)
  { const previous=await status(); await page.click('[data-test=surface-undo]'); await changed(previous) }
  await set('[data-test=surface-drag-strength]', 0.5)
  await dragScreen()
  const half = await exportShape('half screen drag')
  for (const k of ['x','y','z']) assert(Math.abs((half.center[k]-base.center[k]) - (screen.center[k]-base.center[k])*0.5) < 1e-8)
  assert.equal(consoleErrors.length, 0, JSON.stringify(consoleErrors))
  const report = { pass:true, base, screen, delta, depthChange, undone, redone, half, consoleErrors, elapsedMs:performance.now()-started }
  writeFileSync(join(out, 'result.json'), JSON.stringify(report,null,2)); console.log(JSON.stringify({out,...report},null,2))
} catch(e) { writeFileSync(join(out, 'failure.json'), JSON.stringify({error:String(e),stack:e.stack},null,2)); await page.screenshot({path:join(out,'failure.png')}); console.log('UI', await page.$eval('body',e=>e.innerText.slice(-3000))); throw e }
finally { await browser.close(); kernel[Symbol.dispose]() }
