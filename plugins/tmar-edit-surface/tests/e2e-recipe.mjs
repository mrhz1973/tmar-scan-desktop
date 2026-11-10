// SPDX-License-Identifier: AGPL-3.0-only
// Browser worker contract; this is not host feature-history integration QA.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { launchApp } from '../../../scripts/e2e-lib.mjs'
const started = performance.now()
const step = readFileSync('plugins/tmar-edit-surface/evidence/refined-roundtrip/run-Zlk2YR/curved-rational.step', 'utf8')
const sheet = readFileSync('plugins/tmar-edit-surface/evidence/free-boundary/compiled-20261103/original.step', 'utf8')
const compiledWorker = process.env.COMPILED_EDITOR_WORKER ?? ''
const { browser, page, consoleErrors } = await launchApp({ url: process.env.APP_URL ?? 'http://127.0.0.1:17531/' })
try {
  const result = await page.evaluate(async ({step,sheet,compiledWorker}) => {
    const worker = compiledWorker ? new globalThis.Worker(compiledWorker,{type:'module'}) : new (await import('/plugins/tmar-edit-surface/editor.worker.ts?worker')).default()
    const pending = new Map(); let id = 0
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
      const freeOpen=await call({action:'open',step:sheet})
      if(!freeOpen.faces[0].freeBoundary)throw Error('Missing eligible free sheet')
      const freeNet=await call({action:'select',face:0});freeNet.poles[0][2]+=2
      const freeBefore=await call({action:'evaluate',net:freeNet,continuity:'G0',freeBoundary:true})
      const freeRecipe=await call({action:'createRecipe',net:freeNet,continuity:'G0',freeBoundary:true,lockedPoles:[0],bodyId:'browser-sheet'})
      const freeSaved=JSON.parse(JSON.stringify(freeRecipe))
      const freeReplay=await call({action:'replayRecipe',step:sheet,recipe:freeSaved,bodyId:'browser-sheet'})
      const freeRestore=await call({action:'restoreRecipe',step:sheet,recipe:freeSaved,bodyId:'browser-sheet'})
      let freeRejection=''
      try {await call({action:'restoreRecipe',step:sheet,recipe:{...freeSaved,boundaryMode:'locked'},bodyId:'browser-sheet'})}catch(e){freeRejection=e.message}
      const freePreserved=await call({action:'evaluate',net:freeNet,continuity:'G0',freeBoundary:true})
      return { originalVolume: original.volume, replayVolume: replay.volume, restoredVolume: restored.preview.volume, preservedVolume: preserved.volume, valid: replay.valid, hasStep: replay.step?.includes('ISO-10303-21'), netEqual: JSON.stringify(restored.net) === JSON.stringify(net), locks: restored.lockedPoles, rejection, preparation: recipe.preparation,
        free:{version:freeSaved.version,mode:freeSaved.boundaryMode,valid:freeReplay.valid,hasStep:freeReplay.step?.includes('ISO-10303-21'),restoredMode:freeRestore.freeBoundary,netEqual:JSON.stringify(freeRestore.net)===JSON.stringify(freeNet),locks:freeRestore.lockedPoles,before:freeBefore.maxBoundaryError,after:freePreserved.maxBoundaryError,rejection:freeRejection} }
    } finally { worker.terminate() }
  }, {step,sheet,compiledWorker})
  assert.equal(result.valid, true); assert.equal(result.hasStep, true); assert.equal(result.netEqual, true)
  assert.deepEqual(result.locks, [12]); assert.match(result.rejection, /Base NURBS/)
  assert.equal(result.free.version,3);assert.equal(result.free.mode,'free-natural');assert.equal(result.free.valid,true)
  assert.equal(result.free.hasStep,true);assert.equal(result.free.restoredMode,true);assert.equal(result.free.netEqual,true)
  assert.deepEqual(result.free.locks,[0]);assert.match(result.free.rejection,/non supportata/)
  assert.ok(result.free.before>1.9 && Math.abs(result.free.before-result.free.after)<1e-8)
  for (const key of ['replayVolume', 'restoredVolume', 'preservedVolume']) assert.ok(Math.abs(result[key] - result.originalVolume) < 1e-8)
  assert.deepEqual(consoleErrors, [])
  const report = { status: 'PASS', scope: `${compiledWorker ? 'compiled' : 'source'} browser worker recipe contract; not host history`, ...result, elapsedMs: performance.now() - started, consoleErrors }
  mkdirSync('plugins/tmar-edit-surface/evidence/recipe', { recursive: true })
  writeFileSync(`plugins/tmar-edit-surface/evidence/recipe/browser-free-boundary-v3${compiledWorker ? '-compiled' : ''}.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} finally { await browser.close() }
