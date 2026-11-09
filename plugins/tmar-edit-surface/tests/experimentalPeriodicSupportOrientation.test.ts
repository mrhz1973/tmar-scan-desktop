// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { extractExperimentalPeriodicLinearVBernsteinCell } from '../experimentalPeriodicQuinticBernsteinCells'
import { boundExperimentalPeriodicSupportOrientation } from '../experimentalPeriodicSupportOrientation'

function triangle(dv: 1 | 5 = 1): Net {
  const nv = dv + 1, xy = [[0, 0], [1, 0], [0, 1]]
  return { du: 1, dv, nu: 3, nv, periodic: [1, 0], rational: [0, 0],
    ku: [10, 12, 15, 20], mu: [1, 1, 1, 1], kv: [4, 8], mv: [nv, nv],
    poles: xy.flatMap(([x, y]) => Array.from({ length: nv }, (_, v): Point => [x, y, 4 * v / dv])),
    weights: Array<number>(3 * nv).fill(1) }
}
const budget = { maxNativeCells: 16, maxDepth: 8 }

it.each([1, 5] as const)('certifies relative orientation and reports native normal units for V degree %s', dv => {
  const source = triangle(dv), before = structuredClone(source)
  const candidate = { ...structuredClone(source), poles: source.poles.map(([x, y, z]): Point => [x, y, 2 * z]) }
  const result = boundExperimentalPeriodicSupportOrientation(source, candidate, budget)
  expect(result).toMatchObject({ status: 'certified-relative-orientation-and-regularity', expectedNativeCells: 3,
    checkedNativeCells: 3, certifiedNativeCells: 3, coverageComplete: true,
    nativeNormalUnits: 'length^2 per native-U per native-V', crossCellG1Certified: false, nativeCadCertified: false })
  // The last U span has width5 and edge length1; Sv has norm1 (source)
  // or2 (candidate). Local normals instead include DeltaU*DeltaV=20.
  expect(result.minNativeSourceNormalNormLower).toBeGreaterThan(0.2 - 1e-9)
  expect(result.minNativeSourceNormalNormLower).toBeLessThanOrEqual(0.2)
  expect(result.minNativeCandidateNormalNormLower).toBeGreaterThan(0.4 - 1e-9)
  expect(result.minNativeCandidateNormalNormLower).toBeLessThanOrEqual(0.4)
  expect(result.minLocalCandidateNormalNormLower).toBeGreaterThan(3)
  expect(source).toEqual(before)
})

it('records a reversed orientation witness without confusing it with unvisited coverage', () => {
  const source = triangle(), candidate = { ...structuredClone(source),
    poles: source.poles.map(([x, y, z]): Point => [x, y, -z]) }
  const result = boundExperimentalPeriodicSupportOrientation(source, candidate, budget)
  expect(result.status).toBe('nonpositive-orientation-witness')
  expect(result.coverageComplete).toBe(true)
  expect(result.nonpositiveNativeCells).toBe(3)
  expect(result.minNativeCandidateNormalNormLower).toBeNull()
  expect(result.problems.every(p => p.localNormalDotUpper! < 0)).toBe(true)
})

it('never publishes a full support lower bound after a collapsed cell or exhausted coverage budget', () => {
  const source = triangle(), candidate = structuredClone(source)
  candidate.poles = candidate.poles.map(([x, y]): Point => [x, y, 0])
  const collapsed = boundExperimentalPeriodicSupportOrientation(source, candidate, budget)
  expect(collapsed.status).not.toBe('certified-relative-orientation-and-regularity')
  expect(collapsed.coverageComplete).toBe(true)
  expect(collapsed.minNativeCandidateNormalNormLower).toBeNull()
  const partial = boundExperimentalPeriodicSupportOrientation(source, source, { maxNativeCells: 2, maxDepth: 0 })
  expect(partial).toMatchObject({ status: 'inconclusive', coverageComplete: false,
    checkedNativeCells: 2, certifiedNativeCells: 2, unvisitedNativeCells: 1, minNativeCandidateNormalNormLower: null })
})

it('keeps the separate linear seam certificate conditional on its derivative and normal criteria', () => {
  const xy = [[1, 0], [1, 0.5], [0.5, 1], [0, 1], [-0.5, 1], [-1, 0.5],
    [-1, 0], [-1, -0.5], [-0.5, -1], [0, -1], [0.5, -1], [1, -0.5]]
  const net: Net = { du: 3, dv: 1, nu: 12, nv: 2, periodic: [1, 0], rational: [0, 0],
    ku: [0, 1, 2, 3, 4], mu: [3, 3, 3, 3, 3], kv: [4, 8], mv: [2, 2],
    poles: xy.flatMap(([x, y]): Point[] => [[x, y, 0], [x, y, 4]]), weights: Array<number>(24).fill(1) }
  const seam = { maximumAbsoluteJump: 1e-12, maximumJumpChange: 1e-12, maximumNormalChord: 1e-8 }
  const result = boundExperimentalPeriodicSupportOrientation(net, net, { ...budget, linearVSeam: seam })
  expect(result.status).toBe('certified-relative-orientation-and-regularity')
  expect(result.linearVSeam).toMatchObject({ status: 'certified', orientedNormalDotPositive: true,
    evidence: { sourceJumpUpperMmPerU: 0, candidateJumpUpperMmPerU: 0, jumpChangeUpperMmPerU: 0, normalChordUpper: 0 } })
  const corner = triangle()
  const cornerResult = boundExperimentalPeriodicSupportOrientation(corner, corner, { ...budget, linearVSeam: seam })
  expect(cornerResult.status).toBe('certified-relative-orientation-and-regularity')
  expect(cornerResult.linearVSeam).toMatchObject({ status: 'inconclusive', reason: 'source-jump-unverified' })
})

it('rejects substituted bases and refuses to apply the linear extractor to quintic data', () => {
  const source = triangle(), changed = { ...structuredClone(source), ku: [10, 12, 15, 21] }
  expect(() => boundExperimentalPeriodicSupportOrientation(source, changed, budget)).toThrow(/basi sorgente/)
  expect(() => boundExperimentalPeriodicSupportOrientation(source, source, { maxNativeCells: 0, maxDepth: 8 })).toThrow(/budget/)
  const quintic = triangle(5)
  expect(() => extractExperimentalPeriodicLinearVBernsteinCell(quintic, quintic, 0, 0)).toThrow(/V lineare/)
})
