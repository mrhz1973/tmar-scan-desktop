// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import {
  proposeCompatibleCurvedTangency,
  proposeExperimentalCurvedSeamTangency,
  validateExperimentalCurvedSeamTangencyResult,
  type ExperimentalCurvedSeamRequest,
} from '../compatibleCurvedTangency'

/** Quadratic Bezier seam C(t)=(t,t^2,0), with opposite unit inward offsets. */
function patch(support: boolean): Net {
  const seam: Point[] = [[0, 0, 0], [.5, 0, 0], [1, 1, 0]]
  const poles = Array.from({ length: 4 }, (_, u) => seam.map(([x, y, z], v): Point => {
    const offset = support ? (u === 0 ? 0 : u === 1 ? 1 : 2) : (u === 3 ? 0 : u === 2 ? (v === 1 ? 0 : -1) : -1)
    const xOffset = !support && u === 2 && v !== 1 ? x : x - (support || u === 3 ? 0 : 1)
    return [xOffset, y, z + offset]
  })).flat()
  return { nu: 4, nv: 3, du: 2, dv: 2, poles, weights: poles.map(() => 1), rational: [0, 0],
    ku: [0, .5, 1], kv: [0, 1], mu: [3, 1, 3], mv: [3, 3] }
}
const fixture = (): ExperimentalCurvedSeamRequest => ({ net: patch(false), supportNet: patch(true),
  edge: 'U1', supportEdge: 'U0', preserveTangentEdges: [] })
function reverseV(n: Net): Net {
  return { ...structuredClone(n), poles: Array.from({ length: n.poles.length }, (_, i) =>
    [...n.poles[Math.floor(i / n.nv) * n.nv + n.nv - 1 - i % n.nv]]) }
}

describe('experimental coefficient-only curved seam tangency', () => {
  it('proposes a G1 row on a genuinely curved quadratic seam and preserves input', () => {
    const request = fixture(), before = structuredClone(request)
    const result = proposeExperimentalCurvedSeamTangency(request)
    expect(result.changedIndices).toEqual([7])
    expect(result.validation.maxSeamDepartureUpperBound).toBeGreaterThan(0)
    expect(result.validation.checkedDerivativePairs).toBe(6)
    expect(result.validation.maxNormalSinBound).toBeLessThan(1e-12)
    expect(result.validation.globalG1Certified).toBe(false)
    expect(validateExperimentalCurvedSeamTangencyResult(request, result.net)).toEqual(result.validation)
    expect(request).toEqual(before)
  })

  it('does not treat the coefficient chord-departure upper bound as proof that the seam is curved', () => {
    const request = fixture()
    for (const net of [request.net, request.supportNet]) for (const pole of net.poles) pole[1] = 0
    const result = proposeExperimentalCurvedSeamTangency(request)
    expect(result.validation.maxSeamDepartureUpperBound).toBeGreaterThanOrEqual(0)
    expect(result.changedIndices).toEqual([7])
  })

  it('handles an explicitly reversed support basis and rejects a mismatched basis', () => {
    const request = fixture()
    request.supportNet = reverseV(request.supportNet)
    expect(() => proposeExperimentalCurvedSeamTangency(request)).toThrow('bordo comune')
    expect(proposeExperimentalCurvedSeamTangency({ ...request, reverseSupport: true }).changedIndices).toEqual([7])
    const mismatch = fixture(); mismatch.supportNet.kv = [0, 2]
    expect(() => proposeExperimentalCurvedSeamTangency(mismatch)).toThrow('basi')
  })

  it('rejects degenerate seams, protected-pole edits, and calls through the legacy straight-only API', () => {
    const degenerate = fixture()
    for (const net of [degenerate.net, degenerate.supportNet]) {
      const row = net === degenerate.net ? 3 : 0
      for (let v = 0; v < net.nv; v++) net.poles[row * net.nv + v] = [0, 0, 0]
    }
    expect(() => proposeExperimentalCurvedSeamTangency(degenerate)).toThrow('degenere')

    const request = fixture(), result = proposeExperimentalCurvedSeamTangency(request)
    const edited = structuredClone(result.net); edited.poles[0][2] = 1
    expect(() => validateExperimentalCurvedSeamTangencyResult(request, edited)).toThrow('protetto')
    expect(() => proposeCompatibleCurvedTangency(request)).toThrow('rettilineo')
  })
})
