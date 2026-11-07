// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { diagnoseExperimentalPeriodicGeometricJoint, projectExperimentalPeriodicGeometricJoint } from '../experimentalPeriodicGeometricJoint'
import { sampleExperimentalPeriodicGeometricSideTargets,
  type ExperimentalPeriodicGeometricSideTargetsRequest } from '../experimentalPeriodicGeometricSideTargets'
import { prepareExperimentalPeriodicOneSidedSurfaceDerivatives } from '../experimentalPeriodicOneSidedSurfaceDerivatives'
import { proposeExperimentalPeriodicAlmostC1QuinticSide } from '../experimentalPeriodicQuinticSide'
import { boundExperimentalPeriodicQuinticSurfaceNormals } from '../experimentalPeriodicQuinticSurfaceNormals'
import { certifyExperimentalPeriodicUFitCoefficients } from '../experimentalPeriodicUFitCertificate'
import { fitExperimentalPeriodicUVectorSamplesWithFixedFirst } from '../experimentalPeriodicUVectorFit'

const limits = { minimumTangentNorm: 1e-8, minimumTransverseNorm: 1e-8, maximumTangentChord: 1e-10,
  maximumNormalChord: 1e-9, minimumPositiveScale: 0.25, sampledPositionGap: 1e-12, seamDerivativeGap: 1e-9,
  maximumNormalResidual: 1e-10 }

function fixture(incompatibleSeam = false): ExperimentalPeriodicGeometricSideTargetsRequest {
  const count = 8, nu = count + 2
  const ring = Array.from({ length: nu }, (_, i) => [Math.cos(2 * Math.PI * i / nu), Math.sin(2 * Math.PI * i / nu)])
  ring[1][0] = ring[nu - 1][0] = 1
  ring[nu - 1][1] = -ring[1][1]
  const ku = Array.from({ length: count + 1 }, (_, i) => i), mu = [3, ...Array<number>(count - 1).fill(1), 3]
  const strip: Net = { du: 3, dv: 5, nu, nv: 6, periodic: [1, 0], rational: [0, 0], ku, mu,
    kv: [0, 5], mv: [6, 6], weights: Array<number>(nu * 6).fill(1),
    poles: ring.flatMap(([x, y], u) => {
      const normal = u === 4 || (incompatibleSeam && [0, 1, nu - 1].includes(u)) ? 0.125 : 0
      const expansion = u === 5 ? 1.25 : 1
      return Array.from({ length: 6 }, (_, v): Point => [x * (1 + expansion * v), y * (1 + expansion * v), normal * v])
    }),
  }
  const reversed = [ring[0], ...ring.slice(1).reverse()]
  const support: Net = { ...strip, dv: 1, nv: 2, ku: ku.map(u => 10 + 2 * u), kv: [0, 1], mv: [2, 2],
    weights: Array<number>(nu * 2).fill(1), poles: reversed.flatMap(([x, y]): Point[] => [[x / 2, y / 2, 0], [x, y, 0]]),
  }
  return { strip: { net: strip, edge: 'V0', uAtEdgeEnds: [0, count] },
    support: { net: support, edge: 'V1', uAtEdgeEnds: [10 + 2 * count, 10] }, edgePeriod: [0, count],
    training: Array.from({ length: 4 * count + 1 }, (_, i) => i / 4),
    holdout: [0, ...Array.from({ length: 4 * count }, (_, i) => i / 4 + 1 / 8), count], budgets: { ...limits },
  }
}

it('projects away the normal component while keeping a range of positive speeds and a tangential shear', () => {
  for (const speed of [0.85, 4, 20, 40]) {
    const result = projectExperimentalPeriodicGeometricJoint({ ...limits, lateralTangent: [2, 0, 0], supportTangent: [7, 0, 0],
      lateralInward: [3, 0.125, speed], supportInward: [0, 0, -1],
    }, false)
    if (result.status !== 'target') throw new Error(result.reason)
    expect(result.value[0]).toBe(3)
    expect(result.value[1]).toBeCloseTo(0, 13)
    expect(result.value[2]).toBe(speed)
    expect(result.after.lambda).toBeCloseTo(speed, 12)
    expect(result.after.mu).toBeCloseTo(3, 12)
  }
  const tangent = { ...limits, lateralTangent: [2, 0, 0] as Point, supportTangent: [7, 0, 0] as Point, supportInward: [0, 0, -1] as Point }
  expect(projectExperimentalPeriodicGeometricJoint({ ...tangent, lateralInward: [3, 0.125, 0.125] }, false))
    .toMatchObject({ status: 'target', value: [3, 0, 0.25], after: { lambda: 0.25 } })
  expect(projectExperimentalPeriodicGeometricJoint({ ...tangent, lateralInward: [3, 0.125, -1] }, false))
    .toMatchObject({ status: 'inconclusive', reason: 'source-orientation-mismatch' })
})

it('reduces stored normal residuals on held-out points while preserving both borders, U0 and orientation', () => {
  const request = fixture(), before = structuredClone(request)
  const sampled = sampleExperimentalPeriodicGeometricSideTargets(request)
  if (sampled.status !== 'targets-only') throw new Error(JSON.stringify(sampled))
  expect(sampled.maxInteriorTrainingSourceNormalResidual).toBeGreaterThan(0.03)
  expect(sampled.maxInteriorTrainingTargetNormalResidual).toBeLessThan(1e-12)
  const net = request.strip.net
  const fit = fitExperimentalPeriodicUVectorSamplesWithFixedFirst(net.du, net.ku, net.mu, sampled.training, sampled.fixedFirst)
  const certificate = certifyExperimentalPeriodicUFitCoefficients({ degree: net.du, knots: net.ku, multiplicities: net.mu,
    samples: sampled.training, fixedFirst: sampled.fixedFirst, coefficients: fit.coefficients,
    maxCoefficientError: [1e-10, 1e-10, 1e-10], maxRows: 64, maxFreeColumns: 16,
  })
  expect(certificate.status).toBe('certified')
  expect(fit.maxSampleResidual).toBeLessThan(1e-10)
  const stored = proposeExperimentalPeriodicAlmostC1QuinticSide({ net, edge: 'V0', targetInward: fit.coefficients,
    derivativeTolerance: 1e-10, secondDerivativeTolerance: 1e-10, seamDerivativeTolerance: limits.seamDerivativeGap,
  })
  if (stored.status !== 'coefficient-proposal') throw new Error(JSON.stringify(stored))
  expect(stored.proposal.maxPositionDisplacementBound).toBeLessThan(0.3)
  const candidate = stored.proposal.net
  expect(candidate.poles.slice(0, net.nv)).toEqual(net.poles.slice(0, net.nv))
  for (let i = 0; i < net.poles.length; i++) if (![1, 2].includes(i % net.nv)) expect(candidate.poles[i]).toEqual(net.poles[i])

  const original = prepareExperimentalPeriodicOneSidedSurfaceDerivatives(net)
  const edited = prepareExperimentalPeriodicOneSidedSurfaceDerivatives(candidate)
  const support = prepareExperimentalPeriodicOneSidedSurfaceDerivatives(request.support.net)
  let originalMaximum = 0, storedMaximum = 0, minimumScale = Infinity, maximumScale = 0
  for (const sample of sampled.holdout) {
    expect(sampled.training.some(training => training.parameter === sample.parameter || training.supportParameter === sample.supportParameter)).toBe(false)
    const reference = support.evaluate(sample.supportParameter, 1)
    const diagnose = (evaluate: typeof original) => {
      const lateral = evaluate.evaluate(sample.parameter, 0)
      return diagnoseExperimentalPeriodicGeometricJoint({ ...limits, lateralTangent: lateral.du,
        supportTangent: reference.du.map(x => -x) as Point, lateralInward: lateral.dv,
        supportInward: reference.dv.map(x => -x) as Point,
      })
    }
    const initial = diagnose(original), stored = diagnose(edited)
    if (initial.status !== 'sample-diagnostic' || stored.status !== 'sample-diagnostic') throw new Error(JSON.stringify({ initial, stored }))
    expect(stored.classification).toBe('within-sampled-normal-budget')
    expect(stored.lambda).toBeGreaterThan(1.8)
    minimumScale = Math.min(minimumScale, stored.lambda)
    maximumScale = Math.max(maximumScale, stored.lambda)
    originalMaximum = Math.max(originalMaximum, Math.abs(initial.signedNormalResidual))
    storedMaximum = Math.max(storedMaximum, Math.abs(stored.signedNormalResidual))
  }
  expect(originalMaximum).toBeGreaterThan(0.03)
  expect(storedMaximum).toBeLessThan(1e-10)
  expect(maximumScale - minimumScale).toBeGreaterThan(0.1)
  for (const side of ['left', 'right'] as const) {
    const lateral = edited.evaluate(0, 0, { u: side })
    const reference = support.evaluate(26, 1, { u: side === 'left' ? 'right' : 'left' })
    expect(diagnoseExperimentalPeriodicGeometricJoint({ ...limits, lateralTangent: lateral.du,
      supportTangent: reference.du.map(x => -x) as Point, lateralInward: lateral.dv,
      supportInward: reference.dv.map(x => -x) as Point,
    })).toMatchObject({ status: 'sample-diagnostic', classification: 'within-sampled-normal-budget', lambda: 2 })
  }
  expect(boundExperimentalPeriodicQuinticSurfaceNormals(net, candidate, { maxCells: 8, maxPatchChecks: 1024, maxDepth: 4 }))
    .toMatchObject({ status: 'certified-positive', coverage: { certifiedCells: 8 } })
  expect(request).toEqual(before)
})

it('preserves the inward targets when each V parameter and natural edge are reversed', () => {
  const request = fixture()
  const reflect = (side: typeof request.strip): typeof request.strip => {
    const { net } = side
    return { ...side, edge: side.edge === 'V0' ? 'V1' : 'V0', net: { ...net,
      poles: Array.from({ length: net.nu }, (_, u) => net.poles.slice(u * net.nv, (u + 1) * net.nv).reverse()).flat(),
    } }
  }
  const normal = sampleExperimentalPeriodicGeometricSideTargets(request)
  const reflected = sampleExperimentalPeriodicGeometricSideTargets({ ...request, strip: reflect(request.strip), support: reflect(request.support) })
  if (normal.status !== 'targets-only' || reflected.status !== 'targets-only') throw new Error(JSON.stringify({ normal, reflected }))
  const compareTargets = (samples: typeof normal.training) => samples.map(({ value, ...location }) => ({ ...location, value: value.map(x => x + 0) }))
  expect(compareTargets(reflected.training)).toEqual(compareTargets(normal.training))
  expect(reflected.holdout).toEqual(normal.holdout)
})

it('uses each native U basis when the support stores a refined, reversed copy of the boundary', () => {
  const ring: Point[] = [[0, 0, 0], [1, 2 ** -35, 0], [2, 2, 0], [-2, 0, 0]]
  const [a, b, c, d] = ring
  // Exact insertion at U=.5 followed by reversal around the saturated seam.
  const refined = [a, d, c, b.map((x, axis) => (3 * x + c[axis]) / 4) as Point,
    a.map((x, axis) => (x + b[axis]) / 2) as Point]
  const net: Net = { du: 2, dv: 5, nu: 4, nv: 6, periodic: [1, 0], rational: [0, 0],
    ku: [0, 1, 2, 4], mu: [2, 1, 1, 2], kv: [0, 5], mv: [6, 6], weights: Array<number>(24).fill(1),
    poles: ring.flatMap(([x, y]) => Array.from({ length: 6 }, (_, i): Point => [x, y, 10 * i])),
  }
  const support: Net = { ...net, dv: 1, nu: 5, nv: 2, ku: [20, 24, 26, 27, 28], mu: [2, 1, 1, 1, 2],
    kv: [0, 1], mv: [2, 2], weights: Array<number>(10).fill(1),
    poles: refined.flatMap(([x, y]): Point[] => [[x, y, -5], [x, y, 0]]),
  }
  const result = sampleExperimentalPeriodicGeometricSideTargets({ strip: { net, edge: 'V0', uAtEdgeEnds: [0, 4] },
    support: { net: support, edge: 'V1', uAtEdgeEnds: [28, 20] }, edgePeriod: [0, 4],
    training: [0, 0.25, 0.75, 1.5, 3, 4], holdout: [0, 0.125, 1, 2.25, 4], budgets: limits,
  })
  if (result.status !== 'targets-only') throw new Error(JSON.stringify(result))
  expect(result.fixedFirst).toEqual([0, 0, 10])
  for (const { value } of result.training) {
    expect(Math.hypot(value[0], value[1])).toBeLessThan(1e-14)
    expect(value[2]).toBeCloseTo(10, 12)
  }
})

it('refuses incompatible fixed seam derivatives and mapped training/holdout alias without returning targets', () => {
  const request = fixture(true), before = structuredClone(request)
  const locked = sampleExperimentalPeriodicGeometricSideTargets(request)
  expect(locked).toMatchObject({ status: 'inconclusive', phase: 'locked-seam', reason: 'locked-u0-geometric-target-incompatible',
    at: { edgeParameter: 0, seamSide: 'left' },
  })
  expect(locked).not.toHaveProperty('training')
  expect(request).toEqual(before)
  const alias = sampleExperimentalPeriodicGeometricSideTargets({ ...fixture(), holdout: [0, 0.25 + 2 ** -54, 8] })
  expect(alias).toMatchObject({ status: 'inconclusive', phase: 'sampling', reason: 'mapped-training-holdout-alias' })
  expect(alias).not.toHaveProperty('training')
})
