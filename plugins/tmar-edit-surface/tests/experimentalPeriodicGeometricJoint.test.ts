// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { diagnoseExperimentalPeriodicGeometricJoint, diagnoseExperimentalPeriodicGeometricJointExactChord,
  type ExperimentalPeriodicGeometricJointRequest } from '../experimentalPeriodicGeometricJoint'
import { experimentalBinary64NormalChordWithin } from '../experimentalBinary64NormalChord'
import { prepareExperimentalPeriodicOneSidedSurfaceDerivatives } from '../experimentalPeriodicOneSidedSurfaceDerivatives'

const request: ExperimentalPeriodicGeometricJointRequest = {
  lateralTangent: [2, 0, 0], supportTangent: [7, 0, 0], lateralInward: [4, 1, 6], supportInward: [-3, 0, -2],
  minimumTangentNorm: 1e-12, minimumTransverseNorm: 1e-12, maximumTangentChord: 1e-12,
  maximumNormalChord: 1e-10, minimumPositiveScale: 0.5,
}

it('distinguishes a failed outward chord proof from a floating chord above the same threshold', () => {
  const jets: ExperimentalPeriodicGeometricJointRequest = { ...request, lateralTangent: [1, 0, 0], supportTangent: [1, 0, 0],
    supportInward: [0, -1, 0], lateralInward: [0, 1, 7.5e-5], maximumNormalChord: 1e-4 }
  expect(diagnoseExperimentalPeriodicGeometricJoint(jets)).toMatchObject({ status: 'inconclusive',
    reason: 'unrepresentable-diagnostic', proofFailure: 'normal-chord-proof' })
  expect(diagnoseExperimentalPeriodicGeometricJointExactChord(jets)).toMatchObject({ status: 'sample-diagnostic',
    classification: 'within-sampled-normal-budget', normalChordProof: 'exact-binary64-jets' })
  const loose = diagnoseExperimentalPeriodicGeometricJoint({ ...jets, maximumNormalChord: 1 })
  if (loose.status !== 'sample-diagnostic') throw new Error(loose.reason)
  expect(loose.normalChord).toBeLessThan(jets.maximumNormalChord)
  expect(diagnoseExperimentalPeriodicGeometricJoint({ ...jets, lateralInward: [0, 1, 2e-4] }))
    .toMatchObject({ status: 'sample-diagnostic', classification: 'oriented-normal-mismatch' })
  expect(diagnoseExperimentalPeriodicGeometricJointExactChord({ ...jets, lateralInward: [0, 1, 2 ** -13] }))
    .toMatchObject({ status: 'sample-diagnostic', classification: 'oriented-normal-mismatch' })
  expect(diagnoseExperimentalPeriodicGeometricJointExactChord({ ...jets, lateralInward: [0, -1, 0] }))
    .toMatchObject({ status: 'sample-diagnostic', classification: 'orientation-mismatch' })
})

it('compares exact binary64 jet normals at equality and refuses zero or opposite normals', () => {
  const t: Point = [1, -1, -1], a: Point = [-1, 1, -2], b: Point = [1, 2, -1]
  // Both exact normal vectors are scaled by three. Their cosine is 1/2.
  expect(experimentalBinary64NormalChordWithin(t, a, t, b, 1)).toBe(true)
  expect(experimentalBinary64NormalChordWithin(t, a, t, b, 1 - 2 ** -53)).toBe(false)
  expect(experimentalBinary64NormalChordWithin(t, a, t, a, 0)).toBe(true)
  expect(experimentalBinary64NormalChordWithin(t, a, t, t, 2)).toBe(false)
  expect(experimentalBinary64NormalChordWithin(t, a, t, [1, -1, 2], 2)).toBe(false)
  const tiny = Number.MIN_VALUE
  expect(experimentalBinary64NormalChordWithin([tiny, 0, 0], [0, tiny, 0], [tiny, 0, 0], [0, tiny, 0], 0)).toBe(true)
  expect(experimentalBinary64NormalChordWithin(t, a, t, [NaN, 0, 0], 2)).toBe(false)
})

it('separates transverse scale, tangent shear and normal mismatch from equality of derivatives', () => {
  const result = diagnoseExperimentalPeriodicGeometricJoint(request)
  expect(result).toMatchObject({ status: 'sample-diagnostic', classification: 'oriented-normal-mismatch',
    lambda: 3, mu: -5, signedNormalResidual: -1, minimumDerivativeChange: 1,
  })
  if (result.status !== 'sample-diagnostic') throw new Error(result.reason)
  // T=(1,0,0), R=(3,0,2), N=(0,-1,0). The admissible minimizer
  // (4,0,6) moves only one coordinate, while equality moves all three.
  expect(result.derivativeEqualityDistance).toBeCloseTo(Math.sqrt(18), 14)
  expect(result.normalAngleRadians).toBeCloseTo(Math.atan(1 / 6), 14)
  expect(result.normalDot).toBeGreaterThan(0)

  const parallel = diagnoseExperimentalPeriodicGeometricJoint({ ...request, lateralInward: [4, 0, 6] })
  expect(parallel).toMatchObject({ status: 'sample-diagnostic', classification: 'within-sampled-normal-budget',
    lambda: 3, mu: -5, signedNormalResidual: 0, normalAngleRadians: 0, minimumDerivativeChange: 0,
  })
})

it('handles the positive scale floor and keeps signed orientation independent of a permissive chord budget', () => {
  const floor = diagnoseExperimentalPeriodicGeometricJoint({ ...request, lateralInward: [4, 1, 0.25] })
  expect(floor).toMatchObject({ status: 'sample-diagnostic', lambda: 0.125, minimumDerivativeChange: 1.25 })

  const inverted = diagnoseExperimentalPeriodicGeometricJoint({ ...request, lateralInward: [4, 0, -6], maximumNormalChord: 2 })
  expect(inverted).toMatchObject({ status: 'sample-diagnostic', classification: 'orientation-mismatch',
    lambda: -3, signedNormalResidual: 0, normalAngleRadians: Math.PI, normalDot: -1,
  })
})

it('checks the two actual normals even when the projected plane residual vanishes', () => {
  const result = diagnoseExperimentalPeriodicGeometricJoint({ ...request,
    supportTangent: [1, 0.1, 0], supportInward: [0, 0, -2], lateralInward: [0, 0, 2],
    maximumTangentChord: 0.2, maximumNormalChord: 0.01,
  })
  expect(result).toMatchObject({ status: 'sample-diagnostic', classification: 'oriented-normal-mismatch',
    signedNormalResidual: 0, derivativeEqualityDistance: 0,
  })
  if (result.status !== 'sample-diagnostic') throw new Error(result.reason)
  expect(result.normalAngleRadians).toBeCloseTo(Math.atan(0.1), 14)
})

it('preserves the geometric diagnostics when both edge traversals reverse or native tangent speeds differ', () => {
  const reversed = diagnoseExperimentalPeriodicGeometricJoint({ ...request, lateralTangent: [-32, 0, 0], supportTangent: [-0.125, 0, 0] })
  const original = diagnoseExperimentalPeriodicGeometricJoint(request)
  if (original.status !== 'sample-diagnostic') throw new Error(original.reason)
  expect(reversed).toMatchObject({ status: 'sample-diagnostic', classification: original.classification,
    lambda: original.lambda, mu: -original.mu, signedNormalResidual: -original.signedNormalResidual,
    normalAngleRadians: original.normalAngleRadians, minimumDerivativeChange: original.minimumDerivativeChange,
  })
  expect(diagnoseExperimentalPeriodicGeometricJoint({ ...request, supportInward: [-6, 0, -4] })).toMatchObject({
    status: 'sample-diagnostic', lambda: 1.5, mu: original.mu, normalAngleRadians: original.normalAngleRadians,
  })
  expect(diagnoseExperimentalPeriodicGeometricJoint({ ...request, supportTangent: [-7, 0, 0], maximumTangentChord: 2 }))
    .toMatchObject({ status: 'inconclusive', reason: 'incompatible-tangents' })
})

it('refuses degenerate, nonrepresentable or malformed observations', () => {
  const cases = [
    [{ lateralTangent: [0, 0, 0] as Point }, 'degenerate-tangent'],
    [{ supportInward: [-3, 0, 0] as Point }, 'degenerate-transverse'],
    [{ lateralInward: [4, 0, 0] as Point }, 'degenerate-transverse'],
    [{ supportTangent: [7, 1, 0] as Point }, 'incompatible-tangents'],
    [{ minimumPositiveScale: Infinity }, 'invalid-input'],
    [{ lateralTangent: [2, , 0] as unknown as Point }, 'invalid-input'],
    [{ supportInward: [0, 0, -Number.MIN_VALUE] as Point, lateralInward: [0, 0, Number.MIN_VALUE] as Point,
      minimumTransverseNorm: Number.MIN_VALUE }, 'unrepresentable-diagnostic'],
  ] as const
  for (const [patch, reason] of cases) expect(diagnoseExperimentalPeriodicGeometricJoint({ ...request, ...patch }))
    .toMatchObject({ status: 'inconclusive', reason })
})

it('refuses exact and unresolved near-parallel derivatives before normalizing an invented normal', () => {
  const tangent: Point = [1, 1, 5]
  const parallel: Point = [2 ** 100, 2 ** 100, 5 * 2 ** 100]
  const withTangents = { ...request, lateralTangent: tangent, supportTangent: tangent }
  const opposed = parallel.map(x => -x) as Point
  expect(diagnoseExperimentalPeriodicGeometricJoint({ ...withTangents, supportInward: opposed, lateralInward: parallel }))
    .toMatchObject({ status: 'inconclusive', reason: 'degenerate-transverse' })
  const perturbed: Point = [parallel[0], parallel[1], parallel[2] + 2 ** 50]
  expect(diagnoseExperimentalPeriodicGeometricJoint({ ...withTangents,
    supportInward: perturbed.map(x => -x) as Point, lateralInward: perturbed,
  })).toMatchObject({ status: 'inconclusive', reason: 'unrepresentable-diagnostic' })

  const tiny: Point = [Number.MIN_VALUE, Number.MIN_VALUE, 0]
  expect(diagnoseExperimentalPeriodicGeometricJoint({ ...request, lateralTangent: tiny, supportTangent: tiny,
    lateralInward: [0, 0, 4], supportInward: [0, 0, -2], minimumTangentNorm: Number.MIN_VALUE,
  })).toMatchObject({ status: 'inconclusive', reason: 'unrepresentable-diagnostic' })

  // The raw transverse speed is normal. The scaled cross used to recover
  // its direction and magnitude is subnormal and its relative error is large.
  const widelyScaled: Point = [2 ** 1023, 2 ** -48, 2 ** -48]
  expect(diagnoseExperimentalPeriodicGeometricJoint({ ...request, lateralInward: widelyScaled,
    supportInward: widelyScaled.map(x => -x) as Point, minimumTransverseNorm: 1e-16,
  })).toMatchObject({ status: 'inconclusive', reason: 'unrepresentable-diagnostic' })

  // The exact binary64 cross products yield normals separated by about
  // .04579 rad. Naive products round both crosses to the same vector.
  const shallowTangent: Point = [3.5625, 4.28125, 3.625]
  const r: Point = [3.562499999999996, 4.281250000000002, 3.625000000000004]
  const m: Point = [3.5624999999999964, 4.281250000000003, 3.6250000000000044]
  for (const scale of [1, 2 ** 20]) expect(diagnoseExperimentalPeriodicGeometricJoint({ ...request,
    lateralTangent: shallowTangent, supportTangent: shallowTangent,
    lateralInward: m.map(x => scale * x) as Point, supportInward: r.map(x => -scale * x) as Point,
    minimumTransverseNorm: scale === 1 ? 1e-20 : 1e-12, maximumNormalChord: 1e-8,
  })).toMatchObject({ status: 'inconclusive', reason: 'unrepresentable-diagnostic' })
})

it('finds zero required geometric change on a quintic lateral with different transverse speeds and the same seam', () => {
  const ring = [[0, 0], [1, 2 ** -35], [2, 2], [-2, 0]], speeds = [5, 5, 8, 5]
  const lateral: Net = {
    du: 2, dv: 5, nu: 4, nv: 6, periodic: [1, 0], rational: [0, 0], ku: [0, 1, 2, 4], mu: [2, 1, 1, 2],
    kv: [0, 5], mv: [6, 6], poles: ring.flatMap(([x, y], u) => Array.from({ length: 6 }, (_, v): Point => [x, y, v * speeds[u]])),
    weights: Array<number>(24).fill(1),
  }
  const support: Net = {
    ...lateral, dv: 1, nv: 2, kv: [0, 1], mv: [2, 2],
    poles: ring.flatMap(([x, y]): Point[] => [[x, y, -5], [x, y, 0]]), weights: Array<number>(8).fill(1),
  }
  const before = structuredClone({ lateral, support })
  const mobile = prepareExperimentalPeriodicOneSidedSurfaceDerivatives(lateral)
  const fixed = prepareExperimentalPeriodicOneSidedSurfaceDerivatives(support)
  const compare = (u: number, side?: 'left' | 'right') => {
    const m = mobile.evaluate(u, 0, { u: side }), s = fixed.evaluate(u, 1, { u: side })
    return diagnoseExperimentalPeriodicGeometricJoint({ ...request, lateralTangent: m.du, supportTangent: s.du,
      lateralInward: m.dv, supportInward: s.dv.map(value => -value) as Point })
  }
  for (const side of ['left', 'right'] as const) expect(compare(0, side)).toMatchObject({
    status: 'sample-diagnostic', classification: 'within-sampled-normal-budget', lambda: 1, derivativeEqualityDistance: 0,
  })
  const joint = compare(1)
  expect(joint).toMatchObject({ status: 'sample-diagnostic', classification: 'within-sampled-normal-budget' })
  if (joint.status !== 'sample-diagnostic') throw new Error(joint.reason)
  expect(joint.lambda).toBeCloseTo(1.3, 14)
  expect(joint.minimumDerivativeChange).toBeCloseTo(0, 14)
  expect(joint.derivativeEqualityDistance).toBeCloseTo(1.5, 14)
  // Equal derivatives would require moving the first interior pole in
  // column 2 by (8−5)·(5/5)=3. The source already has zero required change.
  expect(lateral.poles[2 * lateral.nv + 1][2] - lateral.poles[2 * lateral.nv][2] - 5).toBe(3)
  expect({ lateral, support }).toEqual(before)
})
