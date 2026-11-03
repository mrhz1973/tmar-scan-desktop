// SPDX-License-Identifier: AGPL-3.0-only
// Browser worker contract; this is not host feature-history integration QA.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { launchApp } from '../../../scripts/e2e-lib.mjs'
const started = performance.now()
const step = readFileSync('plugins/tmar-edit-surface/evidence/refined-roundtrip/run-Zlk2YR/curved-rational.step', 'utf8')
const { browser, page, consoleErrors } = await launchApp({ url: process.env.APP_URL ?? 'http://127.0.0.1:17531/' })
try {
  const result = await page.evaluate(async step => {
    const { default: Worker } = await import('/plugins/tmar-edit-surface/editor.worker.ts?worker')
    const worker = new Worker(), pending = new Map(); let id = 0
    worker.onmessage = ({ data }) => { const p = pending.get(data.id); if (!p) return; pending.delete(data.id); clearTimeout(p.timer); data.error ? p.reject(Error(data.error)) : p.resolve(data.result) }
    const call = request => new Promise((resolve, reject) => { const key = ++id; const timer = setTimeout(() => { pending.delete(key); reject(Error('Worker timeout')) }, 60000); pending.set(key, { resolve, reject, timer }); worker.postMessage({ ...request, id: key }) })
    try {
      const opened = await call({ action: 'open', step })
      const face = opened.faces.find(f => f.enriched && !f.reason)
      if (!face) throw Error('Missing eligible rational face')
      const net = await call({ action: 'select', face: face.index }); net.poles[12][2] += 0.5
      const original = await call({ action: 'evaluate', net, continuity: 'G1' })
      const recipe = await call({ action: 'createRecipe', net, continuity: 'G1', lockedPoles: [12], bodyId: 'browser-qa' })
      // Cross a persistent JSON boundary before replay/reopening.
      localStorage.setItem('qa.surface-edit-recipe', JSON.stringify(recipe))
      const saved = JSON.parse(localStorage.getItem('qa.surface-edit-recipe'))
      const replay = await call({ action: 'replayRecipe', step, recipe: saved, bodyId: 'browser-qa' })
      const restored = await call({ action: 'restoreRecipe', step, recipe: saved, bodyId: 'browser-qa' })
      let rejection = ''
      try { await call({ action: 'restoreRecipe', step, recipe: { ...saved, baseNetSha256: '0'.repeat(64) }, bodyId: 'browser-qa' }) } catch (e) { rejection = e.message }
      const preserved = await call({ action: 'evaluate', net, continuity: 'G1' })
      return { originalVolume: original.volume, replayVolume: replay.volume, restoredVolume: restored.preview.volume, preservedVolume: preserved.volume, valid: replay.valid, hasStep: replay.step?.includes('ISO-10303-21'), netEqual: JSON.stringify(restored.net) === JSON.stringify(net), locks: restored.lockedPoles, rejection, preparation: recipe.preparation }
    } finally { worker.terminate() }
  }, step)
  assert.equal(result.valid, true); assert.equal(result.hasStep, true); assert.equal(result.netEqual, true)
  assert.deepEqual(result.locks, [12]); assert.match(result.rejection, /Base NURBS/)
  for (const key of ['replayVolume', 'restoredVolume', 'preservedVolume']) assert.ok(Math.abs(result[key] - result.originalVolume) < 1e-8)
  assert.deepEqual(consoleErrors, [])
  const report = { status: 'PASS', scope: 'browser worker recipe contract; not host history', ...result, elapsedMs: performance.now() - started, consoleErrors }
  mkdirSync('plugins/tmar-edit-surface/evidence/recipe', { recursive: true })
  writeFileSync('plugins/tmar-edit-surface/evidence/recipe/browser-result.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} finally { await browser.close() }
