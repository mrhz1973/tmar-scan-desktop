// SPDX-License-Identifier: AGPL-3.0-only
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Net, Point } from '../brep'
import { createSurfaceGesture } from '../surfaceGesture'
import { snapAlong } from '../snap'
import { SurfaceDraft } from '../surfaceDraft'
import { SurfaceRuntime } from '../surfaceRuntime'

// Geometry and draft logic are real; pointer-to-mm input and the CAD worker
// are simulated. This is not a viewport, kernel or exported-STEP qualification.
class WorkerStub {
  onmessage: ((event: MessageEvent) => void) | null = null
  postMessage() {}
  terminate() {}
}

function cylinderSix(): Net {
  const poles: Point[] = [], weights: number[] = []
  const heights = [0, 2, 6, 12, 16, 18]
  for (let u = 0; u < 6; u++) {
    const angle = u * Math.PI / 3, weight = u % 2 ? 0.5 : 1
    for (const z of heights) {
      poles.push([10 * Math.cos(angle) / weight, 10 * Math.sin(angle) / weight, z])
      weights.push(weight)
    }
  }
  return { nu: 6, nv: 6, du: 2, dv: 3, poles, weights, rational: [1, 0],
    periodic: [1, 0], ku: [0, 2, 4, 6], mu: [2, 2, 2, 2],
    kv: [0, 6, 12, 18], mv: [4, 1, 1, 4] }
}

afterEach(() => vi.useRealTimers())

describe.each(['scan', 'cad'] as const)('cylinder gesture snapping to %s geometry', kind => {
  it('retains the hit, couples companions, preserves other poles and history, and refuses a locked companion', () => {
    vi.useFakeTimers()
    const runtime = new SurfaceRuntime(() => new WorkerStub() as unknown as Worker)
    const draft = new SurfaceDraft(runtime)
    const geometry = new THREE.PlaneGeometry(8, 8)
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
    try {
      draft.installCylinder(cylinderSix(), 8)
      const base = draft.getSnapshot().net!, center = 3 * base.nv + 2
      const left = 2 * base.nv + 2, right = 4 * base.nv + 2
      const anchor = new THREE.Vector3(...base.poles[center])
      const target = new THREE.Mesh(geometry, material)
      target.position.copy(anchor).add(new THREE.Vector3(0, 0, 0.75))
      target.userData.snapKind = kind
      target.userData.snapLabel = `${kind} cylinder reference`
      target.updateMatrixWorld(true)
      const makeGesture = (net: Net) => {
        const start = new THREE.Vector3(...net.poles[center])
        return createSurfaceGesture({
          frame: { deltaAt: () => [0, 0, 0.5] },
          poles: net.poles, selected: [center], start: { pointerId: 1, clientX: 0, clientY: 0 }, strength: 1,
          // Same anchor/delta contract as workspaceLayer's snap resolver.
          resolveDelta: delta => {
            const hit = snapAlong(start.clone().add(new THREE.Vector3(...delta)), new THREE.Vector3(0, 0, 1), 1, [target])
            expect(hit).toMatchObject({ kind, label: `${kind} cylinder reference` })
            expect(hit!.point.distanceTo(target.position)).toBeLessThan(1e-12)
            return hit!.point.clone().sub(start).toArray() as Point
          },
        })!
      }
      const gesture = makeGesture(base), sample = { pointerId: 1, clientX: 10, clientY: 0 }
      const preview = gesture.move(sample)
      expect(preview.kind).toBe('preview')
      if (preview.kind !== 'preview') throw new Error('Expected preview')
      draft.preview({ ...base, poles: preview.poles })
      const assertSnapped = (net: Net) => {
        expect(new THREE.Vector3(...net.poles[center]).distanceTo(target.position)).toBeLessThan(1e-12)
        // Independent oracle: do not call the coupling helper under test.
        const factorLeft = base.weights[3 * base.nv + 2] / (base.weights[base.nv + 2] + base.weights[3 * base.nv + 2])
        const factorRight = base.weights[3 * base.nv + 2] / (base.weights[3 * base.nv + 2] + base.weights[5 * base.nv + 2])
        for (const [id, factor] of [[left, factorLeft], [right, factorRight]]) {
          expect(net.poles[id]).toEqual([base.poles[id][0], base.poles[id][1], base.poles[id][2] + 0.75 * factor])
        }
        // Includes the second editable row, seam and protected end rows.
        for (let i = 0; i < base.poles.length; i++) if (![left, center, right].includes(i)) expect(net.poles[i]).toEqual(base.poles[i])
        expect({ ...net, poles: [] }).toEqual({ ...base, poles: [] })
      }
      assertSnapped(draft.getSnapshot().net!)
      expect(runtime.history.canUndo).toBe(false)
      const released = gesture.up(sample)
      expect(released.kind).toBe('commit')
      if (released.kind !== 'commit') throw new Error('Expected commit')
      draft.commit({ ...base, poles: released.poles })
      assertSnapped(draft.getSnapshot().net!)
      expect(draft.undo()).toBe(true)
      expect(draft.getSnapshot().net).toEqual(base)
      expect(draft.redo()).toBe(true)
      assertSnapped(draft.getSnapshot().net!)

      expect(draft.undo()).toBe(true)
      draft.setLocks([left])
      const locked = draft.getSnapshot(), blocked = makeGesture(locked.net!).move(sample)
      if (blocked.kind !== 'preview') throw new Error('Expected snapped proposal')
      const proposal = { ...locked.net!, poles: blocked.poles }
      expect(() => draft.preview(proposal)).toThrow('bloccato')
      expect(draft.getSnapshot()).toBe(locked)
      expect(() => draft.commit(proposal)).toThrow('bloccato')
      expect(draft.getSnapshot()).toBe(locked)
      expect(draft.getSnapshot().net).toEqual(base)
    } finally {
      draft.dispose(); runtime.dispose(); geometry.dispose(); material.dispose()
    }
  })
})
