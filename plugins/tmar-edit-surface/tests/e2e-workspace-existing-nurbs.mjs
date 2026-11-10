// SPDX-License-Identifier: AGPL-3.0-only
// Existing synthetic NURBS STEP, actual isolated workspace, no user session.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

assert.equal(process.env.SCANRULER_ISOLATED, '1', 'Explicit isolated-host guard required')
const url = new URL(process.env.APP_URL ?? '')
assert.equal(url.href, 'http://127.0.0.1:17527/', 'Only the designated local QA host is permitted')
const inputPath = process.env.EDIT_SURFACE_QA_STEP, outputRoot = process.env.EDIT_SURFACE_QA_OUT
assert(inputPath && isAbsolute(inputPath), 'An absolute source STEP path is required')
assert(outputRoot && isAbsolute(outputRoot), 'An absolute evidence folder is required')
const rel = relative(resolve(process.cwd()), resolve(outputRoot))
assert(rel && (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)), 'Evidence must be outside the checkout')
mkdirSync(outputRoot, { recursive: true })
const out = mkdtempSync(join(outputRoot, 'existing-nurbs-'))
process.env.SHOT_DIR = out
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const source = readFileSync(inputPath), inputHash = hash(source)
const report = { scope: 'isolated actual workspace; one pre-existing synthetic STEP B-spline',
  inputHash, checks: [], notTested: ['user CAD sessions', 'all other NURBS topologies'], verdict: 'INCOMPLETE' }
const persist = () => writeFileSync(join(out, 'result.json'), JSON.stringify(report, null, 2))
const check = (value, message) => { assert(value, message); report.checks.push(message); persist(); console.log('PASS', message) }
persist()
let kernel, browser, page
try {
  const { OcctKernel } = await import('occt-wasm')
  const { launchApp } = await import('../../../scripts/e2e-lib.mjs')
  kernel = await OcctKernel.init()
  const base = kernel.importStep(source.toString('utf8'))
  const faces = kernel.getSubShapes(base, 'face'), solids = kernel.getSubShapes(base, 'solid')
  try {
    report.originalGeometry = { valid: kernel.isValid(base), solids: solids.length, faces: faces.length,
      types: faces.map((face, index) => ({ index, type: kernel.surfaceType(face) })), volume: kernel.getVolume(base) }
    check(report.originalGeometry.valid && solids.length === 1 && report.originalGeometry.types.some(item => item.type === 'bspline'),
      'Original STEP reimports as one valid solid with a pre-existing B-spline face')
  } finally { faces.forEach(face => kernel.release(face)); solids.forEach(solid => kernel.release(solid)); kernel.release(base) }

  const app = await launchApp({ url: url.href, width: 1440, height: 1000, agentDataOk: false,
    userDataDir: join(out, 'owned-browser-profile'), protocolTimeout: 120000 })
  browser = app.browser; page = app.page; report.consoleErrors = app.consoleErrors
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
    for (let i=0; !reverseSession() && i<500; i++) await new Promise(resolve => setTimeout(resolve,20))
    if (!reverseSession()) throw Error('CAD session unavailable')
    await reverseSession().startKernel(); await reverseSession().settled()
    await runCommand('reverse.import.step', { bytes: new TextEncoder().encode(step), name: 'existing-nurbs-synthetic.step' })
    await reverseSession().settled()
    const scene = sceneOf(), id = useReverse.getState().bodies[0]?.id
    if (!scene || !id || useReverse.getState().bodies.length !== 1) throw Error('Synthetic STEP import failed')
    const original = await runCommand('reverse.body.edit_source', { body:id })
    scene.fitToView()
    window.nurbsQa = { runCommand, useReverse, scene, reScene:reSceneOf(scene), useWorkspaceEditor, history, id,
      historyBefore:history.useHistory.getState().past.length, sourceBefore:new TextDecoder().decode(original.file.bytes) }
  }, source.toString('utf8'))
  await page.waitForFunction(() => window.nurbsQa.reScene.bodyMeshes.has(window.nurbsQa.id), {timeout:60000})
  await page.waitForSelector('[data-test=feature-edit-surface]:enabled', {timeout:60000})
  await page.click('[data-test=feature-edit-surface]')
  await page.waitForSelector('[data-test=workspace-surface-parameters]', {timeout:120000})
  const face = await page.evaluate(() => {
    const infos=window.nurbsQa.useWorkspaceEditor.getState().controller.getPanelState().faces
    return infos.find(item=>item.kind==='bspline'&&!item.converted&&!item.reason) ?? null
  })
  report.face = face
  if (!face) { report.blocker = 'Nessuna faccia B-spline originaria è selezionabile dal kernel editor.'; throw Error(report.blocker) }
  await page.select('[data-test=surface-face]',String(face.index))
  await page.waitForFunction(() => {
    const s=window.nurbsQa.useWorkspaceEditor.getState(),p=s.controller?.getPanelState()
    return s.snapshot?.validation?.kind==='valid'&&!p?.calculating&&!!p?.net
  }, {timeout:120000})
  const before = await page.evaluate(() => {
    const c=window.nurbsQa.useWorkspaceEditor.getState().controller,p=c.getPanelState(),v=c.getViewState()
    return {poles:p.net.poles.map(pole=>[...pole]), locked:[...v.locked], hidden:[...v.hiddenPoles],
      continuity:p.continuity, volume:v.preview.volume, nu:p.net.nu, nv:p.net.nv}
  })
  report.initialNet = {nu:before.nu,nv:before.nv,poleCount:before.poles.length,locked:before.locked,
    hidden:before.hidden,continuity:before.continuity,volume:before.volume}
  if (!before.poles.some((_,i)=>!before.locked.includes(i)&&!before.hidden.includes(i))) {
    report.blocker='La faccia B-spline non ha poli liberi nelle condizioni di protezione correnti.'
    throw Error(report.blocker)
  }
  check(!face.converted && face.kind === 'bspline', 'Editor selects the existing B-spline directly, without converting a plane')
  await page.select('[data-test=surface-selection-mode]', 'points')
  await page.select('[data-test=surface-drag-mode]', 'local')
  await page.click('[data-test=surface-axis-2]')
  const target = await page.evaluate(() => {
    const q=window.nurbsQa,c=q.useWorkspaceEditor.getState().controller,s=c.getViewState()
    const canvas=q.scene.layerHost().canvas,rect=canvas.getBoundingClientRect(),camera=q.scene.layerHost().camera()
    const group=q.scene.layerHost().partGroup;group.updateWorldMatrix(true,true);camera.updateMatrixWorld(true)
    const pixels=s.net.poles.map((pole,id)=>{
      const p=group.position.clone().set(...pole).applyMatrix4(group.matrixWorld).project(camera)
      return {id,x:rect.left+(p.x+1)*rect.width/2,y:rect.top+(1-p.y)*rect.height/2,z:p.z}
    })
    const candidates=pixels.filter(p=>!s.locked.includes(p.id)&&!s.hiddenPoles.includes(p.id)&&p.z>=-1&&p.z<=1&&
      p.x>rect.left+12&&p.x<rect.right-12&&p.y>rect.top+12&&p.y<rect.bottom-12&&document.elementFromPoint(p.x,p.y)===canvas)
    candidates.forEach(p=>{p.separation=Math.min(...pixels.filter(other=>other.id!==p.id).map(other=>Math.hypot(p.x-other.x,p.y-other.y)))})
    candidates.sort((a,b)=>b.separation-a.separation)
    return candidates[0]??null
  })
  if (!target || target.separation <= 8) { report.blocker='Nessun polo libero è selezionabile separatamente dalla vista attuale.'; throw Error(report.blocker) }
  report.target=target
  await page.mouse.click(target.x,target.y)
  await page.waitForFunction(id=>window.nurbsQa.useWorkspaceEditor.getState().controller.getPanelState().selected.includes(id),
    {timeout:10000},target.id)
  await page.screenshot({path:join(out,'before-move.png')})
  await page.$eval('[data-test=surface-distance]',element=>{
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,'0.05')
    element.dispatchEvent(new Event('input',{bubbles:true}))
  })
  await page.waitForSelector('[data-test=surface-move]:enabled',{timeout:10000})
  await page.click('[data-test=surface-move]')
  await page.waitForFunction(({previous,id})=>{
    const s=window.nurbsQa.useWorkspaceEditor.getState(),p=s.controller?.getPanelState(),pole=p?.net?.poles[id]
    return s.snapshot?.validation?.kind==='valid'&&!p?.calculating&&pole?.some((v,i)=>Math.abs(v-previous[i])>1e-8)
  },{timeout:120000},{previous:before.poles[target.id],id:target.id})
  const changed=await page.evaluate(id=>{
    const s=window.nurbsQa.useWorkspaceEditor.getState(),p=s.controller.getPanelState()
    return {pole:[...p.net.poles[id]],volume:s.controller.getViewState().preview.volume,validation:s.snapshot.validation.kind}
  },target.id)
  report.movedPole={id:target.id,before:before.poles[target.id],after:changed.pole,volume:changed.volume}
  check(Math.hypot(...changed.pole.map((v,i)=>v-before.poles[target.id][i]))>1e-8 && changed.validation==='valid',
    'A free pole of the pre-existing B-spline moves and the CAD preview validates')
  await page.screenshot({path:join(out,'after-move.png')})
  await page.waitForSelector('[data-test=workspace-editor-apply]:enabled',{timeout:120000})
  await page.click('[data-test=workspace-editor-apply]')
  await page.waitForFunction(()=>{
    const s=window.nurbsQa.useWorkspaceEditor.getState()
    return s.phase==='closed'||!!s.error
  },{timeout:120000})
  const after = await page.evaluate(async()=>{
    const q=window.nurbsQa,s=q.useWorkspaceEditor.getState(),state=q.useReverse.getState()
    const steps=[]
    for(const body of state.bodies){const value=await q.runCommand('reverse.body.edit_source',{body:body.id});steps.push({id:body.id,text:new TextDecoder().decode(value.file.bytes)})}
    return {phase:s.phase,error:s.error??null,receipt:s.receipt,steps,sourceBefore:q.sourceBefore,originalId:q.id,
      historyDelta:q.history.useHistory.getState().past.length-q.historyBefore,
      originalVisible:q.reScene.bodyMeshes.get(q.id)?.material.visible,
      noOverlay:!document.querySelector('[data-slot="workspace.editor.overlay"]')}
  })
  report.apply={phase:after.phase,error:after.error,receipt:after.receipt,historyDelta:after.historyDelta,bodyCount:after.steps.length}
  check(after.phase==='closed'&&after.steps.length===2&&after.receipt?.createdBodyIds?.length===1&&after.historyDelta===1,
    'Apply creates exactly one separate CAD copy in project history')
  const original=after.steps.find(item=>item.id===after.originalId),copy=after.steps.find(item=>item.id===after.receipt.createdBodyIds[0])
  assert(original && copy,'Cannot identify original and created bodies')
  // STEP is serialized anew for each read and may contain changing metadata.
  // Preserve all three byte streams, then compare the reimported CAD geometry.
  writeFileSync(join(out,'host-source-before.step'),after.sourceBefore)
  writeFileSync(join(out,'host-source-after.step'),original.text)
  writeFileSync(join(out,'host-created-copy.step'),copy.text)
  report.render={originalVisible:after.originalVisible??null,noOverlay:after.noOverlay}
  report.exportHashes={sourceBefore:hash(after.sourceBefore),sourceAfter:hash(original.text),copy:hash(copy.text)}
  persist()
  const geometry = (step,id) => {
    const shape=kernel.importStep(step), fs=kernel.getSubShapes(shape,'face'), solids=kernel.getSubShapes(shape,'solid')
    try{return {id,valid:kernel.isValid(shape),solids:solids.length,faces:fs.length,
      types:fs.map(face=>kernel.surfaceType(face)),volume:kernel.getVolume(shape),brepHash:hash(kernel.toBREP(shape))}}
    finally{fs.forEach(face=>kernel.release(face));solids.forEach(solid=>kernel.release(solid));kernel.release(shape)}
  }
  report.geometryBefore=geometry(after.sourceBefore,original.id)
  report.geometry=[geometry(original.text,original.id),geometry(copy.text,copy.id)]
  persist()
  check(report.geometry.every(item=>item.valid&&item.solids===1&&item.faces===report.originalGeometry.faces&&item.types.includes('bspline')),
    'Original and copy reimport as valid solids with an existing B-spline face')
  check(report.geometryBefore.brepHash===report.geometry[0].brepHash,
    'The reimported CAD geometry of the original is unchanged')
  check(after.originalVisible===true,'The original body visibility is restored')
  check(after.noOverlay===true,'The workspace editor overlay is removed')
  check(Math.abs(report.geometry[0].volume-report.geometry[1].volume)>1e-7,
    'The new CAD solid has a measurable geometric change')
  check(app.consoleErrors.length===0,'No browser application errors')
  await page.screenshot({path:join(out,'applied.png')})
  report.verdict='PASS'
} catch(error) {
  report.verdict=report.blocker?'BLOCKED':'FAIL';report.error=String(error?.stack??error)
  if(page)try{await page.screenshot({path:join(out,'failure.png')})}catch{}
  process.exitCode=1
} finally {
  if(browser)await browser.close()
  kernel?.[Symbol.dispose]()
  report.inputHashAfter=hash(readFileSync(inputPath))
  report.sourceUnchanged=report.inputHashAfter===inputHash
  if(!report.sourceUnchanged){report.verdict='FAIL_SOURCE_CHANGED';process.exitCode=1}
  persist();console.log(JSON.stringify({out,...report},null,2))
}
