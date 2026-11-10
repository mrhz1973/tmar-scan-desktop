// SPDX-License-Identifier: AGPL-3.0-only
// Actual workspace UI/controller: edit, preserve history, Apply, project ZIP,
// fresh browser context, resume, edit again, Apply and global Undo/Redo.
// Uses only an owned localhost app/profile and a synthetic box, never T2/live CAD.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { OcctKernel } from 'occt-wasm'

assert.equal(process.env.SCANRULER_ISOLATED, '1', 'An isolated app is required')
const url = new URL(process.env.APP_URL ?? '')
assert(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.port &&
  url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash, 'Explicit local app origin required')
const root = process.env.HOST_QA_OUT
assert(root && isAbsolute(root), 'Absolute HOST_QA_OUT required')
const rel = relative(resolve(process.cwd()), resolve(root))
assert(rel && (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)), 'Evidence must be outside the Vite checkout')
mkdirSync(root, { recursive: true })
const out = mkdtempSync(join(root, 'surface-history-workspace-')), downloads = join(out, 'downloads')
mkdirSync(downloads)
process.env.SHOT_DIR = out
const { launchApp, MOD } = await import('../../../scripts/e2e-lib.mjs')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const report = {
  scope: 'Isolated Vite source app, actual Edit Surface history UI, synthetic 20×30×10 mm box; no T2 qualification',
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  startedAt: new Date().toISOString(), stage: 'setup', checks: [], consoleErrors: [], verdict: 'INCOMPLETE',
}
const check = (ok, label) => { assert(ok, label); report.checks.push(label); console.log('PASS', label) }
let browser, page, cleanContext, kernel

// These imports expose observations/fixture setup only. All editor opens,
// moves, history opt-ins, Apply, file save/import and Undo/Redo use the UI.
const attach = () => page.evaluate(async () => {
  const { useReverse } = await import('/plugins/reverse/state/reStore.ts')
  const { reverseSession } = await import('/plugins/reverse/app/reSession.ts')
  const { useWorkspaceEditor } = await import('/src/plugins/workspaceEditors.ts')
  const { useHistory } = await import('/src/state/historyStore.ts')
  const { usePrefs } = await import('/src/state/prefsStore.ts')
  const { useStore } = await import('/src/state/store.ts')
  window.surfaceHistoryQa = { useReverse, reverseSession, useWorkspaceEditor, useHistory, usePrefs, useStore }
})
const ready = () => page.waitForFunction(() => {
  const s = window.surfaceHistoryQa.useWorkspaceEditor.getState()
  if (s.error) throw Error(s.error)
  const panel = s.controller?.getPanelState()
  return s.phase === 'editing' && s.snapshot?.validation.kind === 'valid' && panel && !panel.busy && !panel.calculating
}, { timeout: 180000 })
const documentState = () => page.evaluate(() => {
  const q = window.surfaceHistoryQa, re = q.useReverse.getState(), history = q.useHistory.getState()
  return { bodies: re.bodies.map(({ id, visible }) => ({ id, visible })), features: re.features,
    past: history.past.length, future: history.future.length }
})
const stored = bodyId => page.evaluate(bodyId => {
  const q = window.surfaceHistoryQa, re = q.useReverse.getState()
  const feature = re.features.find(f => f.id === Math.floor(bodyId))
  if (feature?.kind !== 'import' || !feature.surfaceEditHistory) throw Error('Published history feature missing')
  const record = feature.surfaceEditHistory
  return { feature, record, sourceStep: re.stepFiles[record.source.file.key], resultStep: re.stepFiles[feature.file.key] }
}, bodyId)
const liveSteps = ids => page.evaluate(async ids => {
  const session = window.surfaceHistoryQa.reverseSession()
  if (!session) throw Error('CAD session unavailable')
  await session.settled()
  const texts = []
  for (const id of ids) texts.push((await session.client().bodyEditSource(id)).text)
  return texts
}, ids)
const inspect = step => {
  assert(typeof step === 'string' && step.startsWith('ISO-10303-21;'), 'STEP text is required for native readback')
  const shape = kernel.importStep(step)
  try {
    return { valid: kernel.isValid(shape), faces: kernel.subShapeCount(shape, 'face'),
      solids: kernel.subShapeCount(shape, 'solid'), area: kernel.getSurfaceArea(shape), volume: kernel.getVolume(shape) }
  } finally { kernel.release(shape) }
}
const solid = result => result.valid && result.faces === 6 && result.solids === 1 && Number.isFinite(result.volume)
const sameShapeMetrics = (a, b) => solid(a) && solid(b) && Math.abs(a.volume - b.volume) < 1e-6 && Math.abs(a.area - b.area) < 1e-6
const validStored = (saved, label) => {
  const r = saved.record
  check(r.schema === 'tmar.host.surface-edit-history' && r.version === 1 && [2, 3, 4, 5, 6].includes(r.recipe?.version) &&
    r.notePolicy === 'none' && r.recipe.edits.length > 0, `${label}: supported, non-empty editable recipe is attached to the CAD import`)
  check(sha(saved.sourceStep) === r.source.stepSha256 && sha(saved.resultStep) === r.resultStepSha256 &&
    r.source.stepSha256 !== r.resultStepSha256, `${label}: distinct archived source and result bytes match their recorded hashes`)
}

async function moveOnePole(distance) {
  await ready()
  await page.select('[data-test=surface-drag-mode]', 'axis')
  await page.click('[data-test=surface-axis-2]')
  await page.waitForSelector('[data-test=surface-next-free]:enabled')
  await page.click('[data-test=surface-next-free]')
  const before = await page.evaluate(() => {
    const c = window.surfaceHistoryQa.useWorkspaceEditor.getState().controller, p = c.getPanelState()
    return { poles: c.getViewState().net.poles, selected: p.selected, revision: c.getSnapshot().current.draftEpoch }
  })
  assert.equal(before.selected.length, 1, 'The simple edit selects exactly one free pole')
  await page.click('[data-test=surface-distance]')
  await page.keyboard.down(MOD); await page.keyboard.press('a'); await page.keyboard.up(MOD)
  await page.type('[data-test=surface-distance]', String(distance))
  await page.keyboard.press('Tab')
  await page.waitForSelector('[data-test=surface-move]:enabled')
  await page.click('[data-test=surface-move]')
  await page.waitForFunction(revision => {
    const s = window.surfaceHistoryQa.useWorkspaceEditor.getState()
    if (s.error) throw Error(s.error)
    return s.snapshot.current.draftEpoch > revision
  }, { timeout: 120000 }, before.revision)
  await ready()
  const after = await page.evaluate(() => {
    const s = window.surfaceHistoryQa.useWorkspaceEditor.getState(), c = s.controller
    return { poles: c.getViewState().net.poles, face: c.getPanelState().face, dirty: s.snapshot.dirty,
      canPreserveHistory: s.canPreserveHistory, volume: c.getViewState().preview.volume }
  })
  const selected = before.selected[0]
  check(after.dirty && after.canPreserveHistory && after.poles.length === before.poles.length &&
    after.poles.every((p, i) => p.every((v, axis) => Math.abs(v - before.poles[i][axis] -
      (i === selected && axis === 2 ? distance : 0)) < 1e-10)),
  `UI move of ${distance} mm changes only the chosen pole along world Z and validates the actual draft`)
  return after
}

async function applyWithHistory(label, exerciseToggle = false) {
  await page.waitForSelector('[data-test=workspace-editor-preserve-history]:enabled', { timeout: 120000 })
  const selector = '[data-test=workspace-editor-preserve-history]'
  if (exerciseToggle) {
    if (await page.$eval(selector, e => e.checked)) await page.click(selector)
    check(await page.evaluate(() => !window.surfaceHistoryQa.useWorkspaceEditor.getState().preserveHistory), 'The history checkbox can explicitly disable the opt-in')
  }
  if (!(await page.$eval(selector, e => e.checked))) await page.click(selector)
  check(await page.evaluate(() => window.surfaceHistoryQa.useWorkspaceEditor.getState().preserveHistory), `${label}: history preservation is explicitly selected in the UI`)
  const before = await documentState()
  await page.waitForSelector('[data-test=workspace-editor-apply]:enabled', { timeout: 180000 })
  await page.click('[data-test=workspace-editor-apply]')
  await page.waitForFunction(() => {
    const s = window.surfaceHistoryQa.useWorkspaceEditor.getState()
    return s.phase === 'closed' || !!s.error
  }, { timeout: 240000 })
  const state = await page.evaluate(() => {
    const s = window.surfaceHistoryQa.useWorkspaceEditor.getState()
    return { phase: s.phase, error: s.error, receipt: s.receipt }
  })
  if (state.error) throw Error(`${label}: ${state.error}`)
  const after = await documentState(), receipt = state.receipt
  check(state.phase === 'closed' && receipt?.mode === 'cad-copy' && receipt.createdBodyIds.length === 1 &&
    after.bodies.length === before.bodies.length + 1 && after.past === before.past + 1,
  `${label}: one validated CAD copy is published in one global history action`)
  return { before, after, receipt, bodyId: receipt.createdBodyIds[0] }
}

try {
  kernel = await OcctKernel.init()
  const box = kernel.makeBox(20, 30, 10)
  let input
  try { input = kernel.exportStep(box) } finally { kernel.release(box) }
  report.fixtureSha256 = sha(input)
  writeFileSync(join(out, 'synthetic-source.step'), input)
  const app = await launchApp({ url: url.href, width: 1440, height: 1000, agentDataOk: false,
    userDataDir: join(out, 'owned-browser-profile'), protocolTimeout: 240000 })
  browser = app.browser; page = app.page; report.consoleErrors = app.consoleErrors
  page.on('dialog', dialog => dialog.accept())
  const cdp = await page.createCDPSession()
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true })
  await attach()
  check(await page.evaluate(() => window.surfaceHistoryQa.usePrefs.getState().units === 'mm'), 'Owned test profile starts with the fixture display unit')
  await page.click('[data-test=workspace-reverse]')
  await page.evaluate(async step => {
    const { runCommand } = await import('/src/commands/registry.ts')
    const { sceneOf } = await import('/src/commands/host.ts')
    const q = window.surfaceHistoryQa
    for (let i = 0; !q.reverseSession() && i < 500; i++) await new Promise(resolve => setTimeout(resolve, 20))
    if (!q.reverseSession()) throw Error('CAD session unavailable')
    await q.reverseSession().startKernel(); await q.reverseSession().settled()
    await runCommand('reverse.import.step', { bytes: new TextEncoder().encode(step), name: 'surface-history-box.step' })
    await q.reverseSession().settled()
    sceneOf()?.fitToView()
  }, input)
  const initial = await documentState()
  assert.equal(initial.bodies.length, 1)
  const originalId = initial.bodies[0].id
  report.stage = 'first-editor'
  await page.waitForSelector('[data-test=feature-edit-surface]:enabled', { timeout: 120000 })
  await page.click('[data-test=feature-edit-surface]')
  await page.waitForSelector('[data-test=workspace-surface-parameters]', { timeout: 120000 })
  const face = await page.evaluate(() => {
    const c = window.surfaceHistoryQa.useWorkspaceEditor.getState().controller, meshes = c.getViewState().preview.faceMeshes
    return c.getPanelState().faces.find(f => f.kind === 'plane' && !f.reason && meshes[f.index]?.positions.length &&
      Array.from(meshes[f.index].positions).filter((_, i) => i % 3 === 2).every(z => Math.abs(z - 10) < 1e-5))?.index
  })
  assert(Number.isInteger(face), 'An editable top planar face exists on the synthetic box')
  await page.select('[data-test=surface-face]', String(face))
  const firstDraft = await moveOnePole(.15)
  await page.screenshot({ path: join(out, 'first-history-draft.png') })
  const firstApply = await applyWithHistory('First Apply', true), first = await stored(firstApply.bodyId)
  validStored(first, 'First Apply')
  report.first = { bodyId: firstApply.bodyId, recipeSha256: first.record.recipeSha256,
    sourceSha256: first.record.source.stepSha256, resultSha256: first.record.resultStepSha256,
    archivedSource: inspect(first.sourceStep), archivedResult: inspect(first.resultStep) }
  check(solid(report.first.archivedSource) && Math.abs(report.first.archivedSource.volume - 6000) < 1e-6 &&
    Math.abs(report.first.archivedSource.area - 2200) < 1e-6 &&
    solid(report.first.archivedResult) && report.first.archivedResult.volume > 6000 + 1e-5 &&
    report.first.archivedResult.volume < 6090, 'Native archived readback preserves the original box and confirms the first geometric edit')
  const firstLive = (await liveSteps([originalId, firstApply.bodyId])).map(inspect)
  check(sameShapeMetrics(firstLive[0], report.first.archivedSource) && sameShapeMetrics(firstLive[1], report.first.archivedResult),
    'Native live-document readback agrees with the archived source and first result')
  writeFileSync(join(out, 'archived-upstream.step'), first.sourceStep)
  writeFileSync(join(out, 'first-result.step'), first.resultStep)

  report.stage = 'save-project'
  await page.waitForSelector('[data-test=save-project]:enabled')
  await page.click('[data-test=save-project]')
  let saved
  for (let i = 0; i < 600; i++) {
    const name = readdirSync(downloads).find(name => name.endsWith('.scanruler'))
    if (name) { saved = join(downloads, name); break }
    await pause(100)
  }
  assert(saved, 'Project ZIP download missing')
  const zip = readFileSync(saved), entries = unzipSync(zip)
  report.projectSha256 = sha(zip)
  assert(entries['project.json'], 'Project manifest missing from downloaded ZIP')
  const manifest = JSON.parse(strFromU8(entries['project.json']))
  const part = manifest.reverse, archivedFeature = part?.features.find(f => f.id === first.feature.id)
  assert(part?.stepFiles && entries[part.stepFiles], 'Downloaded project must carry its STEP member')
  const archivedSteps = JSON.parse(strFromU8(entries[part.stepFiles]))
  assert.deepEqual(archivedFeature.surfaceEditHistory, first.record)
  check(archivedSteps[first.record.source.file.key] === first.sourceStep && archivedSteps[first.feature.file.key] === first.resultStep,
    'Downloaded .scanruler contains the complete recipe and exact distinct upstream/result STEP bytes')
  report.archiveMembers = Object.keys(entries)

  // A separate context has no first-page localStorage, IndexedDB, recovery
  // state or in-memory controller. The archive is the only document handoff.
  report.stage = 'fresh-project-import'
  await page.close()
  cleanContext = await browser.createBrowserContext()
  page = await cleanContext.newPage()
  await page.setViewport({ width: 1440, height: 1000 })
  page.on('dialog', dialog => dialog.accept())
  page.on('pageerror', error => report.consoleErrors.push('fresh-context pageerror: ' + error.message))
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push('fresh-context: ' + message.text()) })
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('scanruler.askstlunits', '0')
    localStorage.setItem('scanruler.beta', 'all')
    localStorage.setItem('scanruler.supportask', '0')
  })
  await page.goto(url.href, { waitUntil: 'networkidle0' })
  await page.waitForSelector('[data-test=project-input]')
  await attach()
  check(await page.evaluate(() => {
    const q = window.surfaceHistoryQa, re = q.useReverse.getState()
    return re.features.length === 0 && re.bodies.length === 0 && Object.keys(re.stepFiles).length === 0 &&
      q.useHistory.getState().past.length === 0 && q.useWorkspaceEditor.getState().phase === 'closed'
  }), 'The fresh app has no geometry, history bytes or active editor before project import')
  await (await page.$('[data-test=project-input]')).uploadFile(saved)
  await page.waitForFunction(() => {
    const q = window.surfaceHistoryQa
    return q.useReverse.getState().features.length === 2 && !q.useStore.getState().busy
  }, { timeout: 120000 })
  await page.click('[data-test=workspace-reverse]')
  await page.waitForFunction(() => {
    const q = window.surfaceHistoryQa, re = q.useReverse.getState()
    return re.bodies.length === 2 && !re.building && !!q.reverseSession()?.client()
  }, { timeout: 180000 })
  const imported = await stored(firstApply.bodyId)
  assert.deepEqual(imported.record, first.record)
  check(imported.sourceStep === first.sourceStep && imported.resultStep === first.resultStep,
    'Fresh-page import restores the recipe and both STEP texts without access to the first app')
  const importedLive = (await liveSteps([originalId, firstApply.bodyId])).map(inspect)
  check(sameShapeMetrics(importedLive[0], report.first.archivedSource) && sameShapeMetrics(importedLive[1], report.first.archivedResult),
    'Native readback after clean project import preserves the source and first edited solid')

  report.stage = 'resume-edit'
  await page.waitForSelector('[data-test=surface-history-reopen]:enabled', { timeout: 120000 })
  await page.click('[data-test=surface-history-reopen]')
  await page.waitForSelector('[data-test=workspace-surface-parameters]', { timeout: 180000 })
  await ready()
  const restored = await page.evaluate(() => {
    const c = window.surfaceHistoryQa.useWorkspaceEditor.getState().controller
    return { face: c.getPanelState().face, poles: c.getViewState().net.poles }
  })
  assert.deepEqual(restored.poles, firstDraft.poles)
  check(restored.face === firstDraft.face, 'Riprendi modifica restores the saved face and exact edited pole net in the real controller')
  await moveOnePole(.1)
  await page.screenshot({ path: join(out, 'resumed-history-draft.png') })
  const secondApply = await applyWithHistory('Resumed Apply'), second = await stored(secondApply.bodyId)
  validStored(second, 'Resumed Apply')
  assert.deepEqual(second.record.source, first.record.source)
  check(second.sourceStep === first.sourceStep && second.record.resultStepSha256 !== first.record.resultStepSha256,
    'Resumed Apply retains the authentic original source and publishes a distinct second result')
  report.second = { bodyId: secondApply.bodyId, recipeSha256: second.record.recipeSha256,
    sourceSha256: second.record.source.stepSha256, resultSha256: second.record.resultStepSha256,
    archivedResult: inspect(second.resultStep) }
  check(solid(report.second.archivedResult) && report.second.archivedResult.volume > report.first.archivedResult.volume + 1e-5 &&
    report.second.archivedResult.volume < 6150, 'Native readback confirms the second edit produces a different valid solid')
  writeFileSync(join(out, 'second-result.step'), second.resultStep)

  report.stage = 'global-undo-redo'
  await page.waitForSelector('[data-test=undo]:enabled')
  await page.click('[data-test=undo]')
  await page.waitForFunction(ids => {
    const q = window.surfaceHistoryQa, re = q.useReverse.getState()
    return !re.building && !q.useHistory.getState().restoring && re.bodies.length === 2 &&
      re.bodies.some(body => body.id === ids.first) && !re.bodies.some(body => body.id === ids.second)
  }, { timeout: 120000 }, { first: firstApply.bodyId, second: secondApply.bodyId })
  const undone = await documentState()
  assert.deepEqual(undone.features, secondApply.before.features)
  assert.deepEqual(undone.bodies, secondApply.before.bodies)
  check(undone.past === secondApply.before.past && undone.future === 1,
    'Global Undo restores the preceding features, source/result visibility and project history in one action')
  const undoLive = (await liveSteps([originalId, firstApply.bodyId])).map(inspect)
  check(sameShapeMetrics(undoLive[0], report.first.archivedSource) && sameShapeMetrics(undoLive[1], report.first.archivedResult),
    'Native readback after Undo preserves the original and first modified solid')
  await page.waitForSelector('[data-test=redo]:enabled')
  await page.click('[data-test=redo]')
  await page.waitForFunction(id => {
    const q = window.surfaceHistoryQa, re = q.useReverse.getState()
    return !re.building && !q.useHistory.getState().restoring && re.bodies.length === 3 && re.bodies.some(body => body.id === id)
  }, { timeout: 120000 }, secondApply.bodyId)
  const redone = await documentState(), redoneStored = await stored(secondApply.bodyId)
  assert.deepEqual(redone.features, secondApply.after.features)
  assert.deepEqual(redone.bodies, secondApply.after.bodies)
  assert.deepEqual(redoneStored.record, second.record)
  check(redone.past === secondApply.after.past && redone.future === 0 && redoneStored.resultStep === second.resultStep &&
    redoneStored.sourceStep === first.sourceStep, 'Global Redo restores the same second result, source bytes and editable history envelope')
  const redoLive = (await liveSteps([originalId, firstApply.bodyId, secondApply.bodyId])).map(inspect)
  report.afterRedo = redoLive
  check(sameShapeMetrics(redoLive[0], report.first.archivedSource) && sameShapeMetrics(redoLive[1], report.first.archivedResult) &&
    sameShapeMetrics(redoLive[2], report.second.archivedResult), 'Native readback after Redo confirms all three expected solids')
  check(report.consoleErrors.length === 0, 'No browser application errors')
  await page.screenshot({ path: join(out, 'history-project-after-redo.png') })
  report.stage = 'complete'; report.verdict = 'PASS'
} catch (error) {
  report.verdict = 'FAIL'; report.error = String(error?.stack ?? error); process.exitCode = 1
  if (page) await page.screenshot({ path: join(out, 'failure.png') }).catch(() => {})
  console.error(report.error)
} finally {
  report.cleanupErrors = []
  const cleanup = async (resource, dispose) => {
    try { await dispose() }
    catch (error) {
      const failure = { resource, error: String(error?.stack ?? error) }
      report.cleanupErrors.push(failure)
      console.error('Cleanup failed:', resource, failure.error)
    }
  }
  try {
    if (cleanContext) await cleanup('fresh browser context', () => cleanContext.close())
    if (browser) await cleanup('browser', () => browser.close())
    if (kernel) await cleanup('OCCT kernel', () => kernel[Symbol.dispose]())
  } finally {
    if (report.cleanupErrors.length) {
      report.verdict = 'FAIL'; process.exitCode = 1
      // Keep any earlier application/validation failure as the primary error.
      if (!report.error) report.error = 'Resource cleanup failed; see cleanupErrors.'
    }
    report.finishedAt = new Date().toISOString()
    writeFileSync(join(out, 'result.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ out, verdict: report.verdict, stage: report.stage, checks: report.checks.length,
      error: report.error, cleanupErrors: report.cleanupErrors }))
  }
}
