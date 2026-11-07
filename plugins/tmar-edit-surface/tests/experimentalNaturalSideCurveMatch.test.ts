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

it('rejects coefficient or basis differences and inverse traversal explicitly', () => {
  const expected = curve('uMin')
  expect(matchNaturalSideCurve(net, 'uMin', { ...expected, poles: [[0,1,0], ...expected.poles.slice(1)] }).comparison.exact).toBe(false)
  expect(matchNaturalSideCurve(net, 'uMin', { ...expected, knots: [0,2] }).comparison.exact).toBe(false)
  expect(() => matchNaturalSideCurve(net, 'uMin', expected, -1)).toThrow(/verso inverso/)
  expect(() => matchNaturalSideCurve(net, 'uMin', { ...expected, periodic: true })).toThrow(/periodiche/)
})
