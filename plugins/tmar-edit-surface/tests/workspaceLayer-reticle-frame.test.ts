// SPDX-License-Identifier: AGPL-3.0-only
// Actual layer + Three geometry, controlled lease only. No renderer/host UI qualification.
import * as THREE from 'three'
import { expect, it, vi } from 'vitest'
import type { Net } from '../brep'
import type { WorkspaceReticleFrame, WorkspaceSurfaceLayerOwner, WorkspaceSurfaceView, WorkspaceSurfaceViewState } from '../workspaceBridge'
import { createWorkspaceLayer } from '../workspaceLayer'

function fixture(publisher: ((frame: WorkspaceReticleFrame | null) => void) | undefined = vi.fn()) {
  const parent = new THREE.Group(), group = new THREE.Group()
  parent.position.set(100, -200, 300); parent.rotation.set(.3, .6, .9); parent.scale.set(2, 3, 4)
  parent.add(group); parent.updateWorldMatrix(true, true)
  const camera = new THREE.PerspectiveCamera(35, 1, .1, 1000)
  camera.position.set(4, 5, 20); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true)
  const net: Net = { nu: 2, nv: 2, du: 1, dv: 1, poles: [[-1,-1,0],[-1,1,0],[1,-1,0],[1,1,0]],
    weights: [1,1,1,1], rational: [0,0], ku: [0,1], kv: [0,1], mu: [2,2], mv: [2,2] }
  const mesh = { positions: new Float32Array([-2,-2,0,2,-2,0,2,2,0,-2,2,0]),
    normals: new Float32Array([0,0,1,0,0,1,0,0,1,0,0,1]), indices: new Uint32Array([0,1,2,0,2,3]), vertexCount: 4, triangleCount: 2 }
  let state: WorkspaceSurfaceViewState = { net, preview: { mesh, faceMeshes: [mesh], valid: true, volume: 0, maxBoundaryError: 0, minimumNormalDot: 1 },
    reticleStamp: Object.freeze({ sessionId: 'reticle-test', sourceEpoch: 3, selectionEpoch: 4, draftEpoch: 5 }),
    face: 0, selected: [3], locked: [], hiddenPoles: [], selectionMode: 'points', dragMode: 'axis', axis: 0,
    dragStrength: 1, showNet: true, snap: false, snapDistance: .1, busy: false, placingNote: false, notePins: [], stripes: null }
  const listeners = new Set<() => void>(), reportViewError = vi.fn()
  let failState = false
  const owner = { getViewState: () => { if (failState) throw Error('revoked test lease'); return state },
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }, reportViewError,
    selectPoints: vi.fn(), requestFaceSelection: vi.fn(), beginPoleGesture: vi.fn(), previewPoles: vi.fn(), finishPoleGesture: vi.fn(), placeNote: vi.fn() } as unknown as WorkspaceSurfaceLayerOwner
  const node = () => ({ style: {}, dataset: {}, remove: vi.fn(), setAttribute: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })
  const view = { group, camera: () => camera, canvas: {}, overlayRoot: { ownerDocument: { createElement: node }, appendChild: vi.fn() },
    bounds: () => ({ left: 0, top: 0, width: 600, height: 600 }), projectPartPoint: () => ({clientX: 0, clientY: 0, visible: false}),
    addLayer: () => () => {}, onCapturedPointer: () => () => {}, onInterruption: () => () => {}, onFrame: () => () => {},
    references: () => [], subscribeReferences: () => () => {}, maskSourceForPreview: () => () => {}, invalidate: vi.fn(),
    ...(publisher ? { publishReticleFrame: publisher } : {}) } as unknown as WorkspaceSurfaceView
  const notify = () => { for (const fn of listeners) fn() }
  return { view, owner, group, parent, camera, reportViewError, state: () => state, notify,
    set: (patch: Partial<WorkspaceSurfaceViewState>) => { state = { ...state, ...patch }; notify() },
    fail: () => { failState = true; notify() }, recover: () => { failState = false; notify() } }
}

function lastFrame(publish: ReturnType<typeof vi.fn>): WorkspaceReticleFrame {
  const frame = publish.mock.lastCall?.[0] as WorkspaceReticleFrame | null
  expect(frame).not.toBeNull(); return frame!
}

it('publishes actual poles, arrow cone/line and mirror frame in part-local mm with the exact session stamp', () => {
  const publish = vi.fn(), f = fixture(publish)
  const before = { world: f.camera.matrixWorld.toArray(), projection: f.camera.projectionMatrix.toArray(), position: f.camera.position.toArray(), quaternion: f.camera.quaternion.toArray() }
  const layer = createWorkspaceLayer(f.view, f.owner)
  const frame = lastFrame(publish), cage = f.group.getObjectByName('tmar-edit-surface-cage')!
  expect(frame.stamp).toBe(f.state().reticleStamp)
  expect(frame.max[0]).toBeGreaterThan(1.5) // pole box ends at 1; actual arrow extends beyond it.
  expect(frame.min[0]).toBeLessThan(-1) // sphere radius, not just pole centres.
  // Independent oracle: every rendered geometry vertex, transformed through its ancestors up to the cage.
  const assertContainsVertices = () => {
    const current = lastFrame(publish)
    cage.traverse(object => {
      const positions = (object as THREE.Mesh).geometry?.getAttribute('position')
      if (!positions) return
      for (let i = 0; i < positions.count; i++) {
        const p = new THREE.Vector3().fromBufferAttribute(positions, i)
        for (let node: THREE.Object3D | null = object; node && node !== f.group; node = node.parent) p.applyMatrix4(node.matrix)
        p.toArray().forEach((v, axis) => { expect(v).toBeGreaterThanOrEqual(current.min[axis] - 1e-7); expect(v).toBeLessThanOrEqual(current.max[axis] + 1e-7) })
      }
    })
  }
  assertContainsVertices()
  expect(Math.max(...frame.max.map(Math.abs), ...frame.min.map(Math.abs))).toBeLessThan(3) // no parent transform.
  const count = publish.mock.calls.length
  f.set({ reticleStamp: { ...frame.stamp }, notePins: [[1000,1000,1000]] })
  expect(publish).toHaveBeenCalledTimes(count) // same stamp values/bounds; notes excluded.
  f.set({ symmetry: true, mirrorAxis: 0, mirrorOffset: 6, symmetryPartners: [2,3,0,1] })
  expect(lastFrame(publish).max[0]).toBeGreaterThanOrEqual(6); assertContainsVertices()
  const stamp = Object.freeze({ ...frame.stamp, draftEpoch: 6 })
  f.set({ reticleStamp: stamp, showNet: false })
  expect(lastFrame(publish).stamp).toBe(stamp)
  expect(cage.children.some(o => o instanceof THREE.Mesh)).toBe(true)
  expect({ world: f.camera.matrixWorld.toArray(), projection: f.camera.projectionMatrix.toArray(), position: f.camera.position.toArray(), quaternion: f.camera.quaternion.toArray() }).toEqual(before)
  layer.dispose(); expect(publish.mock.lastCall).toEqual([null]); expect(f.group.children).toHaveLength(0)
})

it('clears invalid/missing/empty bounds and invalid previews, then recovers; revoked state and cleanup publish null', () => {
  const publish = vi.fn(), f = fixture(publish), layer = createWorkspaceLayer(f.view, f.owner)
  const stamp = f.state().reticleStamp!, preview = f.state().preview!
  for (const bad of [undefined, { ...stamp, draftEpoch: NaN }, { ...stamp, sessionId: '' }]) {
    f.set({ reticleStamp: bad }); expect(publish.mock.lastCall).toEqual([null])
    f.set({ reticleStamp: stamp }); lastFrame(publish)
  }
  f.set({ hiddenPoles: [0,1,2,3], showNet: false }); expect(publish.mock.lastCall).toEqual([null])
  f.set({ hiddenPoles: [], showNet: true }); lastFrame(publish)
  f.set({ preview: { ...preview, valid: false } }); expect(publish.mock.lastCall).toEqual([null])
  f.set({ preview }); lastFrame(publish)
  f.set({ net: null }); expect(publish.mock.lastCall).toEqual([null])
  f.set({ net: fixture().state().net }); lastFrame(publish)
  const cage = f.group.getObjectByName('tmar-edit-surface-cage')!
  const sphere = cage.children.find(o => o instanceof THREE.Mesh) as THREE.Mesh
  sphere.position.x = NaN
  f.notify(); expect(publish.mock.lastCall).toEqual([null])
  f.set({ selected: [2] }); lastFrame(publish) // rebuilding disposes the invalid geometry transform.
  f.fail(); expect(publish.mock.lastCall).toEqual([null]); expect(f.reportViewError).toHaveBeenCalled()
  f.recover(); lastFrame(publish)
  layer.dispose(); expect(publish.mock.lastCall).toEqual([null])
})

it('keeps the newest frame when a synchronous host callback changes selection and stamp', () => {
  let reenter: (() => void) | undefined
  const publish = vi.fn((frame: WorkspaceReticleFrame | null) => { if (frame && reenter) { const run = reenter; reenter = undefined; run() } })
  const f = fixture(publish), layer = createWorkspaceLayer(f.view, f.owner)
  const stamp = { ...f.state().reticleStamp!, draftEpoch: 7 }
  reenter = () => f.set({ selected: [0], axis: 2, reticleStamp: stamp })
  f.set({ selected: [2], reticleStamp: { ...stamp, draftEpoch: 6 } })
  expect(lastFrame(publish).stamp).toBe(stamp)
  expect(lastFrame(publish).max[2]).toBeGreaterThan(.5)
  layer.dispose()
})

it('does not resume lease work after a synchronous publisher disposes the layer', () => {
  let disposeDuringPublish: (() => void) | undefined, invalidationsAtDispose = -1
  const publish = vi.fn((frame: WorkspaceReticleFrame | null) => { if (frame && disposeDuringPublish) {
    const dispose = disposeDuringPublish; disposeDuringPublish = undefined; dispose()
  } })
  const f = fixture(publish), layer = createWorkspaceLayer(f.view, f.owner)
  disposeDuringPublish = () => { layer.dispose(); invalidationsAtDispose = vi.mocked(f.view.invalidate).mock.calls.length }
  f.set({ selected: [2], axis: 2 })
  expect(publish.mock.lastCall).toEqual([null])
  expect(f.group.children).toHaveLength(0)
  expect(vi.mocked(f.view.invalidate).mock.calls.length).toBe(invalidationsAtDispose)
})

it('supports an older lease without the optional publisher and retries publication after a host failure', () => {
  const old = fixture(undefined)
  delete old.view.publishReticleFrame
  const oldLayer = createWorkspaceLayer(old.view, old.owner)
  old.set({ showNet: false }); expect(old.reportViewError).not.toHaveBeenCalled(); oldLayer.dispose()
  let failing = true
  const publish = vi.fn((frame: WorkspaceReticleFrame | null) => { if (failing && frame) throw Error('host unavailable') })
  const f = fixture(publish), layer = createWorkspaceLayer(f.view, f.owner)
  expect(publish.mock.calls.map(call => !!call[0])).toEqual([true, false])
  expect(f.reportViewError).not.toHaveBeenCalled()
  failing = false; f.notify(); lastFrame(publish)
  const count = publish.mock.calls.length; f.notify(); expect(publish).toHaveBeenCalledTimes(count)
  layer.dispose(); expect(publish.mock.lastCall).toEqual([null])
})
