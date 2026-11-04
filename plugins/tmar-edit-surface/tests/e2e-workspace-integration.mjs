// SPDX-License-Identifier: AGPL-3.0-only
// Isolated main-view integration QA. Optional STEP_FILE is read-only; absent
// means a synthetic box. Never connects to an existing user browser profile.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'

if (process.env.SCANRULER_ISOLATED !== '1') throw Error('Set SCANRULER_ISOLATED=1 for an isolated test app.')
const url = new URL(process.env.APP_URL ?? '')
if (url.protocol !== 'http:' || !['localhost','127.0.0.1','[::1]'].includes(url.hostname) || !url.port ||
    url.username || url.password || url.pathname !== '/' || url.search || url.hash)
  throw Error('APP_URL must be an isolated local HTTP origin with an explicit port.')
const sourceFile = process.env.STEP_FILE
if (sourceFile && (!isAbsolute(sourceFile) || !['.step','.stp'].includes(extname(sourceFile).toLowerCase())))
  throw Error('STEP_FILE must be an absolute STEP path.')
if (sourceFile && process.env.TEST_FACE_SWITCH === '1')
  throw Error('TEST_FACE_SWITCH uses only its synthetic box fixture.')
const requestedFace = process.env.FACE_INDEX
if (requestedFace !== undefined && (!/^\d+$/.test(requestedFace) || !Number.isSafeInteger(Number(requestedFace))))
  throw Error('FACE_INDEX must be a non-negative integer.')
const outputRoot = process.env.EDIT_SURFACE_QA_OUT
if (!outputRoot || !isAbsolute(outputRoot)) throw Error('EDIT_SURFACE_QA_OUT must be an absolute folder outside the app checkout.')
const relativeOutput = relative(resolve(process.cwd()), resolve(outputRoot))
if (!relativeOutput || (!relativeOutput.startsWith('..' + sep) && relativeOutput !== '..' && !isAbsolute(relativeOutput)))
  throw Error('EDIT_SURFACE_QA_OUT must be outside the app checkout, so the dev server does not watch the browser profile.')

const { OcctKernel } = await import('occt-wasm')
const root = resolve(outputRoot)
mkdirSync(root, { recursive: true })
const out = mkdtempSync(join(root, 'run-'))
// The shared helper otherwise creates a default evidence directory in the app.
process.env.SHOT_DIR = out
const { launchApp } = await import('../../../scripts/e2e-lib.mjs')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const kernel = await OcctKernel.init()
let input
if (sourceFile) input = readFileSync(sourceFile)
else {
  const box = kernel.makeBox(20, 30, 10)
  try { input = Buffer.from(kernel.exportStep(box)) } finally { kernel.release(box) }
}
const inputHash = sha(input)
const report = { scope: 'isolated source host with actual Edit Surface controller', inputKind: sourceFile ? 'operator STEP' : 'synthetic box',
  inputHash, faceIndex: null, checks: [], consoleErrors: [], verdict: 'INCOMPLETE' }
const check = (ok, name) => { assert(ok, name); report.checks.push(name); console.log('PASS', name) }
let browser, page
try {
  const launched = await launchApp({ url: url.href, width: 1440, height: 1000, agentDataOk: false,
    userDataDir: join(out, 'owned-browser-profile'), protocolTimeout: 120000 })
  browser = launched.browser; page = launched.page; report.consoleErrors = launched.consoleErrors
  const dialogChoices = []
  page.on('dialog', dialog => { void (dialogChoices.shift() === false ? dialog.dismiss() : dialog.accept()) })
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
    for (let i = 0; !reverseSession() && i < 500; i++) await new Promise(r => setTimeout(r,20))
    if (!reverseSession()) throw Error('CAD session unavailable')
    await reverseSession().startKernel(); await reverseSession().settled()
    await runCommand('reverse.import.step', { bytes: new TextEncoder().encode(step), name: 'workspace-test.step' })
    await reverseSession().settled()
    const scene = sceneOf(), id = useReverse.getState().bodies[0]?.id
    if (!scene || !id) throw Error('Imported CAD body unavailable')
    scene.fitToView()
    window.surfaceQa = { runCommand, useReverse, reverseSession, scene, reScene: reSceneOf(scene), useWorkspaceEditor, history, id }
  }, input.toString('utf8'))
  await page.waitForFunction(() => !!window.surfaceQa.reScene.bodyMeshes.get(window.surfaceQa.id), { timeout: 60000 })
  await page.evaluate(() => {
    const q = window.surfaceQa, cam = q.scene.layerHost().camera()
    q.before = { canvas: q.scene.layerHost().canvas, camera: cam, pose: JSON.stringify([cam.position.toArray(),cam.quaternion.toArray()]),
      geometry: q.reScene.bodyMeshes.get(q.id).geometry, history: q.history.useHistory.getState().past.length,
      canvasCount: document.querySelectorAll('.viewport canvas').length }
  })
  await page.waitForSelector('[data-test=feature-edit-surface]:enabled', { timeout: 60000 })
  await page.click('[data-test=feature-edit-surface]')
  await page.waitForSelector('[data-test=workspace-surface-parameters]', { timeout: 120000 })
  const entered = await page.evaluate(() => {
    const q = window.surfaceQa, cam = q.scene.layerHost().camera(), state = q.useWorkspaceEditor.getState()
    return { sameCanvas: q.before.canvas === q.scene.layerHost().canvas, sameCamera: q.before.camera === cam,
      samePose: q.before.pose === JSON.stringify([cam.position.toArray(),cam.quaternion.toArray()]),
      sameGeometry: q.before.geometry === q.reScene.bodyMeshes.get(q.id).geometry,
      sameCanvasCount: q.before.canvasCount === document.querySelectorAll('.viewport canvas').length,
      phase: state.phase, noSeparateDialog: !document.querySelector('[data-test=edit-surface-dialog]') }
  })
  check(entered.sameCanvas && entered.sameCamera && entered.samePose && entered.sameCanvasCount && entered.sameGeometry && entered.noSeparateDialog,
    'actual editor uses the same canvas and camera; source geometry is borrowed unchanged')
  // STEP serialization may reorder faces: choose the largest supported planar
  // face in this imported body, unless the operator supplies its current index.
  const faceIndex = requestedFace !== undefined ? Number(requestedFace) : await page.evaluate(() => {
    const controller = window.surfaceQa.useWorkspaceEditor.getState().controller
    const faces = controller.getPanelState().faces, meshes = controller.getViewState().preview.faceMeshes
    const area = mesh => {
      let total = 0
      for (let i = 0; i < mesh.indices.length; i += 3) {
        const a = mesh.indices[i]*3, b = mesh.indices[i+1]*3, c = mesh.indices[i+2]*3, p = mesh.positions
        const ux=p[b]-p[a], uy=p[b+1]-p[a+1], uz=p[b+2]-p[a+2]
        const vx=p[c]-p[a], vy=p[c+1]-p[a+1], vz=p[c+2]-p[a+2]
        total += Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)/2
      }
      return total
    }
    const candidates = faces.filter(face => face.kind === 'plane' && !face.reason).map(face => ({ index: face.index, locks: face.trimLocks.length, area: area(meshes[face.index]) }))
    candidates.sort((a,b) => a.locks-b.locks || b.area-a.area)
    if (!candidates.length) throw Error('No supported planar face in the imported body')
    return candidates[0].index
  })
  report.faceIndex = faceIndex
  const face = await page.$eval('[data-test=surface-face]', (select, index) => {
    const option = [...select.options].find(item => item.value === String(index))
    return option && { disabled: option.disabled, text: option.textContent }
  }, faceIndex)
  assert(face && !face.disabled, `Face ${faceIndex} is unavailable: ${JSON.stringify(face)}`)
  await page.select('[data-test=surface-face]', String(faceIndex))
  await page.waitForFunction(() => {
    const s = window.surfaceQa.useWorkspaceEditor.getState()
    return s.snapshot?.validation.kind === 'valid' && !s.controller?.getPanelState().calculating
  }, { timeout: 120000 })
  if (process.env.TEST_FACE_SWITCH === '1') {
    const waitDialog = () => new Promise((resolve,reject) => {
      const handler = dialog => { clearTimeout(timer); resolve(dialog.message()) }
      const timer = setTimeout(() => { page.off('dialog',handler); reject(Error('Dialog did not appear')) },10000)
      page.once('dialog',handler)
    })
    // Pick an actually visible, editable face away from the active control
    // cage. The test uses the same camera, preview meshes and pointer as the UI.
    const otherFace = () => page.evaluate(async () => {
      const q=window.surfaceQa, layer=q.scene.layerHost(), c=q.useWorkspaceEditor.getState().controller
      const state=c.getViewState(), rect=layer.canvas.getBoundingClientRect(), camera=layer.camera(), group=layer.partGroup
      const preview=group.getObjectByName('tmar-edit-surface-preview')
      if (!preview) return null
      const THREE=await import('/node_modules/.vite/deps/three.js')
      const { pickNetAt }=await import('/plugins/tmar-edit-surface/netPicking.ts')
      group.updateWorldMatrix(true,true);camera.updateMatrixWorld(true)
      const caster=new THREE.Raycaster(), eligible=new Set(c.getPanelState().faces.filter(f=>!f.reason).map(f=>f.index))
      for (const mesh of preview.children) {
        const id=mesh.userData.face, position=mesh.geometry.getAttribute('position'), index=mesh.geometry.getIndex()
        if (id===state.face || !eligible.has(id) || !position) continue
        const count=index ? index.count : position.count
        for (let i=0;i+2<count;i+=3) {
          const at=j=>index ? index.getX(j) : j
          const p=new THREE.Vector3()
          for (let j=0;j<3;j++) p.add(new THREE.Vector3().fromBufferAttribute(position,at(i+j)))
          p.multiplyScalar(1/3).applyMatrix4(mesh.matrixWorld)
          const projected=p.clone().project(camera)
          if (Math.abs(projected.x)>=.98 || Math.abs(projected.y)>=.98 || Math.abs(projected.z)>=1) continue
          const x=rect.left+(projected.x+1)*rect.width/2, y=rect.top+(1-projected.y)*rect.height/2
          if (document.elementFromPoint(x,y)!==layer.canvas ||
              pickNetAt({net:state.net,mode:state.selectionMode,hiddenPoles:state.hiddenPoles,camera,partWorld:group.matrixWorld,rect,clientX:x,clientY:y})) continue
          caster.setFromCamera(new THREE.Vector2(projected.x,projected.y),camera)
          if (caster.intersectObjects(preview.children,false)[0]?.object.userData.face===id) return {id,x,y}
        }
      }
      return null
    })
    const firstTarget=await otherFace()
    assert(firstTarget,'No second visible editable face in the synthetic fixture')
    await page.mouse.click(firstTarget.x,firstTarget.y)
    await page.waitForFunction(id => {
      const s=window.surfaceQa.useWorkspaceEditor.getState()
      return s.controller?.getPanelState().face===id && s.snapshot?.validation.kind==='valid'
    },{timeout:120000},firstTarget.id)
    check(true,'a click changes the active CAD face in the shared viewport')
    await page.evaluate(() => {
      const c=window.surfaceQa.useWorkspaceEditor.getState().controller, p=c.getPanelState(), v=c.getViewState()
      const id=p.net.poles.findIndex((_,i)=>!p.locked.includes(i) && !v.hiddenPoles.includes(i))
      if(id<0) throw Error('No free point on the second face')
      c.selectPoints([id],false);c.moveSelected(.05)
    })
    await page.waitForFunction(() => {
      const s=window.surfaceQa.useWorkspaceEditor.getState()
      return s.snapshot?.dirty && s.snapshot.validation.kind==='valid'
    },{timeout:120000})
    const draft=await page.evaluate(() => JSON.stringify(window.surfaceQa.useWorkspaceEditor.getState().controller.getPanelState().net.poles))
    const next=await otherFace()
    assert(next,'No other visible editable face after modification')
    dialogChoices.push(false)
    const declined=waitDialog()
    await page.mouse.click(next.x,next.y)
    assert.match(await declined,/scartare/i)
    check(await page.evaluate(({face,draft}) => {
      const p=window.surfaceQa.useWorkspaceEditor.getState().controller.getPanelState()
      return p.face===face && JSON.stringify(p.net.poles)===draft
    },{face:firstTarget.id,draft}),'cancelling the face change preserves the modified draft')
    dialogChoices.push(true)
    const accepted=waitDialog()
    await page.mouse.click(next.x,next.y)
    assert.match(await accepted,/scartare/i)
    await page.waitForFunction(id => {
      const s=window.surfaceQa.useWorkspaceEditor.getState()
      return s.controller?.getPanelState().face===id && s.snapshot?.validation.kind==='valid'
    },{timeout:120000},next.id)
    check(true,'confirming the face change selects the clicked face')
    await page.select('[data-test=surface-face]',String(faceIndex))
    await page.waitForFunction(id => {
      const s=window.surfaceQa.useWorkspaceEditor.getState()
      return s.controller?.getPanelState().face===id && s.snapshot?.validation.kind==='valid'
    },{timeout:120000},faceIndex)
  }
  const panelLayout = await page.$eval('.workspace-editor-parameters', element => ({
    clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
  }))
  report.panelLayout = panelLayout
  check(panelLayout.scrollWidth <= panelLayout.clientWidth + 1, 'editor controls fit the dock without horizontal clipping')
  await page.screenshot({ path: join(out, 'before.png') })
  const first = await page.evaluate(() => {
    const c = window.surfaceQa.useWorkspaceEditor.getState().controller, s = c.getPanelState()
    return { poles: s.net.poles.map(p => [...p]), locked: s.locked, volume: c.getViewState().preview.volume }
  })
  check(first.poles.length > first.locked.length, 'selected imported CAD face has an editable control point')
  if (process.env.TEST_SYMMETRY === '1') {
    await page.select('[data-test=surface-continuity]', 'G0')
    await page.waitForFunction(() => {
      const state = window.surfaceQa.useWorkspaceEditor.getState(), controller = state.controller
      return state.snapshot?.validation.kind === 'valid' && !controller?.getPanelState().calculating && !!controller?.getViewState().preview
    }, { timeout: 120000 })
    const pair = await page.evaluate(() => {
      const q = window.surfaceQa, c = q.useWorkspaceEditor.getState().controller, state = c.getViewState()
      const net = state.net, canvas = q.scene.layerHost().canvas, rect = canvas.getBoundingClientRect()
      const camera = q.scene.layerHost().camera(), group = q.scene.layerHost().partGroup
      group.updateWorldMatrix(true, true); camera.updateMatrixWorld(true)
      const pixels = net.poles.map(point => {
        const projected = group.position.clone().set(...point).applyMatrix4(group.matrixWorld).project(camera)
        return { x: rect.left+(projected.x+1)*rect.width/2, y: rect.top+(1-projected.y)*rect.height/2, z: projected.z }
      })
      for (let axis = 0; axis < 3; axis++) {
        const values = net.poles.map(point => point[axis]), low = Math.min(...values), high = Math.max(...values)
        if (high-low < 1e-6) continue
        const offset = (low+high)/2
        for (let i = 0; i < net.poles.length; i++) {
          if (state.locked.includes(i) || state.hiddenPoles.includes(i)) continue
          const pixel = pixels[i]
          if (pixel.z < -1 || pixel.z > 1 || pixel.x < rect.left+12 || pixel.x > rect.right-12 || pixel.y < rect.top+12 || pixel.y > rect.bottom-12) continue
          if (document.elementFromPoint(pixel.x, pixel.y) !== canvas) continue
          const reflected = net.poles[i].map((value,d) => d === axis ? 2*offset-value : value)
          const matches = net.poles.flatMap((point,j) => point.every((value,d) => Math.abs(value-reflected[d]) < 1e-7) ? [j] : [])
          if (matches.length !== 1 || matches[0] === i || state.locked.includes(matches[0])) continue
          const separation = Math.min(...pixels.filter((_,j) => j !== i).map(other => Math.hypot(pixel.x-other.x,pixel.y-other.y)))
          if (separation > 8) return { axis, offset, i, j: matches[0], x: pixel.x, y: pixel.y }
        }
      }
      return null
    })
    assert(pair, 'No distinct free mirrored pole pair is visible')
    await page.select('[data-test=surface-selection-mode]', 'points')
    await page.mouse.click(pair.x, pair.y)
    await page.waitForFunction(i => window.surfaceQa.useWorkspaceEditor.getState().controller.getPanelState().selected.includes(i), {}, pair.i)
    await page.click('[data-test=surface-symmetry]')
    await page.select('[data-test=surface-mirror-plane]', String(pair.axis))
    await page.focus('[data-test=surface-mirror-offset]')
    await page.click('[data-test=surface-mirror-offset]', { clickCount: 3 })
    await page.keyboard.press('Backspace')
    await page.keyboard.type(String(pair.offset))
    await page.keyboard.press('Tab')
    await page.select('[data-test=surface-drag-mode]', 'local')
    await page.click('[data-test=surface-axis-2]')
    await page.$eval('[data-test=surface-distance]', element => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, '0.05')
      element.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await page.waitForSelector('[data-test=surface-move]:enabled')
    await page.click('[data-test=surface-move]')
    await page.waitForFunction(({i,j,axis,offset,original}) => {
      const state = window.surfaceQa.useWorkspaceEditor.getState(), poles = state.controller?.getPanelState().net?.poles
      return state.snapshot?.validation.kind === 'valid' && poles && poles[i].some((v,d) => Math.abs(v-original[d]) > 1e-8) &&
        poles[i].every((v,d) => Math.abs(poles[j][d]-(d === axis ? 2*offset-v : v)) < 1e-7)
    }, { timeout: 120000 }, { ...pair, original: first.poles[pair.i] })
    check(true, 'symmetry moves a pair of free poles and validates the CAD preview')
    await page.$eval('[data-test=surface-transparency]', element => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, '0.5')
      element.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await page.waitForFunction(() => {
      const q = window.surfaceQa, root = q.scene.layerHost().partGroup.getObjectByName('tmar-edit-surface-preview')
      return root?.children.length > 0 && root.children.every(mesh => Math.abs(mesh.material.opacity-0.5) < 1e-6) &&
        q.reScene.bodyMeshes.get(q.id).material.opacity === 1
    })
    check(true, 'transparency changes only the owned preview materials')
    await page.click('[data-test=surface-undo]')
    await page.waitForFunction(previous => {
      const state = window.surfaceQa.useWorkspaceEditor.getState()
      return state.snapshot?.validation.kind === 'valid' && JSON.stringify(state.controller.getPanelState().net.poles) === JSON.stringify(previous)
    }, { timeout: 120000 }, first.poles)
    await page.click('[data-test=surface-symmetry]')
    await page.select('[data-test=surface-continuity]', 'G1')
    await page.$eval('[data-test=surface-transparency]', element => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, '0')
      element.dispatchEvent(new Event('input', { bubbles: true }))
    })
    check(true, 'Undo restores the pre-symmetry CAD net')
  }
  await page.select('[data-test=surface-drag-mode]', 'local')
  await page.click('[data-test=surface-axis-2]')
  const selectFree = await page.evaluateHandle(() => [...document.querySelectorAll('[data-test=workspace-surface-parameters] button')].find(e => e.textContent === 'Seleziona liberi'))
  await selectFree.asElement().click()
  await page.$eval('[data-test=surface-distance]', element => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, '0.05')
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.click('[data-test=surface-move]')
  await page.waitForFunction(previous => {
    const s = window.surfaceQa.useWorkspaceEditor.getState(), p = s.controller?.getPanelState()
    return s.snapshot?.validation.kind === 'valid' && !p?.calculating &&
      p?.net?.poles.some((point, i) => point.some((value, j) => Math.abs(value - previous[i][j]) > 1e-8))
  }, { timeout: 120000 }, first.poles)
  const changed = await page.evaluate(() => {
    const c = window.surfaceQa.useWorkspaceEditor.getState().controller
    return { poles: c.getPanelState().net.poles.map(p => [...p]), volume: c.getViewState().preview.volume }
  })
  check(changed.poles.some((point, i) => point.some((v,j) => Math.abs(v-first.poles[i][j]) > 1e-8)), 'normal move changes the actual validated CAD draft')
  await page.screenshot({ path: join(out, 'modified.png') })
  await page.click('[data-test=surface-undo]')
  await page.waitForFunction(previous => {
    const s = window.surfaceQa.useWorkspaceEditor.getState()
    return s.snapshot?.validation.kind === 'valid' && JSON.stringify(s.controller.getPanelState().net.poles) === JSON.stringify(previous)
  }, { timeout: 120000 }, first.poles)
  await page.click('[data-test=surface-redo]')
  await page.waitForFunction(previous => {
    const s = window.surfaceQa.useWorkspaceEditor.getState()
    return s.snapshot?.validation.kind === 'valid' && JSON.stringify(s.controller.getPanelState().net.poles) === JSON.stringify(previous)
  }, { timeout: 120000 }, changed.poles)
  check(true, 'local undo and redo restore the previous validated draft')
  await page.select('[data-test=surface-selection-mode]', 'points')
  await page.select('[data-test=surface-drag-mode]', 'screen')
  await page.click('[data-test=surface-snap]')
  await page.$eval('[data-test=surface-drag-strength]', element => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, '0.2')
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const clear = await page.evaluateHandle(() => [...document.querySelectorAll('[data-test=workspace-surface-parameters] button')].find(e => e.textContent === 'Nessuno'))
  await clear.asElement().click()
  const target = await page.evaluate(() => {
    const q = window.surfaceQa, c = q.useWorkspaceEditor.getState().controller, state = c.getViewState()
    const canvas = q.scene.layerHost().canvas, rect = canvas.getBoundingClientRect(), camera = q.scene.layerHost().camera()
    const group = q.scene.layerHost().partGroup; group.updateWorldMatrix(true, true); camera.updateMatrixWorld(true)
    const locations = state.net.poles.map((pole, id) => {
      const vector = group.position.clone().set(...pole).applyMatrix4(group.matrixWorld).project(camera)
      return { id, x: rect.left+(vector.x+1)*rect.width/2, y: rect.top+(1-vector.y)*rect.height/2,
        visible: vector.z >= -1 && vector.z <= 1 }
    })
    const candidates = locations.filter(p => p.visible && !state.locked.includes(p.id) && !state.hiddenPoles.includes(p.id) &&
      p.x > rect.left+12 && p.x < rect.right-12 && p.y > rect.top+12 && p.y < rect.bottom-12)
    candidates.forEach(p => { p.distance = Math.min(...locations.filter(other => other.id !== p.id).map(other => Math.hypot(p.x-other.x,p.y-other.y))) })
    candidates.sort((a,b) => b.distance-a.distance)
    return candidates[0] ?? null
  })
  assert(target && target.distance > 8, `No separately clickable free pole: ${JSON.stringify(target)}`)
  await page.mouse.move(target.x, target.y)
  await page.mouse.down()
  await page.waitForFunction(() => window.surfaceQa.useWorkspaceEditor.getState().snapshot?.gesture === 'pole', { timeout: 10000 })
  await page.mouse.move(target.x + 8, target.y - 3, { steps: 4 })
  check(await page.evaluate(() => window.surfaceQa.useWorkspaceEditor.getState().snapshot?.gesture === 'pole' &&
    document.querySelector('[data-test=workspace-editor-apply]').disabled), 'pointer drag owns the live gesture and blocks Apply')
  await page.mouse.up()
  await page.waitForFunction(previous => {
    const s = window.surfaceQa.useWorkspaceEditor.getState(), p = s.controller?.getPanelState()
    return s.snapshot?.gesture === 'idle' && s.snapshot?.validation.kind === 'valid' &&
      p?.net?.poles.some((point,i) => point.some((v,j) => Math.abs(v-previous[i][j]) > 1e-8))
  }, { timeout: 120000 }, changed.poles)
  check(true, 'a real pointer drag changes and validates a control point in the main view')
  if (process.env.TEST_ZEBRA_NOTES === '1') {
    await page.click('[data-test=surface-zebra]')
    await page.waitForFunction(() => {
      const root = window.surfaceQa.scene.layerHost().partGroup.getObjectByName('tmar-edit-surface-preview')
      let count = 0; root?.traverse(node => { if (node.userData.tmarZebra) count++ })
      return count > 0
    }, { timeout: 10000 })
    await page.click('[data-test=surface-note-add]')
    check(await page.$eval('[data-test=workspace-editor-apply]', button => button.disabled), 'arming note placement disables Apply')
    // Exercise the real CAD anchor/resolve and note UI. The point is taken from
    // the selected face's display triangle; viewport clicking has separate tests.
    await page.evaluate(async () => {
      const controller = window.surfaceQa.useWorkspaceEditor.getState().controller
      const view = controller.getViewState(), mesh = view.preview.faceMeshes[view.face]
      const ids = [...mesh.indices.slice(0,3)], point = [0,1,2].map(axis =>
        ids.reduce((sum,id) => sum + mesh.positions[id*3+axis], 0)/3)
      await controller.placeNote(point)
    })
    await page.waitForSelector('[data-test=surface-note-text]', { timeout: 15000 })
    await page.type('[data-test=surface-note-text]', 'Nota durante Zebra')
    const note = await page.evaluate(() => {
      const s = window.surfaceQa.useWorkspaceEditor.getState(), v = s.controller.getViewState()
      return { count: s.snapshot.draftNoteCount, text: s.controller.getPanelState().notes[0]?.text,
        pins: v.notePins.length, blocked: document.querySelector('[data-test=workspace-editor-apply]').disabled }
    })
    check(note.count === 1 && note.text === 'Nota durante Zebra' && note.pins === 1 && note.blocked,
      'note text and resolved pin coexist with Zebra and prevent an unannotated Apply')
    await page.screenshot({ path: join(out, 'zebra-note.png') })
    await page.select('[data-test=surface-drag-mode]', 'local')
    await page.click('[data-test=surface-axis-2]')
    await page.$eval('[data-test=surface-distance]', element => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, '0.01')
      element.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await page.click('[data-test=surface-move]')
    await page.waitForFunction(() => {
      const state = window.surfaceQa.useWorkspaceEditor.getState(), controller = state.controller
      const view = controller.getViewState(), note = controller.getPanelState().notes[0]
      return state.snapshot?.validation.kind === 'valid' && note?.text === 'Nota durante Zebra' &&
        note.revision === view.preview?.previewRevision && view.notePins.length === 1 && !!view.stripes
    }, { timeout: 120000 })
    check(true, 'draft note is resolved again after CAD deformation with Zebra still active')
    const removeNote = await page.evaluateHandle(() => [...document.querySelectorAll('[data-test=workspace-surface-parameters] button')].find(e => e.textContent === 'Rimuovi nota'))
    await removeNote.asElement().click()
    await page.waitForFunction(() => window.surfaceQa.useWorkspaceEditor.getState().snapshot?.draftNoteCount === 0)
    check(true, 'removing the draft note restores the possibility of a plain CAD copy')
  }
  await page.waitForSelector('[data-test=workspace-editor-apply]:enabled', { timeout: 120000 })
  await page.click('[data-test=workspace-editor-apply]')
  await page.waitForFunction(() => window.surfaceQa.useWorkspaceEditor.getState().phase === 'closed', { timeout: 120000 })
  const after = await page.evaluate(async () => {
    const q = window.surfaceQa, state = q.useReverse.getState(), receipt = q.useWorkspaceEditor.getState().receipt
    const steps = []
    for (const body of state.bodies) {
      const answer = await q.runCommand('reverse.body.edit_source', { body: body.id })
      steps.push({ id: body.id, text: new TextDecoder().decode(answer.file.bytes) })
    }
    return { steps, receipt, historyDelta: q.history.useHistory.getState().past.length - q.before.history,
      originalVisible: q.reScene.bodyMeshes.get(q.id)?.material.visible, noOverlay: !document.querySelector('[data-slot="workspace.editor.overlay"]') }
  })
  check(after.steps.length === 2 && after.receipt?.createdBodyIds?.length === 1 && after.historyDelta === 1,
    'Apply publishes one CAD copy and one project history step')
  check(after.originalVisible && after.noOverlay, 'source render mask and editor overlay are released')
  report.geometry = []
  for (const step of after.steps) {
    const shape = kernel.importStep(step.text), solids = kernel.getSubShapes(shape, 'solid'), faces = kernel.getSubShapes(shape, 'face')
    try { report.geometry.push({ id: step.id, valid: kernel.isValid(shape), solids: solids.length, faces: faces.length, volume: kernel.getVolume(shape) }) }
    finally { solids.forEach(item => kernel.release(item)); faces.forEach(item => kernel.release(item)); kernel.release(shape) }
  }
  check(report.geometry.every(item => item.valid && item.solids === 1) && report.geometry[0].faces === report.geometry[1].faces,
    'both exported STEP bodies reimport as valid solids with the same face count')
  check(Math.abs(report.geometry[0].volume - report.geometry[1].volume) > 1e-7, 'the copy differs geometrically from the source')
  check(report.consoleErrors.length === 0, 'no browser application errors')
  report.entered = entered; report.beforeVolume = first.volume; report.afterVolume = changed.volume
  report.verdict = 'PASS'
} catch (error) {
  report.error = String(error?.stack ?? error)
  if (page) try { await page.screenshot({ path: join(out, 'failure.png') }) } catch { /* Preserve original failure. */ }
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  kernel[Symbol.dispose]()
  if (sourceFile) { report.inputHashAfter = sha(readFileSync(sourceFile)); report.sourceUnchanged = report.inputHashAfter === inputHash }
  if (report.sourceUnchanged === false) { report.verdict = 'FAIL_SOURCE_CHANGED'; process.exitCode = 1 }
  writeFileSync(join(out, 'result.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ out, ...report }))
}
