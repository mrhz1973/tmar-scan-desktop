// SPDX-License-Identifier: AGPL-3.0-only
import { OcctKernel } from 'occt-wasm'
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { mapPeriodicKnotsAffineExactly } from '../experimentalPeriodicAffineCurveWitness'
import { proposeExperimentalPeriodicAffineTangency } from '../experimentalPeriodicAffineTangency'
import { runExperimentalPeriodicAffineTangencyCadFixture } from '../experimentalPeriodicTangencyCadFixture'

it('rejects an exact affine knot that cannot be represented in the original face domain', () => {
  expect(mapPeriodicKnotsAffineExactly([32, 55, 64], -16, 0)).toEqual([-16, -4.5, 0])
  // The normalized knot is 1/3. A domain of length 16 cannot represent it.
  expect(() => mapPeriodicKnotsAffineExactly([0, 1, 3], 0, 16)).toThrow(/non rappresentabili esattamente/)
})

it('rejects a source U period that overflows before its affine conversion', async () => {
  const k = await OcctKernel.init()
  try {
    const ku = Array.from({ length: 17 }, (_, i) => i)
    const poles = ku.slice(0, -1).flatMap(u => {
      const angle = u * Math.PI / 8
      return [0, 1, 2, 3].map((v): Point => [Math.cos(angle), Math.sin(angle), v])
    })
    const net: Net = { nu: 16, nv: 4, du: 2, dv: 3, poles, weights: poles.map(() => 1),
      rational: [0, 0], periodic: [1, 0], ku, mu: ku.map(() => 1), kv: [0, 3], mv: [4, 4] }
    const supportNet: Net = { ...net, poles: poles.map(([x, y, z]) => [x, y, z + 3]),
      ku: ku.map(u => (u - 8) * 2 ** 1020) }
    expect(supportNet.ku.every(Number.isFinite)).toBe(true)
    expect(mapPeriodicKnotsAffineExactly(supportNet.ku, 0, 16)).toEqual(ku)
    const request = { net, supportNet, edge: 'V1', supportEdge: 'V0' } as const
    expect(() => proposeExperimentalPeriodicAffineTangency(k, request)).toThrow(/reticolo U periodico o V clamped non valido/)
  } finally {
    k[Symbol.dispose]()
  }
})

it('uses an affine support with distinct knots and linear V, keeping the selected pcurve domain', async () => {
  const k = await OcctKernel.init()
  try {
    const receipt = runExperimentalPeriodicAffineTangencyCadFixture(k)
    for (const [i, expected] of [[0, 16], [32, 64]].entries()) {
      expect(receipt.domains[i][0]).toBeCloseTo(expected[0], 10)
      expect(receipt.domains[i][1]).toBeCloseTo(expected[1], 10)
    }
    expect(receipt.knots).toEqual([0, 1, 2, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 11.5, 12, 13, 14, 15, 16])
    expect(receipt.samples).toBe(73)
    expect(receipt.validation.changedIndices).toHaveLength(18)
    expect(receipt.validation.checkedSpans).toBe(18)
    expect(receipt.validation.evidenceScope).toBe('input-coefficients-only')
    expect(receipt.beforeNormalSin).toBeGreaterThan(0.25)
    for (const value of [receipt.afterNormalSin, receipt.maxSeamGap, receipt.maxRefinementGap,
      receipt.maxProtectedGap, receipt.maxProtectedNormalSin, receipt.maxStepSurfaceGap]) expect(value).toBeLessThan(1e-8)
    console.info(receipt)
  } finally {
    k[Symbol.dispose]()
  }
}, 30_000)
