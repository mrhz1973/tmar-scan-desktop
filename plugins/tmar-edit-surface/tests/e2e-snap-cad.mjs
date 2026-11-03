// SPDX-License-Identifier: AGPL-3.0-only
// Synthetic, isolated browser check for snapping to another CAD body.
// Requires an explicitly marked isolated ScanRuler host; never target a user session.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as THREE from 'three'
import { OcctKernel } from 'occt-wasm'
import { launchApp } from '../../../scripts/e2e-lib.mjs'

assert(process.env.APP_URL, 'Set APP_URL to the isolated test host')
assert.equal(process.env.SCANRULER_ISOLATED, '1', 'Set SCANRULER_ISOLATED=1 only for a disposable isolated host')

const out = mkdtempSync(join(tmpdir(), 'scanruler-edit-surface-snap-cad-'))
const kernel = await OcctKernel.init()
const source = kernel.makeBox(20, 30, 10)
const sourceStep = kernel.exportStep(source)
const faces = kernel.getSubShapes(source, 'face')
const faceCenters = faces.map((face, index) => {
  const uv = kernel.uvBounds(face)
  return { index, point: kernel.pointOnSurface(face, (uv.uMin + uv.uMax) / 2, (uv.vMin + uv.vMax) / 2) }
})
const faceIndex = faceCenters.reduce((top, f) => f.point.z > top.point.z ? f : top).index
const pole = faceCenters[faceIndex].point
assert(Math.abs(pole.z - 10) < 1e-7, 'synthetic source has a known top face at z=10')
const bodyMesh = kernel.tessellate(source)
const bodyBounds = new THREE.Box3().setFromBufferAttribute(new THREE.BufferAttribute(bodyMesh.positions, 3))
const reference = kernel.translate(source, 0, 0, 2)
const referenceStep = kernel.exportStep(reference)
faces.forEach(face => kernel.release(face))
kernel.release(reference)
kernel.release(source)
writeFileSync(join(out, 'source.step'), sourceStep)
writeFileSync(join(out, 'offset-cad-reference.step'), referenceStep)

const profile = mkdtempSync(join(tmpdir(), 'scanruler-edit-surface-snap-cad-profile-'))
const { browser, page, consoleErrors } = await launchApp({
  url: process.env.APP_URL,
  userDataDir: profile,
  agentDataOk: false,
  width: 1440,
  height: 1000,
})
try {
  if (process.env.CAD_PROJECT) {
    await page.waitForSelector('[data-test=project-input]')
    await (await page.$('[data-test=project-input]')).uploadFile(process.env.CAD_PROJECT)
  }
  await page.click('[data-test=workspace-reverse]')
  if (process.env.CAD_PROJECT) await page.waitForFunction(() => /CAD kernel ready/i.test(document.querySelector('[data-test=kernel-status]')?.textContent ?? ''), { timeout: 120000 })
  else await page.waitForFunction(() => window.__re?.store.getState().kernelStatus === 'ready', { timeout: 120000 })
  if (!process.env.CAD_PROJECT) await page.evaluate(async ({ sourceText, referenceText }) => {
    const { runCommand } = await import('/src/commands/registry.ts')
    await runCommand('reverse.import.step', { bytes: new TextEncoder().encode(sourceText), name: 'snap-cad-source.step' })
    await runCommand('reverse.import.step', { bytes: new TextEncoder().encode(referenceText), name: 'snap-cad-reference.step' })
  }, { sourceText: sourceStep, referenceText: referenceStep })
  if (!process.env.CAD_PROJECT) await page.waitForFunction(() => window.__re?.store.getState().bodies?.length === 2 && !window.__re.store.getState().building, { timeout: 120000 })
  if (process.env.SAVE_PROJECT) {
    await page.evaluate(()=>document.addEventListener('click',e=>{
      if(e.target instanceof HTMLAnchorElement && e.target.download.endsWith('.scanruler')) {
        e.preventDefault(); window.savedSnapProject=fetch(e.target.href).then(r=>r.arrayBuffer()).then(b=>Array.from(new Uint8Array(b)))
      }
    },true))
    await page.click('[data-test=save-project]'); await page.waitForFunction(()=>!!window.savedSnapProject)
    writeFileSync(process.env.SAVE_PROJECT,Buffer.from(await page.evaluate(()=>window.savedSnapProject)))
  }

  await page.waitForSelector('[data-test=edit-surface-entry] button:enabled', { timeout: 60000 })
  await page.click('[data-test=edit-surface-entry] button')
  const bodyOptions = await page.$$eval('[data-test=surface-body] option', xs => xs.map(x => ({ value: x.value, name: x.textContent })))
  assert.equal(bodyOptions.length, 2, 'both synthetic STEP bodies are in the isolated project')
  // STEP imports are kept in insertion order; source is imported before reference.
  const sourceOption = bodyOptions[0]
  await page.select('[data-test=surface-body]', sourceOption.value)
  await page.click('[data-test=surface-load-body]')
  await page.waitForFunction(() => document.querySelectorAll('[data-test=surface-face] option').length === 7, { timeout: 120000 })
  await page.select('[data-test=surface-face]', String(faceIndex))
  await page.waitForFunction(() => {
    const status = document.querySelector('[data-test=surface-status]')
    return status?.textContent.includes('CAD valido') && !document.querySelector('[data-test=surface-apply]')?.disabled
  }, { timeout: 120000 })
  await page.waitForFunction(() => /[1-9]\d* riferimenti/.test(document.querySelector('[data-test=surface-snap-info]')?.textContent ?? ''), { timeout: 30000 })
  assert.equal(await page.$eval('[data-test=surface-snap]', e => e.checked), true)
  await page.$eval('[data-test=surface-snap-distance]', e => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, '1')
    e.dispatchEvent(new Event('input', { bubbles: true }))
    e.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.select('[data-test=surface-drag-mode]', 'axis')
  await page.click('[data-test=surface-axis-2]')

  const rect = await page.$eval('[data-test=edit-surface-viewport]', e => {
    const r = e.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height }
  })
  const center = bodyBounds.getCenter(new THREE.Vector3())
  const radius = Math.max(bodyBounds.getSize(new THREE.Vector3()).length() / 2, 0.1)
  const camera = new THREE.PerspectiveCamera(40, rect.width / rect.height, radius / 1000, radius * 100)
  camera.position.copy(center).add(new THREE.Vector3(1.5, -1.9, 1.8).multiplyScalar(radius))
  camera.up.set(0, 0, 1)
  camera.lookAt(center)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld()
  const origin = new THREE.Vector3(pole.x, pole.y, pole.z)
  const projected = origin.clone().project(camera)
  const end = origin.clone().add(new THREE.Vector3(0, 0, radius)).project(camera)
  const from = [rect.x + (projected.x + 1) * rect.width / 2, rect.y + (1 - projected.y) * rect.height / 2]
  const sx = (end.x - projected.x) * rect.width / 2 / radius
  const sy = -(end.y - projected.y) * rect.height / 2 / radius
  const to = [from[0] + sx * 1.5, from[1] + sy * 1.5]
  assert(Math.hypot(to[0] - from[0], to[1] - from[1]) >= 4, 'synthetic drag exceeds pointer slack')

  await page.mouse.click(...from)
  await page.waitForFunction(() => document.querySelector('[data-test=surface-selection]')?.textContent.includes('1 selezionati · 1 modificabili'), { timeout: 10000 })
  const beforeVolume = await page.$eval('[data-test=surface-status]', e => Number(e.dataset.previewVolume))
  const cdp = await page.createCDPSession()
  const statusReady = () => page.waitForFunction(() => document.querySelector('[data-test=surface-status]')?.textContent.includes('CAD valido'), { timeout: 120000 })
  const exportTop = async label => {
    const dir = join(out, label)
    mkdirSync(dir)
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir, eventsEnabled: true })
    for (const button of await page.$$('.es-dialog button')) {
      if (await button.evaluate(e => e.textContent === 'Esporta STEP…')) { await button.click(); break }
    }
    let file
    const deadline = Date.now() + 120000
    while (Date.now() < deadline && !file) {
      file = readdirSync(dir).find(name => name.toLowerCase().endsWith('.step'))
      if (!file) await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert(file, `STEP export completed for ${label}`)
    const shape = kernel.importStep(readFileSync(join(dir, file), 'utf8'))
    const exportedFaces = kernel.getSubShapes(shape, 'face')
    const exportedSolids = kernel.getSubShapes(shape, 'solid')
    try {
      assert(kernel.isValid(shape) && exportedSolids.length === 1 && exportedFaces.length === 6, 'export remains a valid six-face CAD solid')
      const centers = exportedFaces.map(face => {
        const uv = kernel.uvBounds(face)
        return kernel.pointOnSurface(face, (uv.uMin + uv.uMax) / 2, (uv.vMin + uv.vMax) / 2)
      })
      return centers.reduce((top, point) => point.z > top.z ? point : top).z
    } finally {
      exportedFaces.forEach(face => kernel.release(face))
      exportedSolids.forEach(solid => kernel.release(solid))
      kernel.release(shape)
      await statusReady()
    }
  }
  const waitBase = async () => {
    await page.click('[data-test=surface-undo]')
    await page.waitForFunction(v => {
      const status = document.querySelector('[data-test=surface-status]')
      return status?.textContent.includes('CAD valido') && Math.abs(Number(status.dataset.previewVolume) - v) < 1e-5
    }, { timeout: 120000 }, beforeVolume)
  }
  const drag = async ({ alt = false } = {}) => {
    await page.mouse.move(...from)
    if (alt) await page.keyboard.down('Alt')
    await page.mouse.down()
    await page.mouse.move(...to, { steps: 8 })
    const expectSnap = !alt && await page.$eval('[data-test=surface-snap]', e => e.checked)
    if (!expectSnap) {
      assert.equal(await page.$eval('[data-test=edit-surface-viewport]', e => e.dataset.snapKind), '', 'Alt or disabling the magnet suppresses CAD snapping during the drag')
    } else {
      await page.waitForFunction(() => document.querySelector('[data-test=edit-surface-viewport]')?.dataset.snapKind === 'cad', { timeout: 10000 })
    }
    await page.mouse.up()
    if (alt) await page.keyboard.up('Alt')
    await statusReady()
  }

  await drag()
  assert.equal(await page.$eval('[data-test=edit-surface-viewport]', e => e.dataset.snapKind), '')
  assert.match(await page.$eval('[data-test=surface-snap-feedback]', e => e.textContent), /Agganciato: Corpo CAD/)
  const snappedZ = await exportTop('snapped-cad')
  await waitBase()

  await drag({ alt: true })
  assert.equal(await page.$eval('[data-test=edit-surface-viewport]', e => e.dataset.snapKind), '')
  assert.equal(await page.$eval('[data-test=surface-snap-feedback]', e => getComputedStyle(e).display), 'none')
  const altZ = await exportTop('alt-free')
  await waitBase()

  await page.click('[data-test=surface-snap]')
  assert.equal(await page.$eval('[data-test=surface-snap]', e => e.checked), false)
  await drag()
  assert.equal(await page.$eval('[data-test=edit-surface-viewport]', e => e.dataset.snapKind), '')
  const disabledZ = await exportTop('toggle-free')
  await waitBase()
  assert(snappedZ > altZ + 0.08, `CAD snap moves the center further than Alt: ${snappedZ} vs ${altZ}`)
  assert(Math.abs(altZ - disabledZ) < 1e-5, `Alt and disabled toggle produce the same unsnapped result: ${altZ} vs ${disabledZ}`)
  assert(Math.abs(altZ - 10.375) < 0.02, `unsnapped center follows the 1.5 mm drag: ${altZ}`)
  assert(Math.abs(snappedZ - 10.5) < 0.02, `CAD snapped center follows the 2 mm reference: ${snappedZ}`)
  assert.deepEqual(consoleErrors, [])

  const report = { pass: true, isolatedUrl: process.env.APP_URL, faceIndex, centerPole: [pole.x, pole.y, pole.z], snappedZ, altZ, disabledZ, consoleErrors }
  writeFileSync(join(out, 'result.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ out, ...report }, null, 2))
} catch (error) {
  writeFileSync(join(out, 'failure.json'), JSON.stringify({ error: String(error), stack: error.stack, consoleErrors }, null, 2))
  await page.screenshot({ path: join(out, 'failure.png') })
  throw error
} finally {
  await browser.close()
  kernel[Symbol.dispose]()
}
