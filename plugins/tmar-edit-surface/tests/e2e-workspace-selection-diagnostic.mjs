// SPDX-License-Identifier: AGPL-3.0-only
// One isolated diagnostic: distinguish a stale preview from an incorrect pick.
// No Apply and no use of a user's browser profile, project, STEP file or scan.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

assert.equal(process.env.SCANRULER_ISOLATED, '1', 'Explicit isolated-host guard required')
const url = new URL(process.env.APP_URL ?? '')
assert.equal(url.href, 'http://127.0.0.1:17527/', 'Only the designated local QA host is permitted')
const root = process.env.EDIT_SURFACE_QA_OUT
assert(root && isAbsolute(root), 'Evidence folder must be absolute')
const rel = relative(resolve(process.cwd()), resolve(root))
assert(rel && (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)), 'Evidence must be outside the checkout')
mkdirSync(root, { recursive: true })
const out = mkdtempSync(join(root, 'selection-diagnostic-'))
process.env.SHOT_DIR = out
const report = { scope: 'synthetic STEP box; isolated shared viewport', verdict: 'INCOMPLETE', checks: [], notTested: ['Apply', 'user CAD sessions'] }
const persist = () => writeFileSync(join(out, 'result.json'), JSON.stringify(report, null, 2))
const check = (value, message) => { assert(value, message); report.checks.push(message); persist(); console.log('PASS', message) }
persist()
let kernel, browser, page
try {
  const { OcctKernel } = await import('occt-wasm')
  const { launchApp } = await import('../../../scripts/e2e-lib.mjs')
  kernel = await OcctKernel.init()
  const box = kernel.makeBox(20, 30, 10)
  let source
  try { source = kernel.exportStep(box) } finally { kernel.release(box) }
  const app = await launchApp({ url: url.href, width: 1440, height: 1000, agentDataOk: false,
    userDataDir: join(out, 'owned-browser-profile'), protocolTimeout: 120000 })
  browser = app.browser; page = app.page; report.consoleErrors = app.consoleErrors
  // Install before the editor's capturing listener so both before/after
  // states can be recorded without altering propagation or input behavior.
  await page.evaluate(() => {
    window.selectionDiagEvents = []
    const record = label => {
      const q = window.selectionDiag, s = q?.useWorkspaceEditor.getState(), c = s?.controller, p = c?.getPanelState(), v = c?.getViewState()
      if (c) window.selectionDiagEvents.push({ label, t: performance.now(), selected: [...p.selected],
        validation: s.snapshot?.validation?.kind, calculating: p.calculating, busy: p.busy,
        displayedPreview: !!v.preview, mode: v.selectionMode, gesture: s.snapshot?.gesture, message: p.message })
    }
    window.selectionDiagRecord = record
    for (const kind of ['pointerdown', 'pointerup']) window.addEventListener(kind, event => {
      const q = window.selectionDiag
      if (!q || event.target !== q.scene.layerHost().canvas) return
      record(`${kind}:before`)
      queueMicrotask(() => record(`${kind}:after`))
    }, true)
  })
  await page.evaluate(async step => {
    const { runCommand } = await import('/src/commands/registry.ts')
    const { useShell } = await import('/src/state/shellStore.ts')
    const { useReverse } = await import('/plugins/reverse/state/reStore.ts')
    const { reverseSession } = await import('/plugins/reverse/app/reSession.ts')
    const { sceneOf } = await import('/src/commands/host.ts')
    const { reSceneOf } = await import('/plugins/reverse/viewer/reScene.ts')
    const { useWorkspaceEditor } = await import('/src/plugins/workspaceEditors.ts')
    useShell.getState().setWorkspace('reverse')
    for (let i = 0; !reverseSession() && i < 500; i++) await new Promise(r => setTimeout(r, 20))
    if (!reverseSession()) throw Error('CAD session unavailable')
    await reverseSession().startKernel(); await reverseSession().settled()
    await runCommand('reverse.import.step', { bytes: new TextEncoder().encode(step), name: 'selection-diagnostic.step' })
    await reverseSession().settled()
    const scene = sceneOf(), id = useReverse.getState().bodies[0]?.id
    if (!scene || !id || useReverse.getState().bodies.length !== 1) throw Error('Synthetic box unavailable')
    scene.fitToView()
    window.selectionDiag = { useReverse, scene, reScene: reSceneOf(scene), useWorkspaceEditor, id }
  }, source)
  await page.waitForFunction(() => window.selectionDiag.reScene.bodyMeshes.has(window.selectionDiag.id), { timeout: 60000 })
  await page.waitForSelector('[data-test=feature-edit-surface]:enabled', { timeout: 60000 })
  await page.click('[data-test=feature-edit-surface]')
  await page.waitForSelector('[data-test=workspace-surface-parameters]', { timeout: 120000 })
  const faceIndex = await page.evaluate(() => {
    const c = window.selectionDiag.useWorkspaceEditor.getState().controller
    const faces = c.getPanelState().faces, meshes = c.getViewState().preview.faceMeshes
    const area = mesh => {
      let total = 0
      for (let i = 0; i < mesh.indices.length; i += 3) {
        const a=mesh.indices[i]*3, b=mesh.indices[i+1]*3, d=mesh.indices[i+2]*3, p=mesh.positions
        const ux=p[b]-p[a], uy=p[b+1]-p[a+1], uz=p[b+2]-p[a+2]
        const vx=p[d]-p[a], vy=p[d+1]-p[a+1], vz=p[d+2]-p[a+2]
        total += Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)/2
      }
      return total
    }
    const candidates=faces.filter(f=>f.kind==='plane'&&!f.reason).map(f=>({index:f.index,locks:f.trimLocks.length,area:area(meshes[f.index])}))
    candidates.sort((a,b)=>a.locks-b.locks||b.area-a.area)
    return candidates[0]?.index ?? -1
  })
  assert(faceIndex >= 0, 'No editable planar face')
  report.faceIndex = faceIndex
  await page.select('[data-test=surface-face]', String(faceIndex))
  await page.waitForFunction(() => {
    const s = window.selectionDiag.useWorkspaceEditor.getState(), p = s.controller?.getPanelState()
    return s.snapshot?.validation?.kind === 'valid' && !p?.calculating && !!p?.net
  }, { timeout: 120000 })
  await page.evaluate(() => {
    const c = window.selectionDiag.useWorkspaceEditor.getState().controller
    c.subscribe(() => window.selectionDiagRecord('session:change'))
    window.selectionDiagRecord('before-G0')
  })
  await page.select('[data-test=surface-continuity]', 'G0')
  await page.evaluate(() => window.selectionDiagRecord('after-G0'))
  // Reproduce the original pair-selection algorithm exactly.
  const pair = await page.evaluate(() => {
    const q=window.selectionDiag, c=q.useWorkspaceEditor.getState().controller, state=c.getViewState()
    const net=state.net, canvas=q.scene.layerHost().canvas, rect=canvas.getBoundingClientRect()
    const camera=q.scene.layerHost().camera(), group=q.scene.layerHost().partGroup
    group.updateWorldMatrix(true,true);camera.updateMatrixWorld(true)
    const pixels=net.poles.map(point=>{
      const p=group.position.clone().set(...point).applyMatrix4(group.matrixWorld).project(camera)
      return {x:rect.left+(p.x+1)*rect.width/2,y:rect.top+(1-p.y)*rect.height/2,z:p.z}
    })
    for(let axis=0;axis<3;axis++){
      const values=net.poles.map(point=>point[axis]),low=Math.min(...values),high=Math.max(...values)
      if(high-low<1e-6)continue
      const offset=(low+high)/2
      for(let i=0;i<net.poles.length;i++){
        if(state.locked.includes(i)||state.hiddenPoles.includes(i))continue
        const p=pixels[i]
        if(p.z < -1 || p.z > 1 || p.x < rect.left+12 || p.x > rect.right-12 || p.y < rect.top+12 || p.y > rect.bottom-12)continue
        if(document.elementFromPoint(p.x,p.y)!==canvas)continue
        const reflected=net.poles[i].map((value,d)=>d===axis?2*offset-value:value)
        const matches=net.poles.flatMap((point,j)=>point.every((value,d)=>Math.abs(value-reflected[d])<1e-7)?[j]:[])
        if(matches.length!==1||matches[0]===i||state.locked.includes(matches[0]))continue
        const separation=Math.min(...pixels.filter((_,j)=>j!==i).map(other=>Math.hypot(p.x-other.x,p.y-other.y)))
        if(separation>8)return {axis,offset,i,j:matches[0],x:p.x,y:p.y,separation}
      }
    }
    return null
  })
  assert(pair, 'No visible mirrored pair')
  report.pair = pair
  await page.select('[data-test=surface-selection-mode]', 'points')
  const purePick = await page.evaluate(async ({ x, y }) => {
    const q=window.selectionDiag, c=q.useWorkspaceEditor.getState().controller, s=c.getViewState()
    const camera=q.scene.layerHost().camera(), group=q.scene.layerHost().partGroup, rect=q.scene.layerHost().canvas.getBoundingClientRect()
    group.updateWorldMatrix(true,true);camera.updateMatrixWorld(true)
    const { pickNetAt } = await import('/plugins/tmar-edit-surface/netPicking.ts')
    return pickNetAt({net:s.net,mode:'points',hiddenPoles:s.hiddenPoles,camera,partWorld:group.matrixWorld,rect,clientX:x,clientY:y})
  }, pair)
  report.purePick = purePick
  check(purePick?.length === 1 && purePick[0] === pair.i, 'Pure projection and hit-test identify the intended pole')
  await page.evaluate(() => window.selectionDiagRecord('before-first-click'))
  await page.mouse.click(pair.x, pair.y)
  await page.evaluate(() => window.selectionDiagRecord('after-first-click'))
  const first = await page.evaluate(() => {
    const s=window.selectionDiag.useWorkspaceEditor.getState(),p=s.controller.getPanelState()
    return {selected:[...p.selected],validation:s.snapshot.validation.kind,calculating:p.calculating,message:p.message}
  })
  report.firstClick = first; persist()
  await page.waitForFunction(() => {
    const s=window.selectionDiag.useWorkspaceEditor.getState(),p=s.controller.getPanelState()
    return s.snapshot.validation.kind==='valid'&&!p.calculating&&!!s.controller.getViewState().preview
  }, {timeout:120000})
  await page.evaluate(() => window.selectionDiagRecord('after-G0-preview-valid'))
  if (!first.selected.includes(pair.i)) {
    await page.mouse.click(pair.x,pair.y)
    await page.evaluate(() => window.selectionDiagRecord('after-valid-click'))
  }
  const after = await page.evaluate(() => {
    const s=window.selectionDiag.useWorkspaceEditor.getState(),p=s.controller.getPanelState()
    return {selected:[...p.selected],validation:s.snapshot.validation.kind,calculating:p.calculating,message:p.message}
  })
  report.afterValid = after
  report.events = await page.evaluate(() => window.selectionDiagEvents)
  await page.screenshot({path:join(out,'selection.png')})
  check(after.selected.includes(pair.i), 'The intended pole can be selected after the G0 preview is valid')
  check(app.consoleErrors.length === 0, 'No browser application errors')
  report.verdict='PASS'
} catch(error) {
  report.verdict='FAIL';report.error=String(error?.stack??error)
  if(page){
    try{report.events=await page.evaluate(()=>window.selectionDiagEvents)}catch{}
    try{await page.screenshot({path:join(out,'failure.png')})}catch{}
  }
  process.exitCode=1
} finally {
  if(browser)await browser.close()
  kernel?.[Symbol.dispose]()
  persist();console.log(JSON.stringify({out,...report},null,2))
}
