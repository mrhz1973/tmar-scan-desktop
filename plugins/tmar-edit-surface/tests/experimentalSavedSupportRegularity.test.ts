// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { boundExperimentalSavedSupportRegularity } from '../experimentalSavedSupportRegularity'

function extrudedSquare(uScale = 1, vScale = 1): Net {
  const xy = [[0, 0], [2, 0], [2, 3], [0, 3]]
  return { du: 1, dv: 5, nu: 4, nv: 6, periodic: [1, 0], rational: [0, 0],
    ku: [0, 1, 2, 3, 4].map(u => u * uScale), mu: [1, 1, 1, 1, 1], kv: [0, vScale], mv: [6, 6],
    poles: xy.flatMap(([x, y]) => Array.from({ length: 6 }, (_, v): Point => [x, y, v])), weights: Array<number>(24).fill(1) }
}

it('certifies every planar extrusion piece while retaining one-sided seam and corner scope', () => {
  const net = extrudedSquare(), before = structuredClone(net)
  const result = boundExperimentalSavedSupportRegularity(net, 4, 0)
  expect(result).toMatchObject({ status: 'regular-on-each-closed-native-cell', coverageComplete: true,
    expectedNativeCells: 4, checkedNativeCells: 4, certifiedNativeCells: 4, inconclusiveNativeCells: 0,
    nonpositiveNativeCells: 0, unvisitedNativeCells: 0, budgetExhausted: false,
    crossCellG1Certified: false, seamG1Certified: false, faceOrientationCertified: false, nativeCadCertified: false, tubeAccepted: false })
  // Each span has |Su|=2 or3 and |Sv|=5, with perpendicular derivatives.
  expect(result.minNativeNormalNormLower).toBeGreaterThan(10 - 1e-8)
  expect(result.minNativeNormalNormLower).toBeLessThanOrEqual(10)
  expect(result.minLocalNormalNormLower).toBeGreaterThan(10 - 1e-8)
  expect(result.problemCells).toEqual([])
  expect(net).toEqual(before)
})

it('separates normalized-cell normals from native normals under U and V reparameterization', () => {
  const base = boundExperimentalSavedSupportRegularity(extrudedSquare(), 4, 0)
  const stretched = boundExperimentalSavedSupportRegularity(extrudedSquare(2, 4), 4, 0)
  expect(stretched.status).toBe('regular-on-each-closed-native-cell')
  // The same geometry has the same local patches; Su cross Sv is divided
  // by (2*4), independently of the cell-normal coefficient proof.
  expect(stretched.minLocalNormalNormLower).toBeCloseTo(base.minLocalNormalNormLower!, 10)
  expect(stretched.minNativeNormalNormLower).toBeGreaterThan(1.25 - 1e-8)
  expect(stretched.minNativeNormalNormLower).toBeLessThanOrEqual(1.25)
  expect(stretched.worstNativeCell!.areaScaleUpper).toBeGreaterThanOrEqual(8)
})

it('declines collapsed supports and does not publish a full-domain lower bound from incomplete evidence', () => {
  const net = extrudedSquare(); net.poles = net.poles.map(([x, y]): Point => [x, y, 0])
  const result = boundExperimentalSavedSupportRegularity(net, 4, 0)
  expect(['inconclusive', 'nonpositive-witness']).toContain(result.status)
  expect(result.coverageComplete).toBe(true)
  expect(result.checkedNativeCells).toBe(4)
  expect(result.certifiedNativeCells).toBe(0)
  expect(result.inconclusiveNativeCells + result.nonpositiveNativeCells).toBe(4)
  expect(result.minNativeNormalNormLower).toBeNull()
  expect(result.minLocalNormalNormLower).toBeNull()
})

it('continues after an unresolved first piece and aggregates coverage of the other pieces', () => {
  const net = extrudedSquare()
  for (let v = 0; v < 6; v++) net.poles[6 + v] = [...net.poles[v]]
  const result = boundExperimentalSavedSupportRegularity(net, 4, 0)
  expect(result.coverageComplete).toBe(true)
  expect(result.checkedNativeCells).toBe(4)
  expect(result.certifiedNativeCells).toBe(3)
  expect(result.inconclusiveNativeCells + result.nonpositiveNativeCells).toBe(1)
  expect(result.problemCells[0]).toMatchObject({ uSpan: 0, vSpan: 0 })
  expect(result.minNativeNormalNormLower).toBeNull()
  expect(result.certifiedCellsMinNativeNormalNormLower).toBeGreaterThan(0)
})

it('reports a native-cell coverage budget explicitly without certifying unvisited cells', () => {
  const result = boundExperimentalSavedSupportRegularity(extrudedSquare(), 2, 0)
  expect(result).toMatchObject({ status: 'inconclusive', expectedNativeCells: 4, checkedNativeCells: 2,
    certifiedNativeCells: 2, coverageComplete: false, unvisitedNativeCells: 2, budgetExhausted: true,
    minNativeNormalNormLower: null, minLocalNormalNormLower: null })
  expect(result.certifiedCellsMinNativeNormalNormLower).toBeGreaterThan(0)
})

it('rejects unsupported bases, weights and invalid proof budgets before checking cells', () => {
  const net = extrudedSquare()
  expect(() => boundExperimentalSavedSupportRegularity(net, 0)).toThrow(/budget celle/)
  expect(() => boundExperimentalSavedSupportRegularity(net, 4097)).toThrow(/budget celle/)
  expect(() => boundExperimentalSavedSupportRegularity(net, 4, 17)).toThrow(/profondita/)
  expect(() => boundExperimentalSavedSupportRegularity({ ...net, rational: [1, 0] })).toThrow(/supporto polinomiale/)
  expect(() => boundExperimentalSavedSupportRegularity({ ...net, weights: net.weights.map(() => 2), rational: [1, 0] }))
    .toThrow(/supporto polinomiale/)
})
