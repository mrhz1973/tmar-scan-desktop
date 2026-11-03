// SPDX-License-Identifier: AGPL-3.0-only
// Unit fixture for the lease contract. This does not qualify the real host UI.
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { Net, Point } from '../brep'
import type { Preview } from '../editorKernel'
import type { WorkspaceStripViewState, WorkspaceSurfaceLayerOwner, WorkspaceSurfaceView, WorkspaceSurfaceViewState } from '../workspaceBridge'
import { createWorkspaceLayer } from '../workspaceLayer'

const net: Net = {
  nu: 2, nv: 2, du: 1, dv: 1, poles: [[-1, -1, 0], [-1, 1, 0], [1, -1, 0], [1, 1, 0]],
  weights: [1, 1, 1, 1], rational: [0, 0], ku: [0, 1], kv: [0, 1], mu: [2, 2], mv: [2, 2],
}
const mesh = {
  positions: new Float32Array([-2, -2, 0, 2, -2, 0, 2, 2, 0, -2, 2, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2, 0, 2, 3]), vertexCount: 4, triangleCount: 2,
}
const validPreview: Preview = { mesh, faceMeshes: [mesh], valid: true, volume: 1, maxBoundaryError: 0, minimumNormalDot: 1 }
const stripFixture = (): WorkspaceStripViewState => ({
  paths: [[[-1, -1, 0], [1, -1, 0]], [[1, -1, 0], [1, 1, 0]],
    [[1, 1, 0], [-1, 1, 0]], [[-1, 1, 0], [-1, -1, 0]]],
  selectedEdge: -1, delta: [0, 0, 0], pending: false, canUndo: false, canRedo: false,
  addedArea: null, totalArea: null, hasResult: false,
})

function fixture(options: { reference?: 'scan' | 'cad-face'; rotated?: boolean; oblique?: boolean; preview?: Preview | null } = {}) {
  const host = new THREE.Group(), group = new THREE.Group()
  host.add(group)
  if (options.rotated) { host.rotation.z = Math.PI / 2; host.position.set(5, -3, 2) }
  host.updateWorldMatrix(true, true)
  const target = new THREE.Vector3(0, 0, 0).applyMatrix4(group.matrixWorld)
  const camera = new THREE.OrthographicCamera(-3, 3, 3, -3, 0.1, 100)
  camera.position.copy(target).add(new THREE.Vector3(options.oblique ? 4 : 0, 0, 10)); camera.lookAt(target)
  camera.updateProjectionMatrix(); camera.updateMatrixWorld(true)
  const rect = { left: 0, top: 0, width: 600, height: 600 }
  const overlay: { children: Array<{ style: Record<string, string>; dataset: Record<string, string>; textContent: string; remove: () => void }>; ownerDocument: unknown; getBoundingClientRect: () => typeof rect; appendChild: (child: typeof overlay.children[number]) => void } = {
    children: [], ownerDocument: null, getBoundingClientRect: () => rect,
    appendChild: child => { overlay.children.push(child) },
  }
  overlay.ownerDocument = { createElement: () => {
    const child = { style: {} as Record<string, string>, dataset: {} as Record<string, string>, textContent: '', remove: () => {
      const i = overlay.children.indexOf(child); if (i >= 0) overlay.children.splice(i, 1)
    } }
    return child
  } }
  let maskCount = 0, restoreCount = 0, captured: number | null = null
  let layer: import('../../../src/viewer/sceneLayers').SceneLayer | null = null
  let handlers: { move(e: PointerEvent): void; up(e: PointerEvent): void; cancel(e: PointerEvent): void; lostCapture(e: PointerEvent): void } | null = null
  let interrupted: (() => void) | null = null
  let notifyReference: (() => void) | null = null
  const listeners = new Set<() => void>()
  let state: WorkspaceSurfaceViewState = { net, preview: options.preview === undefined ? validPreview : options.preview,
    face: 0, selected: [], locked: [], hiddenPoles: [], selectionMode: 'points', dragMode: 'axis', axis: 0,
    dragStrength: 1, showNet: true, snap: !!options.reference, snapDistance: 0.25, busy: false, placingNote: false,
    notePins: [], stripes: null }
  const set = (patch: Partial<WorkspaceSurfaceViewState>) => { state = { ...state, ...patch }; for (const listener of listeners) listener() }
  const selectPoints = vi.fn((ids: readonly number[]) => set({ selected: [...ids] }))
  const chooseFace = vi.fn(async () => {})
  const previewPoles = vi.fn((_poles: Point[]) => {})
  const finishPoleGesture = vi.fn((_poles: Point[] | null) => {})
  const placeNote = vi.fn(async (_p: Point | null) => {})
  const reportViewError = vi.fn()
  const beginStripGesture = vi.fn((edge: number) => {
    if (!state.strip) return false
    set({ strip: { ...state.strip, selectedEdge: edge, pending: true, delta: [0, 0, 0] } })
    return true
  })
  const previewStripDelta = vi.fn((delta: Point) => {
    if (state.strip) set({ strip: { ...state.strip, delta: [...delta] } })
  })
  const finishStripGesture = vi.fn(async (_delta: Point | null) => {
    if (state.strip) set({ strip: { ...state.strip, pending: false, delta: [0, 0, 0] } })
  })
  const owner: WorkspaceSurfaceLayerOwner = { getViewState: () => state, subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn) } },
    chooseFace, selectPoints, beginPoleGesture: () => true, previewPoles, finishPoleGesture, placeNote, reportViewError,
    beginStripGesture, previewStripDelta, finishStripGesture }
  const referenceGeometry = new THREE.PlaneGeometry(10, 10)
  const beforePosition = referenceGeometry.getAttribute('position')
  const refMatrix = new THREE.Matrix4().makeRotationY(Math.PI / 2)
  let referenceCurrent = true
  const reference = { id: 'reference', kind: options.reference ?? 'scan', bodyId: options.reference === 'cad-face' ? 7 : null,
    faceKey: null, revision: 1, geometry: referenceGeometry, partFromGeometry: refMatrix.toArray(), visible: true, isCurrent: () => referenceCurrent }
  const view = {
    canvas: {}, group, overlayRoot: overlay, camera: () => camera, bounds: () => rect,
    projectPartPoint(p: readonly [number, number, number]) {
      host.updateWorldMatrix(true, true); camera.updateMatrixWorld(true)
      const v = new THREE.Vector3(...p).applyMatrix4(group.matrixWorld).project(camera)
      return { clientX: rect.left + (v.x + 1) * rect.width / 2, clientY: rect.top + (1 - v.y) * rect.height / 2,
        visible: Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && Math.abs(v.z) <= 1 }
    },
    addLayer(l: NonNullable<typeof layer>) { layer = l; l.clippingChanged?.(null, false); return () => l.dispose() },
    onCapturedPointer(h: NonNullable<typeof handlers>) { handlers = h; return () => { handlers = null } },
    onInterruption(fn: () => void) { interrupted = fn; return () => { interrupted = null } },
    subscribeReferences(fn: () => void) { notifyReference = fn; return () => { notifyReference = null } },
    references: () => options.reference ? [reference] : [],
    maskSourceForPreview() { maskCount++; let restored = false; return () => { if (!restored) { restored = true; restoreCount++ } } },
    capturePointer(id: number) { captured = id; return true }, releasePointer(id: number) { if (captured === id) captured = null },
    hasPointerCapture: (id: number) => captured === id, claimEditDrag: () => {}, invalidate: () => {},
  } as unknown as WorkspaceSurfaceView
  const client = (p: Point) => view.projectPartPoint(p)
  const event = (id: number, p: Point, altKey = false): PointerEvent => ({ pointerId: id, button: 0, shiftKey: false, ctrlKey: false, metaKey: false,
    altKey, ...client(p) } as unknown as PointerEvent)
  const getLayer = () => layer as unknown as NonNullable<typeof layer>
  const getHandlers = () => handlers as unknown as NonNullable<typeof handlers>
  return { view, owner, set, net, group, rect, client, event, getLayer, getHandlers, counts: () => ({ maskCount, restoreCount, captured }),
    selectPoints, chooseFace, previewPoles, finishPoleGesture, placeNote, reportViewError, referenceGeometry, beforePosition,
    beginStripGesture, previewStripDelta, finishStripGesture,
    overlay, notifyReferences: () => notifyReference?.(),
    invalidateReference: () => { referenceCurrent = false; notifyReference?.() }, interrupt: () => interrupted?.() }
}

it('masks only a valid preview, supports picking and restores the source on disposal', async () => {
  const f = fixture({ preview: { ...validPreview, valid: false } })
  const layer = createWorkspaceLayer(f.view, f.owner)
  expect(f.counts().maskCount).toBe(0)
  f.set({ net: null, preview: validPreview })
  expect(f.counts().maskCount).toBe(1)
  f.getLayer().click?.(300, 300, false)
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  expect(f.chooseFace).toHaveBeenCalledWith(0)
  f.set({ placingNote: true, notePins: [[0, 0, 0]] })
  f.getLayer().click?.(300, 300, false)
  expect(f.placeNote).toHaveBeenCalledWith([0, 0, 0])
  expect(f.group.getObjectByName('tmar-edit-surface-notes')?.children).toHaveLength(1)
  layer.dispose(); layer.dispose()
  expect(f.counts().restoreCount).toBe(1)
  expect(f.group.children).toHaveLength(0)
  expect(f.overlay.children).toHaveLength(0)
})

it('drags in part coordinates with a transformed part and cancels/release capture synchronously', () => {
  const f = fixture({ rotated: true }), layer = createWorkspaceLayer(f.view, f.owner)
  const start = f.event(1, [-1, -1, 0])
  expect(f.getLayer().pointerDown?.(start)).toBe(true)
  expect(f.counts().captured).toBe(1)
  f.getHandlers().move(f.event(2, [0, -1, 0]))
  expect(f.previewPoles).not.toHaveBeenCalled()
  f.getHandlers().move(f.event(1, [-0.5, -1, 0]))
  expect(f.previewPoles.mock.lastCall?.[0][0][0]).toBeCloseTo(-0.5)
  expect(layer.cancelGesture()).toBe(true)
  expect(f.finishPoleGesture).toHaveBeenCalledWith(null)
  expect(f.counts().captured).toBeNull()
  expect(layer.cancelGesture()).toBe(false)
  layer.dispose()
})

it('moves a pole in the local surface-normal direction when the camera is oblique', () => {
  const f = fixture({ oblique: true }), layer = createWorkspaceLayer(f.view, f.owner)
  f.set({ dragMode: 'local', axis: 2 })
  expect(f.getLayer().pointerDown?.(f.event(1, [-1, -1, 0]))).toBe(true)
  f.getHandlers().move(f.event(1, [-1, -1, 1]))
  const moved = f.previewPoles.mock.lastCall?.[0][0]
  expect(moved?.[0]).toBeCloseTo(-1)
  expect(moved?.[1]).toBeCloseTo(-1)
  expect(moved?.[2]).toBeCloseTo(1)
  layer.dispose()
})

describe.each(['scan', 'cad-face'] as const)('snap on %s reference', kind => {
  it('provides snap feedback and Alt restores free movement without modifying the borrowed geometry', () => {
    const f = fixture({ reference: kind }), layer = createWorkspaceLayer(f.view, f.owner)
    const disposeGeometry = vi.spyOn(f.referenceGeometry, 'dispose')
    expect(f.getLayer().pointerDown?.(f.event(1, [-1, -1, 0]))).toBe(true)
    f.getHandlers().move(f.event(1, [-0.1, -1, 0]))
    expect(f.previewPoles.mock.lastCall?.[0][0][0]).toBeCloseTo(0)
    expect(f.overlay.children[0].textContent).toContain('Agganciato')
    f.getHandlers().move(f.event(1, [0.1, -1, 0], true))
    expect(f.previewPoles.mock.lastCall?.[0][0][0]).toBeCloseTo(0.1)
    expect(f.overlay.children[0].style.display).toBe('none')
    f.getHandlers().up(f.event(1, [0.1, -1, 0], true))
    expect(f.finishPoleGesture.mock.lastCall?.[0]?.[0][0]).toBeCloseTo(0.1)
    layer.dispose()
    expect(disposeGeometry).not.toHaveBeenCalled()
    expect(f.referenceGeometry.getAttribute('position')).toBe(f.beforePosition)
    expect(f.referenceGeometry.boundsTree).toBeUndefined()
  })
})

it('keeps snap calculations in the part frame after rotating and translating the body', () => {
  const f = fixture({ reference: 'scan', rotated: true }), layer = createWorkspaceLayer(f.view, f.owner)
  f.getLayer().pointerDown?.(f.event(1, [-1, -1, 0]))
  f.getHandlers().move(f.event(1, [-0.1, -1, 0]))
  const moved = f.previewPoles.mock.lastCall?.[0][0]
  expect(moved?.[0]).toBeCloseTo(0)
  expect(moved?.[1]).toBeCloseTo(-1)
  expect(moved?.[2]).toBeCloseTo(0)
  layer.dispose()
})

it('cancels on viewport resize and does not commit a click', () => {
  const f = fixture(), layer = createWorkspaceLayer(f.view, f.owner)
  f.getLayer().pointerDown?.(f.event(1, [-1, -1, 0]))
  f.getHandlers().up(f.event(1, [-1, -1, 0]))
  expect(f.finishPoleGesture).toHaveBeenCalledWith(null)
  f.getLayer().pointerDown?.(f.event(2, [-1, -1, 0]))
  f.getHandlers().move(f.event(2, [-0.5, -1, 0]))
  f.rect.width++
  f.getLayer().tick?.(601, 600)
  expect(f.finishPoleGesture).toHaveBeenLastCalledWith(null)
  expect(f.counts().captured).toBeNull()
  layer.dispose()
})

it('renders Zebra only on its preview and restores resources when it is disabled', () => {
  const f = fixture(), layer = createWorkspaceLayer(f.view, f.owner)
  f.set({ stripes: { orientation: 'horizontal', width: 3, color: '#4d88af' } })
  f.getLayer().tick?.(600, 600)
  const surface = f.group.getObjectByName('tmar-edit-surface-preview')!.children[0]
  expect(surface.children.some(child => child.userData.tmarZebra)).toBe(true)
  f.set({ stripes: null })
  expect(surface.children.some(child => child.userData.tmarZebra)).toBe(false)
  layer.dispose()
})

it('shows the symmetry plane and matched poles, and refreshes them when symmetry changes', () => {
  const f = fixture(), layer = createWorkspaceLayer(f.view, f.owner)
  f.set({ symmetry: true, symmetryPartners: [2, 3, 0, 1], mirrorAxis: 0, mirrorOffset: 0.25, selected: [0] })
  const cage = f.group.getObjectByName('tmar-edit-surface-cage') as THREE.Group
  const plane = cage.children.find(child => child instanceof THREE.LineLoop) as THREE.LineLoop
  expect(plane).toBeDefined()
  const positions = plane.geometry.getAttribute('position')
  for (let i = 0; i < positions.count; i++) expect(positions.getX(i)).toBeCloseTo(0.25)
  const pole = cage.children.find(child => child.userData.point === 2) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  expect(pole.material.color.getHexString()).toBe('f785ff')
  f.set({ mirrorAxis: 1, mirrorOffset: -0.5 })
  const shiftedPlane = cage.children.find(child => child instanceof THREE.LineLoop) as THREE.LineLoop
  const shifted = shiftedPlane.geometry.getAttribute('position')
  for (let i = 0; i < shifted.count; i++) expect(shifted.getY(i)).toBeCloseTo(-0.5)
  f.set({ symmetry: false })
  expect(cage.children.some(child => child instanceof THREE.LineLoop)).toBe(false)
  const unmirrored = cage.children.find(child => child.userData.point === 2) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  expect(unmirrored.material.color.getHexString()).toBe('58f3d0')
  layer.dispose()
})

it('does not begin a blocked symmetric drag and explains how to resolve it', () => {
  const f = fixture(), layer = createWorkspaceLayer(f.view, f.owner)
  f.set({ symmetry: true, symmetryPartners: [2, 3, 0, 1], symmetryBlocked: true, locked: [2] })
  expect(f.getLayer().pointerDown?.(f.event(1, [-1, -1, 0]))).toBe(true)
  expect(f.counts().captured).toBeNull()
  expect(f.previewPoles).not.toHaveBeenCalled()
  expect(f.reportViewError).toHaveBeenCalledWith(expect.stringContaining('Simmetria bloccata'))
  f.set({ symmetryBlocked: false, locked: [] })
  expect(f.getLayer().pointerDown?.(f.event(2, [-1, -1, 0]))).toBe(true)
  expect(f.counts().captured).toBe(2)
  layer.dispose()
})

it('applies transparency to owned preview and Zebra only, including after preview replacement', () => {
  const f = fixture(), layer = createWorkspaceLayer(f.view, f.owner)
  const hostGeometry = new THREE.BoxGeometry(), hostMaterial = new THREE.MeshStandardMaterial({ color: 'orange' })
  const hostMesh = new THREE.Mesh(hostGeometry, hostMaterial)
  f.group.parent!.add(hostMesh)
  const hostGeometryDispose = vi.spyOn(hostGeometry, 'dispose')
  const hostMaterialDispose = vi.spyOn(hostMaterial, 'dispose')
  const getSurface = () => f.group.getObjectByName('tmar-edit-surface-preview')!.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
  let surface = getSurface()
  expect(surface.material.opacity).toBe(1)
  expect(surface.material.transparent).toBe(false)
  f.set({ transparency: 0.5 })
  expect(surface.material.opacity).toBe(0.5)
  expect(surface.material.transparent).toBe(true)
  expect(surface.material.depthWrite).toBe(false)
  expect(surface.material.colorWrite).toBe(true)
  f.set({ stripes: { orientation: 'horizontal', width: 3, color: '#4d88af' } })
  f.getLayer().tick?.(600, 600)
  let stripe = surface.children.find(child => child.userData.tmarZebra) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  expect(stripe.material.opacity).toBe(0.5)
  expect(stripe.material.transparent).toBe(true)
  expect(stripe.material.depthWrite).toBe(false)
  expect(surface.material.colorWrite).toBe(false)
  f.set({ transparency: 0.9, preview: { ...validPreview } })
  surface = getSurface()
  stripe = surface.children.find(child => child.userData.tmarZebra) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  expect(surface.material.opacity).toBeCloseTo(0.1)
  expect(stripe.material.opacity).toBeCloseTo(0.1)
  expect(surface.material.colorWrite).toBe(false)
  f.set({ stripes: null })
  expect(surface.children.some(child => child.userData.tmarZebra)).toBe(false)
  expect(surface.material.colorWrite).toBe(true)
  expect(surface.material.opacity).toBeCloseTo(0.1)
  f.set({ transparency: 0 })
  expect(surface.material.opacity).toBe(1)
  expect(surface.material.transparent).toBe(false)
  expect(surface.material.depthWrite).toBe(true)
  expect(hostMaterial.opacity).toBe(1)
  expect(hostMaterial.transparent).toBe(false)
  expect(hostMaterial.colorWrite).toBe(true)
  layer.dispose()
  expect(hostGeometryDispose).not.toHaveBeenCalled()
  expect(hostMaterialDispose).not.toHaveBeenCalled()
  hostMesh.removeFromParent(); hostGeometry.dispose(); hostMaterial.dispose()
})

it('ignores an invalidated reference during a captured drag', () => {
  const f = fixture({ reference: 'scan' }), layer = createWorkspaceLayer(f.view, f.owner)
  f.getLayer().pointerDown?.(f.event(1, [-1, -1, 0]))
  f.getHandlers().move(f.event(1, [-0.1, -1, 0]))
  expect(f.previewPoles.mock.lastCall?.[0][0][0]).toBeCloseTo(0)
  f.invalidateReference()
  f.getHandlers().move(f.event(1, [-0.1, -1, 0]))
  expect(f.previewPoles.mock.lastCall?.[0][0][0]).toBeCloseTo(-0.1)
  layer.dispose()
  expect(f.finishPoleGesture).toHaveBeenLastCalledWith(null)
  expect(f.counts().captured).toBeNull()
})

it('does not propagate a revoked source or frozen error reporter through a host reference notification', () => {
  const f = fixture({ reference: 'scan' }), layer = createWorkspaceLayer(f.view, f.owner)
  const materialDispose = vi.spyOn(THREE.MeshBasicMaterial.prototype, 'dispose')
  const hostGeometryDispose = vi.spyOn(f.referenceGeometry, 'dispose')
  const references = vi.spyOn(f.view, 'references').mockImplementation(() => { throw new Error('Sorgente revocata') })
  f.reportViewError.mockImplementation(() => { throw new Error('Controller congelato') })
  expect(() => f.notifyReferences()).not.toThrow()
  expect(f.reportViewError).toHaveBeenCalledWith('Magnete non disponibile: Sorgente revocata')
  expect(materialDispose).toHaveBeenCalled() // The former pick-only wrapper was released.
  expect(hostGeometryDispose).not.toHaveBeenCalled()

  // The former target still claims to be current; after refresh failure it
  // must nevertheless no longer attract an otherwise valid drag.
  expect(f.getLayer().pointerDown?.(f.event(1, [-1, -1, 0]))).toBe(true)
  f.getHandlers().move(f.event(1, [-0.1, -1, 0]))
  expect(f.previewPoles.mock.lastCall?.[0][0][0]).toBeCloseTo(-0.1)
  expect(layer.cancelGesture()).toBe(true)

  // A rejected notification must not suppress a later report once writable.
  f.reportViewError.mockReset()
  expect(() => f.notifyReferences()).not.toThrow()
  expect(f.reportViewError).toHaveBeenCalledWith('Magnete non disponibile: Sorgente revocata')
  references.mockRestore()
  expect(() => layer.dispose()).not.toThrow()
  expect(f.counts().restoreCount).toBe(1)
  expect(f.group.children).toHaveLength(0)
  expect(f.overlay.children).toHaveLength(0)
  expect(hostGeometryDispose).not.toHaveBeenCalled()
  materialDispose.mockRestore(); hostGeometryDispose.mockRestore()
})

it('cleans the layer without propagating when state and reporting are both revoked during notification', () => {
  const f = fixture({ reference: 'scan' }), layer = createWorkspaceLayer(f.view, f.owner)
  vi.spyOn(f.owner, 'getViewState').mockImplementationOnce(() => { throw new Error('Sorgente revocata') })
  f.reportViewError.mockImplementation(() => { throw new Error('Controller congelato') })
  expect(() => f.notifyReferences()).not.toThrow()
  expect(f.reportViewError).toHaveBeenCalledWith('Anteprima superficie non disponibile: Sorgente revocata')
  expect(f.counts().restoreCount).toBe(1)
  expect(f.group.getObjectByName('tmar-edit-surface-preview')?.children).toHaveLength(0)
  expect(f.group.getObjectByName('tmar-edit-surface-cage')?.children).toHaveLength(0)
  expect(() => layer.dispose()).not.toThrow()
  expect(f.group.children).toHaveLength(0)
  expect(f.overlay.children).toHaveLength(0)
})

it('selects locked poles without starting a drag', () => {
  const f = fixture(), layer = createWorkspaceLayer(f.view, f.owner)
  f.set({ locked: [0] })
  expect(f.getLayer().pointerDown?.(f.event(1, [-1, -1, 0]))).toBe(true)
  expect(f.selectPoints).toHaveBeenCalledWith([0], false)
  expect(f.counts().captured).toBeNull()
  expect(f.previewPoles).not.toHaveBeenCalled()
  layer.dispose()
})

it('ignores controller updates after the host has removed the layer first', () => {
  const f = fixture(), layer = createWorkspaceLayer(f.view, f.owner)
  f.getLayer().dispose()
  expect(f.counts().restoreCount).toBe(1)
  f.set({ net: { ...net, poles: net.poles.map(p => [...p] as Point) } })
  expect(f.reportViewError).not.toHaveBeenCalled()
  expect(f.group.children).toHaveLength(0)
  layer.dispose()
  expect(f.counts().restoreCount).toBe(1)
})

it('highlights the selected strip boundary and drags it in the rotated part frame', () => {
  const f = fixture({ rotated: true }), layer = createWorkspaceLayer(f.view, f.owner)
  const strip = stripFixture(), original = JSON.stringify(strip.paths)
  f.set({ net: null, strip })
  const stripGroup = f.group.getObjectByName('tmar-edit-surface-strip')!
  expect(stripGroup.getObjectByName('tmar-selected-strip-edge')).toBeUndefined()
  expect(f.getLayer().pointerDown?.(f.event(1, [0, -1, 0]))).toBe(true)
  expect(f.beginStripGesture).toHaveBeenCalledWith(0)
  expect(f.counts().captured).toBe(1)
  const selected = stripGroup.getObjectByName('tmar-selected-strip-edge') as THREE.Mesh<THREE.BufferGeometry, THREE.Material & { color: THREE.Color }>
  expect(selected.material.color.getHexString()).toBe('ffce30')
  f.getHandlers().move(f.event(1, [0, -1.5, 0]))
  const previewDelta = f.previewStripDelta.mock.lastCall?.[0]
  expect(previewDelta?.[0]).toBeCloseTo(0)
  expect(previewDelta?.[1]).toBeCloseTo(-0.5)
  expect(previewDelta?.[2]).toBeCloseTo(0)
  f.getHandlers().up(f.event(1, [0, -1.5, 0]))
  const committedDelta = f.finishStripGesture.mock.lastCall?.[0]
  expect(committedDelta?.[1]).toBeCloseTo(-0.5)
  expect(f.counts().captured).toBeNull()
  expect(f.previewPoles).not.toHaveBeenCalled()
  expect(JSON.stringify(strip.paths)).toBe(original)
  layer.dispose()
})

it('selects an edge without a commit on click and ignores unrelated pointers', () => {
  const f = fixture(), layer = createWorkspaceLayer(f.view, f.owner)
  f.set({ net: null, strip: stripFixture() })
  f.getLayer().pointerDown?.(f.event(4, [0, -1, 0]))
  f.getHandlers().move(f.event(5, [0, -2, 0]))
  f.getHandlers().up(f.event(5, [0, -2, 0]))
  expect(f.previewStripDelta).not.toHaveBeenCalled()
  expect(f.counts().captured).toBe(4)
  f.getHandlers().up(f.event(4, [0, -1, 0]))
  expect(f.finishStripGesture).toHaveBeenCalledWith(null)
  expect(f.counts().captured).toBeNull()
  expect(f.group.getObjectByName('tmar-selected-strip-edge')).toBeDefined()
  layer.dispose()
})

it('keeps the panel-selected edge when two boundaries overlap in the projection', () => {
  const f = fixture(), layer = createWorkspaceLayer(f.view, f.owner)
  const strip: WorkspaceStripViewState = { ...stripFixture(), selectedEdge: 1,
    paths: [[[-1, -1, 0], [1, -1, 0]], [[-1, -1, 0.2], [1, -1, 0.2]]] }
  f.set({ net: null, strip })
  expect(f.group.getObjectByName('tmar-selected-strip-edge')).toBeDefined()
  expect(f.getLayer().pointerDown?.(f.event(1, [0, -1, 0.2]))).toBe(true)
  expect(f.beginStripGesture).toHaveBeenCalledWith(1)
  expect(layer.cancelGesture()).toBe(true)
  layer.dispose()
})

it('cancels the strip synchronously on interruption and does not commit afterward', () => {
  const f = fixture(), layer = createWorkspaceLayer(f.view, f.owner)
  f.set({ net: null, strip: stripFixture() })
  f.getLayer().pointerDown?.(f.event(1, [0, -1, 0]))
  f.getHandlers().move(f.event(1, [0, -1.5, 0]))
  expect(f.previewStripDelta).toHaveBeenCalled()
  f.interrupt()
  expect(f.finishStripGesture).toHaveBeenCalledOnce()
  expect(f.finishStripGesture).toHaveBeenCalledWith(null)
  expect(f.counts().captured).toBeNull()
  f.getHandlers().up(f.event(1, [0, -1.5, 0]))
  expect(f.finishStripGesture).toHaveBeenCalledOnce()
  layer.dispose()
})

it('does not pick clipped or busy strip boundaries and leaves face selection alone', () => {
  const f = fixture(), layer = createWorkspaceLayer(f.view, f.owner)
  f.set({ net: null, strip: stripFixture() })
  const clipping = new THREE.Plane(new THREE.Vector3(0, 0, 1), -1)
  f.getLayer().clippingChanged?.([clipping], false)
  const stripGroup = f.group.getObjectByName('tmar-edit-surface-strip')!
  const line = stripGroup.children[0].children[0] as THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
  expect(line.material.clippingPlanes).toEqual([clipping])
  expect(f.getLayer().pointerDown?.(f.event(1, [0, -1, 0]))).toBe(false)
  f.getLayer().clippingChanged?.(null, false)
  f.set({ busy: true })
  expect(f.getLayer().pointerDown?.(f.event(2, [0, -1, 0]))).toBe(false)
  f.set({ busy: false })
  f.getLayer().click?.(300, 300, false)
  expect(f.chooseFace).not.toHaveBeenCalled()
  expect(f.counts().captured).toBeNull()
  layer.dispose()
})
