// SPDX-License-Identifier: AGPL-3.0-only
// Unit fixture for the lease contract. This does not qualify the real host UI.
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { describe, expect, it, vi } from 'vitest'
import type { Net, Point } from '../brep'
import type {BoundaryCadCandidate,VerifiedBoundaryPick} from '../boundaryVisibilityCad'
import type { Preview } from '../editorKernel'
import type { VerifiedWholeFacePick, WorkspaceStripViewState, WorkspaceSurfaceLayerOwner, WorkspaceSurfaceView, WorkspaceSurfaceViewState } from '../workspaceBridge'
import { createWorkspaceLayer } from '../workspaceLayer'
import { selectNetPoints } from '../netSelection'
import { SurfaceEditorKernel } from '../editorKernel'
import { wholeBoundaryPath } from '../wholeBoundary'
import { pickSheetEdge } from '../sheetDrag'
import { readFileSync,writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

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

function fixture(options: { reference?: 'scan' | 'cad-face'; rotated?: boolean; oblique?: boolean; nearAligned?: boolean; perspective?: boolean; preview?: Preview | null; worldOffset?:number } = {}) {
  const host = new THREE.Group(), group = new THREE.Group()
  host.add(group)
  if (options.rotated) { host.rotation.z = Math.PI / 2; host.position.set(5, -3, 2) }
  if(options.worldOffset)host.position.add(new THREE.Vector3(options.worldOffset,-options.worldOffset,options.worldOffset))
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
  const claimEditDrag = vi.fn()
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
  const setQuiet = (patch: Partial<WorkspaceSurfaceViewState>) => { state = { ...state, ...patch } }
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
  owner.prepareWholeBoundaryPicks=vi.fn(async(_net:Net,candidates:BoundaryCadCandidate[])=>candidates.map(c=>({side:c.side,point:[...c.seed] as Point})))
  owner.beginVerifiedWholeBoundaryGesture=vi.fn(pick=>owner.beginWholeBoundaryGesture?.(pick.side)??false)
  owner.cancelPreparedWholeBoundaryPicks=vi.fn()
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
    hasPointerCapture: (id: number) => captured === id, claimEditDrag, invalidate: () => {},
  } as unknown as WorkspaceSurfaceView
  const client = (p: Point) => view.projectPartPoint(p)
  const event = (id: number, p: Point, altKey = false): PointerEvent => ({ pointerId: id, button: 0, shiftKey: false, ctrlKey: false, metaKey: false,
    altKey, ...client(p) } as unknown as PointerEvent)
  const getLayer = () => layer as unknown as NonNullable<typeof layer>
  const getHandlers = () => handlers as unknown as NonNullable<typeof handlers>
  return { view, owner, set, setQuiet, net, group, rect, client, event, getLayer, getHandlers, counts: () => ({ maskCount, restoreCount, captured }),
    selectPoints, requestFaceSelection, beginPoleGesture, previewPoles, finishPoleGesture, placeNote, reportViewError, reference, referenceGeometry, beforePosition, claimEditDrag,
    beginStripGesture, beginDirectStripGesture, previewStripDelta, finishStripGesture,
    overlay, frame: () => frameCallback?.(), notifyReferences: () => notifyReference?.(),
    invalidateReference: () => { referenceCurrent = false; notifyReference?.() }, interrupt: () => interrupted?.() }
}
function putLayersInReference(f: ReturnType<typeof fixture>, depths: readonly number[]) {
  const layers = depths.map(z => new THREE.PlaneGeometry(10,10).translate(0,0,z))
  const merged = mergeGeometries(layers)!
  f.referenceGeometry.copy(merged)
  merged.dispose()
  layers.forEach(layer => layer.dispose())
}

it('renders only current G1 CAD geometry in part coordinates without intercepting picks', () => {
  const f = fixture({rotated:true})
  const layer = createWorkspaceLayer(f.view,f.owner)
  const preview = {...validPreview,previewRevision:4}
  const candidate = {kind:'compatible-bspline' as const,id:'g1',stamp:{sourceId:'source',sourceRevision:1,selectionRevision:2,faceIndex:0},
    supportFaceIndex:1,edgeIndex:0,side:'uMin' as const,supportSide:'uMax' as const,reverseSupport:false,lengthMm:2}
  const result = {choice:candidate,previewRevision:4,supportMesh:mesh,seam:[[0,-1,0],[0,1,0]] as [Point,Point]}
  f.set({preview,g1CurvedSupportGeometry:result})
  const group = f.group.getObjectByName('tmar-edit-surface-g1-support')!
  expect(group.children).toHaveLength(2)
  expect(group.parent).toBe(f.group)
  f.group.updateWorldMatrix(true,true)
  expect(group.localToWorld(new THREE.Vector3(1,2,0))).toEqual(f.group.localToWorld(new THREE.Vector3(1,2,0)))
  const ray = new THREE.Raycaster()
  ray.setFromCamera(new THREE.Vector2(0,0),f.view.camera())
  expect(ray.intersectObjects(group.children,false)).toEqual([])
  const materials = group.children.map(child => (child as THREE.Mesh<THREE.BufferGeometry,THREE.Material>).material)
  expect(materials.every(material => material.depthTest && !material.depthWrite)).toBe(true)
  const clipping = new THREE.Plane(new THREE.Vector3(0,0,1),.5)
  f.getLayer().clippingChanged?.([clipping],false)
  expect(materials.every(material => material.clippingPlanes?.[0] === clipping)).toBe(true)

  const disposeGeometry = vi.spyOn((group.children[0] as THREE.Mesh).geometry,'dispose')
  f.set({preview:{...preview,previewRevision:5}})
  expect(group.children).toHaveLength(0)
  expect(disposeGeometry).toHaveBeenCalledTimes(1)
  f.set({g1CurvedSupportGeometry:{...result,previewRevision:5}})
  expect(group.children).toHaveLength(2)
  f.set({face:1})
  expect(group.children).toHaveLength(0)
  f.set({face:0,g1CurvedSupportGeometry:{...result,previewRevision:5,supportMesh:{} as Preview['mesh']}})
  expect(group.children).toHaveLength(0)
  expect(f.group.getObjectByName('tmar-edit-surface-preview')?.children).toHaveLength(1)
  layer.dispose()
  expect(group.parent).toBeNull()
})

it('uses the visible face interior for whole-face translation and leaves space outside it to navigation', () => {
  const f = fixture({ reference:'scan' })
  f.reference.partFromGeometry = new THREE.Matrix4().makeTranslation(0,0,-1).toArray()
  f.set({ wholeFaceDrag:{ canStart:true }, showNet:false, dragMode:'screen' })
  f.owner.beginWholeFaceGesture = vi.fn(() => true)
  const layer = createWorkspaceLayer(f.view, f.owner)
  f.set({ dragMode:'local' })
  expect(f.getLayer().pointerDown?.(f.event(1,[0,0,0]))).toBe(false)
  expect(f.owner.beginWholeFaceGesture).not.toHaveBeenCalled()
  expect(f.counts().captured).toBeNull()
  f.set({ dragMode:'screen' })
  expect(f.getLayer().pointerDown?.(f.event(1,[2.5,2.5,0]))).toBe(false)
  expect(f.getLayer().pointerDown?.(f.event(1,[0,0,0]))).toBe(true)
  expect(f.owner.beginWholeFaceGesture).toHaveBeenCalledWith(f.net)
  expect(f.beginPoleGesture).not.toHaveBeenCalled()
  expect(f.selectPoints).not.toHaveBeenCalled()
  f.getHandlers().move(f.event(1,[.1,.15,0]))
  f.getHandlers().up(f.event(1,[.1,.15,0]))
  const moved = f.finishPoleGesture.mock.calls[0][0]!
  moved.forEach((pole, i) => {
    expect(pole[0] - f.net.poles[i][0]).toBeCloseTo(.1)
    expect(pole[1] - f.net.poles[i][1]).toBeCloseTo(.15)
    expect(pole[2] - f.net.poles[i][2]).toBeCloseTo(0)
  })
  expect(f.counts().captured).toBeNull()

  f.set({ locked:[0] })
  expect(f.getLayer().pointerDown?.(f.event(2,[0,0,0]))).toBe(false)
  expect(f.owner.beginWholeFaceGesture).toHaveBeenCalledTimes(1)
  f.set({ locked:[] })
  expect(f.getLayer().pointerDown?.(f.event(3,[0,0,0]))).toBe(true)
  f.getHandlers().cancel(f.event(3,[0,0,0]))
  expect(f.finishPoleGesture).toHaveBeenLastCalledWith(null)
  expect(f.counts().captured).toBeNull()

  // The controller releases the mode-owned selection before normal picking resumes.
  f.set({ wholeFaceDrag:null, selected:[], snap:false, showNet:true })
  expect(f.getLayer().pointerDown?.(f.event(4,f.net.poles[0]))).toBe(true)
  f.getHandlers().up(f.event(4,[-.9,-.85,0]))
  const singlePole = f.finishPoleGesture.mock.lastCall![0]!
  expect(singlePole[0]).not.toEqual(f.net.poles[0])
  expect(singlePole.slice(1)).toEqual(f.net.poles.slice(1))
  layer.dispose()
})

const flushBoundaryPick=async()=>{for(let i=0;i<8;i++)await Promise.resolve()}

it.each([
  ['screen','scan','front',1,true,false],
  ['axis','cad-face','front',1,true,false],
  ['local','scan','front',1,true,false],
  ['screen','cad-face','behind',-1,true,true],
  ['axis','scan','hidden',1,false,true],
  ['screen','scan','clipped',1,true,true],
  ['local','cad-face','behind',-1,true,true],
  ['local','scan','hidden',1,false,true],
  ['screen','scan','nearly coincident',-0.000001,true,false],
] as const)('checks %s whole-face occlusion with %s %s and snap disabled', async (dragMode, referenceKind, placement, z, visible, accepted) => {
  const f = fixture({ reference:referenceKind })
  f.reference.partFromGeometry = new THREE.Matrix4().makeTranslation(0,0,z).toArray()
  f.reference.visible = visible
  f.set({ wholeFaceDrag:{canStart:true}, dragMode, snap:false })
  f.owner.beginWholeFaceGesture = vi.fn(() => true)
  f.owner.prepareWholeFacePick = vi.fn(async () => ({point:[0,0,0] as Point,direction:[1,0,0] as Point}))
  f.owner.beginVerifiedWholeFaceGesture = vi.fn(() => true)
  f.owner.cancelPreparedWholeFacePick = vi.fn()
  const layer = createWorkspaceLayer(f.view, f.owner), press = f.event(1,[0,0,0])
  if (placement === 'clipped') f.getLayer().clippingChanged?.([new THREE.Plane(new THREE.Vector3(0,0,-1),.5)],false)
  expect(f.getLayer().pointerDown?.(press)).toBe(accepted)
  await flushBoundaryPick()
  if (accepted) {
    if (dragMode === 'local') expect(f.owner.beginVerifiedWholeFaceGesture).toHaveBeenCalledTimes(1)
    else expect(f.owner.beginWholeFaceGesture).toHaveBeenCalledTimes(1)
    f.getHandlers().up(press)
  } else {
    expect(f.owner.prepareWholeFacePick).not.toHaveBeenCalled()
    expect(f.owner.beginWholeFaceGesture).not.toHaveBeenCalled()
    expect(f.reportViewError).toHaveBeenCalledWith(expect.stringContaining('coperta'))
  }
  expect(f.counts().captured).toBeNull()
  layer.dispose()
})

it('fails closed before capturing a whole-face press when a visible reference has no triangles', () => {
  const f = fixture({reference:'scan'})
  f.reference.geometry = new THREE.BufferGeometry() as THREE.PlaneGeometry
  f.set({ wholeFaceDrag:{canStart:true}, dragMode:'screen', snap:false })
  f.owner.beginWholeFaceGesture = vi.fn(() => true)
  const layer = createWorkspaceLayer(f.view, f.owner)
  expect(f.getLayer().pointerDown?.(f.event(1,[0,0,0]))).toBe(false)
  expect(f.counts().captured).toBeNull()
  expect(f.owner.beginWholeFaceGesture).not.toHaveBeenCalled()
  layer.dispose()
})

it.each(['reference moved','visibility changed','CAD hit is deeper'] as const)('refuses pending Local whole-face promotion when %s', async cause => {
  const f = fixture({reference:'cad-face'})
  f.reference.partFromGeometry = new THREE.Matrix4().makeTranslation(0,0,-.05).toArray()
  f.set({ wholeFaceDrag:{canStart:true}, dragMode:'local', snap:false })
  let resolve!: (value: VerifiedWholeFacePick) => void
  f.owner.prepareWholeFacePick = vi.fn(() => new Promise<VerifiedWholeFacePick>(r => { resolve = r }))
  f.owner.beginVerifiedWholeFaceGesture = vi.fn(() => true)
  f.owner.cancelPreparedWholeFacePick = vi.fn()
  const layer = createWorkspaceLayer(f.view, f.owner)
  expect(f.getLayer().pointerDown?.(f.event(1,[0,0,0]))).toBe(true)
  expect(f.counts().captured).toBe(1)
  if (cause === 'reference moved') f.reference.partFromGeometry = new THREE.Matrix4().makeTranslation(0,0,.05).toArray()
  if (cause === 'visibility changed') {
    f.reference.visible = false
    f.notifyReferences()
    expect(f.counts().captured).toBeNull()
    f.reference.visible = true
    f.notifyReferences()
  }
  resolve({ point:[0,0,cause === 'CAD hit is deeper' ? -.1 : 0], direction:[1,0,0] })
  await flushBoundaryPick()
  expect(f.owner.beginVerifiedWholeFaceGesture).not.toHaveBeenCalled()
  expect(f.owner.cancelPreparedWholeFacePick).toHaveBeenCalledTimes(1)
  expect(f.counts().captured).toBeNull()
  layer.dispose()
})

it('uses the verified Local axis and translates every pole after the CAD reply', async () => {
  const f = fixture()
  f.set({ wholeFaceDrag:{canStart:true}, dragMode:'local' })
  const pick = {point:[0,0,0] as Point, direction:[0,1,0] as Point}
  f.owner.prepareWholeFacePick = vi.fn(async () => pick)
  f.owner.beginVerifiedWholeFaceGesture = vi.fn(() => true)
  f.owner.cancelPreparedWholeFacePick = vi.fn()
  const layer = createWorkspaceLayer(f.view, f.owner)
  expect(f.getLayer().pointerDown?.(f.event(1,[0,0,0]))).toBe(true)
  expect(f.owner.beginVerifiedWholeFaceGesture).not.toHaveBeenCalled()
  f.getHandlers().move(f.event(1,[.2,.15,0]))
  expect(f.previewPoles).not.toHaveBeenCalled()
  await flushBoundaryPick()
  expect(f.owner.prepareWholeFacePick).toHaveBeenCalledWith(f.net, {seed:[0,0,0],origin:[0,0,expect.closeTo(10,12)],direction:[0,0,-1]})
  expect(f.owner.beginVerifiedWholeFaceGesture).toHaveBeenCalledWith(pick)
  expect(f.previewPoles).toHaveBeenCalledTimes(1)
  f.getHandlers().up(f.event(1,[.2,.15,0]))
  const moved = f.finishPoleGesture.mock.lastCall![0]!
  moved.forEach(([x,y,z], i) => {
    expect(x).toBeCloseTo(f.net.poles[i][0])
    expect(y).toBeCloseTo(f.net.poles[i][1]+.15)
    expect(z).toBeCloseTo(f.net.poles[i][2])
  })
  expect(f.counts().captured).toBeNull()
  layer.dispose()
})

it.each([
  'up','escape','lostCapture','camera','clipping','axis','dragMode','strength','canStart','lock','hidden','resize','projection',
] as const)('ignores a pending Local face hit after %s', async change => {
  const f = fixture()
  f.set({wholeFaceDrag:{canStart:true}, dragMode:'local'})
  let resolve!: (pick:VerifiedWholeFacePick) => void
  f.owner.prepareWholeFacePick = vi.fn(() => new Promise<VerifiedWholeFacePick>(r => { resolve = r }))
  f.owner.beginVerifiedWholeFaceGesture = vi.fn(() => true)
  f.owner.cancelPreparedWholeFacePick = vi.fn()
  const layer = createWorkspaceLayer(f.view, f.owner), down = f.event(1,[0,0,0])
  expect(f.getLayer().pointerDown?.(down)).toBe(true)
  if (change === 'up') f.getHandlers().up(down)
  if (change === 'escape') layer.cancelGesture()
  if (change === 'lostCapture') f.getHandlers().lostCapture(down)
  if (change === 'camera') { f.view.camera().position.x++; f.view.camera().updateMatrixWorld(true); f.frame() }
  if (change === 'clipping') f.getLayer().clippingChanged?.([new THREE.Plane(new THREE.Vector3(0,1,0),0)],false)
  if (change === 'axis') f.set({axis:2})
  if (change === 'dragMode') f.set({dragMode:'screen'})
  if (change === 'strength') f.set({dragStrength:.5})
  if (change === 'canStart') f.set({wholeFaceDrag:{canStart:false}})
  if (change === 'lock') f.set({locked:[0]})
  if (change === 'hidden') f.set({hiddenPoles:[0]})
  if (change === 'resize') { f.rect.width -= 20; f.frame() }
  if (change === 'projection') {
    const camera = f.view.camera() as THREE.OrthographicCamera
    camera.zoom *= 1.1
    camera.updateProjectionMatrix()
    f.frame()
  }
  expect(f.counts().captured).toBeNull()
  resolve({point:[0,0,0],direction:[0,1,0]})
  await flushBoundaryPick()
  expect(f.owner.beginVerifiedWholeFaceGesture).not.toHaveBeenCalled()
  expect(f.finishPoleGesture).not.toHaveBeenCalled()
  expect(f.owner.cancelPreparedWholeFacePick).toHaveBeenCalledTimes(1)
  layer.dispose()
})

it('ignores a rejected old Local pick while the same mouse holds a newer request', async () => {
  const f = fixture()
  f.set({wholeFaceDrag:{canStart:true}, dragMode:'local'})
  let rejectOld!: (error:Error) => void
  let resolveNew!: (pick:VerifiedWholeFacePick) => void
  f.owner.prepareWholeFacePick = vi.fn()
    .mockImplementationOnce(() => new Promise<VerifiedWholeFacePick>((_resolve,reject) => { rejectOld = reject }))
    .mockImplementationOnce(() => new Promise<VerifiedWholeFacePick>(resolve => { resolveNew = resolve }))
  f.owner.beginVerifiedWholeFaceGesture = vi.fn(() => true)
  f.owner.cancelPreparedWholeFacePick = vi.fn()
  const layer = createWorkspaceLayer(f.view, f.owner), down = f.event(1,[0,0,0])
  expect(f.getLayer().pointerDown?.(down)).toBe(true)
  f.getHandlers().up(down)
  expect(f.getLayer().pointerDown?.(down)).toBe(true)
  rejectOld(new Error('old CAD request'))
  await flushBoundaryPick()
  expect(f.counts().captured).toBe(1)
  expect(f.reportViewError).not.toHaveBeenCalled()
  resolveNew({point:[0,0,0],direction:[0,1,0]})
  await flushBoundaryPick()
  expect(f.owner.beginVerifiedWholeFaceGesture).toHaveBeenCalledTimes(1)
  f.getHandlers().up(f.event(1,[0,.15,0]))
  expect(f.finishPoleGesture).toHaveBeenCalledTimes(1)
  layer.dispose()
})

it.each(['up','escape','view','draft','navigation','dispose'] as const)('discards a late native boundary response after %s and releases only its capture',async change=>{
  const f=fixture();f.owner.beginWholeBoundaryGesture=vi.fn(()=>true)
  let resolve!:(value:readonly import('../boundaryVisibilityCad').VerifiedBoundaryPick[])=>void
  f.owner.prepareWholeBoundaryPicks=vi.fn(()=>new Promise<readonly VerifiedBoundaryPick[]>(r=>{resolve=r}))
  const layer=createWorkspaceLayer(f.view,f.owner)
  f.set({wholeBoundaryDrag:{side:'U0',canStart:true}})
  const press=f.event(1,[-1,0,0]);expect(f.getLayer().pointerDown?.(press)).toBe(true)
  expect(f.owner.beginWholeBoundaryGesture).not.toHaveBeenCalled()
  expect(f.getLayer().pointerDown?.(f.event(2,[.5,0,0]))).toBe(false)
  if(change==='up')f.getHandlers().up(press)
  if(change==='escape')layer.cancelGesture()
  if(change==='view'){f.view.camera().position.x+=1;f.view.camera().updateMatrixWorld(true);f.getHandlers().move(press)}
  if(change==='draft')f.set({net:structuredClone(f.net)})
  if(change==='navigation')f.set({navigationOnly:true})
  if(change==='dispose')layer.dispose()
  resolve([{side:'U0',point:[-1,0,0]}]);await flushBoundaryPick()
  expect(f.owner.beginWholeBoundaryGesture).not.toHaveBeenCalled();expect(f.previewPoles).not.toHaveBeenCalled()
  expect(f.counts().captured).toBeNull();expect(f.owner.cancelPreparedWholeBoundaryPicks).toHaveBeenCalled()
  layer.dispose()
})

it.each(['dragMode','axis','strength','canStart'] as const)('cancels a pending boundary pick immediately when %s changes',async change=>{
  const f=fixture();f.owner.beginWholeBoundaryGesture=vi.fn(()=>true)
  let resolve!:(value:readonly VerifiedBoundaryPick[])=>void
  f.owner.prepareWholeBoundaryPicks=vi.fn(()=>new Promise<readonly VerifiedBoundaryPick[]>(r=>{resolve=r}))
  const layer=createWorkspaceLayer(f.view,f.owner);f.set({wholeBoundaryDrag:{side:'U0',canStart:true},snap:false})
  expect(f.getLayer().pointerDown?.(f.event(1,[-1,0,0]))).toBe(true)
  if(change==='dragMode')f.set({dragMode:'screen'})
  if(change==='axis')f.set({axis:1})
  if(change==='strength')f.set({dragStrength:.5})
  if(change==='canStart')f.set({wholeBoundaryDrag:{side:'U0',canStart:false}})
  expect(f.counts().captured).toBeNull()
  expect(f.owner.cancelPreparedWholeBoundaryPicks).toHaveBeenCalledOnce()
  resolve([{side:'U0',point:[-1,0,0]}]);await flushBoundaryPick()
  expect(f.owner.beginWholeBoundaryGesture).not.toHaveBeenCalled()
  expect(f.previewPoles).not.toHaveBeenCalled()
  layer.dispose()
})

it.each(['dragMode','axis','strength'] as const)('rejects a late boundary reply if %s changed without a sync notification',async change=>{
  const f=fixture();f.owner.beginWholeBoundaryGesture=vi.fn(()=>true)
  let resolve!:(value:readonly VerifiedBoundaryPick[])=>void
  f.owner.prepareWholeBoundaryPicks=vi.fn(()=>new Promise<readonly VerifiedBoundaryPick[]>(r=>{resolve=r}))
  const layer=createWorkspaceLayer(f.view,f.owner);f.set({wholeBoundaryDrag:{side:'U0',canStart:true},snap:false})
  expect(f.getLayer().pointerDown?.(f.event(1,[-1,0,0]))).toBe(true)
  if(change==='dragMode')f.setQuiet({dragMode:'screen'})
  if(change==='axis')f.setQuiet({axis:1})
  if(change==='strength')f.setQuiet({dragStrength:.5})
  resolve([{side:'U0',point:[-1,0,0]}]);await flushBoundaryPick()
  expect(f.owner.beginWholeBoundaryGesture).not.toHaveBeenCalled()
  expect(f.previewPoles).not.toHaveBeenCalled()
  expect(f.owner.cancelPreparedWholeBoundaryPicks).toHaveBeenCalledOnce()
  expect(f.counts().captured).toBeNull()
  layer.dispose()
})

it('keeps a newer gesture with the same mouse pointer when an older native request rejects',async()=>{
  const f=fixture();f.owner.beginWholeBoundaryGesture=vi.fn(()=>true)
  let reject!:(reason:Error)=>void
  f.owner.prepareWholeBoundaryPicks=vi.fn(()=>new Promise<readonly VerifiedBoundaryPick[]>((_resolve,r)=>{reject=r}))
  const layer=createWorkspaceLayer(f.view,f.owner);f.set({wholeBoundaryDrag:{side:'U0',canStart:true},snap:false})
  const press=f.event(1,[-1,0,0]);expect(f.getLayer().pointerDown?.(press)).toBe(true)
  f.getHandlers().up(press)
  f.owner.prepareWholeBoundaryPicks=vi.fn(async()=>[{side:'U0' as const,point:[-1,0,0] as Point}])
  expect(f.getLayer().pointerDown?.(press)).toBe(true);await flushBoundaryPick()
  expect(f.owner.beginWholeBoundaryGesture).toHaveBeenCalledOnce()
  reject(Error('obsolete CAD failure'));await flushBoundaryPick()
  expect(f.counts().captured).toBe(1);expect(f.finishPoleGesture).not.toHaveBeenCalled()
  expect(f.reportViewError).not.toHaveBeenCalled()
  f.getHandlers().move(f.event(1,[-.5,0,0]));expect(f.previewPoles).toHaveBeenCalledOnce()
  f.getHandlers().up(f.event(1,[-.5,0,0]));expect(f.finishPoleGesture).toHaveBeenCalledOnce()
  layer.dispose()
})

it('buffers boundary pointer motion until native proof and releases capture on native failure',async()=>{
  const f=fixture();f.owner.beginWholeBoundaryGesture=vi.fn(()=>true)
  let resolve!:(value:readonly import('../boundaryVisibilityCad').VerifiedBoundaryPick[])=>void
  f.owner.prepareWholeBoundaryPicks=vi.fn(()=>new Promise<readonly VerifiedBoundaryPick[]>(r=>{resolve=r}))
  const layer=createWorkspaceLayer(f.view,f.owner);f.set({wholeBoundaryDrag:{side:'U0',canStart:true},snap:false})
  const press=f.event(1,[-1,0,0]);f.getLayer().pointerDown?.(press)
  f.getHandlers().move(f.event(1,[-.5,0,0]));expect(f.previewPoles).not.toHaveBeenCalled()
  resolve([{side:'U0',point:[-1,0,0]}]);await flushBoundaryPick()
  expect(f.previewPoles).toHaveBeenCalledOnce();f.getHandlers().up(f.event(1,[-.5,0,0]))
  expect(f.finishPoleGesture).toHaveBeenCalledOnce()
  f.owner.prepareWholeBoundaryPicks=vi.fn(async()=>{throw Error('CAD refused')})
  f.getLayer().pointerDown?.(f.event(2,[-1,0,0]));await flushBoundaryPick()
  expect(f.counts().captured).toBeNull();expect(f.reportViewError).toHaveBeenCalledWith('CAD refused')
  layer.dispose()
})

it.skipIf(process.env.SURFACE_QA_CURVED_EXISTING_PROBE!=='1')('probes the prequalified compiled free-boundary STEP in one oblique view',async()=>{
  const input=readFileSync(new URL('../evidence/free-boundary/compiled-20261103/moved.step',import.meta.url))
  const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex'),inputHash=sha(input)
  expect(inputHash).toBe('61e1e624a432089e613cc9b744a7c883ccee3cd79ba459f0ef1c5c159419741f')
  const editor=await SurfaceEditorKernel.load(),k=editor.kernel,shape=k.importStep(input.toString('utf8')),faces=k.getSubShapes(shape,'face'),solids=k.getSubShapes(shape,'solid')
  let layer:ReturnType<typeof createWorkspaceLayer>|undefined
  try{
    expect(k.isValid(shape)).toBe(true);expect(faces).toHaveLength(1);expect(solids).toHaveLength(0)
    const opened=editor.open(input.toString('utf8'))
    expect(opened.faces).toHaveLength(1);expect(opened.faces[0].freeBoundary).toBe(true);expect(opened.faces[0].reason).toBeNull()
    const curved=editor.select(0),result=editor.evaluate(curved,'G0')
    expect(result.valid).toBe(true)
    const f=fixture({preview:result}),begin=vi.fn(()=>true);f.owner.beginWholeBoundaryGesture=begin
    f.owner.prepareWholeBoundaryPicks=async(_net,candidates,origin,parallel)=>editor.verifyBoundaryVisibility(result.previewRevision!,candidates,origin,parallel).results.filter(r=>r.visible).map(r=>({side:r.side,point:r.point}))
    const camera=f.view.camera() as THREE.OrthographicCamera
    camera.left=-24;camera.right=24;camera.top=24;camera.bottom=-24;camera.near=.1;camera.far=200
    camera.position.set(40,-25,45);camera.lookAt(10,15,10.7);camera.updateProjectionMatrix();camera.updateMatrixWorld(true)
    layer=createWorkspaceLayer(f.view,f.owner)
    f.set({net:curved,wholeBoundaryDrag:{side:'U1',canStart:true},snap:false})
    const b=k.uvBounds(faces[0]),v=b.vMin+(b.vMax-b.vMin)*.37,point=k.pointOnSurface(faces[0],b.uMax,v)
    const cadPoint:Point=[point.x,point.y,point.z],client=f.client(cadPoint),path=wholeBoundaryPath(curved,'U1')
    const picked=pickSheetEdge([path],camera,f.rect as DOMRect,client.clientX,client.clientY)
    expect(picked).not.toBeNull()
    const anchor=picked!.anchor,previewGroup=f.group.getObjectByName('tmar-edit-surface-preview')!
    previewGroup.updateWorldMatrix(true,true)
    const rendered=previewGroup.children[0] as THREE.Mesh,position=rendered.geometry.getAttribute('position'),index=rendered.geometry.getIndex()!
    const triangle=new THREE.Triangle(),closest=new THREE.Vector3()
    const distance=(p:THREE.Vector3)=>{
      let best=Infinity
      for(let i=0;i<index.count;i+=3){
        triangle.a.fromBufferAttribute(position,index.getX(i));triangle.b.fromBufferAttribute(position,index.getX(i+1));triangle.c.fromBufferAttribute(position,index.getX(i+2))
        triangle.closestPointToPoint(p,closest);best=Math.min(best,closest.distanceTo(p))
      }
      return best
    }
    const projection=anchor.clone().project(camera),caster=new THREE.Raycaster()
    caster.setFromCamera(new THREE.Vector2(projection.x,projection.y),camera)
    const hits=caster.intersectObject(rendered,false),depth=anchor.clone().sub(caster.ray.origin).dot(caster.ray.direction)
    const claimed=f.getLayer().pointerDown?.(f.event(1,cadPoint))??false
    await flushBoundaryPick()
    const evidence={scope:'Existing prequalified single natural open curved NURBS STEP; one oblique pick, no new deformation',
      fixture:'evidence/free-boundary/compiled-20261103/moved.step',inputHash,currentValidity:true,currentSingleFace:true,currentSolids:0,currentFreeBoundary:true,
      tessellation:{linearDeflectionMm:.08,angularDeflectionRad:.15},side:'U1',curveParameterFraction:.37,cadPoint,pickAnchor:anchor.toArray(),
      cadCurveToStoredTrianglesMm:distance(new THREE.Vector3(...cadPoint)),pickAnchorToStoredTrianglesMm:distance(anchor),
      rayHitCount:hits.length,anchorDepthMm:depth,firstHitDepthMm:hits[0]?.distance??null,signedDepthGapMm:hits.length?depth-hits[0].distance:null,
      triangles:index.count/3,pointerClaimed:claimed,controllerBegun:begin.mock.calls.length,verdict:claimed?'ACCEPTED':'REFUSED',
      inputUnchanged:sha(readFileSync(new URL('../evidence/free-boundary/compiled-20261103/moved.step',import.meta.url)))===inputHash,
      browser:'NOT_RUN; simulated layer pointer and host lease'}
    if(process.env.SURFACE_QA_CURVED_BOUNDARY_EVIDENCE)writeFileSync(process.env.SURFACE_QA_CURVED_BOUNDARY_EVIDENCE,JSON.stringify(evidence,null,2)+'\n')
    console.log(JSON.stringify(evidence))
    expect(claimed,'Prequalified visible curved boundary press must be reserved for native verification').toBe(true)
    expect(begin).toHaveBeenCalledWith('U1')
  }finally{layer?.dispose();solids.forEach(s=>k.release(s));faces.forEach(f=>k.release(f));k.release(shape);editor.dispose()}
},60000)

it.skipIf(process.env.SURFACE_QA_CURVED_BOUNDARY_PROBE!=='1')('probes one curved OCCT boundary with production tessellation and an oblique view',async()=>{
  const editor=await SurfaceEditorKernel.load(),k=editor.kernel,box=k.makeBox(2,2,.1),shifted=k.translate(box,-1,-1,0)
  const faces=k.getSubShapes(shifted,'face')
  let layer:ReturnType<typeof createWorkspaceLayer>|undefined
  let recorded=false,phase='kernel-curved-evaluate'
  try{
    const bottom=faces.find(face=>{const b=k.uvBounds(face);return Math.abs(k.pointOnSurface(face,(b.uMin+b.uMax)/2,(b.vMin+b.vMax)/2).z)<1e-8})!
    editor.open(k.exportStep(bottom))
    const curved=editor.select(0),height=[0,.6,.6,.6,0]
    expect(curved.nv).toBe(5)
    for(let i=0;i<curved.nu;i++)for(let j=0;j<curved.nv;j++)curved.poles[i*curved.nv+j][2]+=height[j]
    const result=editor.evaluate(curved,'G0',false,true)
    expect(result.valid).toBe(true)
    phase='layer-depth-probe'
    const f=fixture({oblique:true,preview:result}),begin=vi.fn(()=>true);f.owner.beginWholeBoundaryGesture=begin
    layer=createWorkspaceLayer(f.view,f.owner)
    f.set({net:curved,wholeBoundaryDrag:{side:'U0',canStart:true},snap:false})
    const u0x=(curved.poles[0][0]+curved.poles[curved.nv-1][0])/2
    const u1x=(curved.poles[(curved.nu-1)*curved.nv][0]+curved.poles.at(-1)![0])/2
    const side=u1x>=u0x?'U1':'U0'
    const witness=editor.finalFaceWitness(result.previewRevision!),face=k.fromBREP(witness.faceBrep)
    let cadPoint:Point
    try{
      const b=k.uvBounds(face),p=k.pointOnSurface(face,side==='U0'?b.uMin:b.uMax,b.vMin+(b.vMax-b.vMin)*.37)
      cadPoint=[p.x,p.y,p.z]
    }finally{k.release(face)}
    const client=f.client(cadPoint),path=wholeBoundaryPath(curved,side)
    const picked=pickSheetEdge([path],f.view.camera(),f.rect as DOMRect,client.clientX,client.clientY)
    expect(picked).not.toBeNull()
    const anchor=picked!.anchor,previewGroup=f.group.getObjectByName('tmar-edit-surface-preview')!
    previewGroup.updateWorldMatrix(true,true)
    const previewMesh=previewGroup.children[0] as THREE.Mesh,position=previewMesh.geometry.getAttribute('position'),index=previewMesh.geometry.getIndex()!
    const triangle=new THREE.Triangle(),closest=new THREE.Vector3()
    const distance=(p:THREE.Vector3)=>{
      let best=Infinity
      for(let i=0;i<index.count;i+=3){
        triangle.a.fromBufferAttribute(position,index.getX(i));triangle.b.fromBufferAttribute(position,index.getX(i+1));triangle.c.fromBufferAttribute(position,index.getX(i+2))
        triangle.closestPointToPoint(p,closest);best=Math.min(best,closest.distanceTo(p))
      }
      return best
    }
    const projection=anchor.clone().project(f.view.camera()),caster=new THREE.Raycaster()
    caster.setFromCamera(new THREE.Vector2(projection.x,projection.y),f.view.camera())
    const hits=caster.intersectObject(previewMesh,false),anchorDepth=anchor.clone().sub(caster.ray.origin).dot(caster.ray.direction)
    const claimed=f.getLayer().pointerDown?.(f.event(1,cadPoint)) ?? false
    const evidence={scope:'Single synthetic curved natural OCCT sheet; actual production tessellation and oblique camera',
      tessellation:{linearDeflectionMm:.08,angularDeflectionRad:.15},side,curveParameterFraction:.37,cadPoint,pickAnchor:anchor.toArray(),
      cadCurveToStoredTrianglesMm:distance(new THREE.Vector3(...cadPoint)),pickAnchorToStoredTrianglesMm:distance(anchor),
      rayHitCount:hits.length,anchorDepthMm:anchorDepth,firstHitDepthMm:hits[0]?.distance??null,
      signedDepthGapMm:hits.length?anchorDepth-hits[0].distance:null,triangles:index.count/3,
      pointerClaimed:claimed,controllerBegun:begin.mock.calls.length,
      verdict:claimed?'ACCEPTED':'REFUSED',browser:'NOT_RUN; simulated layer pointer and host lease'}
    if(process.env.SURFACE_QA_CURVED_BOUNDARY_EVIDENCE)writeFileSync(process.env.SURFACE_QA_CURVED_BOUNDARY_EVIDENCE,JSON.stringify(evidence,null,2)+'\n')
    recorded=true
    console.log(JSON.stringify(evidence))
    expect(claimed,'Visible curved boundary must be supported before publishing multi-edge picking').toBe(true)
    expect(f.owner.beginWholeBoundaryGesture).toHaveBeenCalledWith(side)
  }catch(error){
    if(!recorded && process.env.SURFACE_QA_CURVED_BOUNDARY_EVIDENCE)writeFileSync(process.env.SURFACE_QA_CURVED_BOUNDARY_EVIDENCE,
      JSON.stringify({scope:'Single synthetic curved OCCT sheet and oblique-view probe',phase,verdict:'REFUSED_BEFORE_MEASUREMENT',
        error:String((error as Error).message),distanceMeasurements:null,pickingAttempted:false,browser:'NOT_RUN'},null,2)+'\n')
    throw error
  }finally{layer?.dispose();faces.forEach(f=>k.release(f));k.release(shifted);k.release(box);editor.dispose()}
},60000)

it.each([{perspective:false,size:1,offset:0},{perspective:true,size:1,offset:0},{perspective:false,size:50,offset:1e12}])(
  'guards overlapping folded boundaries using native proof (perspective: $perspective, width: $size*2, offset: $offset)',async({perspective,size,offset})=>{
  const frontX=perspective?-.9:-1
  const folded:Net={nu:3,nv:2,du:2,dv:1,ku:[0,1],kv:[0,1],mu:[3,3],mv:[2,2],rational:[0,0],
    poles:[[-size,-size,0],[-size,size,0],[size,-size,.5],[size,size,.5],[frontX*size,-size,1],[frontX*size,size,1]],weights:[1,1,1,1,1,1]}
  const positions:number[]=[],indices:number[]=[]
  for(let i=0;i<=40;i++){
    const u=i/40,x=-((1-u)**2)+2*(1-u)*u+frontX*u*u
    positions.push(x*size,-size,u,x*size,size,u)
    if(i<40){const j=i*2;indices.push(j,j+1,j+2,j+1,j+3,j+2)}
  }
  const geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(positions,3))
  geometry.setIndex(indices);geometry.computeVertexNormals()
  const shape={positions:geometry.getAttribute('position').array as Float32Array,normals:geometry.getAttribute('normal').array as Float32Array,
    indices:new Uint32Array(indices),vertexCount:positions.length/3,triangleCount:indices.length/3}
  const f=fixture({perspective,worldOffset:offset,preview:{...validPreview,mesh:shape,faceMeshes:[shape]}})
  if(size>1){const c=f.view.camera() as THREE.OrthographicCamera;c.left=-60;c.right=60;c.top=60;c.bottom=-60;c.updateProjectionMatrix()}
  f.owner.beginWholeBoundaryGesture=vi.fn(()=>true)
  f.owner.prepareWholeBoundaryPicks=vi.fn(async():Promise<readonly VerifiedBoundaryPick[]>=>[{side:'U1',point:[frontX*size,0,1]}])
  const layer=createWorkspaceLayer(f.view,f.owner)
  f.set({net:folded,wholeBoundaryDrag:{side:'U0',canStart:true},snap:false})
  const claimed=f.getLayer().pointerDown?.(f.event(1,[-size,0,0]))
  await flushBoundaryPick()
  expect(claimed).toBe(true)
  expect(f.owner.beginWholeBoundaryGesture).toHaveBeenCalledExactlyOnceWith('U1')
  layer.cancelGesture();layer.dispose();geometry.dispose()
})

it.each([{offset:0,hidden:false},{offset:1e12,hidden:false},{offset:1e12,hidden:true}])(
  'confirms a visible 100 mm sheet and refuses native occlusion with world offset $offset (hidden: $hidden)',async({offset,hidden})=>{
  const wide:Net={...net,poles:[[-50,-50,0],[-50,50,0],[50,-50,0],[50,50,0]]}
  const shape={...mesh,positions:new Float32Array(Array.from(mesh.positions,(value,i)=>i%3===2?(hidden?.01:0):value*30))}
  const f=fixture({worldOffset:offset,preview:{...validPreview,mesh:shape,faceMeshes:[shape]}})
  const c=f.view.camera() as THREE.OrthographicCamera;c.left=-60;c.right=60;c.top=60;c.bottom=-60;c.updateProjectionMatrix()
  f.owner.beginWholeBoundaryGesture=vi.fn(()=>true)
  if(hidden)f.owner.prepareWholeBoundaryPicks=vi.fn(async()=>[])
  const layer=createWorkspaceLayer(f.view,f.owner)
  f.set({net:wide,wholeBoundaryDrag:{side:'U0',canStart:true},snap:false})
  expect(f.getLayer().pointerDown?.(f.event(1,[-50,0,0]))).toBe(true)
  await flushBoundaryPick()
  if(hidden)expect(f.owner.beginWholeBoundaryGesture).not.toHaveBeenCalled()
  else expect(f.owner.beginWholeBoundaryGesture).toHaveBeenCalledExactlyOnceWith('U0')
  layer.cancelGesture();layer.dispose()
})

it.each(['occluded','no-depth-hit','preview-behind-anchor'] as const)('fails closed when native proof refuses %s',async condition=>{
  const dx=condition==='no-depth-hit'?4:0,z=condition==='preview-behind-anchor'?-.01:condition==='occluded'?.01:0
  const shape={...mesh,positions:new Float32Array(Array.from(mesh.positions,(value,i)=>value+(i%3===0?dx:i%3===2?z:0)))}
  const f=fixture({preview:{...validPreview,mesh:shape,faceMeshes:[shape]}})
  f.owner.beginWholeBoundaryGesture=vi.fn(()=>true)
  f.owner.prepareWholeBoundaryPicks=vi.fn(async()=>[])
  const layer=createWorkspaceLayer(f.view,f.owner)
  f.set({wholeBoundaryDrag:{side:'U0',canStart:true}})
  expect(f.getLayer().pointerDown?.(f.event(1,[-1,0,0]))).toBe(true)
  await flushBoundaryPick()
  expect(f.owner.beginWholeBoundaryGesture).not.toHaveBeenCalled()
  expect(f.counts().captured).toBeNull();layer.dispose()
})

it.each([
  {side:'U0',at:[-1,0,0],ids:[0,1]}, {side:'U1',at:[1,0,0],ids:[2,3]},
  {side:'V0',at:[0,-1,0],ids:[0,2]}, {side:'V1',at:[0,1,0],ids:[1,3]},
] as const)('picks $side directly even when the panel previously selected U0',async({side,at,ids})=>{
  const f=fixture({rotated:true,perspective:true});f.owner.beginWholeBoundaryGesture=vi.fn(()=>true)
  const layer=createWorkspaceLayer(f.view,f.owner)
  f.set({wholeBoundaryDrag:{side:'U0',canStart:true},snap:false})
  const start=[...at] as Point,end=[at[0]+.4,at[1],at[2]] as Point
  expect(f.getLayer().pointerDown?.(f.event(1,start))).toBe(true)
  await flushBoundaryPick()
  expect(f.owner.beginWholeBoundaryGesture).toHaveBeenCalledWith(side)
  f.getHandlers().move(f.event(1,end));f.getHandlers().up(f.event(1,end))
  const actual=f.finishPoleGesture.mock.lastCall![0]!
  actual.forEach((p,i)=>{
    expect(p[0]).toBeCloseTo(f.net.poles[i][0]+((ids as readonly number[]).includes(i)?.4:0),8)
    expect(p[1]).toBe(f.net.poles[i][1]);expect(p[2]).toBe(f.net.poles[i][2])
  })
  expect(f.beginDirectStripGesture).not.toHaveBeenCalled();layer.dispose()
})

it('refuses the directly picked locked side without falling back to an unlocked side',async()=>{
  const f=fixture();f.owner.beginWholeBoundaryGesture=vi.fn(()=>true)
  const layer=createWorkspaceLayer(f.view,f.owner)
  f.set({wholeBoundaryDrag:{side:'U0',canStart:true},locked:[2]})
  expect(f.getLayer().pointerDown?.(f.event(1,[1,0,0]))).toBe(true)
  await flushBoundaryPick()
  expect(f.owner.beginWholeBoundaryGesture).not.toHaveBeenCalled()
  expect(f.reportViewError).toHaveBeenCalledWith('Il bordo contiene un polo bloccato.')
  expect(f.counts().captured).toBeNull();layer.dispose()
})

it.each([false,true])('drags the chosen complete natural boundary and leaves off-edge navigation unclaimed (rotated: %s)',async rotated=>{
  const f=fixture({rotated,perspective:true}),begin=vi.fn(()=>true)
  f.owner.beginWholeBoundaryGesture=begin
  const layer=createWorkspaceLayer(f.view,f.owner)
  f.set({wholeBoundaryDrag:{side:'U0',canStart:true},snap:false})
  expect(f.getLayer().pointerDown?.(f.event(1,[.5,0,0]))).toBe(false)
  expect(begin).not.toHaveBeenCalled()
  const press=f.event(2,[-1,0,0])
  expect(f.getLayer().pointerDown?.(press)).toBe(true)
  await flushBoundaryPick()
  expect(begin).toHaveBeenCalledWith('U0')
  expect(f.claimEditDrag).toHaveBeenLastCalledWith(true)
  f.getHandlers().move(f.event(3,[0,0,0]));expect(f.previewPoles).not.toHaveBeenCalled()
  f.getHandlers().move(f.event(2,[0,0,0]))
  const poles=f.previewPoles.mock.lastCall![0]
  expect(poles[0][0]).toBeCloseTo(0,8);expect(poles[1][0]).toBeCloseTo(0,8)
  expect(poles[2]).toEqual(f.net.poles[2]);expect(poles[3]).toEqual(f.net.poles[3])
  f.getHandlers().up(f.event(2,[0,0,0]))
  expect(f.finishPoleGesture.mock.lastCall![0]).toEqual(poles)
  expect(f.counts().captured).toBeNull();expect(f.claimEditDrag).toHaveBeenLastCalledWith(false)
  expect(f.beginDirectStripGesture).not.toHaveBeenCalled()
  layer.dispose()
})

it.each(['click','escape','cancel','camera'] as const)('restores a whole-boundary gesture on %s without a geometry commit',async mode=>{
  const f=fixture();f.owner.beginWholeBoundaryGesture=vi.fn(()=>true)
  const layer=createWorkspaceLayer(f.view,f.owner)
  f.set({wholeBoundaryDrag:{side:'U0',canStart:true},snap:false})
  const press=f.event(1,[-1,0,0]);f.getLayer().pointerDown?.(press)
  await flushBoundaryPick()
  if(mode==='click')f.getHandlers().up(press)
  else{
    f.getHandlers().move(f.event(1,[-.5,0,0]))
    if(mode==='escape')layer.cancelGesture()
    if(mode==='cancel')f.getHandlers().cancel(press)
    if(mode==='camera'){
      f.view.camera().position.x+=1;f.view.camera().updateMatrixWorld(true)
      f.getHandlers().move(f.event(1,[0,0,0]))
    }
  }
  expect(f.finishPoleGesture).toHaveBeenLastCalledWith(null)
  expect(f.counts().captured).toBeNull();layer.dispose()
})

it('refuses a locked whole edge, preserves navigation-only mode and does not select cells while the tool is armed',async()=>{
  const f=fixture();f.owner.beginWholeBoundaryGesture=vi.fn(()=>true)
  const layer=createWorkspaceLayer(f.view,f.owner)
  f.set({wholeBoundaryDrag:{side:'U0',canStart:true},locked:[0]})
  expect(f.getLayer().pointerDown?.(f.event(1,[-1,0,0]))).toBe(true)
  await flushBoundaryPick()
  expect(f.owner.beginWholeBoundaryGesture).not.toHaveBeenCalled()
  f.set({locked:[],navigationOnly:true})
  expect(f.getLayer().pointerDown?.(f.event(1,[-1,0,0]))).toBe(false)
  f.set({navigationOnly:false,wholeBoundaryDrag:{side:'U0',canStart:false}})
  expect(f.getLayer().pointerDown?.(f.event(1,[-1,0,0]))).toBe(false)
  const at=f.client([0,0,0]);f.getLayer().click?.(at.clientX,at.clientY,false)
  expect(f.selectPoints).not.toHaveBeenCalled();layer.dispose()
})

it.each(['scan','cad'] as const)('resolves a surface target from external %s references in part coordinates, with snap disabled',async kind=>{
  const f=fixture({reference:kind==='scan'?'scan':'cad-face',rotated:true})
  let found:import('../workspaceBridge').WorkspacePointTarget|null=null
  f.owner.pickSurfaceTarget=vi.fn(async(_p,resolve)=>{found=resolve([.2,0,0],[1,0,0],1,kind)})
  f.owner.cancelSurfaceTarget=vi.fn(()=>f.set({surfaceTarget:null}))
  const layer=createWorkspaceLayer(f.view,f.owner)
  f.set({snap:false,surfaceTarget:{kind,sourceBodyId:4}})
  expect(f.getLayer().pointerDown?.(f.event(4,[0,0,0]))).toBe(false)
  const client=f.client([0,0,0]);f.getLayer().click?.(client.clientX,client.clientY,false)
  await Promise.resolve()
  expect(f.owner.pickSurfaceTarget).toHaveBeenCalled()
  const hit=found as import('../workspaceBridge').WorkspacePointTarget|null
  expect(hit?.point[0]).toBeCloseTo(0,10);expect(hit?.current()).toBe(true)
  const ref=f.view.references()[0]
  ref.partFromGeometry[12]=2
  expect(hit?.current()).toBe(false)
  expect(layer.cancelGesture()).toBe(true)
  expect(f.owner.cancelSurfaceTarget).toHaveBeenCalled()
  layer.dispose()
})

it.each(['scan','cad'] as const)('uses the farther visible surface for a clipped %s point target', async kind=>{
  const f=fixture({reference:kind==='scan'?'scan':'cad-face',rotated:true})
  putLayersInReference(f,[-.7,-.2])
  const targets: Array<import('../workspaceBridge').WorkspacePointTarget|null> = []
  f.owner.pickSurfaceTarget=vi.fn(async(_p,resolve)=>{targets.push(resolve([-.5,0,0],[1,0,0],1,kind))})
  const layer=createWorkspaceLayer(f.view,f.owner)
  f.set({snap:false,surfaceTarget:{kind,sourceBodyId:4}})
  const world = f.group.matrixWorld
  const left = new THREE.Plane(new THREE.Vector3(1,0,0),.6).applyMatrix4(world)
  f.getLayer().clippingChanged?.([left],false)
  const at=f.client([-.5,0,0])
  expect(f.getLayer().click?.(at.clientX,at.clientY,false)).toBe(true)
  await Promise.resolve()
  expect(targets[0]?.point[0]).toBeCloseTo(-.2)
  expect(targets[0]?.current()).toBe(true)

  const right = new THREE.Plane(new THREE.Vector3(-1,0,0),-.4).applyMatrix4(world)
  f.getLayer().clippingChanged?.([left,right],false)
  expect(targets[0]?.current()).toBe(false)
  expect(f.getLayer().click?.(at.clientX,at.clientY,false)).toBe(true)
  await Promise.resolve()
  expect(targets).toHaveLength(2)
  expect(targets[1]).toBeNull()
  layer.dispose()
})

it('shows collected CAD/target pairs and clears them on reference invalidation and Escape',()=>{
  const f=fixture({reference:'scan'});f.owner.cancelSurfaceTarget=vi.fn(()=>f.set({surfaceTarget:null}))
  const layer=createWorkspaceLayer(f.view,f.owner),pair={at:[0,0,0] as Point,target:[0,0,.2] as Point,label:'scan QA'}
  f.set({surfaceTarget:{kind:'scan',sourceBodyId:4,pairs:[pair]},snap:false})
  const pins=f.group.getObjectByName('tmar-edit-surface-notes')!
  expect(pins.children).toHaveLength(3)
  expect((pins.children[0] as THREE.Mesh).position.toArray()).toEqual(pair.at)
  expect((pins.children[1] as THREE.Mesh).position.toArray()).toEqual(pair.target)
  f.notifyReferences();expect(f.owner.cancelSurfaceTarget).toHaveBeenCalledOnce();expect(pins.children).toHaveLength(0)
  f.set({surfaceTarget:{kind:'cad',sourceBodyId:4,pairs:[pair]}})
  expect(layer.cancelGesture()).toBe(true);expect(pins.children).toHaveLength(0)
  expect(f.previewPoles).not.toHaveBeenCalled();expect(f.finishPoleGesture).not.toHaveBeenCalled();layer.dispose()
})

it.each(['tangent-plane','tangent-span'] as const)('routes a %s pick from the CAD face and Escape cancels the mode',async kind=>{
  const f=fixture();f.owner.pickTangentPlane=vi.fn(async()=>{})
  f.owner.cancelSurfaceTarget=vi.fn(()=>f.set({surfaceTarget:null}))
  const layer=createWorkspaceLayer(f.view,f.owner)
  f.set({snap:false,surfaceTarget:{kind,sourceBodyId:4}})
  const client=f.client([0,0,0]);f.getLayer().click?.(client.clientX,client.clientY,false)
  expect(f.owner.pickTangentPlane).toHaveBeenCalledWith([0,0,0]);expect(f.selectPoints).not.toHaveBeenCalled()
  expect(layer.cancelGesture()).toBe(true);expect(f.owner.cancelSurfaceTarget).toHaveBeenCalledOnce()
  layer.dispose()
})

it('never uses the edited CAD body or neighbouring preview faces as an external point target',async()=>{
  const f=fixture({reference:'cad-face'})
  let found:unknown='not called'
  f.owner.pickSurfaceTarget=vi.fn(async(_p,resolve)=>{found=resolve([.2,0,0],[1,0,0],1,'cad')})
  const layer=createWorkspaceLayer(f.view,f.owner)
  f.set({surfaceTarget:{kind:'cad',sourceBodyId:7}})
  const client=f.client([0,0,0]);f.getLayer().click?.(client.clientX,client.clientY,false)
  await Promise.resolve();expect(found).toBeNull();layer.dispose()
})

it.each(['up', 'cancel', 'lostCapture', 'interruption', 'dispose'] as const)(
  'releases the navigation claim after pole gesture %s', termination => {
    const f=fixture(), layer=createWorkspaceLayer(f.view,f.owner), press=f.event(4,[-1,-1,0])
    expect(f.getLayer().pointerDown?.(press)).toBe(true)
    expect(f.claimEditDrag).toHaveBeenLastCalledWith(true)
    if(termination==='interruption') f.interrupt()
    else if(termination==='dispose') layer.dispose()
    else f.getHandlers()[termination](press)
    expect(f.counts().captured).toBeNull()
    expect(f.claimEditDrag).toHaveBeenLastCalledWith(false)
    layer.dispose()
  })

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

  it('snaps past a clipped surface on the same reference and falls back to free movement if all hits are clipped',()=>{
    const f=fixture({reference:kind,rotated:true}), raw:Point=[-.1,-1,0]
    putLayersInReference(f,[0,-.5])
    const layer=createWorkspaceLayer(f.view,f.owner)
    f.set({snapDistance:.6})
    const section=(x:number) => new THREE.Plane(new THREE.Vector3(-1,0,0),x).applyMatrix4(f.group.matrixWorld)
    f.getLayer().clippingChanged?.([section(-.3)],false)
    expect(f.getLayer().pointerDown?.(f.event(1,[-1,-1,0]))).toBe(true)
    f.getHandlers().move(f.event(1,raw))
    expect(f.previewPoles.mock.lastCall?.[0][0][0]).toBeCloseTo(-.5)
    expect(f.overlay.children[0].textContent).toContain('Agganciato')
    f.getHandlers().move(f.event(1,raw,true))
    expect(f.previewPoles.mock.lastCall?.[0][0][0]).toBeCloseTo(-.1)
    f.set({snap:false})
    f.getHandlers().move(f.event(1,raw))
    expect(f.previewPoles.mock.lastCall?.[0][0][0]).toBeCloseTo(-.1)
    f.set({snap:true})
    f.getHandlers().move(f.event(1,raw))
    expect(f.previewPoles.mock.lastCall?.[0][0][0]).toBeCloseTo(-.5)
    f.getLayer().clippingChanged?.([section(-.75)],false)
    expect(f.overlay.children[0].style.display).toBe('none')
    f.getHandlers().up(f.event(1,raw))
    expect(f.finishPoleGesture.mock.lastCall?.[0]?.[0][0]).toBeCloseTo(-.1)
    layer.dispose()
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

function overlappingDirectEdges(backFirst:boolean, withReference=false) {
  const f=fixture(withReference ? {reference:'scan'} : {})
  if (withReference) f.reference.partFromGeometry=new THREE.Matrix4().makeTranslation(0,0,-2).toArray()
  const layer=createWorkspaceLayer(f.view,f.owner)
  const front:Point[]=[[-1,-1,.02],[1,-1,.02]], back:Point[]=[[-1,-1,0],[1,-1,0]]
  const paths=backFirst?[back,front]:[front,back], edge=backFirst?1:0
  const winner={edge,point:[0,-1,.02] as Point}
  const prepare=vi.fn().mockResolvedValueOnce(winner)
  f.owner.prepareDirectStripPick=prepare
  const begin=vi.fn((pick:{readonly edge:number})=>f.beginDirectStripGesture(pick.edge,9))
  f.owner.beginVerifiedDirectStripGesture=begin
  f.owner.cancelPreparedDirectStripPick=vi.fn()
  f.set({directStrip:{paths,revision:9,axis:0}})
  const handle=f.overlay.children.find(item=>item.dataset.test==='surface-strip-handle')!
  const press=()=>({pointerId:7,button:0,shiftKey:false,ctrlKey:false,metaKey:false,altKey:false,
    clientX:parseFloat(handle.style.left),clientY:parseFloat(handle.style.top),
    preventDefault:vi.fn(),stopPropagation:vi.fn()} as unknown as PointerEvent)
  return {f,layer,winner,prepare,begin,handle,press}
}

it.each([true,false])('uses the CAD winner for overlapping D edges in either order (rear first %s)',async backFirst=>{
  const {f,layer,winner,prepare,begin,handle,press}=overlappingDirectEdges(backFirst)
  expect(f.getLayer().pointerDown?.(f.event(1,[0,-1,0]))).toBe(true)
  expect(handle.style.display).toBe('none')
  await flushBoundaryPick()
  expect(prepare.mock.calls[0][1]).toHaveLength(2)
  expect(handle.dataset.edge).toBe(String(winner.edge))
  expect(handle.style.display).toBe('block')
  let complete!:(pick:typeof winner)=>void
  prepare.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve}))
  const down=press()
  handle.dispatch('pointerdown',down)
  expect(prepare).toHaveBeenCalledTimes(2)
  expect(begin).not.toHaveBeenCalled()
  expect(f.counts().captured).toBe(7)
  const moved={...down,clientX:down.clientX+50}
  f.getHandlers().move(moved)
  complete(winner);await flushBoundaryPick()
  expect(begin).toHaveBeenCalledWith(winner)
  expect(f.previewStripDelta.mock.lastCall?.[0][0]).toBeCloseTo(.5)
  f.getHandlers().up(moved)
  expect(f.finishStripGesture.mock.lastCall?.[0]?.[0]).toBeCloseTo(.5)
  layer.dispose()
})

it.each(['release','camera','viewport','part transform','section','selection','references','winner changed'])(
  'refuses stale D recertification after %s',async reason=>{
    const {f,layer,winner,prepare,begin,handle,press}=overlappingDirectEdges(true)
    f.getLayer().pointerDown?.(f.event(1,[0,-1,0]))
    await flushBoundaryPick()
    let complete!:(pick:typeof winner)=>void
    prepare.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve}))
    const down=press()
    handle.dispatch('pointerdown',down)
    if (reason==='release') f.getHandlers().up(down)
    if (reason==='camera') { f.view.camera().position.z+=1;f.frame() }
    if (reason==='viewport') { f.rect.width+=1;f.frame() }
    if (reason==='part transform') { f.group.position.x+=1;f.frame() }
    if (reason==='section') f.getLayer().clippingChanged?.([new THREE.Plane(new THREE.Vector3(0,0,1),1)],false)
    if (reason==='selection') f.set({selected:[0]})
    if (reason==='references') f.notifyReferences()
    complete(reason==='winner changed'?{edge:0,point:[0,-1,0]}:winner)
    await flushBoundaryPick()
    expect(begin).not.toHaveBeenCalled()
    expect(f.finishStripGesture).not.toHaveBeenCalled()
    expect(f.counts().captured).toBeNull()
    layer.dispose()
  })

it('certifies D with world clipping planes and repeats the proof on pointerdown',async()=>{
  const {f,layer,winner,prepare,begin,handle,press}=overlappingDirectEdges(true)
  const plane=new THREE.Plane(new THREE.Vector3(0,0,1),1)
  f.getLayer().clippingChanged?.([plane],false)
  expect(f.getLayer().pointerDown?.(f.event(1,[0,-1,0]))).toBe(true)
  await flushBoundaryPick()
  expect(prepare.mock.calls[0][4]).toEqual({partToWorld:f.group.matrixWorld.toArray(),
    planes:[{normal:[0,0,1],constant:1}],margins:{planeClearanceMm:.001,startGuardMm:.001,
      endpointExtensionMm:.0001,minimumVisibleLengthMm:.003,minimumCrossingCosine:.01}})
  expect(handle.style.display).toBe('block')
  prepare.mockResolvedValueOnce(winner)
  const down=press();handle.dispatch('pointerdown',down)
  await flushBoundaryPick()
  expect(prepare.mock.calls[1][4]).toEqual(prepare.mock.calls[0][4])
  expect(begin).toHaveBeenCalledWith(winner)
  f.getHandlers().up(down);layer.dispose()
})

it.each(['section event','plane mutation','preview','camera','references'] as const)(
  'rejects a pending clipped D proof after %s',async reason=>{
    const {f,layer,winner,prepare,handle}=overlappingDirectEdges(true)
    const plane=new THREE.Plane(new THREE.Vector3(0,0,1),1)
    f.getLayer().clippingChanged?.([plane],false)
    let complete!:(pick:typeof winner)=>void
    prepare.mockReset().mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve}))
    f.getLayer().pointerDown?.(f.event(1,[0,-1,0]))
    await flushBoundaryPick()
    if(reason==='section event') f.getLayer().clippingChanged?.(null,false)
    if(reason==='plane mutation') plane.constant=2
    if(reason==='preview') f.set({preview:null})
    if(reason==='camera') { f.view.camera().position.z+=1;f.frame() }
    if(reason==='references') f.notifyReferences()
    complete(winner);await flushBoundaryPick()
    expect(handle.style.display).toBe('none')
    expect(f.counts().captured).toBeNull()
    layer.dispose()
  })

it('refuses a recertification if a clipping plane mutates in place',async()=>{
  const {f,layer,winner,prepare,begin,handle,press}=overlappingDirectEdges(true)
  const plane=new THREE.Plane(new THREE.Vector3(0,0,1),1)
  f.getLayer().clippingChanged?.([plane],false)
  f.getLayer().pointerDown?.(f.event(1,[0,-1,0]));await flushBoundaryPick()
  let complete!:(pick:typeof winner)=>void
  prepare.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve}))
  handle.dispatch('pointerdown',press())
  plane.constant=2
  complete(winner);await flushBoundaryPick()
  expect(begin).not.toHaveBeenCalled()
  expect(f.counts().captured).toBeNull()
  layer.dispose()
})

it.each(['frame','tick','move','up'] as const)(
  'cancels a verified drag on in-place plane mutation before %s',async trigger=>{
    const {f,layer,winner,prepare,begin,handle,press}=overlappingDirectEdges(true)
    const plane=new THREE.Plane(new THREE.Vector3(0,0,1),1)
    f.getLayer().clippingChanged?.([plane],false)
    f.getLayer().pointerDown?.(f.event(1,[0,-1,0]));await flushBoundaryPick()
    prepare.mockResolvedValueOnce(winner)
    const down=press();handle.dispatch('pointerdown',down);await flushBoundaryPick()
    expect(begin).toHaveBeenCalledOnce()
    const moved={...down,clientX:down.clientX+30}
    f.getHandlers().move(moved)
    plane.constant=2
    if (trigger==='frame') f.frame()
    if (trigger==='tick') f.getLayer().tick?.(600,600)
    if (trigger==='move') f.getHandlers().move(moved)
    if (trigger==='up') f.getHandlers().up(moved)
    expect(f.finishStripGesture).toHaveBeenCalledWith(null)
    expect(f.counts().captured).toBeNull()
    layer.dispose()
  })

it('cancels a verified drag when a reference changes without a notification',async()=>{
  const {f,layer,winner,prepare,begin,handle,press}=overlappingDirectEdges(true,true)
  f.getLayer().pointerDown?.(f.event(1,[0,-1,0]));await flushBoundaryPick()
  prepare.mockResolvedValueOnce(winner)
  const down=press();handle.dispatch('pointerdown',down);await flushBoundaryPick()
  expect(begin).toHaveBeenCalledOnce()
  const moved={...down,clientX:down.clientX+30}
  f.getHandlers().move(moved)
  f.reference.partFromGeometry[12]+=1
  f.getHandlers().up(moved)
  expect(f.finishStripGesture).toHaveBeenCalledWith(null)
  expect(f.counts().captured).toBeNull()
  layer.dispose()
})

it('rejects a native result whose point is clipped',async()=>{
  const {f,layer,prepare,handle}=overlappingDirectEdges(true)
  f.getLayer().clippingChanged?.([new THREE.Plane(new THREE.Vector3(0,0,1),-.01)],false)
  prepare.mockReset().mockResolvedValue({edge:0,point:[0,-1,0]})
  f.getLayer().pointerDown?.(f.event(1,[0,-1,.02]));await flushBoundaryPick()
  expect(prepare).toHaveBeenCalledOnce()
  expect(handle.style.display).toBe('none')
  layer.dispose()
})

it('does not offer D when the initial CAD result leaves overlapping edges ambiguous',async()=>{
  const {f,layer,prepare,handle}=overlappingDirectEdges(true)
  prepare.mockReset().mockResolvedValue(null)
  f.getLayer().pointerDown?.(f.event(1,[0,-1,0]))
  await flushBoundaryPick()
  expect(prepare).toHaveBeenCalledOnce()
  expect(handle.style.display).toBe('none')
  expect(f.counts().captured).toBeNull()
  layer.dispose()
})

it.each([
  ['shell',false],['shell',true],['reference',false],['reference',true],['front',false],['front',true],
] as const)('checks a single straight D candidate against %s in either order (decoy first %s)',async (kind,decoyFirst)=>{
  const f=fixture({reference:kind==='shell'?undefined:'scan'})
  const selected:Point[]=[[-1,-1,.02],[1,-1,.02]], decoy:Point[]=[[-1,1,0],[1,1,0]]
  const paths=decoyFirst?[decoy,selected]:[selected,decoy], edge=decoyFirst?1:0
  const winner={edge,point:[0,-1,.02] as Point}
  f.reference.partFromGeometry=new THREE.Matrix4().makeTranslation(0,0,kind==='reference'?.2:-.2).toArray()
  f.set({snap:false,directStrip:{paths,revision:9,axis:0}})
  const prepare=vi.fn().mockResolvedValue(kind==='shell'?null:winner)
  f.owner.prepareDirectStripPick=prepare
  const begin=vi.fn((pick:{readonly edge:number})=>f.beginDirectStripGesture(pick.edge,9))
  f.owner.beginVerifiedDirectStripGesture=begin
  const layer=createWorkspaceLayer(f.view,f.owner)
  const handle=f.overlay.children.find(item=>item.dataset.test==='surface-strip-handle')!
  expect(f.getLayer().pointerDown?.(f.event(1,[0,-1,.02]))).toBe(true)
  await flushBoundaryPick()
  expect(prepare.mock.calls[0][1]).toEqual([{edge,path:selected,seed:[expect.closeTo(0,8),-1,.02],segment:0}])
  if (kind==='front') {
    expect(handle.dataset.edge).toBe(String(edge))
    expect(handle.style.display).toBe('block')
    const down={pointerId:7,button:0,clientX:parseFloat(handle.style.left),clientY:parseFloat(handle.style.top),
      preventDefault:vi.fn(),stopPropagation:vi.fn()} as unknown as PointerEvent
    handle.dispatch('pointerdown',down)
    await flushBoundaryPick()
    expect(prepare).toHaveBeenCalledTimes(2)
    expect(begin).toHaveBeenCalledWith(winner)
    f.getHandlers().up(down)
  } else {
    expect(handle.style.display).toBe('none')
    expect(begin).not.toHaveBeenCalled()
    expect(f.counts().captured).toBeNull()
  }
  layer.dispose()
})

it('keeps the existing direct D path for one curved edge even with native visibility available',()=>{
  const f=fixture(), layer=createWorkspaceLayer(f.view,f.owner)
  const paths:Point[][]=[[[-1,-1,0],[0,-1,.1],[1,-1,0]]]
  f.set({directStrip:{paths,revision:9,axis:0}})
  f.owner.prepareDirectStripPick=vi.fn()
  f.owner.beginVerifiedDirectStripGesture=vi.fn()
  const handle=f.overlay.children.find(item=>item.dataset.test==='surface-strip-handle')!
  expect(f.getLayer().pointerDown?.(f.event(1,[0,-1,.1]))).toBe(true)
  expect(handle.style.display).toBe('block')
  const down={pointerId:7,button:0,clientX:parseFloat(handle.style.left),clientY:parseFloat(handle.style.top),
    preventDefault:vi.fn(),stopPropagation:vi.fn()} as unknown as PointerEvent
  handle.dispatch('pointerdown',down)
  expect(f.beginDirectStripGesture).toHaveBeenCalledWith(0,9)
  expect(f.owner.prepareDirectStripPick).not.toHaveBeenCalled()
  f.getHandlers().up(down)
  layer.dispose()
})


it.each(['visible','refused','outside click','recertified outside click','released','section'] as const)(
  'qualifies a sampled curved D edge using the picked segment (%s)',async scenario=>{
  const f=fixture()
  const path=Array.from({length:49},(_,i):Point=>{
    const x=(i-24)*.05
    return [x,-1+x*x/2,0]
  })
  const click:Point=[.025,-1+.05*.05/4,0]
  const curve:Point=[click[0],-1+click[0]*click[0]/2,0]
  const firstPoint:Point=[curve[0]+(scenario==='outside click'?.09:scenario==='recertified outside click'?.075:0),curve[1],curve[2]]
  const winner={edge:0,point:firstPoint}
  const prepare=vi.fn().mockResolvedValueOnce(scenario==='refused'?null:winner)
  const begin=vi.fn((pick:{readonly edge:number})=>f.beginDirectStripGesture(pick.edge,9))
  f.owner.prepareDirectStripPick=prepare
  f.owner.beginVerifiedDirectStripGesture=begin
  f.owner.cancelPreparedDirectStripPick=vi.fn()
  f.set({directStrip:{paths:[path],revision:9,axis:0}})
  const layer=createWorkspaceLayer(f.view,f.owner)
  const handle=f.overlay.children.find(item=>item.dataset.test==='surface-strip-handle')!
  if (scenario==='section') {
    f.getLayer().clippingChanged?.([new THREE.Plane(new THREE.Vector3(0,0,1),1)],false)
    f.getLayer().pointerDown?.(f.event(1,click))
    await flushBoundaryPick()
    expect(prepare).toHaveBeenCalledOnce()
    expect(handle.style.display).toBe('block')
    layer.dispose()
    return
  }
  expect(f.getLayer().pointerDown?.(f.event(1,click))).toBe(true)
  expect(handle.style.display).toBe('none')
  await flushBoundaryPick()
  expect(prepare.mock.calls[0][1]).toEqual([{edge:0,path,segment:24,
    seed:click.map(coordinate=>expect.closeTo(coordinate,8))}])
  if (scenario==='refused' || scenario==='outside click') {
    expect(handle.style.display).toBe('none')
    expect(begin).not.toHaveBeenCalled()
    layer.dispose()
    return
  }
  expect(handle.style.display).toBe('block')
  let complete!:(pick:typeof winner)=>void
  prepare.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve}))
  const down={pointerId:7,button:0,clientX:parseFloat(handle.style.left),clientY:parseFloat(handle.style.top),
    preventDefault:vi.fn(),stopPropagation:vi.fn()} as unknown as PointerEvent
  handle.dispatch('pointerdown',down)
  expect(prepare.mock.calls[1][1]).toEqual(prepare.mock.calls[0][1])
  expect(begin).not.toHaveBeenCalled()
  expect(f.counts().captured).toBe(7)
  const moved={...down,clientX:down.clientX+50}
  if (scenario==='released') f.getHandlers().up(down)
  else f.getHandlers().move(moved)
  complete(scenario==='recertified outside click'
    ? {edge:0,point:[firstPoint[0]+.0075,firstPoint[1],firstPoint[2]]} : winner)
  await flushBoundaryPick()
  if (scenario==='visible') {
    expect(begin).toHaveBeenCalledWith(winner)
    f.getHandlers().up(moved)
    expect(f.finishStripGesture.mock.lastCall?.[0]?.[0]).toBeCloseTo(.5)
  } else {
    expect(begin).not.toHaveBeenCalled()
    expect(f.finishStripGesture).not.toHaveBeenCalled()
  }
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

it('places D at the length midpoint of the visible portion when a section clips the edge midpoint', () => {
  const f = fixture(), layer = createWorkspaceLayer(f.view, f.owner)
  f.set({ net: null, strip: { ...stripFixture(), selectedEdge: 0, axis: 0 } })
  const handle = f.overlay.children.find(item => item.dataset.test === 'surface-strip-handle')!
  const plane = new THREE.Plane(new THREE.Vector3(1, 0, 0), -0.5)
  f.getLayer().clippingChanged?.([plane], false)
  expect(handle.style.display).toBe('block')
  const expected = f.client([0.75, -1, 0])
  expect(Number.parseFloat(handle.style.left)).toBeCloseTo(expected.clientX + 32)
  expect(Number.parseFloat(handle.style.top)).toBeCloseTo(expected.clientY - 32)
  layer.dispose()
})

it('does not show D when the section planes clip the whole selected edge', () => {
  const f = fixture(), layer = createWorkspaceLayer(f.view, f.owner)
  f.set({ net: null, strip: { ...stripFixture(), selectedEdge: 0, axis: 0 } })
  const handle = f.overlay.children.find(item => item.dataset.test === 'surface-strip-handle')!
  const keepRight = new THREE.Plane(new THREE.Vector3(1, 0, 0), -0.5)
  const keepLeft = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0.25)
  f.getLayer().clippingChanged?.([keepRight, keepLeft], false)
  expect(handle.style.display).toBe('none')
  layer.dispose()
})

it('moves D into a visible run when equal disconnected runs put their global midpoint on the section boundary', () => {
  const f = fixture({ worldOffset: 1e8 }), layer = createWorkspaceLayer(f.view, f.owner)
  const strip = { ...stripFixture(), selectedEdge: 0, axis: 0 as const,
    paths: [[[0, -1, 0], [0.5, -1, 0], [-0.5, -1, 0], [0, -1, 0], [1, -1, 0]] as Point[], ...stripFixture().paths.slice(1)] }
  f.set({ net: null, strip })
  const handle = f.overlay.children.find(item => item.dataset.test === 'surface-strip-handle')!
  const section = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0).applyMatrix4(f.group.matrixWorld)
  f.getLayer().clippingChanged?.([section], false)
  expect(handle.style.display).toBe('block')
  const expected = f.client([0.25, -1, 0])
  expect(Number.parseFloat(handle.style.left)).toBeCloseTo(expected.clientX + 32)
  expect(Number.parseFloat(handle.style.top)).toBeCloseTo(expected.clientY - 32)
  layer.dispose()
})

it('uses translated strip geometry and world section planes under a part transform', () => {
  const f = fixture({ rotated: true, worldOffset: 20 }), layer = createWorkspaceLayer(f.view, f.owner)
  const strip = { ...stripFixture(), selectedEdge: 0, axis: 0 as const, delta: [0.4, 0, 0] as Point }
  f.set({ net: null, strip })
  const handle = f.overlay.children.find(item => item.dataset.test === 'surface-strip-handle')!
  const partWorld = f.group.matrixWorld
  const keepRight = new THREE.Plane(new THREE.Vector3(1, 0, 0), -0.5).applyMatrix4(partWorld)
  const keepLeft = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0.75).applyMatrix4(partWorld)
  f.getLayer().clippingChanged?.([keepRight, keepLeft], false)
  expect(handle.style.display).toBe('block')
  // The visible translated interval is x=[0.5, 0.75], centered at 0.625.
  const expected = f.client([0.625, -1, 0])
  expect(Number.parseFloat(handle.style.left)).toBeCloseTo(expected.clientX + 32)
  expect(Number.parseFloat(handle.style.top)).toBeCloseTo(expected.clientY - 32)
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
  expect(f.requestFaceSelection).not.toHaveBeenCalled()
  expect(f.counts().captured).toBeNull()
  layer.dispose()
})

it('leaves the selected net and cell to camera navigation when navigation mode is on', () => {
  const f=fixture(), layer=createWorkspaceLayer(f.view,f.owner)
  f.set({selectionMode:'cells',selected:[0,1,2,3],navigationOnly:true})
  const at=f.client([0,0,0])
  expect(f.getLayer().pointerDown?.(f.event(1,[0,0,0]))).toBe(false)
  expect(f.getLayer().pointerDown?.(f.event(2,[-1,-1,0]))).toBe(false)
  expect(f.getLayer().click?.(at.clientX,at.clientY,false)).toBe(false)
  expect(f.claimEditDrag).not.toHaveBeenCalled()
  f.set({navigationOnly:false})
  expect(f.getLayer().pointerDown?.(f.event(3,[0,0,0]))).toBe(true)
  f.getHandlers().up(f.event(3,[0,0,0]))
  layer.dispose()
})

it('cancels a deferred edge drag when navigation mode is enabled',()=>{
  const f=fixture(),layer=createWorkspaceLayer(f.view,f.owner)
  f.set({directStrip:{paths:stripFixture().paths,revision:1,axis:0},selectionMode:'auto'})
  const down=f.event(1,[0,-1,0])
  expect(f.getLayer().pointerDown?.(down)).toBe(true)
  expect(f.counts().captured).toBe(1)
  f.set({navigationOnly:true})
  expect(f.counts().captured).toBeNull()
  expect(f.claimEditDrag).toHaveBeenLastCalledWith(false)
  f.getHandlers().move({...down,clientX:down.clientX+20} as PointerEvent)
  f.getHandlers().up({...down,clientX:down.clientX+20} as PointerEvent)
  expect(f.beginPoleGesture).not.toHaveBeenCalled()
  expect(f.finishPoleGesture).not.toHaveBeenCalled()
  layer.dispose()
})

it('still places a note when navigation mode is enabled',()=>{
  const f=fixture(),layer=createWorkspaceLayer(f.view,f.owner)
  f.set({navigationOnly:true,placingNote:true})
  expect(f.getLayer().click?.(300,300,false)).toBe(true)
  expect(f.placeNote).toHaveBeenCalledWith([0,0,0])
  layer.dispose()
})
