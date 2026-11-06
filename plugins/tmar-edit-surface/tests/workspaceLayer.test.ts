// SPDX-License-Identifier: AGPL-3.0-only
// Unit fixture for the lease contract. This does not qualify the real host UI.
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { Net, Point } from '../brep'
import type { Preview } from '../editorKernel'
import type { WorkspaceStripViewState, WorkspaceSurfaceLayerOwner, WorkspaceSurfaceView, WorkspaceSurfaceViewState } from '../workspaceBridge'
import { createWorkspaceLayer } from '../workspaceLayer'
import { selectNetPoints } from '../netSelection'

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
  selectedEdge: -1, axis: 2, delta: [0, 0, 0], pending: false, canUndo: false, canRedo: false,
  addedArea: null, totalArea: null, hasResult: false,
})

function fixture(options: { reference?: 'scan' | 'cad-face'; rotated?: boolean; oblique?: boolean; nearAligned?: boolean; perspective?: boolean; preview?: Preview | null } = {}) {
  const host = new THREE.Group(), group = new THREE.Group()
  host.add(group)
  if (options.rotated) { host.rotation.z = Math.PI / 2; host.position.set(5, -3, 2) }
  host.updateWorldMatrix(true, true)
  const target = new THREE.Vector3(0, 0, 0).applyMatrix4(group.matrixWorld)
  const camera = options.perspective ? new THREE.PerspectiveCamera(35, 1, 0.1, 100) : new THREE.OrthographicCamera(-3, 3, 3, -3, 0.1, 100)
  camera.position.copy(target).add(new THREE.Vector3(options.oblique ? 4 : options.nearAligned ? 0.1 : 0, 0, 10)); camera.lookAt(target)
  camera.updateProjectionMatrix(); camera.updateMatrixWorld(true)
  const rect = { left: 0, top: 0, width: 600, height: 600 }
  type OverlayNode = { style: Record<string, string>; dataset: Record<string, string>; textContent: string; remove: () => void;
    type: string; title: string; disabled: boolean; setAttribute(name: string, value: string): void;
    addEventListener(name: string, fn: (event: PointerEvent) => void): void;
    removeEventListener(name: string, fn: (event: PointerEvent) => void): void; dispatch(name: string, event: PointerEvent): void }
  const overlay: { children: OverlayNode[]; ownerDocument: unknown; getBoundingClientRect: () => typeof rect; appendChild: (child: OverlayNode) => void } = {
    children: [], ownerDocument: null, getBoundingClientRect: () => rect,
    appendChild: child => { overlay.children.push(child) },
  }
  overlay.ownerDocument = { createElement: () => {
    const handlers = new Map<string, (event: PointerEvent) => void>()
    const child: OverlayNode = { style: {}, dataset: {}, textContent: '', type: '', title: '', disabled: false,
      setAttribute: () => {}, addEventListener: (name, fn) => { handlers.set(name, fn) },
      removeEventListener: (name, fn) => { if (handlers.get(name) === fn) handlers.delete(name) },
      dispatch: (name, event) => { handlers.get(name)?.(event) }, remove: () => {
      const i = overlay.children.indexOf(child); if (i >= 0) overlay.children.splice(i, 1)
    } }
    return child
  } }
  let maskCount = 0, restoreCount = 0, captured: number | null = null
  let layer: import('../../../src/viewer/sceneLayers').SceneLayer | null = null
  let handlers: { move(e: PointerEvent): void; up(e: PointerEvent): void; cancel(e: PointerEvent): void; lostCapture(e: PointerEvent): void } | null = null
  let interrupted: (() => void) | null = null
  let frameCallback: (() => void) | null = null
  let notifyReference: (() => void) | null = null
  const listeners = new Set<() => void>()
  let state: WorkspaceSurfaceViewState = { net, preview: options.preview === undefined ? validPreview : options.preview,
    face: 0, selected: [], locked: [], hiddenPoles: [], selectionMode: 'points', dragMode: 'axis', axis: 0,
    dragStrength: 1, showNet: true, snap: !!options.reference, snapDistance: 0.25, busy: false, placingNote: false,
    notePins: [], stripes: null }
  const set = (patch: Partial<WorkspaceSurfaceViewState>) => { state = { ...state, ...patch }; for (const listener of listeners) listener() }
  const selectPoints = vi.fn((ids: readonly number[]) => set({ selected: [...ids] }))
  const requestFaceSelection = vi.fn(async () => {})
  const beginPoleGesture = vi.fn(() => { if (state.directStrip) set({ directStrip: null }); return true })
  const previewPoles = vi.fn((_poles: Point[]) => {})
  const finishPoleGesture = vi.fn((_poles: Point[] | null) => {})
  const placeNote = vi.fn(async (_p: Point | null) => {})
  const reportViewError = vi.fn()
  const beginStripGesture = vi.fn((edge: number) => {
    if (!state.strip) return false
    set({ strip: { ...state.strip, selectedEdge: edge, pending: true, delta: [0, 0, 0] } })
    return true
  })
  let promoted: WorkspaceSurfaceViewState['directStrip'] = null
  const beginDirectStripGesture = vi.fn((edge: number, revision: number) => {
    const direct = state.directStrip
    if (!direct || direct.revision !== revision || !direct.paths[edge]) return false
    promoted = direct
    set({ directStrip: null, strip: { ...stripFixture(), paths: direct.paths, axis: direct.axis, selectedEdge: edge, pending: true } })
    return true
  })
  const previewStripDelta = vi.fn((delta: Point) => {
    if (state.strip) set({ strip: { ...state.strip, delta: [...delta] } })
  })
  const finishStripGesture = vi.fn(async (_delta: Point | null) => {
    if (state.strip && promoted && !_delta) { const direct = promoted; promoted = null; set({ strip: null, directStrip: direct }); return }
    if (state.strip) set({ strip: { ...state.strip, pending: false, delta: [0, 0, 0] } })
  })
  const owner: WorkspaceSurfaceLayerOwner = { getViewState: () => state, subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn) } },
    requestFaceSelection, selectPoints, beginPoleGesture, previewPoles, finishPoleGesture, placeNote, reportViewError,
    beginStripGesture, beginDirectStripGesture, previewStripDelta, finishStripGesture }
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
    onFrame(fn: () => void) { frameCallback = fn; return () => { frameCallback = null } },
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
    selectPoints, requestFaceSelection, beginPoleGesture, previewPoles, finishPoleGesture, placeNote, reportViewError, referenceGeometry, beforePosition,
    beginStripGesture, beginDirectStripGesture, previewStripDelta, finishStripGesture,
    overlay, frame: () => frameCallback?.(), notifyReferences: () => notifyReference?.(),
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
  expect(f.requestFaceSelection).toHaveBeenCalledWith(0)
  f.set({ placingNote: true, notePins: [[0, 0, 0]] })
  f.getLayer().click?.(300, 300, false)
  expect(f.placeNote).toHaveBeenCalledWith([0, 0, 0])
  expect(f.group.getObjectByName('tmar-edit-surface-notes')?.children).toHaveLength(1)
  layer.dispose(); layer.dispose()
  expect(f.counts().restoreCount).toBe(1)
  expect(f.group.children).toHaveLength(0)
  expect(f.overlay.children).toHaveLength(0)
})

it('requests another face from the viewport after the first is selected', async () => {
  const second = { ...mesh, positions: new Float32Array([2.1,-1,0, 2.9,-1,0, 2.9,1,0, 2.1,1,0]) }
  const f = fixture({ preview: { ...validPreview, faceMeshes: [mesh, second] } })
  const layer = createWorkspaceLayer(f.view, f.owner)
  const current = f.client([1.5,0,0]), other = f.client([2.5,0,0])
  f.getLayer().click?.(current.clientX,current.clientY,false)
  expect(f.requestFaceSelection).not.toHaveBeenCalled()
  f.getLayer().click?.(other.clientX,other.clientY,false)
  await Promise.resolve()
  expect(f.requestFaceSelection).toHaveBeenCalledOnce()
  expect(f.requestFaceSelection).toHaveBeenCalledWith(1)
  layer.dispose()
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

it('leaves an unselected automatic cell press for navigation and allows dragging it after selection', () => {
  const f = fixture(), layer = createWorkspaceLayer(f.view, f.owner)
  f.set({ selectionMode: 'auto' })
  const at = f.client([0, 0, 0])
  expect(f.getLayer().pointerDown?.(f.event(1, [0, 0, 0]))).toBe(false)
  expect(f.getLayer().click?.(at.clientX, at.clientY, false)).toBe(true)
  expect(f.selectPoints).toHaveBeenLastCalledWith(expect.arrayContaining([0, 1, 2, 3]), false)
  expect(f.getLayer().pointerDown?.(f.event(2, [0, 0, 0]))).toBe(true)
  f.getHandlers().move(f.event(2, [0.5, 0, 0]))
  expect(f.previewPoles).toHaveBeenCalled()
  f.getHandlers().up(f.event(2, [0.5, 0, 0]))
  expect(f.getLayer().click?.(590, 10, false)).toBe(true)
  expect(f.selectPoints).toHaveBeenLastCalledWith([], false)
  expect(f.getLayer().pointerDown?.(f.event(3, [0, 0, 0]))).toBe(false)
  layer.dispose()
})

it('keeps direct cell dragging in explicit cell mode and leaves modified or middle presses to navigation', () => {
  const f = fixture(), layer = createWorkspaceLayer(f.view, f.owner)
  f.set({ selectionMode: 'cells' })
  const press = f.event(1, [0, 0, 0])
  expect(f.getLayer().pointerDown?.({ ...press, button: 1 } as PointerEvent)).toBe(false)
  expect(f.getLayer().pointerDown?.({ ...press, shiftKey: true } as PointerEvent)).toBe(false)
  expect(f.getLayer().pointerDown?.(press)).toBe(true)
  f.getHandlers().move(f.event(1, [0.5, 0, 0]))
  expect(f.previewPoles).toHaveBeenCalled()
  f.getHandlers().up(f.event(1, [0.5, 0, 0]))
  layer.dispose()
})

it('clears the real net selection on an empty plain click but preserves additive selection', () => {
  expect(selectNetPoints([0, 1, 2, 3], [], false)).toEqual([])
  expect(selectNetPoints([0, 1, 2, 3], [], true)).toEqual([0, 1, 2, 3])
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

it('keeps valid snap references when another reference cannot be read', () => {
  const f = fixture({ reference: 'scan' })
  const existing = f.view.references()
  vi.spyOn(f.view, 'references').mockReturnValue([
    { ...existing[0], id: 'broken', isCurrent: () => { throw new Error('revoked') } },
    existing[0],
  ])
  const layer = createWorkspaceLayer(f.view, f.owner)
  expect(f.reportViewError).toHaveBeenCalledWith('Magnete: 1 riferimento non disponibile; gli altri restano utilizzabili.')
  expect(f.getLayer().pointerDown?.(f.event(1, [-1, -1, 0]))).toBe(true)
  f.getHandlers().move(f.event(1, [-0.1, -1, 0]))
  expect(f.previewPoles.mock.lastCall?.[0][0][0]).toBeCloseTo(0)
  expect(f.overlay.children[0].textContent).toContain('Agganciato')
  layer.dispose()
})

it('recovers one temporarily unreadable reference while keeping the others usable', () => {
  let now = 1000, unavailable = true
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
  const f = fixture({ reference: 'scan' }), existing = f.view.references()[0]
  const temporaryGeometry = existing.geometry.clone()
  const readValidGeometry = vi.spyOn(existing.geometry, 'getAttribute')
  vi.spyOn(f.view, 'references').mockReturnValue([
    { ...existing, id: 'temporary', geometry: temporaryGeometry, isCurrent: () => { if (unavailable) throw new Error('temporary'); return true } },
    { ...existing, id: 'far', partFromGeometry: new THREE.Matrix4().makeTranslation(2, 0, 0).multiply(new THREE.Matrix4().fromArray(existing.partFromGeometry)).toArray() },
  ])
  const layer = createWorkspaceLayer(f.view, f.owner)
  const initialReads = readValidGeometry.mock.calls.length
  expect(initialReads).toBeGreaterThan(0)
  expect(f.reportViewError).toHaveBeenCalledWith('Magnete: 1 riferimento non disponibile; gli altri restano utilizzabili.')
  expect(f.getLayer().pointerDown?.(f.event(1, [-1, -1, 0]))).toBe(true)
  f.getHandlers().move(f.event(1, [-0.1, -1, 0]))
  expect(f.previewPoles.mock.lastCall?.[0][0][0]).toBeCloseTo(-0.1)
  now += 500
  f.getHandlers().move(f.event(1, [-0.09, -1, 0]))
  expect(f.view.references).toHaveBeenCalledTimes(1)
  unavailable = false
  now += 600
  f.getHandlers().move(f.event(1, [-0.1, -1, 0]))
  expect(f.view.references).toHaveBeenCalledTimes(2)
  expect(readValidGeometry).toHaveBeenCalledTimes(initialReads)
  expect(f.previewPoles.mock.lastCall?.[0][0][0]).toBeCloseTo(0)
  layer.dispose(); readValidGeometry.mockRestore(); temporaryGeometry.dispose(); clock.mockRestore()
})

it('rebuilds a changed reference instead of reusing its stale transform during retry', () => {
  let now = 1000, moved = false
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
  const f = fixture({ reference: 'scan' }), existing = f.view.references()[0]
  vi.spyOn(f.view, 'references').mockImplementation(() => [
    { ...existing, id: 'temporary', isCurrent: () => { throw new Error('temporary') } },
    { ...existing, id: 'moving', revision: moved ? 2 : 1, partFromGeometry: moved ? existing.partFromGeometry :
      new THREE.Matrix4().makeTranslation(2, 0, 0).multiply(new THREE.Matrix4().fromArray(existing.partFromGeometry)).toArray() },
  ])
  const layer = createWorkspaceLayer(f.view, f.owner)
  expect(f.getLayer().pointerDown?.(f.event(1, [-1, -1, 0]))).toBe(true)
  f.getHandlers().move(f.event(1, [-0.1, -1, 0]))
  expect(f.previewPoles.mock.lastCall?.[0][0][0]).toBeCloseTo(-0.1)
  moved = true; now += 1100
  f.getHandlers().move(f.event(1, [-0.1, -1, 0]))
  expect(f.previewPoles.mock.lastCall?.[0][0][0]).toBeCloseTo(0)
  layer.dispose(); clock.mockRestore()
})

it('keeps snapping to valid references if one becomes unreadable during a drag', () => {
  const f = fixture({ reference: 'scan' })
  const existing = f.view.references()
  let revoked = false
  vi.spyOn(f.view, 'references').mockReturnValue([
    { ...existing[0], id: 'revocable', isCurrent: () => { if (revoked) throw new Error('revoked'); return true } },
    existing[0],
  ])
  const layer = createWorkspaceLayer(f.view, f.owner)
  expect(f.getLayer().pointerDown?.(f.event(1, [-1, -1, 0]))).toBe(true)
  revoked = true
  f.getHandlers().move(f.event(1, [-0.1, -1, 0]))
  f.getHandlers().move(f.event(1, [-0.08, -1, 0]))
  expect(f.previewPoles.mock.lastCall?.[0][0][0]).toBeCloseTo(0)
  expect(f.overlay.children[0].textContent).toContain('Agganciato')
  expect(f.reportViewError).toHaveBeenCalledTimes(1)
  expect(f.reportViewError).toHaveBeenCalledWith('Magnete: un riferimento non è più disponibile; gli eventuali altri restano utilizzabili.')
  layer.dispose()
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

it('recovers scan snapping after a transient reference lookup failure without a second notification', () => {
  const f = fixture({ reference: 'scan' }), layer = createWorkspaceLayer(f.view, f.owner)
  const refs = f.view.references()
  const lookup = vi.spyOn(f.view, 'references').mockImplementationOnce(() => { throw new Error('temporaneamente non disponibile') })
    .mockReturnValue(refs)
  f.notifyReferences()
  expect(f.reportViewError).toHaveBeenCalledWith('Magnete non disponibile: temporaneamente non disponibile')
  expect(f.getLayer().pointerDown?.(f.event(1, [-1, -1, 0]))).toBe(true)
  f.getHandlers().move(f.event(1, [-0.1, -1, 0]))
  expect(f.previewPoles.mock.lastCall?.[0][0][0]).toBeCloseTo(0)
  expect(f.overlay.children[0].textContent).toContain('Agganciato')
  lookup.mockRestore(); layer.dispose()
})

it('recovers snapping to a nearby CAD face after its temporary lookup failure', () => {
  let now = 1000
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
  const second = { ...mesh, positions: new Float32Array([0,-2,-2, 0,2,-2, 0,2,2, 0,-2,2]) }
  const third = { ...mesh, positions: new Float32Array([2,-2,-2, 2,2,-2, 2,2,2, 2,-2,2]) }
  const f = fixture({ reference: 'scan', preview: { ...validPreview, faceMeshes: [mesh, second, third] } })
  vi.spyOn(f.view, 'references').mockReturnValue([])
  const layer = createWorkspaceLayer(f.view, f.owner)
  f.set({ snap: false })
  const previewGroup = f.group.getObjectByName('tmar-edit-surface-preview')!
  const geometry = (previewGroup.children[1] as THREE.Mesh).geometry as THREE.BufferGeometry
  const validGeometry = (previewGroup.children[2] as THREE.Mesh).geometry as THREE.BufferGeometry
  const readValid = vi.spyOn(validGeometry, 'getAttribute')
  const original = geometry.getAttribute.bind(geometry)
  const getAttribute = vi.spyOn(geometry, 'getAttribute').mockImplementationOnce(() => { throw new Error('faccia temporaneamente non disponibile') })
    .mockImplementation(original)
  f.set({ snap: true })
  const initialReads = readValid.mock.calls.length
  expect(initialReads).toBeGreaterThan(0)
  expect(f.reportViewError).toHaveBeenCalledWith('Magnete non disponibile: faccia temporaneamente non disponibile')
  expect(f.getLayer().pointerDown?.(f.event(1, [-1, -1, 0]))).toBe(true)
  now += 1100
  f.getHandlers().move(f.event(1, [-0.1, -1, 0]))
  expect(readValid).toHaveBeenCalledTimes(initialReads)
  expect(f.previewPoles.mock.lastCall?.[0][0][0]).toBeCloseTo(0)
  expect(f.overlay.children[0].textContent).toContain('Faccia CAD 2')
  getAttribute.mockRestore(); readValid.mockRestore(); layer.dispose(); clock.mockRestore()
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

it.each([
  { axis: 0 as const, destination: [0.5, -1, 0] as Point, rotated: false, oblique: false, perspective: false },
  { axis: 1 as const, destination: [0, -0.5, 0] as Point, rotated: true, oblique: false, perspective: false },
  { axis: 2 as const, destination: [0, -1, 0.5] as Point, rotated: false, oblique: true, perspective: false },
  { axis: 0 as const, destination: [0.5, -1, 0] as Point, rotated: true, oblique: true, perspective: true },
])('constrains the D handle to part axis $axis and commits the resulting delta', ({ axis, destination, rotated, oblique, perspective }) => {
  const f = fixture({ rotated, oblique, perspective }), layer = createWorkspaceLayer(f.view, f.owner)
  const strip = { ...stripFixture(), selectedEdge: 0, axis }, original = JSON.stringify(strip.paths)
  f.set({ net: null, strip }); f.frame()
  const handle = f.overlay.children.find(item => item.dataset.test === 'surface-strip-handle')!
  expect(handle.style.display).toBe('block')
  const start = f.client([0, -1, 0]), target = f.client(destination)
  const x = Number.parseFloat(handle.style.left), y = Number.parseFloat(handle.style.top)
  const event = (id: number, clientX: number, clientY: number) => ({ pointerId: id, button: 0, shiftKey: false,
    ctrlKey: false, metaKey: false, altKey: false, clientX, clientY, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as PointerEvent)
  const down = event(1, x, y)
  handle.dispatch('pointerdown', down)
  expect(down.preventDefault).toHaveBeenCalledOnce()
  expect(f.counts().captured).toBe(1)
  const end = event(1, x + target.clientX - start.clientX, y + target.clientY - start.clientY)
  f.getHandlers().move(end)
  const delta = f.previewStripDelta.mock.lastCall?.[0]
  expect(delta?.[axis]).toBeCloseTo(0.5)
  for (let i = 0; i < 3; i++) if (i !== axis) expect(delta?.[i]).toBeCloseTo(0)
  f.frame()
  expect(Number.parseFloat(handle.style.left)).toBeCloseTo(x + target.clientX - start.clientX)
  expect(Number.parseFloat(handle.style.top)).toBeCloseTo(y + target.clientY - start.clientY)
  f.getHandlers().up(end)
  expect(f.finishStripGesture.mock.lastCall?.[0]?.[axis]).toBeCloseTo(0.5)
  expect(f.counts().captured).toBeNull()
  expect(JSON.stringify(strip.paths)).toBe(original)
  layer.dispose()
  expect(f.overlay.children).toHaveLength(0)
})

it.each([false, true])('rejects an axis aligned or almost aligned to the view (%s) with a useful message', nearAligned => {
  const f = fixture({ nearAligned }), layer = createWorkspaceLayer(f.view, f.owner)
  const strip = { ...stripFixture(), selectedEdge: 0, axis: 2 as const }
  f.set({ net: null, strip }); f.frame()
  const handle = f.overlay.children.find(item => item.dataset.test === 'surface-strip-handle')!
  const event = { pointerId: 1, button: 0, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
    clientX: Number.parseFloat(handle.style.left), clientY: Number.parseFloat(handle.style.top),
    preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as PointerEvent
  handle.dispatch('pointerdown', event)
  expect(f.reportViewError).toHaveBeenCalledWith('Direzione allineata alla vista: ruota il modello o scegli un altro asse.')
  expect(f.counts().captured).toBeNull()
  expect(f.beginStripGesture).not.toHaveBeenCalled()
  f.set({ strip: { ...strip, axis: 0 } }); f.frame()
  handle.dispatch('pointerdown', event)
  expect(f.counts().captured).toBe(1)
  expect(layer.cancelGesture()).toBe(true)
  expect(f.finishStripGesture).toHaveBeenCalledWith(null)
  expect(f.counts().captured).toBeNull()
  layer.dispose()
})

it('shows D on a direct free-edge click, promotes only when D is dragged and returns to the poles on cancel', () => {
  const f = fixture(), layer = createWorkspaceLayer(f.view, f.owner)
  const direct = { paths: stripFixture().paths, revision: 123, axis: 0 as const }
  f.set({ directStrip: direct })
  expect(f.getLayer().pointerDown?.(f.event(1, [0, -1, 0]))).toBe(true)
  const handle = f.overlay.children.find(item => item.dataset.test === 'surface-strip-handle')!
  expect(handle.style.display).toBe('block')
  expect(handle.dataset.edge).toBe('0'); expect(handle.dataset.revision).toBe('123')
  expect(f.group.getObjectByName('tmar-selected-strip-edge')).toBeDefined()
  expect(f.owner.getViewState().strip).toBeFalsy()
  expect(f.beginDirectStripGesture).not.toHaveBeenCalled()
  expect(f.counts().captured).toBeNull()
  const down = { pointerId: 7, button: 0, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
    clientX: Number.parseFloat(handle.style.left), clientY: Number.parseFloat(handle.style.top),
    preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as PointerEvent
  handle.dispatch('pointerdown', down)
  expect(f.beginDirectStripGesture).toHaveBeenCalledOnce()
  expect(f.beginDirectStripGesture).toHaveBeenCalledWith(0, 123)
  expect(f.counts().captured).toBe(7)
  f.getHandlers().move({ ...down, clientX: down.clientX + 50, clientY: down.clientY - 80 } as PointerEvent)
  const delta = f.previewStripDelta.mock.lastCall?.[0]
  expect(delta?.[0]).toBeCloseTo(0.5); expect(delta?.[1]).toBeCloseTo(0); expect(delta?.[2]).toBeCloseTo(0)
  f.interrupt()
  expect(f.finishStripGesture).toHaveBeenCalledWith(null)
  expect(f.counts().captured).toBeNull()
  expect(handle.style.display).toBe('none')
  expect(f.getLayer().pointerDown?.(f.event(2, [0, -1, 0]))).toBe(true)
  expect(handle.style.display).toBe('block')
  layer.dispose()
})

it('preserves net-edge selection alongside D and gives individual poles precedence', () => {
  const f = fixture(), layer = createWorkspaceLayer(f.view, f.owner)
  f.set({ directStrip: { paths: stripFixture().paths, revision: 1, axis: 0 }, selectionMode: 'auto' })
  const handle = f.overlay.children.find(item => item.dataset.test === 'surface-strip-handle')!
  expect(f.getLayer().pointerDown?.(f.event(1, [0, -1, 0]))).toBe(true)
  expect(f.selectPoints).toHaveBeenCalledWith([0, 2], false)
  expect(handle.style.display).toBe('block')
  const original = f.event(1, [0, -1, 0])
  f.getHandlers().move({ ...original, clientX: original.clientX + 3 } as PointerEvent)
  expect(f.beginPoleGesture).not.toHaveBeenCalled()
  f.getHandlers().up({ ...original, clientX: original.clientX + 3 } as PointerEvent)
  expect(f.beginPoleGesture).not.toHaveBeenCalled()
  expect(f.finishPoleGesture).not.toHaveBeenCalled()
  expect(f.counts().captured).toBeNull()
  expect(handle.style.display).toBe('block')
  f.set({ selectionMode: 'points' })
  expect(f.getLayer().pointerDown?.(f.event(2, [-1, -1, 0]))).toBe(true)
  expect(f.selectPoints).toHaveBeenLastCalledWith([0], false)
  expect(handle.style.display).toBe('none')
  expect(f.beginPoleGesture).toHaveBeenCalledOnce()
  expect(layer.cancelGesture()).toBe(true)
  layer.dispose()
})

it('starts a coincident net drag only at 4 pixels and finishes even when released outside the viewport', () => {
  const f = fixture(), layer = createWorkspaceLayer(f.view, f.owner)
  f.set({ directStrip: { paths: stripFixture().paths, revision: 1, axis: 0 }, selectionMode: 'auto' })
  const down = f.event(1, [0, -1, 0]), handle = f.overlay.children.find(item => item.dataset.test === 'surface-strip-handle')!
  expect(f.getLayer().pointerDown?.(down)).toBe(true)
  f.getHandlers().move({ ...down, clientX: down.clientX + 3 } as PointerEvent)
  expect(f.beginPoleGesture).not.toHaveBeenCalled()
  f.getHandlers().move({ ...down, clientX: down.clientX + 4 } as PointerEvent)
  expect(f.beginPoleGesture).toHaveBeenCalledOnce()
  expect(f.previewPoles).toHaveBeenCalledOnce()
  expect(handle.style.display).toBe('none') // The preview changed; old direct edges are invalid.
  f.getHandlers().up({ ...down, clientX: 700 } as PointerEvent)
  expect(f.finishPoleGesture).toHaveBeenCalledOnce()
  expect(f.finishPoleGesture.mock.lastCall?.[0]).not.toBeNull()
  expect(f.counts().captured).toBeNull()
  layer.dispose()
})

it('releases a deferred pointer on lost capture or Escape and preserves Ctrl/Meta selection routing', () => {
  const f = fixture(), layer = createWorkspaceLayer(f.view, f.owner)
  f.set({ directStrip: { paths: stripFixture().paths, revision: 1, axis: 0 }, selectionMode: 'auto' })
  const down = f.event(1, [0, -1, 0])
  expect(f.getLayer().pointerDown?.({ ...down, ctrlKey: true } as PointerEvent)).toBe(false)
  expect(f.getLayer().pointerDown?.({ ...down, metaKey: true } as PointerEvent)).toBe(false)
  expect(f.counts().captured).toBeNull()
  expect(f.getLayer().pointerDown?.(down)).toBe(true)
  f.getHandlers().lostCapture(down)
  expect(f.counts().captured).toBeNull()
  expect(f.beginPoleGesture).not.toHaveBeenCalled()
  expect(f.finishPoleGesture).not.toHaveBeenCalled()
  expect(f.getLayer().pointerDown?.(f.event(2, [0, -1, 0]))).toBe(true)
  expect(layer.cancelGesture()).toBe(true)
  expect(f.counts().captured).toBeNull()
  expect(f.beginPoleGesture).not.toHaveBeenCalled()
  expect(f.finishPoleGesture).not.toHaveBeenCalled()
  layer.dispose()
})

it('clears the local direct selection on revision, paths, note mode and lease interruption', () => {
  const f = fixture(), layer = createWorkspaceLayer(f.view, f.owner)
  const direct = { paths: stripFixture().paths, revision: 11, axis: 0 as const }
  f.set({ directStrip: direct })
  const handle = f.overlay.children.find(item => item.dataset.test === 'surface-strip-handle')!
  const select = () => { expect(f.getLayer().pointerDown?.(f.event(1, [0, -1, 0]))).toBe(true); expect(handle.style.display).toBe('block') }
  select()
  f.set({ directStrip: { ...direct, axis: 1 } })
  expect(handle.style.display).toBe('block') // An axis change does not replace the border.
  f.set({ directStrip: { ...direct, revision: 12 } })
  expect(handle.style.display).toBe('none')
  f.set({ directStrip: direct })
  expect(handle.style.display).toBe('none') // The old selection cannot revive.
  select()
  f.set({ directStrip: { ...direct, paths: [...direct.paths] } })
  expect(handle.style.display).toBe('none')
  f.set({ directStrip: direct }); select()
  f.set({ placingNote: true }); expect(handle.style.display).toBe('none')
  f.set({ placingNote: false }); expect(handle.style.display).toBe('none')
  select(); f.interrupt(); expect(handle.style.display).toBe('none')
  select()
  layer.dispose()
  expect(f.overlay.children).toHaveLength(0)
})

it('hides D for unselected, clipped or disposed borders and cancels the captured drag on interruption', () => {
  const f = fixture(), layer = createWorkspaceLayer(f.view, f.owner)
  const strip = { ...stripFixture(), selectedEdge: 0, axis: 0 as const }
  f.set({ net: null, strip: { ...strip, selectedEdge: -1 } }); f.frame()
  const handle = f.overlay.children.find(item => item.dataset.test === 'surface-strip-handle')!
  expect(handle.style.display).toBe('none')
  f.set({ strip }); f.frame(); expect(handle.style.display).toBe('block')
  f.getLayer().clippingChanged?.([new THREE.Plane(new THREE.Vector3(0, 0, 1), -1)], false)
  expect(handle.style.display).toBe('none')
  f.getLayer().clippingChanged?.(null, false); f.frame(); expect(handle.style.display).toBe('block')
  const down = { pointerId: 7, button: 0, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
    clientX: Number.parseFloat(handle.style.left), clientY: Number.parseFloat(handle.style.top),
    preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as PointerEvent
  handle.dispatch('pointerdown', down)
  f.getHandlers().move({ ...down, clientX: down.clientX + 50 } as PointerEvent)
  expect(f.previewStripDelta).toHaveBeenCalled()
  f.getHandlers().up({ ...down, pointerId: 8 } as PointerEvent)
  expect(f.counts().captured).toBe(7)
  f.interrupt()
  expect(f.finishStripGesture).toHaveBeenCalledWith(null)
  expect(f.counts().captured).toBeNull()
  layer.dispose()
  expect(f.overlay.children).toHaveLength(0)
  handle.dispatch('pointerdown', down) // The listener has been removed.
  expect(f.beginStripGesture).toHaveBeenCalledOnce()
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
  expect(f.requestFaceSelection).not.toHaveBeenCalled()
  expect(f.counts().captured).toBeNull()
  layer.dispose()
})
