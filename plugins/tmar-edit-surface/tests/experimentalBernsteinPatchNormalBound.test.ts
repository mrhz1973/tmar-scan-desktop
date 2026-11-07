// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { boundExperimentalBernsteinPatchNormals,
  type ExperimentalBernsteinSurfacePatch } from '../experimentalBernsteinPatchNormalBound'
import { vector } from '../tangencyCoefficientIntervals'

function plane(): ExperimentalBernsteinSurfacePatch {
  return { degreeU: 1, degreeV: 1, controls: [0, 1].flatMap(x => [0, 1].map(z => vector([x, 0, z]))) }
}

function strip(heights: number[], lateral = 0): ExperimentalBernsteinSurfacePatch {
  return { degreeU: 1, degreeV: 3,
    controls: [0, 1].flatMap(x => heights.map((z, i) => vector([x, i * lateral, z]))) }
}

it('certifies relative orientation and normal magnitudes for a general bicubic patch with interval coefficients', () => {
  const controls = Array.from({ length: 4 }, (_, i) =>
    Array.from({ length: 4 }, (_, j) => vector([i, i * j, j]))).flat()
  controls[15][2] = [3 - 1 / 128, 3 + 1 / 128]
  const reference = { degreeU: 3, degreeV: 3, controls: Array.from({ length: 4 }, (_, i) =>
    Array.from({ length: 4 }, (_, j) => vector([i, 0, j]))).flat() }
  const result = boundExperimentalBernsteinPatchNormals({ degreeU: 3, degreeV: 3, controls }, reference)
  expect(result.status).toBe('certified-positive')
  if (result.status !== 'certified-positive') throw new Error('Expected a positive certificate')

  // S=(3u,9uv,3v+e*u³*v³), |e|<=1/128. The exact dot is
  // 81+81e*u³*v², and neither normal can have norm below its |Y|.
  expect(result.minNormalDot).toBeGreaterThan(80)
  expect(result.minNormalDot).toBeLessThanOrEqual(81 - 81 / 128)
  expect(result.minCandidateNormalNorm).toBeGreaterThan(0)
  expect(result.minCandidateNormalNorm).toBeLessThanOrEqual(9 - 9 / 128)
  expect(result.minReferenceNormalNorm).toBeGreaterThan(0)
  expect(result.minReferenceNormalNorm).toBeLessThanOrEqual(9)
})

it('subdivides an ambiguous hull until positivity can be proved', () => {
  const candidate = strip([0, 101, 2, 103])
  const reference = plane()
  expect(boundExperimentalBernsteinPatchNormals(candidate, reference, 0)).toMatchObject({
    status: 'inconclusive', checkedCells: 1,
  })
  const result = boundExperimentalBernsteinPatchNormals(candidate, reference)
  expect(result.status).toBe('certified-positive')
  if (result.status !== 'certified-positive') throw new Error('Expected a positive certificate')

  // Exact dot 300*(2v-1)²+3 has minimum 3 despite a negative initial
  // Bernstein coefficient.
  expect(result.checkedCells).toBeGreaterThan(1)
  expect(result.minNormalDot).toBeGreaterThan(0)
  expect(result.minNormalDot).toBeLessThanOrEqual(3)
})

it('proves a nonpositive witness between the five former V samples', () => {
  const reference = plane()
  const candidate = strip([0, 24, -952, 37_072], 1)
  const exactDot = (v: number) => 3 * ((200 * v - 5) ** 2 - 1)
  expect([0.05, 0.25, 0.5, 0.75, 0.95].every(v => exactDot(v) > 0)).toBe(true)
  const result = boundExperimentalBernsteinPatchNormals(candidate, reference)
  expect(result.status).toBe('nonpositive-witness')
  if (result.status !== 'nonpositive-witness') throw new Error('Expected a nonpositive witness')

  // The lateral V derivative is 3. The candidate normal stays nonzero
  // even in the negative-dot region, so the witness concerns orientation.
  const [, v] = result.parameter
  expect(v).toBeGreaterThan(0.02)
  expect(v).toBeLessThan(0.03)
  expect(exactDot(v)).toBeLessThanOrEqual(result.normalDotUpperBound)
  expect(result.normalDotUpperBound).toBeLessThanOrEqual(0)
})

it('declines a zero-dot enclosure without presenting an unproved witness', () => {
  const result = boundExperimentalBernsteinPatchNormals(strip([0, 0, 0, 0], 1), plane(), 2)
  expect(result.status).toBe('inconclusive')
})

it('refuses noncubic degrees, sparse controls and invalid intervals', () => {
  const candidate = plane(), reference = plane()
  expect(() => boundExperimentalBernsteinPatchNormals({ ...candidate, degreeV: 4 }, reference)).toThrow(/gradi/)
  const sparse = candidate.controls.slice()
  delete sparse[0]
  expect(() => boundExperimentalBernsteinPatchNormals({ ...candidate, controls: sparse }, reference))
    .toThrow(/controllo vettoriale/)
  candidate.controls[0][0] = [1, 0]
  expect(() => boundExperimentalBernsteinPatchNormals(candidate, reference)).toThrow(/intervallo/)
})
