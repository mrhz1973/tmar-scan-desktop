// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { proposeCompatibleCurvedTangency, validateCompatibleCurvedTangencyResult, type CompatibleCurvedTangencyRequest } from '../compatibleCurvedTangency'

function patch(support: boolean): Net {
  const u = [0, 1 / 3, 2 / 3, 1], v = [0, 1 / 6, .5, 5 / 6, 1], f = [0, 0, .2, 0, 0]
  const poles = u.flatMap(x => v.map((y, j): Point => [support ? x : x - 1, y, support ? x * f[j] : 0]))
  return { nu: 4, nv: 5, du: 3, dv: 3, poles, weights: poles.map(() => 1), rational: [0, 0],
    ku: [0, 1], kv: [0, .5, 1], mu: [4, 4], mv: [4, 1, 4] }
}
const fixture = (): CompatibleCurvedTangencyRequest => ({ net: patch(false), supportNet: patch(true), edge: 'U1', supportEdge: 'U0' })
function reverseU(n: Net): Net {
  const result = structuredClone(n)
  result.poles = result.poles.map((_, i) => [...n.poles[(n.nu - 1 - Math.floor(i / n.nv)) * n.nv + i % n.nv]])
  return result
}
function transpose(n: Net): Net {
  return { ...n, nu: n.nv, nv: n.nu, du: n.dv, dv: n.du, ku: [...n.kv], kv: [...n.ku], mu: [...n.mv], mv: [...n.mu],
    poles: Array.from({ length: n.poles.length }, (_, i) => [...n.poles[(i % n.nu) * n.nv + Math.floor(i / n.nu)]]),
    weights: [...n.weights], rational: [...n.rational] }
}

describe('compatible nonrational curved-support tangency', () => {
  it('changes only the free first-row pole and proves continuous regularity without mutating either input', () => {
    const request = fixture(), before = structuredClone(request)
    const result = proposeCompatibleCurvedTangency(request)
    expect(result.changedIndices).toEqual([12])
    expect(result.net.poles[12][2]).toBeCloseTo(-.2 / 3, 14)
    expect(result.validation.edgeRegularity).toBe('outward-rounded-coefficient-hull-proof')
    expect(result.validation.checkedDerivativePairs).toBe(20)
    expect(result.validation.minSupportNormalMagnitudeBound).toBeGreaterThan(0)
    expect(result.validation.minSelectedNormalMagnitudeBound).toBeGreaterThan(0)
    expect(result.validation.maxNormalSinBound).toBeLessThan(1e-12)
    expect(result.validation.globalG1Certified).toBe(false)
    expect(validateCompatibleCurvedTangencyResult(request, result.net)).toEqual(result.validation)
    result.net.poles[12][2] = 9
    expect(request).toEqual(before)
  })

  it('supports both parameter directions and either edge end', () => {
    for (const reverse of [false, true]) for (const transposed of [false, true]) {
      const request = fixture()
      if (reverse) { request.net = reverseU(request.net); request.supportNet = reverseU(request.supportNet); request.edge = 'U0'; request.supportEdge = 'U1' }
      if (transposed) { request.net = transpose(request.net); request.supportNet = transpose(request.supportNet); request.edge = reverse ? 'V0' : 'V1'; request.supportEdge = reverse ? 'V1' : 'V0' }
      const result = proposeCompatibleCurvedTangency(request)
      expect(result.changedIndices).toHaveLength(1)
      expect(result.validation.maxNormalSinBound).toBeLessThan(1e-12)
    }
  })

  it('accepts an explicitly reversed seam parameterization and refuses guessing its direction', () => {
    const request = fixture(), original = request.supportNet
    request.supportNet = { ...original, poles: original.poles.map((_, i) => [...original.poles[Math.floor(i / original.nv) * original.nv + original.nv - 1 - i % original.nv]]) }
    expect(() => proposeCompatibleCurvedTangency(request)).toThrow('bordo comune')
    expect(proposeCompatibleCurvedTangency({ ...request, reverseSupport: true }).changedIndices).toEqual([12])
  })

  it('handles a rotated seam and positive derivative scaling between different transverse domains', () => {
    const request = fixture(), angle = .37
    for (const net of [request.net, request.supportNet]) net.poles = net.poles.map(([x, y, z]) =>
      [Math.cos(angle) * x - Math.sin(angle) * y, Math.sin(angle) * x + Math.cos(angle) * y, z])
    request.supportNet.ku = [0, 2]; request.scale = 2
    const result = proposeCompatibleCurvedTangency(request)
    expect(result.changedIndices).toEqual([12])
    expect(result.validation.maxNormalSinBound).toBeLessThan(1e-12)
  })

  it('rejects incompatible locks, altered protected poles, changed structure and an incorrect final tangent', () => {
    const request = fixture(), accepted = proposeCompatibleCurvedTangency(request)
    expect(() => proposeCompatibleCurvedTangency({ ...request, lockIndices: [12] })).toThrow('incompatibile')
    for (const id of [0, 5, 19]) {
      const net = structuredClone(accepted.net); net.poles[id][2] += .1
      expect(() => validateCompatibleCurvedTangencyResult(request, net)).toThrow('protetto')
    }
    const altered = structuredClone(accepted.net); altered.kv[1] = .6
    expect(() => validateCompatibleCurvedTangencyResult(request, altered)).toThrow('struttura')
    const wrong = structuredClone(accepted.net); wrong.poles[12][2] += .1
    expect(() => validateCompatibleCurvedTangencyResult(request, wrong)).toThrow('derivate')
    const negativeZero = structuredClone(accepted.net); negativeZero.poles[0][2] = -0
    expect(() => validateCompatibleCurvedTangencyResult(request, negativeZero)).toThrow('protetto')
  })

  it('rejects mismatched bases or seams instead of fitting or moving the support', () => {
    const request = fixture()
    const mismatch = structuredClone(request); mismatch.supportNet.kv[1] = .6
    expect(() => proposeCompatibleCurvedTangency(mismatch)).toThrow('basi')
    const shifted = structuredClone(request); shifted.supportNet.poles[2][2] += .01
    expect(() => proposeCompatibleCurvedTangency(shifted)).toThrow('bordo comune')
    const curved = structuredClone(request)
    curved.net.poles[17][2] = .01; curved.supportNet.poles[2][2] = .01
    expect(() => proposeCompatibleCurvedTangency(curved)).toThrow('rettilineo')
  })

  it('refuses rational, periodic, non-C1, degenerate and unprovable derivative hulls', () => {
    const rational = fixture(); rational.supportNet.rational = [1, 1]; rational.supportNet.weights[7] = 2
    expect(() => proposeCompatibleCurvedTangency(rational)).toThrow('non razionali')
    const periodic = fixture(); periodic.net.periodic = [1, 0]
    expect(() => proposeCompatibleCurvedTangency(periodic)).toThrow('clamped')
    const nonC1 = fixture(), n = nonC1.supportNet
    n.nv = 7; n.mv = [4, 3, 4]
    n.poles = Array.from({ length: 28 }, (_, i): Point => [Math.floor(i / 7) / 3, (i % 7) / 6, 0])
    n.weights = n.poles.map(() => 1)
    expect(() => proposeCompatibleCurvedTangency(nonC1)).toThrow('C1')
    const sparse = fixture(); delete sparse.supportNet.poles[7]
    expect(() => proposeCompatibleCurvedTangency(sparse)).toThrow('sparso')
    const degenerate = fixture()
    for (const n of [degenerate.net, degenerate.supportNet]) for (const p of n.poles) p[1] = 0
    expect(() => proposeCompatibleCurvedTangency(degenerate)).toThrow('degenere')
    const unproven = fixture(); unproven.supportNet.poles[7] = [...unproven.supportNet.poles[2]]
    expect(() => proposeCompatibleCurvedTangency(unproven)).toThrow('regolarità')
  })

  it('validates all optional controls and does not change geometry when validation is refused', () => {
    const request = fixture(), before = structuredClone(request)
    for (const scale of [0, -1, NaN, Infinity]) expect(() => proposeCompatibleCurvedTangency({ ...request, scale })).toThrow('scala')
    for (const distanceTolerance of [0, -1, NaN, 1e-5]) expect(() => proposeCompatibleCurvedTangency({ ...request, distanceTolerance })).toThrow('tolleranze')
    for (const derivativeTolerance of [0, -1, NaN, 1e-5]) expect(() => proposeCompatibleCurvedTangency({ ...request, derivativeTolerance })).toThrow('tolleranze')
    for (const lockIndices of [[-1], [20], [.5], new Array(1)]) expect(() => proposeCompatibleCurvedTangency({ ...request, lockIndices })).toThrow('indice')
    expect(() => proposeCompatibleCurvedTangency({ ...request, preserveTangentEdges: ['U1'] })).toThrow('altro bordo')
    expect(request).toEqual(before)
  })
})
