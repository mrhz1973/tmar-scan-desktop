// SPDX-License-Identifier: AGPL-3.0-only
// Disposable synthetic fixtures and an isolated headless browser only.
import { fileURLToPath } from 'node:url'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import * as THREE from 'three'
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const server = process.env.APP_URL ? null : await createServer({ root, server: { host: '127.0.0.1', port: 0, open: false, watch: { ignored: ['**/e2e-out/**'] } } })
if (server) { await server.listen(); process.env.APP_URL = server.resolvedUrls.local[0] }
const { CHROME, check, fail, finish, sleep, pixelDiff, shotPath } = await import('../../../scripts/e2e-lib.mjs')
const tempRoot = resolve(tmpdir())
const profile = resolve(mkdtempSync(join(tempRoot, 'tmar-zebra-e2e-')))
const profileRelative = relative(tempRoot, profile)
if (!profileRelative || profileRelative.startsWith('..') || isAbsolute(profileRelative) || !basename(profile).startsWith('tmar-zebra-e2e-')) throw new Error('Unsafe temporary browser profile path')

function sphereStl() {
  const geometry = new THREE.SphereGeometry(20, 64, 32)
  const pos = geometry.getAttribute('position'), index = geometry.getIndex()
  const n = index.count / 3, bytes = Buffer.alloc(84 + n * 50)
  bytes.writeUInt32LE(n, 80)
  for (let t = 0; t < n; t++) for (let v = 0; v < 3; v++) {
    const i = index.getX(3 * t + v)
    for (let axis = 0; axis < 3; axis++) bytes.writeFloatLE(pos.getComponent(i, axis), 84 + t * 50 + 12 + v * 12 + axis * 4)
  }
  geometry.dispose()
  return bytes
}

let browser, page, consoleErrors = []
try {
  // An explicitly owned profile avoids Puppeteer's automatic Windows temp
  // cleanup racing Chrome on exit. It never shares a person's browser data.
  browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: profile,
    args: ['--window-size=1500,1000', '--no-sandbox', ...(process.env.CI ? ['--enable-unsafe-swiftshader'] : [])],
    defaultViewport: { width: 1500, height: 1000 }, protocolTimeout: 600_000 })
  page = await browser.newPage()
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`))
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('scanruler.askstlunits', '0')
    localStorage.setItem('scanruler.beta', 'all')
    localStorage.setItem('scanruler.supportask', '0')
    localStorage.setItem('scanruler.agentdataok', '1')
  })
  await page.goto(process.env.APP_URL, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.panel')
  // A synthetic project is deliberately discarded at the end of this test.
  page.on('dialog', (dialog) => dialog.accept())
  console.log('ENV:', JSON.stringify({ node: process.version, platform: process.platform, browser: await browser.version() }))
  const call = (name, args = {}) => page.evaluate(async (name, args) => {
    const { registerCoreCommands } = await import('/src/commands/core.ts')
    registerCoreCommands()
    const { runCommand } = await import('/src/commands/registry.ts')
    if (args.bytes) args.bytes = new Uint8Array(args.bytes)
    return runCommand(name, args)
  }, name, args)
  const shot = async () => {
    await page.mouse.move(10, 10)
    await sleep(500)
    const clip = await page.$eval('.stage', (el) => {
      const r = el.getBoundingClientRect()
      return { x: r.x + 20, y: r.y + 20, width: r.width - 40, height: r.height - 40 }
    })
    return page.screenshot({ clip, encoding: 'base64' })
  }

  await call('scan.open', { bytes: Array.from(sphereStl()), name: 'synthetic-sphere.stl', units: 'mm' })
  await page.click('[data-test=workspace-reverse]')
  await page.waitForFunction(() => /ready/.test(document.querySelector('[data-test=kernel-status]')?.textContent ?? ''), { timeout: 180_000 })
  if (await page.$('[data-test=support-card] .sc-x')) await page.click('[data-test=support-card] .sc-x')
  await page.waitForSelector('[data-test=zebra-enabled]')
  check(!(await page.$eval('[data-test=zebra-enabled]', (el) => el.checked)), 'Zebra starts off')
  await page.click('[data-test=zebra-enabled]')
  await page.select('[data-test=zebra-target]', 'scan')
  await page.waitForFunction(() => /1 visible object/.test(document.querySelector('[data-test=zebra-status]')?.textContent ?? ''))
  const zebraScan = await shot()
  await page.screenshot({ path: shotPath('tmar-zebra-scan.png') })
  await page.select('[data-test=zebra-orientation]', 'vertical')
  const rotatedBands = await shot()
  const orientationDiff = await pixelDiff(page, zebraScan, rotatedBands)
  check(orientationDiff > 1, `changing orientation changes rendered scan stripes (${orientationDiff.toFixed(2)}% of stage pixels)`)
  await page.focus('[data-test=zebra-width]')
  await page.keyboard.press('End')
  const widerBands = await shot()
  const widthDiff = await pixelDiff(page, rotatedBands, widerBands)
  check(widthDiff > 1, `changing stripe width updates the reflected bands (${widthDiff.toFixed(2)}% of stage pixels)`)
  await page.click('[data-test=zebra-enabled]')
  const normalScan = await shot()
  const scanDiff = await pixelDiff(page, zebraScan, normalScan)
  check(scanDiff > 1, `enabling Zebra visibly changes the scan (${scanDiff.toFixed(2)}% of stage pixels)`)
  await page.click('[data-test=zebra-enabled]')
  await page.waitForFunction(() => /1 visible object/.test(document.querySelector('[data-test=zebra-status]')?.textContent ?? ''))
  await page.click('[data-test=zebra-enabled]')
  const restoredScan = await shot()
  const restoreDiff = await pixelDiff(page, normalScan, restoredScan)
  check(restoreDiff < 0.1, `disabling Zebra restores the scan view (${restoreDiff.toFixed(2)}% pixel difference)`)
  await page.click('[data-test=zebra-enabled]')
  await page.waitForFunction(() => /1 visible object/.test(document.querySelector('[data-test=zebra-status]')?.textContent ?? ''))
  check(await page.evaluate(async () => !(await import('/src/state/prefsStore.ts')).usePrefs.getState().agentLink), 'local notes start without an agent connection')
  await page.click('[data-test=zebra-add-note]')
  const scanPoint = await page.$eval('.stage', (el) => {
    const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await page.mouse.click(scanPoint.x, scanPoint.y)
  await page.waitForSelector('[data-test=note-text]')
  await page.type('[data-test=note-text]', 'Synthetic scan zebra observation')
  await page.click('[data-test=note-keep]')
  check(await page.evaluate(async () => {
    const { usePrefs } = await import('/src/state/prefsStore.ts')
    const { useNotes } = await import('/plugins/reverse/state/noteStore.ts')
    return !usePrefs.getState().agentLink && useNotes.getState().notes.some((n) => n.text === 'Synthetic scan zebra observation' && n.on[0]?.kind === 'scan')
  }), 'a scan note is pinned without enabling an agent')
  check(await page.$eval('[data-test=zebra-enabled]', (el) => el.checked), 'Zebra remains visible while a note is written')
  await page.evaluate(async () => {
    const { sceneOf } = await import('/src/commands/host.ts')
    const scene = sceneOf(), geometry = scene.scanGeometry()
    window.__zebraOldScan = scene.layerHost().partGroup.children.find((x) => x.isMesh && x.geometry === geometry)
  })
  await call('scan.open', { bytes: Array.from(sphereStl()), name: 'replacement-sphere.stl', units: 'mm', discard: true })
  await page.waitForFunction(() => !window.__zebraOldScan.children.some((c) => c.name === 'tmar-zebra-overlay'))
  await page.waitForFunction(() => /1 visible object/.test(document.querySelector('[data-test=zebra-status]')?.textContent ?? ''))
  check(await page.evaluate(async () => {
    const { sceneOf } = await import('/src/commands/host.ts')
    const scene = sceneOf(), geometry = scene.scanGeometry()
    const scan = scene.layerHost().partGroup.children.find((x) => x.isMesh && x.geometry === geometry)
    return scan !== window.__zebraOldScan && scan?.children.filter((c) => c.name === 'tmar-zebra-overlay').length === 1
  }), 'replacing the scan moves Zebra to the new scan and releases the old one')
  await page.click('[data-test=zebra-enabled]')

  const circle = async (name, cx) => {
    await call('reverse.feature.add', { feature: { kind: 'sketch', name: `${name} sketch`, plane: { kind: 'world', axis: 'z' }, sketch: { entities: [{ id: 1, kind: 'circle', c: [cx, 0], r: 6 }] } } })
    await call('reverse.feature.add', { feature: { kind: 'extrude', name, sketchId: `${name} sketch`, regions: 'all', extent: { kind: 'distance', from: 0, to: 12 }, op: 'new' } })
  }
  await circle('Cylinder A', -10)
  await circle('Cylinder B', 10)
  const ids = await page.evaluate(() => window.__re.store.getState().bodies.map((b) => b.id))
  check(ids.length === 2, 'two separate synthetic CAD bodies were built')
  await page.evaluate(() => { window.__re.store.getState().setScanHidden(true) })
  await page.evaluate(() => {
    const meshes = [...window.__re.reScene().bodyMeshes.values()]
    window.__zebraOriginal = meshes.map((mesh) => ({ mesh, geometry: mesh.geometry, material: mesh.material, positions: Array.from(mesh.geometry.attributes.position.array.slice(0, 20)) }))
  })
  await page.click('[data-test=zebra-enabled]')
  await page.select('[data-test=zebra-target]', 'visible')
  await page.focus('[data-test=zebra-width]')
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.waitForFunction(() => /2 visible objects/.test(document.querySelector('[data-test=zebra-status]')?.textContent ?? ''))
  const overlays = await page.evaluate(() => window.__zebraOriginal.map(({ mesh, geometry, material, positions }) => ({
    count: mesh.children.filter((c) => c.name === 'tmar-zebra-overlay').length,
    sameGeometry: mesh.geometry === geometry, sameMaterial: mesh.material === material,
    sameData: JSON.stringify(Array.from(mesh.geometry.attributes.position.array.slice(0, 20))) === JSON.stringify(positions),
  })))
  check(overlays.every((x) => x.count === 1 && x.sameGeometry && x.sameMaterial && x.sameData), 'both CAD overlays leave source geometry and materials unchanged')
  await page.click('[data-test=zebra-add-note]')
  const cadPoint = await page.evaluate(() => {
    const rs = window.__re.reScene()
    for (const p of [[-10, 0, 12], [10, 0, 12], [-10, -4, 8], [10, -4, 8]]) {
      const [x, y] = rs.bodyPicks.screenProjection()(...p)
      if (rs.bodyItemAt(x, y)) return { x, y }
    }
    return null
  })
  if (!cadPoint) throw new Error('No synthetic CAD face was available for a note')
  await page.mouse.click(cadPoint.x, cadPoint.y)
  await page.waitForSelector('[data-test=note-text]')
  await page.type('[data-test=note-text]', 'Synthetic CAD zebra observation')
  await page.click('[data-test=note-keep]')
  check(await page.evaluate(async () => {
    const { usePrefs } = await import('/src/state/prefsStore.ts')
    const { useNotes } = await import('/plugins/reverse/state/noteStore.ts')
    return !usePrefs.getState().agentLink && useNotes.getState().notes.some((n) => n.text === 'Synthetic CAD zebra observation' && ['face', 'edge', 'vertex'].includes(n.on[0]?.kind))
  }), 'a CAD note is pinned through the Zebra overlay without enabling an agent')
  check(await page.$eval('[data-test=zebra-enabled]', (el) => el.checked), 'Zebra remains enabled after pinning a CAD note')
  await page.evaluate(async () => {
    // This disposable page must never connect to a real agent while testing
    // what happens to existing notes as the agent setting changes.
    class InertSocket extends EventTarget {
      static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3
      readyState = 0; close() { this.readyState = 3 } send() {}
    }
    window.WebSocket = InertSocket
    const { usePrefs } = await import('/src/state/prefsStore.ts')
    usePrefs.setState({ agentLink: true })
  })
  await page.waitForFunction(() => document.querySelector('[data-test=note-list]')?.textContent.includes('Notes for the agent'))
  await page.evaluate(async () => (await import('/src/state/prefsStore.ts')).usePrefs.setState({ agentLink: false }))
  await page.waitForFunction(() => document.querySelector('[data-test=note-row-text]')?.textContent.includes('Synthetic CAD zebra observation'))
  check(await page.evaluate(async () => !(await import('/src/state/prefsStore.ts')).usePrefs.getState().agentLink && !!document.querySelector('[data-test=note-list]')), 'switching the agent off keeps local notes available')
  const zebraCad = await shot()
  await page.screenshot({ path: shotPath('tmar-zebra-cad.png') })
  await page.evaluate(async () => {
    const { Plane, Vector3 } = await import('/node_modules/three/build/three.module.js')
    const mesh = window.__zebraOriginal[0].mesh
    window.__zebraClip = [new Plane(new Vector3(0, 0, -1), 6)]
    mesh.material.clippingPlanes = window.__zebraClip
    mesh.material.needsUpdate = true
    window.__re.reScene().host.invalidate()
  })
  await page.waitForFunction(() => window.__zebraOriginal[0].mesh.children.find((c) => c.name === 'tmar-zebra-overlay')?.material.clippingPlanes === window.__zebraClip)
  const clippedCad = await shot()
  const clipDiff = await pixelDiff(page, zebraCad, clippedCad)
  check(clipDiff > 0.1, `the Zebra overlay follows clipping on a CAD body (${clipDiff.toFixed(2)}% of stage pixels)`)
  await page.evaluate(() => {
    const mesh = window.__zebraOriginal[0].mesh
    mesh.material.clippingPlanes = null
    mesh.material.needsUpdate = true
    window.__re.reScene().host.invalidate()
  })
  await page.waitForFunction(() => window.__zebraOriginal[0].mesh.children.find((c) => c.name === 'tmar-zebra-overlay')?.material.clippingPlanes === null)
  await page.click('[data-test=zebra-enabled]')
  const normalCad = await shot()
  const cadDiff = await pixelDiff(page, zebraCad, normalCad)
  check(cadDiff > 0.5, `CAD zebra is visible (${cadDiff.toFixed(2)}% of stage pixels)`)
  await page.click('[data-test=zebra-enabled]')
  await page.select('[data-test=zebra-target]', 'selected')
  await page.click(`[data-test=body-row][data-body="${ids[0]}"] [data-test=body-name]`)
  await page.waitForFunction(() => /1 visible object/.test(document.querySelector('[data-test=zebra-status]')?.textContent ?? ''))
  check(await page.evaluate(() => window.__zebraOriginal.map(({ mesh }) => mesh.children.filter((c) => c.name === 'tmar-zebra-overlay').length).join(',') === '1,0'), 'body-list selection targets only the selected body')
  await page.evaluate((id) => window.__re.store.getState().setBodiesVisible([id], false), ids[0])
  await page.waitForFunction(() => /Select visible CAD bodies/.test(document.querySelector('[data-test=zebra-status]')?.textContent ?? ''))
  check(await page.evaluate(() => window.__zebraOriginal[0].mesh.children.find((c) => c.name === 'tmar-zebra-overlay')?.visible === false), 'hidden bodies do not show stripes')
  await page.click('[data-test=feature-move-body]')
  await page.waitForSelector('[data-test=move-body-editor]')
  await page.waitForFunction(() => window.__zebraOriginal.every(({ mesh }) => !mesh.children.some((c) => c.name === 'tmar-zebra-overlay')))
  check(!(await page.$('[data-test=tmar-zebra]')), 'opening a CAD editor removes the Zebra controls and overlays')
  // Reverse scrolls the editor into view smoothly; wait for it to stop before clicking.
  await sleep(900)
  await page.click('[data-test=move-body-cancel]')
  await page.waitForSelector('[data-test=zebra-enabled]')
  check(!(await page.$eval('[data-test=zebra-enabled]', (el) => el.checked)), 'closing the editor returns to the normal display')
  await page.click('[data-test=zebra-enabled]')
  await call('reverse.body.compare_in_deviation')
  await page.waitForFunction(() => window.__zebraOriginal.every(({ mesh }) => !mesh.children.some((c) => c.name === 'tmar-zebra-overlay')))
  const deviation = await page.evaluate(async () => {
    const { useShell } = await import('/src/state/shellStore.ts')
    const { useDeviation } = await import('/src/state/deviationStore.ts')
    return { workspace: useShell.getState().workspace, mapStatus: useDeviation.getState().mapStatus }
  })
  check(deviation.workspace === 'deviation' && deviation.mapStatus === 'ready', 'comparison opens its normal deviation map after Zebra is closed')
  check(true, 'leaving Reverse removes Zebra overlays')
  await page.click('[data-test=workspace-reverse]')
  await page.waitForSelector('[data-test=zebra-enabled]')
  check(!(await page.$eval('[data-test=zebra-enabled]', (el) => el.checked)), 'returning to Reverse starts with Zebra off')
  await page.evaluate((id) => window.__re.store.getState().setBodiesVisible([id], true), ids[0])
  await page.click('[data-test=zebra-enabled]')
  await page.waitForFunction(() => /2 visible objects/.test(document.querySelector('[data-test=zebra-status]')?.textContent ?? ''))
  const savedBytes = await page.evaluate(async () => {
    const { runCommand } = await import('/src/commands/registry.ts')
    const result = await runCommand('project.save')
    window.__zebraSavedProject = result.file
    return result.file.bytes.byteLength
  })
  check(savedBytes > 0, 'project saves while Zebra is shown')
  await page.click('[data-test=zebra-enabled]')
  await page.evaluate(async () => {
    const { useNotes } = await import('/plugins/reverse/state/noteStore.ts')
    useNotes.getState().load([])
    useNotes.setState({ localNotesVisible: false })
  })
  await page.evaluate(async () => {
    const { runCommand } = await import('/src/commands/registry.ts')
    await runCommand('project.load', { bytes: window.__zebraSavedProject.bytes, name: window.__zebraSavedProject.name, discard: true })
  })
  await page.waitForFunction(() => window.__re.store.getState().bodies.length === 2 && !window.__re.store.getState().building, { timeout: 180_000 })
  check(!(await page.$eval('[data-test=zebra-enabled]', (el) => el.checked)), 'reopened project keeps its bodies and does not persist the Zebra display')
  check(await page.evaluate(async () => {
    const { useNotes } = await import('/plugins/reverse/state/noteStore.ts')
    const { usePrefs } = await import('/src/state/prefsStore.ts')
    return !usePrefs.getState().agentLink && useNotes.getState().notes.some((n) => n.text === 'Synthetic CAD zebra observation') && !!document.querySelector('[data-test=note-list]')
  }), 'saved Zebra notes reopen and remain accessible without an agent connection')
  const disabledURL = new URL(process.env.APP_URL); disabledURL.searchParams.set('plugins', 'none')
  await page.goto(disabledURL.href, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.panel')
  check(!(await page.$('[data-test=tmar-zebra]')) && !(await page.$('[data-test=workspace-reverse]')), 'host starts without plugins')
} catch (error) {
  fail(error.stack ?? String(error))
} finally {
  try {
    if (browser) await finish(browser, consoleErrors)
    else process.exitCode = 1
  } finally {
    if (server) await server.close()
    try { await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }) }
    catch (error) { console.warn(`Could not remove the isolated test profile: ${error.message}`) }
  }
}
