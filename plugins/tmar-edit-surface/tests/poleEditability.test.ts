// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { assertNet, type Net, type Point } from '../brep'
import { evaluatePoleLockState, poleLockExplanation, suggestedPoleUnlock } from '../poleEditability'
import { populateSurfaceCage } from '../surfaceCage'

const base = (): Net => {
  const poles: Point[] = Array.from({length: 25}, (_, i) => [Math.floor(i / 5), i % 5, 0])
  return { nu: 5, nv: 5, du: 3, dv: 3, poles, weights: Array(25).fill(1),
    rational: [0, 0], ku: [0, 0.5, 1], kv: [0, 0.5, 1],
    mu: [4, 1, 4], mv: [4, 1, 4] }
}
const policy = (n: Net, mode: 'G0' | 'G1', freeBoundary = false,
  trimLocks: number[] = [], manualLocks: number[] = [], hiddenPoles: number[] = []) =>
  evaluatePoleLockState(n, {continuity: mode, freeBoundary, trimLocks, manualLocks, hiddenPoles})

describe('Edit Surface 5x5 pole editability is aligned with the CAD guard', () => {
  it('G1 protects both rings, G0 protects only boundary, free natural sheet permits every pole', () => {
    const n = base()
    const strict = policy(n, 'G1')
    const border = policy(n, 'G0')
    const sheet = policy(n, 'G1', true)
    expect(strict.editable).toEqual([12])
    expect(strict.locked).toHaveLength(24)
    expect(strict.reasons[6]).toBe('g1-tangent-ring')
    expect(strict.reasons[0]).toBe('g1-boundary')
    expect(border.editable).toEqual([6, 7, 8, 11, 12, 13, 16, 17, 18])
    expect(border.reasons[0]).toBe('g0-boundary')
    expect(sheet.editable).toHaveLength(25)
    expect(sheet.locked).toEqual([])
    const g1Blocked = structuredClone(n); g1Blocked.poles[6][2] += 0.5
    expect(() => assertNet(n, g1Blocked, 'G1')).toThrow()
    expect(() => assertNet(n, g1Blocked, 'G0')).not.toThrow()
    const seamMoved = structuredClone(n); seamMoved.poles[0][2] += 0.5
    expect(() => assertNet(n, seamMoved, 'G0')).toThrow()
    expect(() => assertNet(n, seamMoved, 'G0', true)).not.toThrow()
  })

  it('trim, manual and hidden poles cannot be unlocked by geometric mode switching', () => {
    const n = base()
    const p = policy(n, 'G0', true, [6], [7], [8])
    expect(p.reasons[6]).toBe('trim')
    expect(p.reasons[7]).toBe('manual')
    expect(p.reasons[8]).toBe('hidden')
    expect(p.locked).toEqual([6, 7, 8])
    for (const i of [6, 7, 8]) {
      expect(suggestedPoleUnlock(p.reasons[i], true, true)).toBeNull()
      expect(poleLockExplanation[p.reasons[i]].length).toBeGreaterThan(10)
    }
  })

  it('suggestions never release a solid shared seam or manual locks', () => {
    expect(suggestedPoleUnlock('g1-tangent-ring', true, false)).toBe('g0')
    expect(suggestedPoleUnlock('g1-tangent-ring', false, true)).toBeNull()
    expect(suggestedPoleUnlock('g1-boundary', true, false)).toBeNull()
    expect(suggestedPoleUnlock('g0-boundary', true, false)).toBeNull()
    expect(suggestedPoleUnlock('g0-boundary', true, true)).toBe('free')
    expect(suggestedPoleUnlock('g1-boundary', true, true)).toBe('free')
    expect(suggestedPoleUnlock('manual', true, true)).toBeNull()
  })

  it('selected locked poles are rose diamonds without an arrow; free poles remain yellow with an arrow', () => {
    const n = base()
    const opts = {net: n, hiddenPoles: [], showNet: false, dragMode: 'axis' as const, axis: 2,
      mirrorAxis: 0, mirrorOffset: 0, mirrorPartners: null, radius: 10}
    const blocked = new THREE.Group()
    populateSurfaceCage(blocked, {...opts, selected: [6], locked: policy(n, 'G1').locked})
    const blockedPole = blocked.children.find(o => o.userData.point === 6) as THREE.Mesh
    expect(blockedPole.geometry).toBeInstanceOf(THREE.OctahedronGeometry)
    expect((blockedPole.material as THREE.MeshBasicMaterial).color.getHexString()).toBe('ef8298')
    expect(blocked.children.some(o => o instanceof THREE.ArrowHelper)).toBe(false)
    const free = new THREE.Group()
    populateSurfaceCage(free, {...opts, selected: [12], locked: policy(n, 'G1').locked})
    const freePole = free.children.find(o => o.userData.point === 12) as THREE.Mesh
    expect(freePole.geometry).toBeInstanceOf(THREE.SphereGeometry)
    expect((freePole.material as THREE.MeshBasicMaterial).color.getHexString()).toBe('ffcf35')
    expect(free.children.some(o => o instanceof THREE.ArrowHelper)).toBe(true)
  })
})
