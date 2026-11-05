// SPDX-License-Identifier: AGPL-3.0-only
import * as THREE from 'three'
import { EditorLifetime } from '../plugins/editorLifetime'
import { EditorReferenceNotifications } from '../plugins/editorReferenceNotifications'
import type { DraftStamp, EditorViewportLease, ReferenceDescriptor, ReticleFrame, Vec3 } from '../plugins/workspaceEditorTypes'
import type { OwnedEditorViewport } from '../plugins/workspaceEditors'
import type { SceneManager } from './SceneManager'
import type { SceneLayer } from './sceneLayers'
import { sameReticleFrame, sameReticleStamp, validatedReticleFrame, worldReticleBox } from './editorReticleFrame'

export interface EditorSceneAdapter {
  references(): readonly ReferenceDescriptor[]
  subscribeReferences(listener: () => void): () => void
  maskSource(): () => void
  sourceVisible(): boolean
  assertCurrent(): void
}
/** Part/world conversion shared by orthographic and perspective projections. */
export function editorRayInPart(camera: THREE.Camera, matrix: THREE.Matrix4, rect: Pick<DOMRectReadOnly, 'left' | 'top' | 'width' | 'height'>, x: number, y: number) {
  if (rect.width <= 0 || rect.height <= 0 || Math.abs(matrix.determinant()) < 1e-15) return null
  camera.updateMatrixWorld(true)
  const caster = new THREE.Raycaster()
  caster.setFromCamera(new THREE.Vector2((x - rect.left) * 2 / rect.width - 1, 1 - (y - rect.top) * 2 / rect.height), camera)
  const ray = caster.ray.clone().applyMatrix4(matrix.clone().invert())
  return { origin: ray.origin.toArray() as Vec3, direction: ray.direction.toArray() as Vec3 }
}
export function editorProjectPart(camera: THREE.Camera, matrix: THREE.Matrix4, rect: Pick<DOMRectReadOnly, 'left' | 'top' | 'width' | 'height'>, point: Vec3) {
  camera.updateMatrixWorld(true)
  const p = new THREE.Vector3(...point).applyMatrix4(matrix).project(camera)
  return { clientX: rect.left + (p.x + 1) * rect.width / 2, clientY: rect.top + (1 - p.y) * rect.height / 2, visible: Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && Math.abs(p.z) <= 1 }
}
export function createEditorViewportLease(scene: SceneManager, adapter: EditorSceneAdapter): OwnedEditorViewport {
  adapter.assertCurrent()
  const host = scene.layerHost(), life = new EditorLifetime(), group = new THREE.Group()
  group.name = 'workspace-editor-preview'
  host.partGroup.add(group)
  life.own(() => host.partGroup.remove(group))
  const root = host.container.ownerDocument.createElement('div')
  root.dataset.slot = 'workspace.editor.overlay'
  Object.assign(root.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' })
  host.container.appendChild(root)
  life.own(() => root.remove())
  const referenceNotifications = new EditorReferenceNotifications()
  life.own(() => referenceNotifications.dispose())
  let disposed = false, capture: number | null = null
  let reticle: ReticleFrame | null = null
  const reticleListeners = new Set<() => void>()
  const layers = new Set<SceneLayer>(), frames = new Set<(time: number) => void>()
  const handlers = new Set<Parameters<EditorViewportLease['onCapturedPointer']>[0]>()
  const interruptions = new Set<(reason: 'blur' | 'source-invalid' | 'dispose') => void>()
  const ordered = () => [...layers].sort((a, b) => a.order - b.order)
  const releaseCapture = () => {
    const id = capture
    capture = null // Invalidate BEFORE lostpointercapture can be dispatched.
    try { if (id !== null && host.canvas.hasPointerCapture(id)) host.canvas.releasePointerCapture(id) }
    catch { /* Detached/lost canvas must not prevent the remaining cleanup. */ }
  }
  const interrupt = (reason: 'blur' | 'source-invalid' | 'dispose') => {
    releaseCapture()
    for (const fn of [...interruptions]) { try { fn(reason) } catch { /* Other leases must still release. */ } }
  }
  const aggregate: SceneLayer = {
    order: -100, covers: true,
    pointerDown: event => {
      // A second pointer/button must not modify selection or start navigation.
      if (capture !== null) return true
      if (!adapter.sourceVisible()) return event.button === 0 && !event.shiftKey
      // Modified navigation belongs to the configured host scheme, not the net.
      if (event.shiftKey || event.button !== 0) return false
      for (const layer of ordered()) if (layer.pointerDown?.(event)) return true
      return false
    },
    click: (x, y, additive) => {
      if (adapter.sourceVisible()) for (const layer of ordered()) if (layer.click?.(x, y, additive)) break
      return true // Never leak an empty click to host model selection.
    },
    hover: (at, covered) => {
      let blocked = covered
      for (const layer of ordered()) if (layer.hover?.(adapter.sourceVisible() ? at : null, blocked) && layer.covers) blocked = true
      return blocked
    },
    cycle: (at, step, behind) => capture === null && adapter.sourceVisible() && ordered().some(layer => layer.cycle?.(at, step, behind)),
    navTargets: () => adapter.sourceVisible() ? ordered().flatMap(layer => layer.navTargets?.() ?? []) : [],
    tick: (w, h) => {
      group.visible = adapter.sourceVisible()
      root.hidden = !group.visible
      for (const layer of [...layers]) layer.tick?.(w, h)
      for (const fn of [...frames]) fn(performance.now())
    },
    clippingChanged: (planes, section) => { for (const l of layers) l.clippingChanged?.(planes, section) },
    themeChanged: theme => { for (const l of layers) l.themeChanged?.(theme) },
    lineWidthChanged: px => { for (const l of layers) l.lineWidthChanged?.(px) },
    opacityChanged: opacity => { for (const l of layers) l.opacityChanged?.(opacity) },
    partMoved: () => interrupt('source-invalid'), scanReplaced: () => interrupt('source-invalid'),
    dispose: () => interrupt('dispose'),
  }
  try {
    life.own(scene.leaseEditorInput(aggregate))
    life.own(scene.addLayer(aggregate))
  } catch (error) { life.dispose(); throw error }
  const forward = (kind: keyof Parameters<EditorViewportLease['onCapturedPointer']>[0]) => (event: PointerEvent) => {
    if (disposed) return
    if (capture !== null && capture !== event.pointerId && event.target === host.canvas) {
      event.stopImmediatePropagation(); return
    }
    if (capture !== event.pointerId) return
    event.stopImmediatePropagation()
    try { adapter.assertCurrent() } catch { interrupt('source-invalid'); return }
    if (!adapter.sourceVisible()) { interrupt('blur'); return }
    if (kind === 'lostCapture') capture = null
    try { for (const h of [...handlers]) h[kind](event) }
    finally { if (kind !== 'move') releaseCapture() }
  }
  const win = host.canvas.ownerDocument.defaultView!
  // Capture before OrbitControls/OrthoViewport can retain an editor pointer.
  // Otherwise a later swallowed pointerup leaves navigation with stale pointers.
  const begin = (event: PointerEvent) => {
    if (disposed || event.target !== host.canvas) return
    if (capture !== null || aggregate.pointerDown?.(event)) {
      event.preventDefault(); event.stopImmediatePropagation()
    }
  }
  win.addEventListener('pointerdown', begin, true)
  life.own(() => win.removeEventListener('pointerdown', begin, true))
  for (const [event, kind] of [['pointermove', 'move'], ['pointerup', 'up'], ['pointercancel', 'cancel'], ['lostpointercapture', 'lostCapture']] as const) {
    const listener = forward(kind)
    win.addEventListener(event, listener, true)
    life.own(() => win.removeEventListener(event, listener, true))
  }
  const blur = () => interrupt('blur')
  win.addEventListener('blur', blur)
  life.own(() => win.removeEventListener('blur', blur))
  const current = () => { if (disposed) throw new Error('Viewport lease disposed.'); adapter.assertCurrent() }
  const view: EditorViewportLease = {
    canvas: host.canvas, group, overlayRoot: root, camera: () => host.camera(), bounds: () => host.canvas.getBoundingClientRect(),
    rayInPart: (x, y) => { current(); host.partGroup.updateWorldMatrix(true, false); return editorRayInPart(host.camera(), host.partGroup.matrixWorld, view.bounds(), x, y) },
    projectPartPoint: point => { current(); host.partGroup.updateWorldMatrix(true, false); return editorProjectPart(host.camera(), host.partGroup.matrixWorld, view.bounds(), point) },
    publishReticleFrame: frame => {
      current()
      const next = validatedReticleFrame(frame)
      if (sameReticleFrame(reticle, next)) return
      reticle = next
      for (const fn of [...reticleListeners]) { try { fn() } catch { /* A listener must not break an editor gesture. */ } }
    },
    addLayer: layer => {
      current(); layers.add(layer)
      const remove = life.own(() => { layers.delete(layer); layer.dispose(); host.invalidate() })
      try {
        layer.clippingChanged?.(host.clipPlanes(), scene.sliced()); layer.themeChanged?.(host.theme())
        host.invalidate(); return remove
      } catch (error) { remove(); throw error }
    },
    onCapturedPointer: h => { current(); handlers.add(h); return life.own(() => { handlers.delete(h) }) },
    onInterruption: fn => { current(); interruptions.add(fn); return life.own(() => { interruptions.delete(fn) }) },
    onFrame: fn => { current(); frames.add(fn); return life.own(() => { frames.delete(fn) }) },
    references: () => { current(); return adapter.references() },
    subscribeReferences: fn => { current(); return life.own(referenceNotifications.subscribe(fn)) },
    maskSourceForPreview: () => { current(); return life.own(adapter.maskSource()) },
    capturePointer: id => {
      current()
      if (capture !== null && capture !== id) return false
      try { host.canvas.setPointerCapture(id); capture = id; return host.canvas.hasPointerCapture(id) }
      catch { capture = null; return false }
    },
    releasePointer: id => { if (capture === id) releaseCapture() },
    hasPointerCapture: id => capture === id && host.canvas.hasPointerCapture(id),
    // The exclusive session always reserves plain left, including empty space.
    claimEditDrag: () => { current() },
    invalidate: () => { if (!disposed) host.invalidate() },
  }
  life.own(adapter.subscribeReferences(() => {
    if (disposed) return
    group.visible = adapter.sourceVisible(); root.hidden = !group.visible
    if (!group.visible && capture !== null) interrupt('blur')
    host.invalidate()
    referenceNotifications.notify()
  }))
  return { view, releaseCapture,
    reticleFrame: () => disposed ? null : reticle,
    onReticleFrameChanged: fn => {
      current()
      reticleListeners.add(fn)
      return life.own(() => { reticleListeners.delete(fn) })
    },
    frameReticle: (stamp: DraftStamp) => {
      if (disposed || capture !== null || !adapter.sourceVisible() ||
          !reticle || !sameReticleStamp(reticle.stamp, stamp)) return false
      try { current() } catch { return false }
      host.partGroup.updateWorldMatrix(true, false)
      const box = worldReticleBox(reticle, host.partGroup.matrixWorld)
      if (!box) return false
      scene.fitBox(box.min.toArray() as [number, number, number], box.max.toArray() as [number, number, number])
      return true
    },
    suspendReferenceNotifications: () => { current(); return referenceNotifications.suspend() },
    dispose: () => {
    if (disposed) return
    disposed = true
    interrupt('dispose')
    life.dispose()
    // Do not traverse/dispose borrowed buffers or materials. Plugin owns its layer resources.
    reticle = null; reticleListeners.clear()
    group.clear(); frames.clear(); handlers.clear(); interruptions.clear()
    host.invalidate()
  } }
}
