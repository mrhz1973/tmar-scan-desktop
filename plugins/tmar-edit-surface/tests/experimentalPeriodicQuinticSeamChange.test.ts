// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { boundExperimentalPeriodicQuinticSeamChange } from '../experimentalPeriodicQuinticSeamChange'
import { checkExperimentalPeriodicSeamC1 } from '../experimentalPeriodicSeamC1'

const budget = { maximumAbsoluteJump: 1 / 16, maximumJumpChange: 1 / 64,
  maximumCandidateNormalChord: 0.025, maxPieces: 32, maxDepth: 4 }

function net(rightZ: number, seam: Point[] = Array.from({ length: 6 }, (_, v) => [0, v, 0])): Net {
  const offsets: Point[] = [[0, 0, 0], [1, 0, rightZ], [2, 2, 0], [-2, 0, 0]]
  return { du: 2, dv: 5, nu: 4, nv: 6, ku: [0, 1, 2, 4], mu: [2, 1, 1, 2], kv: [0, 5], mv: [6, 6],
    periodic: [1, 0], rational: [0, 0], weights: Array<number>(24).fill(1),
    poles: offsets.flatMap(offset => seam.map(p => p.map((x, i) => x + offset[i]) as Point)) }
}

it('certifies a bounded change on top of a nonzero source jump using a separate angular threshold', () => {
  const original = net(1 / 64), candidate = net(3 / 128)
  const before = structuredClone([original, candidate])
  const result = boundExperimentalPeriodicQuinticSeamChange(original, candidate, budget)
  if (result.status !== 'certified') throw new Error(JSON.stringify(result))
  expect(result.evidence).toEqual({ sourceJumpUpper: 1 / 32, candidateJumpUpper: 3 / 64, jumpChangeUpper: 1 / 64 })
  // Independent analytic normal chord: one normal rotates by atan(3/128).
  expect(result.maximumNormalChordUpper).toBeGreaterThanOrEqual(2 * Math.sin(Math.atan(3 / 128) / 2))
  expect(result.maximumNormalChordUpper).toBeLessThanOrEqual(budget.maximumCandidateNormalChord)
  expect(checkExperimentalPeriodicSeamC1(candidate).c1AtUSeam).toBe(false)
  expect([original, candidate]).toEqual(before)
  expect(boundExperimentalPeriodicQuinticSeamChange(original, candidate, { ...budget, maximumJumpChange: 0 }))
    .toMatchObject({ status: 'inconclusive', reason: 'jump-change-unverified' })
  expect(boundExperimentalPeriodicQuinticSeamChange(original, net(-1 / 64), budget))
    .toMatchObject({ status: 'inconclusive', reason: 'jump-change-unverified', evidence: { jumpChangeUpper: 1 / 16 } })
  expect(boundExperimentalPeriodicQuinticSeamChange(original, candidate, { ...budget, maximumAbsoluteJump: 1 / 32 }))
    .toMatchObject({ status: 'inconclusive', reason: 'candidate-jump-unverified' })
  expect(boundExperimentalPeriodicQuinticSeamChange(original, candidate, { ...budget, maximumCandidateNormalChord: 0.02 }))
    .toMatchObject({ status: 'inconclusive', reason: 'seam-normal-chord-unverified', vSpan: 0 })
})

it('rejects an arbitrarily small absolute jump with opposite one-sided normals', () => {
  const candidate = net(0)
  for (let v = 0; v < candidate.nv; v++) {
    candidate.poles[candidate.nv + v][0] = -(2 ** -40)
    candidate.poles[(candidate.nu - 1) * candidate.nv + v][0] = -(2 ** -39)
  }
  const result = boundExperimentalPeriodicQuinticSeamChange(candidate, candidate, budget)
  expect(result).toMatchObject({ status: 'inconclusive', reason: 'seam-normal-chord-unverified',
    evidence: { candidateJumpUpper: 2 ** -38, jumpChangeUpper: 0 } })
  expect(result).not.toHaveProperty('maximumNormalChordUpper')
})

it('subdivides rotating regular seam tangents and refuses when the work cap prevents coverage', () => {
  const rotating = net(0, [[0, 0, 0], [0, 1, 0], [0, 2, 0], [0, 3, 1], [0, 3, 2], [0, 3, 3]])
  const result = boundExperimentalPeriodicQuinticSeamChange(rotating, rotating, { ...budget, maximumCandidateNormalChord: 0 })
  expect(result).toMatchObject({ status: 'certified', maximumNormalChordUpper: 0, work: { checkedPieces: 3, acceptedPieces: 2 } })
  expect(boundExperimentalPeriodicQuinticSeamChange(rotating, rotating, { ...budget, maxPieces: 2 }))
    .toMatchObject({ status: 'inconclusive', reason: 'piece-budget', vSpan: 0 })
  const degenerate = net(0, Array<Point>(6).fill([0, 0, 0]))
  expect(boundExperimentalPeriodicQuinticSeamChange(degenerate, degenerate, { ...budget, maxDepth: 0 }))
    .toMatchObject({ status: 'inconclusive', reason: 'seam-normal-chord-unverified' })
  expect(boundExperimentalPeriodicQuinticSeamChange(rotating, { ...rotating, kv: [0, 6] }, budget))
    .toMatchObject({ status: 'inconclusive', reason: 'seam-bound-refused' })
})
