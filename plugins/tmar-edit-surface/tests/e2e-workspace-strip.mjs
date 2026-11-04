// SPDX-License-Identifier: AGPL-3.0-only
// Isolated main-view QA for a one-face open STEP sheet. Requires an isolated
// ScanRuler host with the workspace strip APIs enabled; never uses user data.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

if (process.env.SCANRULER_ISOLATED !== '1') throw Error('Set SCANRULER_ISOLATED=1 for an isolated test app.')
const url = new URL(process.env.APP_URL ?? '')
if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.port ||
    url.username || url.password || url.pathname !== '/' || url.search || url.hash)
  throw Error('APP_URL must be an isolated local HTTP origin with an explicit port.')
const outputRoot = process.env.EDIT_SURFACE_QA_OUT
if (!outputRoot || !isAbsolute(outputRoot)) throw Error('EDIT_SURFACE_QA_OUT must be an absolute folder outside the app checkout.')
const relativeOutput = relative(resolve(process.cwd()), resolve(outputRoot))
if (!relativeOutput || (!relativeOutput.startsWith('..' + sep) && relativeOutput !== '..' && !isAbsolute(relativeOutput)))
  throw Error('EDIT_SURFACE_QA_OUT must be outside the app checkout.')

const { OcctKernel } = await import('occt-wasm')
const root = resolve(outputRoot)
mkdirSync(root, { recursive: true })
const out = mkdtempSync(join(root, 'run-'))
process.env.SHOT_DIR = out
const { launchApp } = await import('../../../scripts/e2e-lib.mjs')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const kernel = await OcctKernel.init()
let browser, page, sourceBytes, sourceHash
const report = { scope: 'isolated real host, shared-view open-sheet strip workflow', fixture: 'synthetic planar STEP face',
  checks: [], consoleErrors: [], verdict: 'INCOMPLETE' }
const check = (ok, name) => { assert(ok, name); report.checks.push(name); console.log('PASS', name) }
const measureGeometry = shape => {
  const owned = []
  const collect = type => { const values = kernel.getSubShapes(shape, type); owned.push(...values); return values }
  try {
    const faces = collect('face'), edges = collect('edge'), vertices = collect('vertex')
    const wires = collect('wire'), shells = collect('shell'), solids = collect('solid')
    const bbox = kernel.getBoundingBox(shape, { useTriangulation: false })
    const faceData = faces.map(face => ({ type:kernel.surfaceType(face), area:kernel.getSurfaceArea(face),
      bbox:kernel.getBoundingBox(face, { useTriangulation:false }) }))
      .sort((a,b) => a.type.localeCompare(b.type) || a.area-b.area)
    const edgeData = edges.map(edge => ({ type:kernel.curveType(edge), length:kernel.getLength(edge) }))
      .sort((a,b) => a.type.localeCompare(b.type) || a.length-b.length)
    const vertexData = vertices.map(vertex => {
      const b = kernel.getBoundingBox(vertex, { useTriangulation:false })
      return [b.xmin,b.ymin,b.zmin]
    }).sort((a,b) => a[0]-b[0] || a[1]-b[1] || a[2]-b[2])
    return { valid:kernel.isValid(shape), shapeType:kernel.getShapeType(shape),
      topology:{ faces:faces.length, wires:wires.length, edges:edges.length, vertices:vertices.length,
        shells:shells.length, solids:solids.length }, bbox, faceData, edgeData, vertexData }
  } finally { owned.forEach(item => kernel.release(item)) }
}
const near = (a,b,tolerance=1e-5) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b) <= tolerance
const sameGeometry = (a,b) => {
  if (!a || !b || a.shapeType !== b.shapeType || JSON.stringify(a.topology) !== JSON.stringify(b.topology) ||
      a.faceData.length !== b.faceData.length || a.edgeData.length !== b.edgeData.length || a.vertexData.length !== b.vertexData.length)
    return false
  const bboxKeys = ['xmin','ymin','zmin','xmax','ymax','zmax']
  if (!bboxKeys.every(key => near(a.bbox[key],b.bbox[key]))) return false
  if (!a.faceData.every((item,i) => item.type === b.faceData[i].type && near(item.area,b.faceData[i].area) &&
      bboxKeys.every(key => near(item.bbox[key],b.faceData[i].bbox[key])))) return false
  if (!a.edgeData.every((item,i) => item.type === b.edgeData[i].type && near(item.length,b.edgeData[i].length))) return false
  return a.vertexData.every((point,i) => point.every((value,axis) => near(value,b.vertexData[i][axis])))
}

try {
  // Export a single planar face from a synthetic box: a 20 x 30 mm open sheet.
  const box = kernel.makeBox(20, 30, 10)
  const boxFaces = kernel.getSubShapes(box, 'face')
  try {
    const candidates = boxFaces.map((face, index) => ({ index, area: kernel.getSurfaceArea(face) }))
    const planarFace = candidates.find(item => Math.abs(item.area - 600) < 1e-7)
    assert(planarFace, 'Synthetic box has no 20 x 30 mm face')
    sourceBytes = Buffer.from(kernel.exportStep(boxFaces[planarFace.index]))
    report.inputAreaMm2 = planarFace.area
  } finally {
    boxFaces.forEach(face => kernel.release(face))
    kernel.release(box)
  }
  sourceHash = sha(sourceBytes)
  report.inputSha256 = sourceHash
  const fixtureShape = kernel.importStep(sourceBytes.toString('utf8'))
  try { report.fixtureGeometry = measureGeometry(fixtureShape) } finally { kernel.release(fixtureShape) }

  const launched = await launchApp({ url: url.href, width: 1440, height: 1000, agentDataOk: false,
    userDataDir: join(out, 'owned-browser-profile'), protocolTimeout: 120000 })
  browser = launched.browser; page = launched.page; report.consoleErrors = launched.consoleErrors
  page.on('dialog', dialog => dialog.accept())

  // Import only the synthetic sheet in the isolated app's fresh profile.
  await page.evaluate(async step => {
    const { runCommand } = await import('/src/commands/registry.ts')
    const { useShell } = await import('/src/state/shellStore.ts')
    const { useReverse } = await import('/plugins/reverse/state/reStore.ts')
    const { reverseSession } = await import('/plugins/reverse/app/reSession.ts')
    const { sceneOf } = await import('/src/commands/host.ts')
    const { reSceneOf } = await import('/plugins/reverse/viewer/reScene.ts')
    const { useWorkspaceEditor } = await import('/src/plugins/workspaceEditors.ts')
    const history = await import('/src/state/historyStore.ts')
    useShell.getState().setWorkspace('reverse')
    for (let i = 0; !reverseSession() && i < 500; i++) await new Promise(resolve => setTimeout(resolve, 20))
    if (!reverseSession()) throw Error('CAD session unavailable')
    await reverseSession().startKernel(); await reverseSession().settled()
    await runCommand('reverse.import.step', { bytes: new TextEncoder().encode(step), name: 'synthetic-open-sheet.step' })
    await reverseSession().settled()
    const scene = sceneOf(), id = useReverse.getState().bodies[0]?.id
    if (!scene || !id || useReverse.getState().bodies.length !== 1) throw Error('Synthetic sheet import failed')
    const source = await runCommand('reverse.body.edit_source', { body: id })
    scene.fitToView()
    window.surfaceStripQa = { runCommand, useReverse, reverseSession, scene, reScene: reSceneOf(scene), useWorkspaceEditor,
      history, beforeHistory: history.useHistory.getState().past.length, sourceText: new TextDecoder().decode(source.file.bytes), id }
  }, sourceBytes.toString('utf8'))

  await page.waitForSelector('[data-test=feature-edit-surface]:enabled', { timeout: 60000 })
  await page.click('[data-test=feature-edit-surface]')
  await page.waitForSelector('[data-test=workspace-surface-parameters]', { timeout: 120000 })
  await page.waitForFunction(() => window.surfaceStripQa.useReverse.getState().bodies[0]?.surface === true,
    { timeout: 60000 })
  await page.waitForFunction(() => document.querySelectorAll('[data-test=surface-face] option').length === 2,
    { timeout: 60000 })
  await page.select('[data-test=surface-face]', '0')
  await page.waitForFunction(() => {
    const s = window.surfaceStripQa.useWorkspaceEditor.getState(), p = s.controller?.getPanelState()
    return p?.canBeginStrip && s.snapshot?.validation?.kind === 'valid' && !p.calculating
  }, { timeout: 120000 })
  check(true, 'the imported single-face STEP sheet is accepted as a valid strip source')

  await page.click('[data-test=surface-strip-begin]')
  await page.waitForFunction(() => {
    const strip = window.surfaceStripQa.useWorkspaceEditor.getState().controller?.getPanelState().strip
    return strip && !strip.pending && strip.paths.length === 4
  }, { timeout: 120000 })
  await page.select('[data-test=surface-strip-edge]', '0')
  await page.select('[data-test=surface-strip-axis]', '2')
  await page.$eval('[data-test=surface-strip-distance]', input => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '2')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  const initial = await page.evaluate(() => {
    const q = window.surfaceStripQa, state = q.useWorkspaceEditor.getState()
    return { area: state.controller.getPanelState().strip.totalArea,
      history: q.history.useHistory.getState().past.length, sourceId: q.id,
      sourceBodyCount: q.useReverse.getState().bodies.length }
  })
  check(initial.sourceBodyCount === 1, 'fixture remains a single source body before Apply')

  await page.click('[data-test=surface-strip-extend]')
  await page.waitForFunction(() => {
    const s = window.surfaceStripQa.useWorkspaceEditor.getState(), strip = s.controller?.getPanelState().strip
    return strip?.hasResult && !strip.pending && s.snapshot?.validation?.kind === 'valid'
  }, { timeout: 120000 })
  const extended = await page.evaluate(() => {
    const s = window.surfaceStripQa.useWorkspaceEditor.getState(), strip = s.controller.getPanelState().strip
    return { addedArea: strip.addedArea, totalArea: strip.totalArea, canUndo: strip.canUndo,
      canRedo: strip.canRedo, previewFaces: s.controller.getViewState().preview.faceMeshes.length }
  })
  check(extended.canUndo && !extended.canRedo && extended.previewFaces === 2 && extended.addedArea > 0,
    'numeric edge extension creates one validated strip face and an undo frame')

  await page.click('[data-test=surface-strip-undo]')
  await page.waitForFunction(() => {
    const strip = window.surfaceStripQa.useWorkspaceEditor.getState().controller?.getPanelState().strip
    return strip && !strip.hasResult && !strip.canUndo && strip.canRedo
  }, { timeout: 30000 })
  check(true, 'Undo returns to the original open sheet and preserves the redo frame')
  await page.click('[data-test=surface-strip-redo]')
  await page.waitForFunction(() => {
    const s = window.surfaceStripQa.useWorkspaceEditor.getState(), strip = s.controller?.getPanelState().strip
    return strip?.hasResult && strip.canUndo && !strip.canRedo && s.snapshot?.validation?.kind === 'valid'
  }, { timeout: 120000 })
  check(true, 'Redo restores the same validated strip result')

  await page.waitForSelector('[data-test=workspace-editor-apply]:enabled', { timeout: 120000 })
  await page.evaluate(() => {
    const q = window.surfaceStripQa, controller = q.useWorkspaceEditor.getState().controller
    const cleanSource = source => source ? Object.fromEntries(['documentEpoch','sourceEpoch','bodyId','bodyKey','buildVersion',
      'kernelGeneration','frameRevision','stepSha256','units','coordinateFrame'].map(key => [key, source[key]])) : null
    const cleanStamp = stamp => stamp ? Object.fromEntries(['sessionId','sourceEpoch','selectionEpoch','draftEpoch','requestId']
      .map(key => [key, stamp[key]])) : null
    const cleanTicket = ticket => ticket ? { operationId:ticket.operationId, mode:ticket.mode,
      source:cleanSource(ticket.source), stamp:cleanStamp(ticket.stamp) } : null
    q.applyDiagnostics = [{ event:'before-click', hostStateKeys:Object.keys(q.useWorkspaceEditor.getState()),
      controllerKeys:Object.keys(controller), phase:q.useWorkspaceEditor.getState().phase,
      snapshot:controller.getSnapshot(), panel:{face:controller.getPanelState().face, strip:controller.getPanelState().strip},
      source:cleanSource(controller.source ?? controller.context?.source),
      contextSource:cleanSource(controller.context?.source), reverseStateKeys:Object.keys(q.useReverse.getState()),
      bodyIds:q.useReverse.getState().bodies.map(body => ({ id:body.id, key:body.key, surface:body.surface })) }]
    const logMethod = (name, summarize, wrapResult = value => value) => {
      const original = controller[name]
      if (typeof original !== 'function') { q.applyDiagnostics.push({ event:'not-instrumented', method:name }); return }
      const wrapped = function (...args) {
        q.applyDiagnostics.push({ event:`${name}:call`, args:summarize(...args) })
        try {
          const value = original.apply(this, args)
          q.applyDiagnostics.push({ event:`${name}:return` })
          return wrapResult(value, q.applyDiagnostics)
        } catch (error) {
          q.applyDiagnostics.push({ event:`${name}:throw`, error:String(error?.stack ?? error) })
          throw error
        }
      }
      try {
        controller[name] = wrapped
        if (controller[name] !== wrapped) q.applyDiagnostics.push({ event:'method-not-wrapped', method:name })
      } catch (error) { q.applyDiagnostics.push({ event:'method-not-wrapped', method:name, error:String(error) }) }
    }
    logMethod('freeze', ticket => ({ ticket:cleanTicket(ticket), snapshot:controller.getSnapshot() }), (release, log) => {
      if (typeof release !== 'function') return release
      return (...args) => { log.push({ event:'unfreeze:call' }); return release(...args) }
    })
    logMethod('prepareApply', (ticket, signal) => ({ ticket:cleanTicket(ticket), aborted:signal?.aborted,
      snapshot:controller.getSnapshot(), source:cleanSource(controller.context?.source) }), (promise, log) => {
      if (!promise || typeof promise.then !== 'function') return promise
      return promise.then(value => {
        log.push({ event:'prepareApply:resolved', result:{ kind:value?.kind, operationId:value?.operationId,
          source:cleanSource(value?.source), stamp:cleanStamp(value?.stamp), stepBytes:value?.step?.byteLength } })
        return value
      }, error => {
        log.push({ event:'prepareApply:rejected', error:String(error?.stack ?? error) })
        throw error
      })
    })
    const context = controller.context
    const originalAssert = context?.assertSourceCurrent
    if (typeof originalAssert === 'function') {
      try {
        context.assertSourceCurrent = function (...args) {
          try {
            const result = originalAssert.apply(this, args)
            q.applyDiagnostics.push({ event:'assertSourceCurrent:pass', source:cleanSource(context.source) })
            return result
          } catch (error) {
            q.applyDiagnostics.push({ event:'assertSourceCurrent:throw', source:cleanSource(context.source),
              error:String(error?.stack ?? error) })
            throw error
          }
        }
        q.applyDiagnostics.push({ event:context.assertSourceCurrent !== originalAssert ? 'source-assert-instrumented' : 'source-assert-not-instrumented' })
      } catch (error) { q.applyDiagnostics.push({ event:'source-assert-not-instrumented', error:String(error) }) }
    }
  })
  await page.click('[data-test=workspace-editor-apply]')
  await page.waitForFunction(() => {
    const state = window.surfaceStripQa.useWorkspaceEditor.getState()
    const text = document.body.innerText
    return state.phase === 'closed' || text.includes('La sorgente CAD o il documento è cambiato') ||
      String(state.error ?? state.message ?? '').includes('sorgente CAD o il documento')
  }, { timeout: 120000 })
  const applyOutcome = await page.evaluate(() => {
    const q = window.surfaceStripQa, state = q.useWorkspaceEditor.getState()
    return { phase:state.phase, stateKeys:Object.keys(state), error:state.error ?? state.message ?? null,
      snapshot:state.controller?.getSnapshot?.(), diagnostics:q.applyDiagnostics,
      visibleText:document.body.innerText.split('\n').filter(line => /sorgente CAD|documento è cambiato|riapri la modifica/i.test(line)) }
  })
  report.applyOutcome = applyOutcome
  if (applyOutcome.phase !== 'closed') throw Error(`Apply rifiutato prima della chiusura: ${JSON.stringify(applyOutcome)}`)

  const result = await page.evaluate(async () => {
    const q = window.surfaceStripQa, state = q.useReverse.getState(), receipt = q.useWorkspaceEditor.getState().receipt
    const sources = []
    for (const body of state.bodies) {
      const answer = await q.runCommand('reverse.body.edit_source', { body: body.id })
      sources.push({ id: body.id, text: new TextDecoder().decode(answer.file.bytes) })
    }
    return { sources, sourceText: q.sourceText, receipt, historyDelta: q.history.useHistory.getState().past.length - q.beforeHistory,
      originalId: q.id, originalVisible: q.reScene.bodyMeshes.get(q.id)?.material.visible,
      bodyCount: state.bodies.length, overlayPresent: !!document.querySelector('[data-slot="workspace.editor.overlay"]') }
  })
  check(result.bodyCount === 2 && result.receipt?.createdBodyIds?.length === 1 && result.historyDelta === 1,
    'Apply publishes exactly one CAD copy and one project history entry')
  check(result.originalVisible && !result.overlayPresent, 'Apply restores the source mask and removes the editor layer')
  const original = kernel.importStep(result.sources.find(item => item.id === result.originalId).text)
  const copyId = result.receipt.createdBodyIds[0]
  const copy = kernel.importStep(result.sources.find(item => item.id === copyId).text)
  try {
    report.original = measureGeometry(original); report.copy = measureGeometry(copy)
    const originalTextAfter = result.sources.find(item => item.id === result.originalId).text
    report.originalSerializationHashes = { before:sha(Buffer.from(result.sourceText)), after:sha(Buffer.from(originalTextAfter)),
      equal:sha(Buffer.from(result.sourceText)) === sha(Buffer.from(originalTextAfter)) }
    check(report.original.valid && report.original.topology.faces === 1 && report.original.topology.solids === 0 &&
      report.original.faceData.length === 1 && report.original.faceData[0].type === 'plane' &&
      near(report.original.faceData[0].area, report.inputAreaMm2) && sameGeometry(report.fixtureGeometry, report.original),
      'original remains a valid one-face plane with unchanged area, bounds, vertices, edges, and topology')
    const copyFaces = kernel.getSubShapes(copy, 'face')
    let sharedEdges = 0
    try {
      const edgeSets = copyFaces.map(face => kernel.getSubShapes(face, 'edge'))
      try { sharedEdges = edgeSets[0].filter(edge => edgeSets[1].some(other => kernel.isSame(edge, other))).length }
      finally { edgeSets.flat().forEach(edge => kernel.release(edge)) }
    } finally { copyFaces.forEach(face => kernel.release(face)) }
    const originalArea = report.original.faceData.reduce((sum,face) => sum+face.area,0)
    const copyArea = report.copy.faceData.reduce((sum,face) => sum+face.area,0)
    check(report.copy.valid && report.copy.topology.faces === 2 && report.copy.topology.solids === 0 &&
      near(copyArea, extended.totalArea, 1e-4) && near(copyArea-originalArea, extended.addedArea, 1e-4) && sharedEdges === 1,
      'applied STEP reimports as a valid two-face open sheet with one shared edge and the measured added area')
    check(report.consoleErrors.length === 0, 'no browser application errors')
    report.receipt = result.receipt; report.verdict = 'PASS'
  } finally { kernel.release(original); kernel.release(copy) }
} catch (error) {
  report.error = String(error?.stack ?? error)
  if (page) try { await page.screenshot({ path: join(out, 'failure.png') }) } catch { /* Keep the primary failure. */ }
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  kernel[Symbol.dispose]()
  report.inputSha256After = sourceBytes ? sha(sourceBytes) : null
  report.fixtureUnchanged = report.inputSha256After === report.inputSha256
  if (!report.fixtureUnchanged) { report.verdict = 'FAIL_FIXTURE_CHANGED'; process.exitCode = 1 }
  writeFileSync(join(out, 'result.json'), JSON.stringify({ out, ...report }, null, 2))
  console.log(JSON.stringify({ out, ...report }))
}
