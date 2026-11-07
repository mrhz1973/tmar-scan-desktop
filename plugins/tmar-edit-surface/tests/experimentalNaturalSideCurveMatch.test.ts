import { expect, it } from 'vitest'
import type { Net } from '../brep'
import { matchNaturalSideCurve } from '../experimentalNaturalSideCurveMatch'
import type { Curve3dRecord } from '../experimentalCurveWitness'

const net: Net = {
  nu: 3, nv: 2, du: 2, dv: 1,
  poles: [[0,0,0],[0,1,0], [1,0,0],[1,1,0], [2,0,0],[2,1,0]],
  weights: [1,1, 1,1, 1,1], rational: [0,0],
  ku: [0,1], mu: [3,3], kv: [0,1], mv: [2,2], periodic: [0,0]
}
const curve = (side: 'uMin' | 'uMax' | 'vMin' | 'vMax'): Curve3dRecord => {
  const alongU = side[0] === 'v'
  const indices = alongU
    ? side === 'vMin' ? [0,2,4] : [1,3,5]
    : side === 'uMin' ? [0,1] : [4,5]
  return {
    kind: 7, rational: false, periodic: false,
    degree: alongU ? 2 : 1,
    poles: indices.map(i => [...net.poles[i]] as [number,number,number]), weights: indices.map(() => 1),
    knots: [0,1], multiplicities: alongU ? [3,3] : [2,2], source: 'curve-table'
  }
}

it('extracts the correct varying axis and exact natural boundary coefficients on all four sides', () => {
  for (const side of ['uMin','uMax','vMin','vMax'] as const) {
    const result = matchNaturalSideCurve(net, side, curve(side))
    expect(result.side).toBe(side)
    expect(result.along).toBe(side[0] === 'u' ? 'V' : 'U')
    expect(result.comparison.exact).toBe(true)
  }
})

it('rejects coefficient or basis differences and periodic curves', () => {
  const expected = curve('uMin')
  expect(matchNaturalSideCurve(net, 'uMin', { ...expected, poles: [[0,1,0], ...expected.poles.slice(1)] }).comparison.exact).toBe(false)
  expect(matchNaturalSideCurve(net, 'uMin', { ...expected, knots: [0,2] }).comparison.exact).toBe(false)
  expect(() => matchNaturalSideCurve(net, 'uMin', { ...expected, periodic: true })).toThrow(/periodiche/)
})

it('reverses the poles, weights and asymmetric basis on a rational boundary', () => {
  const rationalNet: Net = {
    ...net, nu: 6, rational: [1, 0], ku: [2, 2.25, 3.5, 4], mu: [3, 1, 2, 3],
    poles: Array.from({ length: 12 }, (_, i) => [i, i % 3, i % 4]),
    weights: Array.from({ length: 12 }, (_, i) => i + 1)
  }
  const original = structuredClone(rationalNet)
  const expected: Curve3dRecord = {
    ...curve('vMin'), rational: true,
    poles: [[10, 1, 2], [8, 2, 0], [6, 0, 2], [4, 1, 0], [2, 2, 2], [0, 0, 0]],
    weights: [11, 9, 7, 5, 3, 1], knots: [2, 2.5, 3.75, 4], multiplicities: [3, 2, 1, 3]
  }
  const match = matchNaturalSideCurve(rationalNet, 'vMin', expected, -1)
  expect(match.comparison.exact).toBe(true)
  expect(match.curve).toEqual({ ...expected, source: 'inline-surface-generator' })
  expect(rationalNet).toEqual(original)
  expect(matchNaturalSideCurve(rationalNet, 'vMin', expected).comparison.exact).toBe(false)
  expect(matchNaturalSideCurve(rationalNet, 'vMin', { ...expected, knots: rationalNet.ku }, -1).comparison.sameKnots).toBe(false)
  expect(matchNaturalSideCurve(rationalNet, 'vMin', { ...expected, multiplicities: rationalNet.mu }, -1).comparison.sameMultiplicity).toBe(false)
  expect(matchNaturalSideCurve(rationalNet, 'vMin', { ...expected, weights: [1, 3, 5, 7, 9, 11] }, -1).comparison.sameWeights).toBe(false)
})

function linearSideWithKnots(knots: number[]): Net {
  return {
    ...net, nv: 3, kv: knots, mv: [2, 1, 2],
    poles: Array.from({ length: 9 }, (_, i) => [Math.floor(i / 3), i % 3, 0]),
    weights: Array(9).fill(1)
  }
}

function reversedLinearCurve(knots: number[]): Curve3dRecord {
  return { ...curve('uMin'), poles: [[0, 2, 0], [0, 1, 0], [0, 0, 0]], weights: [1, 1, 1], knots, multiplicities: [2, 1, 2] }
}

it('reflects exactly when a floating-point sum of the domain endpoints overflows', () => {
  const large = 2 ** 1023
  const input = linearSideWithKnots([large, 1.5 * large, 1.75 * large])
  const expected = reversedLinearCurve([large, 1.25 * large, 1.75 * large])
  expect(matchNaturalSideCurve(input, 'uMin', expected, -1).comparison.exact).toBe(true)
})

it('preserves an exactly representable subnormal reflected knot', () => {
  const input = linearSideWithKnots([-1, Number.MIN_VALUE, 1])
  const expected = reversedLinearCurve([-1, -Number.MIN_VALUE, 1])
  expect(matchNaturalSideCurve(input, 'uMin', expected, -1).comparison.exact).toBe(true)
})

it('refuses an unrepresentable reflected knot even when its rounded value matches', () => {
  const input = linearSideWithKnots([Number.MIN_VALUE, 0.5, 1])
  const rounded = reversedLinearCurve([Number.MIN_VALUE, 0.5, 1])
  expect(() => matchNaturalSideCurve(input, 'uMin', rounded, -1)).toThrow(/nodo riflesso non rappresentabile esattamente/)
})
