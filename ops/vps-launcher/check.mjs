// SPDX-License-Identifier: AGPL-3.0-only
// Isolated checks: temporary metadata, loopback HTTP and a minimal DOM; no Chrome.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { aggregateMetadata, parseArguments, parseMetadata } from './metadata.mjs'
import { createLauncherServer } from './server.mjs'

// Historical responses observed on 10 November, describing builds of 3 November.
// These values are test fixtures only, never a fallback for published versions.
const stable = { revision: '935f07f23a2311e8d90684590b8aac3d78ca0b5a', channel: 'main-tested', built_at_utc: '2026-11-03T10:57:37Z', cnckitchen_version: '0.9.4', tmar_number: null, tmar_channel: null, source_branch: 'main' }
const dev = { revision: '4a937825508c7a3ae8677821a00ba3b6e87e0873', channel: 'experimental-edit-surface', built_at_utc: '2026-11-03T14:10:51Z', cnckitchen_version: '0.9.4', tmar_number: 1, tmar_channel: 'preview', source_branch: 'review/edit-surface-integration-20261103' }
const javascript = await readFile(new URL('./launcher-version.js', import.meta.url), 'utf8')
const settle = () => new Promise(resolve => setImmediate(resolve))

function chooser(fetch) {
  const nodes = Object.fromEntries(['stable', 'dev'].flatMap(channel => ['base', 'tmar', 'revision', 'date'].map(field => [`${channel}-${field}`, { textContent: 'Non disponibile' }])))
  const timeouts = [], intervals = []
  let reloads = 0
  const location = { reload() { reloads++ } }
  runInNewContext(javascript, {
    document: { getElementById: id => nodes[id] }, fetch, AbortController, Intl, location, window: { location },
    setTimeout(fn, delay) { timeouts.push({ fn, delay }); return timeouts.length - 1 },
    clearTimeout(id) { timeouts[id].cleared = true },
    setInterval(fn, delay) { intervals.push({ fn, delay }); return intervals.length - 1 },
  })
  return { nodes, timeouts, intervals, reloads: () => reloads }
}

test('parses the observed contract without inferring missing or malformed values', () => {
  assert.deepEqual(parseMetadata(JSON.stringify(stable)), stable)
  assert.deepEqual(parseMetadata(JSON.stringify(dev)), dev)
  for (const bad of [null, [], {}, { ...dev, revision: 'main' }, { ...dev, tmar_number: undefined }, { ...dev, tmar_number: 0 }, { ...dev, tmar_channel: 'unknown' }, { ...dev, built_at_utc: '2026-02-30T00:00:00Z' }, { ...dev, cnckitchen_version: '<script>' }]) {
    assert.equal(parseMetadata(JSON.stringify(bad)), null)
  }
  assert.equal(parseMetadata('{'), null)
  assert.equal(parseMetadata(' '.repeat(65537)), null)
  assert.deepEqual(parseMetadata(JSON.stringify({ ...dev, private_path: '/not/public' })), dev)
})

test('reads both files independently, rereads changes, and generates JSON on stdout', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tmar-launcher-metadata-'))
  const stablePath = join(directory, 'stable.json'), devPath = join(directory, 'dev.json')
  try {
    await writeFile(stablePath, JSON.stringify(stable))
    await writeFile(devPath, JSON.stringify(dev))
    assert.deepEqual(await aggregateMetadata({ stablePath, devPath }), { stable, dev })
    const command = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./metadata.mjs', import.meta.url)), '--stable-metadata', stablePath, '--dev-metadata', devPath])
    assert.deepEqual(JSON.parse(command.stdout), { stable, dev })
    assert.equal(await readFile(stablePath, 'utf8'), JSON.stringify(stable))
    await writeFile(devPath, '{')
    assert.deepEqual(await aggregateMetadata({ stablePath, devPath }), { stable, dev: null })
    assert.deepEqual(await aggregateMetadata({ stablePath: join(directory, 'missing'), devPath: directory }), { stable: null, dev: null })
    assert.deepEqual(await aggregateMetadata(), { stable: null, dev: null })
    assert.throws(() => parseArguments(['--stable-metadata']))
    assert.throws(() => parseArguments(['--port', '65536'], true))
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('serves UTF-8 HTML, JS and fresh JSON on loopback without taking over app routes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tmar-launcher-http-'))
  const stablePath = join(directory, 'stable.json'), devPath = join(directory, 'dev.json')
  const server = await createLauncherServer({ stablePath, devPath })
  try {
    await writeFile(stablePath, JSON.stringify(stable))
    await writeFile(devPath, JSON.stringify(dev))
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    const base = `http://127.0.0.1:${server.address().port}`
    const page = await fetch(base + '/?utm_source=check')
    assert.equal(page.status, 200)
    assert.match(page.headers.get('content-type'), /text\/html; charset=utf-8/)
    const html = await page.text()
    for (const text of ['non è necessario', 'già presenti', 'Versione TMAR 5', 'Impostazioni → Lingua dell’interfaccia', 'href="/?version=stable"', 'href="https://scanruler-dev.31-70-139-73.sslip.io/"']) assert.ok(html.includes(text), text)
    assert.equal((html.match(/>Non disponibile<\/strong>/g) ?? []).length, 8)
    assert.ok(!html.includes('Caricamento'))
    const script = await fetch(base + '/launcher-version.js')
    assert.equal(script.status, 200)
    assert.match(script.headers.get('content-type'), /text\/javascript; charset=utf-8/)
    assert.equal(await script.text(), javascript)
    const metadata = await fetch(base + '/tmar-live-versions.json')
    assert.equal(metadata.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await metadata.json(), { stable, dev })
    await writeFile(devPath, JSON.stringify({ ...dev, revision: 'a'.repeat(40) }))
    assert.equal((await (await fetch(base + '/tmar-live-versions.json')).json()).dev.revision, 'a'.repeat(40))
    assert.equal((await fetch(base + '/?version=stable')).status, 404)
    assert.equal((await fetch(base + '/assets/app.js')).status, 404)
    assert.equal((await fetch(base + '/metadata.mjs')).status, 404)
    assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405)
    const head = await fetch(base + '/launcher-version.js', { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(await head.text(), '')
  } finally {
    if (server.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
    await rm(directory, { recursive: true, force: true })
  }
})

test('updates both cards in Europe/Rome every 120 seconds without reloading', async () => {
  let calls = 0
  const ui = chooser(async (url, options) => {
    calls++
    assert.equal(url, '/tmar-live-versions.json')
    assert.equal(options.mode, 'same-origin')
    assert.equal(options.cache, 'no-store')
    return { ok: true, json: async () => ({ stable, dev: { ...dev, tmar_number: calls } }) }
  })
  await settle()
  assert.equal(ui.nodes['stable-base'].textContent, 'v0.9.4')
  assert.equal(ui.nodes['stable-tmar'].textContent, 'TMAR Web — non numerata')
  assert.equal(ui.nodes['dev-tmar'].textContent, 'TMAR Versione 1 — Anteprima')
  assert.equal(ui.nodes['dev-revision'].textContent, '4a93782')
  assert.match(ui.nodes['dev-date'].textContent, /03\/11\/2026.*15:10/)
  assert.equal(ui.intervals.length, 1)
  assert.equal(ui.intervals[0].delay, 120000)
  ui.intervals[0].fn()
  await settle()
  assert.equal(ui.nodes['dev-tmar'].textContent, 'TMAR Versione 2 — Anteprima')
  assert.equal(ui.reloads(), 0)
})

test('HTTP and JSON failures replace old values with Non disponibile', async () => {
  for (const response of [{ ok: false }, { ok: true, json: async () => { throw new Error('Bad JSON') } }, { ok: true, json: async () => [] }]) {
    let first = true
    const ui = chooser(async () => { if (first) { first = false; return { ok: true, json: async () => ({ stable, dev }) } } return response })
    await settle()
    ui.intervals[0].fn()
    await settle()
    assert.ok(Object.values(ui.nodes).every(node => node.textContent === 'Non disponibile'))
  }
})

test('an eight-second timeout releases the request so the next refresh can recover', async () => {
  let calls = 0
  const ui = chooser((_url, { signal }) => {
    if (calls++ > 0) return Promise.resolve({ ok: true, json: async () => ({ stable, dev }) })
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Timed out')), { once: true }))
  })
  assert.equal(ui.timeouts[0].delay, 8000)
  ui.timeouts[0].fn()
  await settle()
  assert.ok(Object.values(ui.nodes).every(node => node.textContent === 'Non disponibile'))
  ui.intervals[0].fn()
  await settle()
  assert.equal(ui.nodes['dev-revision'].textContent, '4a93782')
  assert.equal(ui.reloads(), 0)
})
