// SPDX-License-Identifier: AGPL-3.0-only
// Development command-registry integration. Isolated profiles; synthetic CAD only.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { OcctKernel } from 'occt-wasm'
import { launchApp } from '../../../scripts/e2e-lib.mjs'
assert(process.env.APP_URL, 'Supply the isolated development APP_URL')
const out = resolve(process.env.OUT_DIR ?? 'e2e-out/reverse-body-edit-source')
mkdirSync(out, { recursive: true })
const k = await OcctKernel.init(), box = k.makeBox(20, 30, 10), fs = k.getSubShapes(box, 'face')
const top = fs.find(f => { const b = k.getBoundingBox(f); return Math.abs(b.zmin - 10) < 1e-6 && Math.abs(b.zmax - 10) < 1e-6 })
assert(top)
const sheet = k.exportStep(top)
fs.forEach(f => k.release(f)); k.release(box)
const { browser, page, consoleErrors } = await launchApp({ url: process.env.APP_URL, agentDataOk: false, userDataDir: mkdtempSync(join(out, 'owned-profile-')) })
const checks = [], ok = (condition, label) => { assert(condition, label); checks.push(label); console.log('PASS: ' + label) }
try {
  await page.click('[data-test=workspace-reverse]')
  await page.waitForSelector('[data-test=edit-surface-entry] button')
  const result = await page.evaluate(async step => {
    const { runCommand } = await import('/src/commands/registry.ts')
    const { useReverse } = await import('/plugins/reverse/state/reStore.ts')
    const { useNotes } = await import('/plugins/reverse/state/noteStore.ts')
    const { useHistory } = await import('/src/state/historyStore.ts')
    await runCommand('reverse.import.step', { bytes: new TextEncoder().encode(step), name: 'QA sheet.step' })
    const body = useReverse.getState().bodies[0].id
    useReverse.getState().setBodiesVisible([body], false)
    useNotes.getState().load([{ id: 1, text: 'Existing QA note', at: [10, 15, 10], on: [{ kind: 'scan' }] }])
    const before = useReverse.getState(), notes = useNotes.getState().notes, history = useHistory.getState()
    const denied = async (name, input) => { try { await runCommand(name, input); return null } catch (e) { return { code: e.code, message: e.message } } }
    const generalBefore = await denied('reverse.export.step', { bodies: [body] })
    const first = await runCommand('reverse.body.edit_source', { body })
    const after = useReverse.getState()
    const noMutation = before.features === after.features && before.stepFiles === after.stepFiles && before.buildVersion === after.buildVersion && notes === useNotes.getState().notes && history.past === useHistory.getState().past && history.future === useHistory.getState().future
    await runCommand('reverse.feature.add', { feature: { kind: 'moveBody', bodies: [body], translate: [40, 0, 0] } })
    const moved = await runCommand('reverse.body.edit_source', { body })
    const oldKey = await denied('reverse.body.edit_source', { body, expectedKey: first.source.bodyKey })
    const oldVersion = await denied('reverse.body.edit_source', { body, expectedBuildVersion: first.source.buildVersion })
    const generalAfter = await denied('reverse.export.step', { bodies: [body] })
    const missing = await denied('reverse.body.edit_source', { body: 999999 })
    return { body, noMutation, generalBefore, generalAfter, oldKey, oldVersion, missing,
      first: { source: first.source, text: new TextDecoder().decode(first.file.bytes) },
      moved: { source: moved.source, text: new TextDecoder().decode(moved.file.bytes) } }
  }, sheet)
  ok(result.noMutation, 'Editor read preserves feature/resource references, notes and host history')
  ok(/no body to write/.test(result.generalBefore?.message) && /no body to write/.test(result.generalAfter?.message), 'General STEP export retains its ordinary-sheet refusal')
  ok(result.first.source.kind === 'surface' && result.first.source.faces === 1 && !result.first.source.closed, 'Current ordinary sheet is returned explicitly')
  ok(result.oldKey?.code === 'invalid_state' && result.oldVersion?.code === 'invalid_state', 'Obsolete key and build version are refused')
  ok(result.missing?.code === 'not_found', 'Missing current body is refused')
  const measures = []
  for (const [name, data] of [['first', result.first], ['moved', result.moved]]) {
    writeFileSync(join(out, name + '.step'), data.text)
    const shape = k.importStep(data.text), faces = k.getSubShapes(shape, 'face'), solids = k.getSubShapes(shape, 'solid')
    try {
      ok(k.isValid(shape) && faces.length === 1 && solids.length === 0, name + ' editor source reimports as a valid one-face sheet')
      const area = k.getSurfaceArea(shape), bounds = k.getBoundingBox(shape)
      ok(Math.abs(area - 600) < 1e-7, name + ' sheet area stays 600 mm2')
      measures.push({ name, area, bounds })
    } finally { [...faces, ...solids, shape].forEach(h => k.release(h)) }
  }
  ok(Math.abs(measures[1].bounds.xmin - 40) < 1e-6 && Math.abs(measures[1].bounds.xmax - 60) < 1e-6, 'Read follows current Move body geometry, not original STEP bytes')
  await page.click('[data-test=edit-surface-entry] button')
  await (await page.$('[data-test=surface-step-file]')).uploadFile(join(out, 'moved.step'))
  await page.waitForFunction(() => document.querySelectorAll('[data-test=surface-face] option').length === 2)
  await page.select('[data-test=surface-face]', '0')
  await page.waitForSelector('[data-test=strip-open]:enabled')
  ok(true, 'The new source opens in the real editor as an editable sheet')
  await page.screenshot({ path: join(out, 'current-sheet-editor.png') })
  ok(consoleErrors.length === 0, 'No captured application errors')
  const { first, moved, ...data } = result
  writeFileSync(join(out, 'result.json'), JSON.stringify({ pass: true, scope: 'development registry + current worker + independent STEP reader; Load body button not rewired', checks, ...data, first: first.source, moved: moved.source, measures, consoleErrors }, null, 2))
} catch (e) {
  writeFileSync(join(out, 'failure.json'), JSON.stringify({ error: String(e), stack: e.stack, checks, consoleErrors }, null, 2))
  await page.screenshot({ path: join(out, 'failure.png') }); throw e
} finally { await browser.close(); k[Symbol.dispose]() }
