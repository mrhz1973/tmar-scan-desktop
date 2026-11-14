// SPDX-License-Identifier: AGPL-3.0-only
// Bounded first split-view Zebra slice: scan at left, unchanged reference at
// right, with shared scan-only notes. Synthetic files and a fresh browser only.
import { fileURLToPath } from 'node:url'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'vite'
import { importStep, writeBinarySTL } from 'meshstep'
import { unzipSync, strFromU8 } from 'fflate'
import { cubeStep } from '../../../tests/stepFixtures.ts'
import { launchApp, check, fail, finish, loadScan, pixelDiff, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const standalone = !process.env.APP_URL
const server = standalone ? await createServer({
  root,
  server: { host: '127.0.0.1', port: 0, open: false, watch: { ignored: ['**/e2e-out/**'] } },
}) : null
const dir = mkdtempSync(join(tmpdir(), 'tmar-zebra-split-'))
const step = cubeStep(20)
const stepPath = join(dir, 'reference.step')
writeFileSync(stepPath, step)
const scan = importStep(step, { surfaceDeviation: 0.005, maxEdge: 1.2 }).mesh
const scanPath = join(dir, 'scan.stl')
writeFileSync(scanPath, Buffer.from(writeBinarySTL(scan)))

let browser
let consoleErrors = []
try {
  if (server) await server.listen()
  const app = await launchApp({
    url: server ? server.resolvedUrls.local[0] : process.env.APP_URL,
    width: 1600, height: 1000, protocolTimeout: 120000, language: 'en',
  })
  browser = app.browser
  const page = app.page
  consoleErrors = app.consoleErrors
  page.on('dialog', dialog => dialog.accept())

  const shot = async (selector, name) => {
    await page.mouse.move(2, 2)
    await sleep(200)
    const clip = await page.$eval(selector, el => {
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.x + 10), y: Math.round(r.y + 10),
        width: Math.round(r.width - 20), height: Math.round(r.height - 20) }
    })
    const png = await page.screenshot({ clip, encoding: 'base64' })
    if (name) await page.screenshot({ path: shotPath(name) })
    return png
  }
  // Query only public DOM so the same scenario runs against a compiled build.
  const notes = () => page.$$eval('[data-test=note-row]', rows => rows.map(row => ({
    id: row.getAttribute('data-note-id'),
    text: row.querySelector('[data-test=note-row-text]')?.textContent ?? '',
  })))

  await page.click('[data-test=workspace-deviation]')
  await loadScan(page, scanPath, { inputSelector: '[data-test=start-scan] input[type=file]', timeout: 120000, settle: 0 })
  await (await page.$('[data-test=slot-reference] input[type=file]')).uploadFile(stepPath)
  await page.waitForSelector('[data-test=toggle-split]:enabled', { timeout: 120000 })
  await page.click('[data-test=toggle-split]')
  await page.waitForSelector('[data-test=compare-half]:not([hidden])')
  await page.waitForSelector('[data-test=zebra-enabled]')
  check(!(await page.$('[data-test=zebra-deviation-blocked]')), 'split keeps the Zebra controls available')

  const leftBare = await shot('.viewport canvas', 'zebra-split-left-before.png')
  const rightBare = await shot('.compareview canvas', 'zebra-split-right-before.png')
  check(!(await page.$eval('[data-test=zebra-quick-toggle]', e => e.disabled)), 'Zebra quick button works in split view')
  await page.click('[data-test=zebra-quick-toggle]')
  await page.waitForFunction(() =>
    document.querySelector('[data-test=zebra-enabled]')?.checked &&
    document.querySelector('[data-test=zebra-target]')?.value === 'scan' &&
    document.querySelector('[data-test=zebra-status]')?.textContent.includes('1 visible object'),
    { timeout: 20000 },
  )
  check(true, 'Zebra targets the visible left scan rather than the reference')
  check(await page.$eval('[data-test=zebra-target] option[value=reference]', el => el.disabled),
    'the unsupported reference-side Zebra target cannot be chosen in split view')
  check(!!(await page.$('[data-test=zebra-split-help]')),
    'the split view explicitly describes the current scan-only scope')
  const leftZebra = await shot('.viewport canvas', 'zebra-split-left-after.png')
  const rightZebra = await shot('.compareview canvas', 'zebra-split-right-after.png')
  const leftDelta = await pixelDiff(page, leftBare, leftZebra)
  const rightDelta = await pixelDiff(page, rightBare, rightZebra)
  check(leftDelta > 1, 'left scan visually changes under Zebra (' + leftDelta.toFixed(2) + '%)')
  check(rightDelta < 1 && leftDelta > 20 * rightDelta,
    'right reference stays visually stable within the WebGL frame noise (' + rightDelta.toFixed(3) + '% vs ' + leftDelta.toFixed(2) + '% on scan)')

  // Verify that both halves remain synchronized after a change of Zebra
  // orientation and closing/opening the split without remounting its canvas.
  const rightCanvas = await page.$eval('.compareview canvas', e => {
    e.dataset.zebraSplitKept = 'yes'
    return e.isConnected
  })
  check(rightCanvas, 'reference canvas starts attached')
  await page.select('[data-test=zebra-orientation]', 'vertical')
  const leftRotated = await shot('.viewport canvas')
  const directionDelta = await pixelDiff(page, leftZebra, leftRotated)
  check(directionDelta > 0.2, 'Zebra direction remains interactive (' + directionDelta.toFixed(2) + '%)')
  await page.click('[data-test=toggle-split]')
  await page.waitForSelector('[data-test=compare-half][hidden]')
  await page.click('[data-test=toggle-split]')
  await page.waitForSelector('[data-test=compare-half]:not([hidden])')
  check(!!(await page.$('.compareview canvas[data-zebra-split-kept=yes]')),
    'the same reference canvas survives split hide/show')
  check(await page.$eval('[data-test=zebra-enabled]', e => e.checked),
    'Zebra survives split hide/show without changing CAD geometry')

  await page.click('[data-test=open-settings]')
  await page.waitForSelector('[data-test=interface-language]')
  await page.select('[data-test=interface-language]', 'it')
  await page.waitForFunction(() => document.documentElement.lang === 'it')
  check(await page.$eval('[data-test=zebra-split-help]', e => e.textContent.includes('Nella vista affiancata')),
    'the split-view explanation is translated into Italian')
  await page.select('[data-test=interface-language]', 'en')
  await page.waitForFunction(() => document.documentElement.lang === 'en')
  await page.click('[data-test=settings-close]')

  // The right reference viewport is intentionally not a note target. The
  // existing scan view on the left still owns the note pin and its IDs.
  await page.click('[data-test=zebra-add-note]')
  const rightCenter = await page.$eval('.compareview canvas', e => {
    const r = e.getBoundingClientRect()
    return { x: r.x + r.width * .5, y: r.y + r.height * .5 }
  })
  await page.mouse.click(rightCenter.x, rightCenter.y)
  await sleep(250)
  check((await notes()).length === 0, 'a click in the reference half does not fabricate a scan note')
  const leftCenter = await page.$eval('.viewport canvas', e => {
    const r = e.getBoundingClientRect()
    return { x: r.x + r.width * .5, y: r.y + r.height * .5 }
  })
  await page.mouse.click(leftCenter.x, leftCenter.y)
  await page.waitForSelector('[data-test=note-text]', { timeout: 20000 })
  const text = 'Synthetic split Zebra scan-side note'
  await page.type('[data-test=note-text]', text)
  await page.click('[data-test=note-keep]')
  const savedRow = (await notes()).find(n => n.text === text)
  check(!!savedRow, 'the left scan creates a shared local note')
  check(await page.$eval('[data-test=zebra-enabled]', e => e.checked),
    'Zebra remains visible when the scan note is kept')

  // Locate the saved left-scan observation and return to the original linked
  // framing, without changing or anchoring anything on the reference.
  const rightBeforeFocus = await shot('.compareview canvas')
  await page.click('[data-note-id="' + savedRow.id + '"] [data-test=note-locate]')
  await page.waitForSelector('[data-test=note-focus-ring][data-note-id="' + savedRow.id + '"]', { visible: true })
  await page.waitForFunction(id => {
    const ring = document.querySelector('[data-test=note-focus-ring][data-note-id="' + id + '"]')
    const canvas = document.querySelector('.viewport canvas')
    if (!ring || !canvas) return false
    const r = ring.getBoundingClientRect(), c = canvas.getBoundingClientRect()
    return Math.hypot(r.x + r.width / 2 - c.x - c.width / 2, r.y + r.height / 2 - c.y - c.height / 2) < 3 && r.width >= 50
  }, { timeout: 30000 }, savedRow.id)
  check(await page.$eval('[data-test=note-focus-feedback]', el => el.textContent.includes('centered')),
    'scan-side note focuses and highlights inside the left split viewport')
  await sleep(700)
  const rightAfterFocus = await shot('.compareview canvas')
  const linkedChange = await pixelDiff(page, rightBeforeFocus, rightAfterFocus)
  check(linkedChange > 1, 'the reference view follows the left scan focus (' + linkedChange.toFixed(2) + '% of pixels)')
  await page.click('[data-test=note-return-view]')
  await sleep(700)
  const rightAfterReturn = await shot('.compareview canvas')
  const returnDifference = await pixelDiff(page, rightBeforeFocus, rightAfterReturn)
  check(returnDifference < 1, 'Return to previous view restores the linked reference framing (' + returnDifference.toFixed(3) + '%)')
  check(await page.$eval('[data-test=zebra-enabled]', el => el.checked),
    'note navigation and Return keep split Zebra enabled')

  await page.evaluate(() => {
    const original = URL.createObjectURL
    URL.createObjectURL = blob => { window.zebraSplitSaved = blob; return original(blob) }
    HTMLAnchorElement.prototype.click = function () {}
  })
  await page.waitForSelector('[data-test=save-project]:enabled')
  await page.click('[data-test=save-project]')
  await page.waitForFunction(() => window.zebraSplitSaved instanceof Blob, { timeout: 40000 })
  const raw = await page.evaluate(async () => Array.from(new Uint8Array(await window.zebraSplitSaved.arrayBuffer())))
  const archive = unzipSync(Uint8Array.from(raw))
  const project = JSON.parse(strFromU8(archive['project.json']))
  const stored = project.reverseNotes?.notes?.find(note => String(note.id) === savedRow?.id)
  check(!!stored && stored.text === text && stored.on?.[0]?.kind === 'scan',
    'the saved .scanruler preserves the original scan-side note ID and anchor kind')
  await page.reload({ waitUntil: 'networkidle0' })
  await page.evaluate(bytes => {
    const data = new DataTransfer()
    data.items.add(new File([new Uint8Array(bytes)], 'zebra-split-roundtrip.scanruler'))
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }))
  }, raw)
  await page.waitForFunction(value => {
    return document.body.textContent.includes(value) &&
      !document.querySelector('[data-test=save-project]')?.disabled
  }, { timeout: 120000 }, text)
  check((await notes()).some(n => n.id === savedRow?.id && n.text === text),
    'fresh project reload displays the same note ID and text')
} catch (error) {
  fail(error.stack ?? String(error))
} finally {
  if (browser) await finish(browser, consoleErrors)
  if (server) await server.close()
}
