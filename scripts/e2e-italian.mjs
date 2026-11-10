// SPDX-License-Identifier: AGPL-3.0-only
// Exercise the shipped Italian UI through public controls, including a live
// language change with a project open. No private stores or /src imports.
import assert from 'node:assert/strict'
import { unzipSync, strFromU8 } from 'fflate'
import { launchApp, check, fail, finish, shotPath } from './e2e-lib.mjs'

const { browser, page, consoleErrors } = await launchApp({ language: null })
page.on('dialog', dialog => dialog.accept())
const mesh = 'v 0 0 0\nv 10 0 0\nv 0 10 0\nf 1 2 3\n'
const drop = (contents, name) => page.evaluate((data, filename) => {
  const transfer = new DataTransfer()
  transfer.items.add(new File([typeof data === 'string' ? data : new Uint8Array(data)], filename))
  window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
}, contents, name)
const text = selector => page.$eval(selector, el => el.textContent.trim())
const language = async value => {
  await page.click('[data-test="open-settings"]')
  await page.waitForSelector('[data-test="interface-language"]')
  await page.select('[data-test="interface-language"]', value)
  await page.waitForFunction(value => document.documentElement.lang === value, {}, value)
  check(await text('#settings-title') === (value === 'it' ? 'Impostazioni' : 'Settings'), 'settings react to the selected language')
  await page.click('[data-test="settings-close"]')
}
const save = async () => {
  await page.evaluate(() => { window.italianProjectBlob = null })
  await page.click('[data-test="save-project"]')
  await page.waitForFunction(() => window.italianProjectBlob instanceof Blob)
  const bytes = await page.evaluate(async () => Array.from(new Uint8Array(await window.italianProjectBlob.arrayBuffer())))
  const files = unzipSync(Uint8Array.from(bytes))
  return { bytes, files, manifest: JSON.parse(strFromU8(files['project.json'])) }
}

try {
  check(await page.evaluate(() => document.documentElement.lang) === 'it', 'a fresh browser opens in Italian without a preference')
  for (const [workspace, expected] of [
    ['elements', /Misur.*3D/], ['deviation', /Scostamento superficiale/],
    ['thickness', /Spessore parete/], ['flat', /Misur.*2D/],
    ['reverse', /Ricostruzione CAD/], ['mesh', /Strumenti mesh/],
  ]) check(expected.test(await text(`[data-test="workspace-${workspace}"]`)), `${workspace} workspace is labelled in Italian`)
  check(await page.$eval('[data-test="project-name"]', el => el.getAttribute('aria-label')) === 'Nome del progetto', 'accessible project-name label is Italian')
  await page.click('[data-test="open-settings"]')
  for (const name of ['jet', 'viridis', 'magma', 'plasma', 'inferno', 'cividis', 'mako', 'rocket', 'turbo']) {
    const hint = await page.$eval(`[data-test="colormap-${name}"]`, el => el.title)
    check(hint.length > 30 && !/Blue through|Dark blue|Black through|Indigo through|Navy through|A rainbow|Perceptually|colour-blind/.test(hint), `${name} color-map description is Italian`)
  }
  await page.click('[data-test="settings-close"]')

  await drop(mesh, 'Apply.obj')
  await page.waitForFunction(() => document.querySelector('.file-info')?.textContent.includes('Apply.obj'))
  await page.waitForFunction(() => document.querySelector('[data-test="save-project"]')?.disabled === false)
  await page.click('[data-test="project-name"]')
  await page.type('[data-test="project-name"]', 'Save')
  await page.keyboard.press('Enter')
  await page.evaluate(() => {
    window.italianCanvas = document.querySelector('canvas')
    window.italianNavigation = performance.timeOrigin
    const createURL = URL.createObjectURL
    URL.createObjectURL = blob => { window.italianProjectBlob = blob; return createURL(blob) }
    HTMLAnchorElement.prototype.click = function () {}
  })
  const italian = await save()
  check(italian.manifest.name === 'Save' && italian.manifest.scan.fileName === 'Apply.obj', 'English-looking project and file names are preserved verbatim')
  check(strFromU8(italian.files[italian.manifest.scan.member]) === mesh, 'the saved project retains the exact imported mesh bytes')

  await language('en')
  check(await text('[data-test="workspace-elements"]') === '3D Measure', 'English remains available on demand')
  const english = await save()
  assert.deepEqual(english.manifest, italian.manifest, 'language must not alter the saved project manifest')
  assert.deepEqual(english.files, italian.files, 'language must not alter any saved project member')
  check(true, 'switching language changes neither the project schema nor its saved content')

  await language('it')
  check(await page.evaluate(() => window.italianCanvas === document.querySelector('canvas') && window.italianCanvas.isConnected && performance.timeOrigin === window.italianNavigation), 'live language changes preserve the existing viewer without navigating or remounting it')
  check(await page.$eval('[data-test="project-name"]', el => el.value) === 'Save', 'the user-entered name is never translated')

  await page.click('[data-test="workspace-reverse"]')
  check(/Estrudi/.test(await text('[data-test="feature-extrude"]')), 'CAD commands are translated in the rendered workspace')
  await page.click('[data-test="workspace-mesh"]')
  check(/Taglia/.test(await text('[data-test="mesh-tool-cut"]')), 'mesh commands are translated in the rendered workspace')
  await page.click('[data-test="workspace-elements"]')
  await page.click('[data-test="open-settings"]')
  await page.screenshot({ path: shotPath('italian-settings.png') })
  await page.click('[data-test="settings-close"]')

  await page.reload({ waitUntil: 'networkidle0' })
  check(await page.evaluate(() => document.documentElement.lang === 'it' && localStorage.getItem('tmar.language') === 'it'), 'the language preference survives a browser reload')
  await drop(italian.bytes, 'Saved.scanruler')
  await page.waitForFunction(() => document.querySelector('.file-info')?.textContent.includes('Apply.obj'))
  await page.waitForFunction(() => document.querySelector('[data-test="save-project"]')?.disabled === false)
  check(await page.$eval('[data-test="project-name"]', el => el.value) === 'Save', 'the project reopens in Italian with its original user name')
  await page.screenshot({ path: shotPath('italian-project.png') })
} catch (error) { fail(error.stack ?? String(error)) }
finally { await finish(browser, consoleErrors) }
