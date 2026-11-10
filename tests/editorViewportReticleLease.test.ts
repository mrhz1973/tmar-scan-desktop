// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createEditorViewportLease } from '../src/viewer/editorViewportLease'
import type { SceneManager } from '../src/viewer/SceneManager'
import type { ReticleFrame } from '../src/plugins/workspaceEditorTypes'

const stamp = { sessionId: 'reticle-session', sourceEpoch: 4, selectionEpoch: 2, draftEpoch: 7 }
const target: ReticleFrame = { min: [-2, 0, 1], max: [3, 5, 8], stamp }
function fixture() {
  let held: number | null = null
  const win = { addEventListener: vi.fn(), removeEventListener: vi.fn() }
  const ownerDocument = {
    defaultView: win,
    createElement: vi.fn(() => ({ dataset: {}, style: {}, hidden: false, remove: vi.fn() })),
  }
  const canvas = {
    ownerDocument,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    hasPointerCapture: (id: number) => held === id,
    setPointerCapture: (id: number) => { held = id },
    releasePointerCapture: (id: number) => { if (held === id) held = null },
  }
  const partGroup = new THREE.Group()
  partGroup.position.set(30, -20, 11)
  partGroup.rotation.z = Math.PI / 3
  const container = { ownerDocument, appendChild: vi.fn() }
  const fitBox = vi.fn()
  const host = { partGroup, canvas, container, camera: () => new THREE.OrthographicCamera(),
    invalidate: vi.fn(), clipPlanes: () => [], theme: () => ({}) }
  const scene = {
    layerHost: () => host, leaseEditorInput: () => () => {},
    addLayer: () => () => {}, fitBox,
  } as unknown as SceneManager
  const assertCurrent = vi.fn()
  const adapter = {
    references: () => [],
    subscribeReferences: () => () => {},
    maskSource: () => () => {},
    sourceVisible: () => true,
    assertCurrent,
  }
  const owned = createEditorViewportLease(scene, adapter)
  return { owned, fitBox, partGroup, canvas, assertCurrent }
}
describe('actual EditorViewportLease reticle framing boundary', () => {
  it('publishes without moving the camera; only explicit host action fits the transformed bounds', () => {
    const f = fixture()
    const notice = vi.fn()
    f.owned.onReticleFrameChanged!(notice)
    f.owned.view.publishReticleFrame!(target)
    expect(notice).toHaveBeenCalledTimes(1)
    expect(f.fitBox).not.toHaveBeenCalled()
    f.owned.view.publishReticleFrame!({ ...target })
    expect(notice).toHaveBeenCalledTimes(1)
    expect(f.owned.frameReticle!({ ...stamp, draftEpoch: 8 })).toBe(false)
    expect(f.fitBox).not.toHaveBeenCalled()
    expect(f.owned.frameReticle!(stamp)).toBe(true)
    expect(f.fitBox).toHaveBeenCalledTimes(1)
    const [min, max] = f.fitBox.mock.calls[0] as [number[], number[]]
    f.partGroup.updateWorldMatrix(true, false)
    for (const x of [target.min[0], target.max[0]]) {
      for (const y of [target.min[1], target.max[1]]) {
        for (const z of [target.min[2], target.max[2]]) {
          const w = new THREE.Vector3(x, y, z).applyMatrix4(f.partGroup.matrixWorld)
          expect(w.x).toBeGreaterThan(min[0])
          expect(w.y).toBeGreaterThan(min[1])
          expect(w.z).toBeGreaterThan(min[2])
          expect(w.x).toBeLessThan(max[0])
          expect(w.y).toBeLessThan(max[1])
          expect(w.z).toBeLessThan(max[2])
        }
      }
    }
    f.owned.dispose()
  })
  it('rejects malformed bounds, active pointer capture and disposed leases without fitting', () => {
    const f = fixture()
    f.owned.view.publishReticleFrame!({ ...target, max: [Infinity, 0, 0] })
    expect(f.owned.frameReticle!(stamp)).toBe(false)
    f.owned.view.publishReticleFrame!(target)
    expect(f.owned.view.capturePointer(55)).toBe(true)
    expect(f.owned.frameReticle!(stamp)).toBe(false)
    f.owned.view.releasePointer(55)
    expect(f.owned.frameReticle!(stamp)).toBe(true)
    f.owned.dispose()
    expect(f.owned.frameReticle!(stamp)).toBe(false)
    expect(() => f.owned.view.publishReticleFrame!(target)).toThrow()
    expect(f.fitBox).toHaveBeenCalledTimes(1)
  })
})