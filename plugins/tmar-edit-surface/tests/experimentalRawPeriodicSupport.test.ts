// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Point } from '../brep'
import { prepareExperimentalRawPeriodicSupport, type ExperimentalRawPolynomialSupport } from '../experimentalRawPeriodicSupport'

function raw(nv = 2): ExperimentalRawPolynomialSupport {
  const xy = [[0, 0], [2, 0], [4, 1], [4, 2], [2, 3], [0, 2], [0, 0]]
  return { degreeU: 3, degreeV: nv === 2 ? 1 : 5, knotsU: [8, 10, 12, 14, 16],
    multiplicitiesU: [1, 3, 3, 3, 1], activeU: [10, 14],
    knotsV: nv === 2 ? [20, 24] : [20, 21, 23, 24], multiplicitiesV: nv === 2 ? [2, 2] : [6, 3, 3, 6],
    poles: xy.map(([x, y]) => Array.from({ length: nv }, (_, v): Point => [x + 7 * v, y - 3 * v, 2 * v])) }
}

it('retains U-major tensor ordering, original parameters and linear or quintic V without aliasing inputs', () => {
  for (const nv of [2, 12]) {
    const input = raw(nv), before = structuredClone(input)
    const result = prepareExperimentalRawPeriodicSupport(input)
    expect(result).toMatchObject({ status: 'prepared-coefficient-representation', originalActiveU: [10, 14],
      nativeCadCertified: false, differentialContinuityCertified: false, tubeAccepted: false })
    expect(result.net).toMatchObject({ nu: 6, nv, du: 3, dv: nv === 2 ? 1 : 5,
      ku: [10, 12, 14], mu: [3, 3, 3], kv: input.knotsV, mv: input.multiplicitiesV, periodic: [1, 0] })
    // These independently identifiable controls catch transposition or an
    // accidental cyclic shift at the periodic boundary.
    expect(result.net.poles[0]).toEqual([0, 0, 0])
    expect(result.net.poles[nv + 1]).toEqual([9, -3, 2])
    expect(result.net.poles[5 * nv + nv - 1]).toEqual([7 * (nv - 1), 2 - 3 * (nv - 1), 2 * (nv - 1)])
    expect(result.perVClamps).toHaveLength(nv)
    expect(result.perVClamps.every(r => r.maximumClampEmissionErrorUpper === 0 && r.exactClosedCurveIdentity)).toBe(true)
    result.net.poles[0][0] = 999
    result.net.kv[0] = -999
    expect(input).toEqual(before)
  }
})

it('refuses a substituted active domain or nonclosure in any single V control column', () => {
  expect(() => prepareExperimentalRawPeriodicSupport({ ...raw(), activeU: [10, 12] })).toThrow(/active-u-domain-substitution/)
  const input = raw(12), poles = input.poles.map(row => row.map(p => [...p] as Point))
  poles[poles.length - 1][7][2] += 1
  expect(() => prepareExperimentalRawPeriodicSupport({ ...input, poles })).toThrow(/column-7-not-exactly-closed/)
})

it('refuses a closed padded representation whose exact clamp requires rounded coefficients', () => {
  // The clamped endpoint is (2/3,1/6,v), which is not exactly binary64.
  const xy = [[0, 0], [1, 0], [0, 1], [-1, 0], [0, 0], [1, 0], [0, 1]]
  const input: ExperimentalRawPolynomialSupport = { ...raw(), knotsU: [-3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7],
    multiplicitiesU: Array<number>(11).fill(1), activeU: [0, 4],
    poles: xy.map(([x, y]) => [[x, y, 0], [x, y, 1]] as Point[]) }
  expect(() => prepareExperimentalRawPeriodicSupport(input)).toThrow(/nonzero-clamp-emission-error/)
})

it('does not silently omit sparse coefficients or treat rational/nonunit data as polynomial', () => {
  const input = raw(), sparse = input.poles.map(row => row.map(p => [...p] as Point))
  delete sparse[2][1]
  expect(() => prepareExperimentalRawPeriodicSupport({ ...input, poles: sparse })).toThrow(/nonrectangular/)
  expect(() => prepareExperimentalRawPeriodicSupport({ ...input, rational: true })).toThrow(/invalid-polynomial/)
  const weights = input.poles.map(row => row.map(() => 1)); weights[3][1] = 2
  expect(() => prepareExperimentalRawPeriodicSupport({ ...input, weights })).toThrow(/nonunit/)
})
