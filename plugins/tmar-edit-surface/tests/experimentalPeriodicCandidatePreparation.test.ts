// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { materializeExperimentalPeriodicQuinticCandidateCoefficients } from '../experimentalPeriodicQuinticSide'

function source(mu = [3, 1, 3]): Net {
  const nu = mu.slice(0, -1).reduce((sum, multiplicity) => sum + multiplicity, 0), nv = 12
  return {
    du: 3, dv: 5, nu, nv, periodic: [1, 0], rational: [0, 0],
    ku: [0, 1, 2], mu, kv: [0, 1.25, 3.75, 5], mv: [6, 3, 3, 6],
    poles: Array.from({ length: nu }, (_, u) => Array.from({ length: nv }, (_, v): Point =>
      [u, v / 8, u / 8 + v / 16])).flat(),
    weights: Array<number>(nu * nv).fill(1),
  }
}

function inwardTargets(net: Net, edge: 'V0' | 'V1'): Point[] {
  const direction = edge === 'V0' ? 1 : -1, row = edge === 'V0' ? 0 : net.nv - 1
  return Array.from({ length: net.nu }, (_, u) => {
    const i = u * net.nv + row
    return net.poles[i].map((value, axis) => 4 * (net.poles[i + direction][axis] - value) +
      (u + 1) * [0.5, 0.25, -0.125][axis]) as Point
  })
}

function request(net: Net, edge: 'V0' | 'V1' = 'V0') {
  return { net, edge, targetInward: inwardTargets(net, edge), derivativeTolerance: 1e-9, secondDerivativeTolerance: 1e-9 }
}

it('prepares a saturated-seam artifact without granting continuity or CAD acceptance', () => {
  const net = source()
  const result = materializeExperimentalPeriodicQuinticCandidateCoefficients(request(net))
  expect(net.mu[0]).toBe(net.du)
  expect(result.status).toBe('prepared-unqualified-coefficient-candidate')
  expect(result.continuousG1Certified).toBe(false)
  expect(result.nativeCadCertified).toBe(false)
  expect(result.tubeAccepted).toBe(false)
  expect(result.pendingQualification).toContain('joint-continuity')
  expect(result.pendingQualification).toContain('native-topology-and-pcurves')
  expect(result.proposal.changedIndices).toHaveLength(2 * net.nu)
})

it.each(['V0', 'V1'] as const)('preserves the required rows and D2 while storing inward targets at %s', edge => {
  const net = source(), input = request(net, edge), before = structuredClone(input)
  const result = materializeExperimentalPeriodicQuinticCandidateCoefficients(input)
  const candidate = result.proposal.net
  const direction = edge === 'V0' ? 1 : -1, boundary = edge === 'V0' ? 0 : net.nv - 1
  const first = boundary + direction, second = first + direction
  const editableRows = new Set([first, second])
  expect(new Set(result.proposal.changedIndices.map(index => index % net.nv))).toEqual(editableRows)
  for (let u = 0; u < net.nu; u++) {
    const offset = u * net.nv
    for (let v = 0; v < net.nv; v++) if (!editableRows.has(v)) {
      for (let axis = 0; axis < 3; axis++)
        expect(Object.is(candidate.poles[offset + v][axis], net.poles[offset + v][axis])).toBe(true)
    }
    for (let axis = 0; axis < 3; axis++) {
      const values = (surface: Net) => [boundary, first, second].map(v => surface.poles[offset + v][axis])
      const [a, b, c] = values(net), [nextA, nextB, nextC] = values(candidate)
      // The test knot spans are 1.25, so endpoint D1=4(B-A) and
      // D2=12.8(C-2B+A). These checks use the stored poles independently.
      expect(4 * (nextB - nextA)).toBe(input.targetInward[u][axis])
      expect(12.8 * (nextC - 2 * nextB + nextA)).toBe(12.8 * (c - 2 * b + a))
    }
  }
  const { poles: originalPoles, ...originalBasis } = net
  const { poles: candidatePoles, ...candidateBasis } = candidate
  expect(originalPoles).not.toBe(candidatePoles)
  expect(candidateBasis).toEqual(originalBasis)
  expect(input).toEqual(before)
  expect(result.proposal.maxDerivativeResidualBound).toBeLessThanOrEqual(input.derivativeTolerance)
  expect(result.proposal.maxSecondDerivativeChangeBound).toBeLessThanOrEqual(input.secondDerivativeTolerance)
})

it('refuses incompatible locks or invalid targets without changing source data', () => {
  const net = source(), input = request(net), before = structuredClone(input)
  expect(() => materializeExperimentalPeriodicQuinticCandidateCoefficients({ ...input, lockIndices: [1] }))
    .toThrow(/residuo prima derivata al polo bloccato/)
  expect(() => materializeExperimentalPeriodicQuinticCandidateCoefficients({ ...input, lockIndices: [2] }))
    .toThrow(/variazione seconda derivata al polo bloccato/)
  expect(() => materializeExperimentalPeriodicQuinticCandidateCoefficients({ ...input, targetInward: input.targetInward.slice(1) }))
    .toThrow(/coefficienti della derivata entrante/)
  const invalid = structuredClone(input.targetInward)
  invalid[0][0] = NaN
  expect(() => materializeExperimentalPeriodicQuinticCandidateCoefficients({ ...input, targetInward: invalid }))
    .toThrow(/coefficienti della derivata entrante/)
  expect(input).toEqual(before)
})

it('refuses a saturated interior knot or nonunit weights in the preparation-only path', () => {
  expect(() => materializeExperimentalPeriodicQuinticCandidateCoefficients(request(source([3, 3, 3]))))
    .toThrow(/nodi interni C1/)
  const rational = source()
  rational.rational = [1, 0]
  rational.weights[0] = 2
  expect(() => materializeExperimentalPeriodicQuinticCandidateCoefficients(request(rational)))
    .toThrow(/pesi unitari/)
})
