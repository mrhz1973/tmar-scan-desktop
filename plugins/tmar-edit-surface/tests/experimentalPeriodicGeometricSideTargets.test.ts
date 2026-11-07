// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { diagnoseExperimentalPeriodicGeometricJoint, projectExperimentalPeriodicGeometricJoint } from '../experimentalPeriodicGeometricJoint'
import { sampleExperimentalPeriodicGeometricSideTargets,
  type ExperimentalPeriodicGeometricSideTargetsRequest } from '../experimentalPeriodicGeometricSideTargets'
import { prepareExperimentalPeriodicOneSidedSurfaceDerivatives } from '../experimentalPeriodicOneSidedSurfaceDerivatives'
import { proposeExperimentalPeriodicAlmostC1QuinticSide, proposeExperimentalPeriodicQuinticCoordinatedSeam,
  type ExperimentalPeriodicQuinticCoordinatedSeamRequest } from '../experimentalPeriodicQuinticSide'
import { boundExperimentalPeriodicQuinticSurfaceNormals } from '../experimentalPeriodicQuinticSurfaceNormals'
import { measureExperimentalPeriodicQuinticCoordinatedPair,
  type ExperimentalPeriodicQuinticCoordinatedPairRequest } from '../experimentalPeriodicQuinticCoordinatedPair'
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

const coordinatedBudgets = { derivativeTolerance: 1e-10, secondDerivativeTolerance: 1e-10, seamDerivativeTolerance: 1e-9,
  maximumDisplacement: 2, maximumSeamDisplacement: 1, normalBudget: { maxCells: 8, maxPatchChecks: 1024, maxDepth: 4 } }

it('repairs the synthetic fixed-U0 incompatibility while preserving both borders and the periodic derivative jump', () => {
  const request = fixture(true), net = request.strip.net
  // Isolate the perturbation to the seam and its two neighboring columns.
  for (let v = 0; v < net.nv; v++) net.poles[4 * net.nv + v][2] = 0
  const before = structuredClone(request)
  expect(sampleExperimentalPeriodicGeometricSideTargets(request)).toMatchObject({
    status: 'inconclusive', reason: 'locked-u0-geometric-target-incompatible',
  })
  const inwardWithoutNormal = (u: number): Point => {
    const i = u * net.nv
    return [net.poles[i + 1][0] - net.poles[i][0], net.poles[i + 1][1] - net.poles[i][1], 0]
  }
  const result = proposeExperimentalPeriodicQuinticCoordinatedSeam({ ...coordinatedBudgets, net, edge: 'V0',
    previousInward: inwardWithoutNormal(net.nu - 1), nextInward: inwardWithoutNormal(1),
  })
  if (result.status !== 'coefficient-proposal') throw new Error(JSON.stringify(result))
  const candidate = result.proposal.net
  expect(result.proposal.changedIndices).toEqual([1, 2, 7, 8, 55, 56])
  expect(result.evidence).toMatchObject({ seamJumpPreserved: true, normals: { status: 'certified-positive' } })
  expect(result.evidence.before).toEqual(result.evidence.after)
  expect(result.evidence.maxSeamDisplacementBound).toBeCloseTo(0.25, 14)
  expect(candidate.poles[1][2]).toBe(0)
  expect(candidate.poles[2][2]).toBe(0)
  expect(candidate.poles[3]).toEqual(net.poles[3])
  for (let i = 0; i < net.poles.length; i++) if (!result.proposal.changedIndices.includes(i)) expect(candidate.poles[i]).toEqual(net.poles[i])

  const updated = sampleExperimentalPeriodicGeometricSideTargets({ ...request, strip: { ...request.strip, net: candidate } })
  if (updated.status !== 'targets-only') throw new Error(JSON.stringify(updated))
  const source = prepareExperimentalPeriodicOneSidedSurfaceDerivatives(candidate)
  const support = prepareExperimentalPeriodicOneSidedSurfaceDerivatives(request.support.net)
  for (const { parameter, supportParameter } of updated.holdout) {
    const a = source.evaluate(parameter, 0), b = support.evaluate(supportParameter, 1)
    expect(diagnoseExperimentalPeriodicGeometricJoint({ ...limits, lateralTangent: a.du,
      supportTangent: b.du.map(x => -x) as Point, lateralInward: a.dv, supportInward: b.dv.map(x => -x) as Point,
    })).toMatchObject({ status: 'sample-diagnostic', classification: 'within-sampled-normal-budget' })
  }
  expect(request).toEqual(before)
})

function unevenSeam(lastWidth: number): ExperimentalPeriodicQuinticCoordinatedSeamRequest {
  const ring = [[1, 0], [1, 0.25 + 2 ** -38], [0, 1], [-1, 0], [1, -lastWidth / 4]]
  const net: Net = { du: 3, dv: 5, nu: 5, nv: 6, periodic: [1, 0], rational: [0, 0],
    ku: [0, 1, 2, 2 + lastWidth], mu: [3, 1, 1, 3], kv: [0, 5], mv: [6, 6], weights: Array<number>(30).fill(1),
    poles: ring.flatMap(([x, y]) => Array.from({ length: 6 }, (_, v): Point => [x, y, v])),
  }
  return { ...coordinatedBudgets, net, edge: 'V0', previousInward: [0, 0, 1.5], nextInward: [0, 0, 1.25] }
}

it.each(['V0', 'V1'] as const)('uses unequal native seam widths at %s and preserves a nonzero source jump exactly', edge => {
  const request = unevenSeam(3)
  request.edge = edge
  if (edge === 'V1') {
    const { net } = request
    net.poles = Array.from({ length: net.nu }, (_, u) => net.poles.slice(u * net.nv, (u + 1) * net.nv).reverse()).flat()
  }
  const result = proposeExperimentalPeriodicQuinticCoordinatedSeam(request)
  if (result.status !== 'coefficient-proposal') throw new Error(JSON.stringify(result))
  // h+=1, h−=3. ΔD0=(.5 + 3·.25)/4 = .3125.
  const [first, second] = edge === 'V0' ? [1, 2] : [4, 3]
  expect(result.proposal.net.poles[first][2]).toBe(1.3125)
  expect(result.proposal.net.poles[second][2]).toBe(2.625)
  expect(result.evidence.before?.maxDerivativeDifferenceBound).toBe(3 * 2 ** -38)
  expect(result.evidence.after).toEqual(result.evidence.before)
})

it('withholds a proposal when exact stored coordination, a lock or a work budget cannot be respected', () => {
  const rounded = proposeExperimentalPeriodicQuinticCoordinatedSeam(unevenSeam(2))
  expect(rounded).toMatchObject({ status: 'inconclusive', phase: 'candidate-seam', reason: 'stored-seam-jump-changed' })
  const request = unevenSeam(3)
  const locked = proposeExperimentalPeriodicQuinticCoordinatedSeam({ ...request, lockIndices: [1] })
  expect(locked).toMatchObject({ status: 'inconclusive', phase: 'proposal' })
  const displaced = proposeExperimentalPeriodicQuinticCoordinatedSeam({ ...request, maximumSeamDisplacement: 0.5 })
  expect(displaced).toMatchObject({ status: 'inconclusive', phase: 'candidate-seam', reason: 'seam-displacement-bound-exceeds-budget' })
  const normalBudget = proposeExperimentalPeriodicQuinticCoordinatedSeam({ ...request, normalBudget: { ...request.normalBudget, maxCells: 2 } })
  expect(normalBudget).toMatchObject({ status: 'inconclusive', phase: 'surface-normals',
    evidence: { normals: { status: 'inconclusive', reason: 'knot-cell-budget' } },
  })
  const inverted = proposeExperimentalPeriodicQuinticCoordinatedSeam({ ...request,
    previousInward: [0, 0, -1], nextInward: [0, 0, -1], maximumDisplacement: 8, maximumSeamDisplacement: 8,
  })
  expect(inverted).toMatchObject({ status: 'inconclusive', phase: 'surface-normals',
    evidence: { seamJumpPreserved: true, normals: { status: 'nonpositive-witness' } },
  })
  for (const result of [rounded, locked, displaced, normalBudget, inverted]) expect(result).not.toHaveProperty('proposal')
})

function pairFixture(): ExperimentalPeriodicQuinticCoordinatedPairRequest {
  const original = fixture(true), upper = original.strip.net, central = original.support.net
  for (let v = 0; v < upper.nv; v++) upper.poles[4 * upper.nv + v][2] = 0
  const ring = Array.from({ length: upper.nu }, (_, u) => upper.poles[u * upper.nv])
  const reversed = [ring[0], ...ring.slice(1).reverse()]
  const lower: Net = { ...structuredClone(upper), ku: upper.ku.map(u => 100 + 3 * u),
    poles: reversed.flatMap(([x, y], u) => Array.from({ length: 6 }, (_, v): Point => {
      const radius = 0.5 - (5 - v) / 16
      const z = [0, 1, upper.nu - 1].includes(u) ? (5 - v) / 16 : 0
      return [radius * x, radius * y, z]
    })),
  }
  const side = (net: Net, below: boolean): ExperimentalPeriodicQuinticCoordinatedPairRequest['atCentralV0'] => {
    const edge = below ? 'V1' : 'V0', first = below ? net.nv - 1 : 0, sign = below ? -1 : 1
    const target = (u: number): Point => {
      const i = u * net.nv + first
      return [net.poles[i + sign][0] - net.poles[i][0], net.poles[i + sign][1] - net.poles[i][1], 0]
    }
    return { lateral: { net, edge, uAtEdgeEnds: below ? [124, 100] : [0, 8] }, centralUAtEdgeEnds: [26, 10],
      edgePeriod: below ? [-1, 1] : [0, 8], verificationParameters: original.holdout.map(t => below ? t / 4 - 1 : t),
      move: { ...coordinatedBudgets, previousInward: target(net.nu - 1), nextInward: target(1) },
      joint: { ...limits, minimumPositiveScale: below ? 0.0625 : limits.minimumPositiveScale },
    }
  }
  return { central, atCentralV0: side(lower, true), atCentralV1: side(upper, false) }
}

it('exposes both coordinated laterals after validating both stored joints against the unchanged center', () => {
  const request = pairFixture(), before = structuredClone(request)
  const result = measureExperimentalPeriodicQuinticCoordinatedPair(request)
  if (result.status !== 'diagnostic-only') throw new Error(JSON.stringify(result))
  for (const [edge, input] of [['V0', request.atCentralV0], ['V1', request.atCentralV1]] as const) {
    const receipt = result.receipts[edge]
    if (receipt.status !== 'diagnostic-only') throw new Error(JSON.stringify(receipt))
    expect(receipt.evidence.move).toMatchObject({ seamJumpPreserved: true, normals: { status: 'certified-positive' } })
    expect(receipt.evidence.joint).toMatchObject({ checked: input.verificationParameters.length })
    expect(receipt.evidence.joint!.maxNormalResidual).toBeLessThan(input.joint.maximumNormalResidual)
    const candidate = result.candidates[edge], original = input.lateral.net
    expect(candidate.poles).not.toEqual(original.poles)
    for (let u = 0; u < original.nu; u++) for (const v of [0, original.nv - 1])
      expect(candidate.poles[u * original.nv + v]).toEqual(original.poles[u * original.nv + v])
  }
  expect(request).toEqual(before)
})

it('withholds both candidates on a second move or a second stored joint stop', () => {
  const request = pairFixture()
  request.atCentralV1.move.maximumSeamDisplacement = 0
  const movement = measureExperimentalPeriodicQuinticCoordinatedPair(request)
  expect(movement).toMatchObject({ status: 'inconclusive',
    stop: { side: 'V1', phase: 'coordinated-move', reasonCode: 'seam-displacement-bound-exceeds-budget' },
    receipts: { V0: { status: 'diagnostic-only' }, V1: { evidence: { movePhase: 'candidate-seam' } } },
  })
  request.atCentralV1.move.maximumSeamDisplacement = 1
  request.atCentralV1.move.previousInward[2] = request.atCentralV1.move.nextInward[2] = 0.0625
  const stored = measureExperimentalPeriodicQuinticCoordinatedPair(request)
  expect(stored).toMatchObject({ status: 'inconclusive', stop: { side: 'V1', phase: 'stored-joint', reasonCode: 'stored-joint-beyond-budget' },
    receipts: { V0: { status: 'diagnostic-only' }, V1: { at: { edgeParameter: 0, seamSide: 'left' },
      evidence: { move: { seamJumpPreserved: true, normals: { status: 'certified-positive' } } } } },
  })
  for (const result of [movement, stored]) {
    expect(result).not.toHaveProperty('candidates')
    expect(result.receipts.V0).not.toHaveProperty('candidate')
    expect(result.receipts.V1).not.toHaveProperty('candidate')
  }
})

it('refuses a shared lateral before either coordinated proposal is evaluated', () => {
  const request = pairFixture()
  request.atCentralV1.lateral.net = request.atCentralV0.lateral.net
  expect(measureExperimentalPeriodicQuinticCoordinatedPair(request)).toMatchObject({ status: 'inconclusive',
    stop: { phase: 'preflight', reasonCode: 'pair-aliased-input' }, receipts: { V0: { status: 'not-run' }, V1: { status: 'not-run' } },
  })
})

it('validates the center before recording any support seam status or evaluating a move', () => {
  const request = pairFixture()
  request.central.mu[0] = request.central.du + 1
  const result = measureExperimentalPeriodicQuinticCoordinatedPair(request)
  expect(result).toMatchObject({ status: 'inconclusive', stop: { side: 'V0', phase: 'support-seam' },
    receipts: { V0: { evidence: {} }, V1: { status: 'not-run' } },
  })
  expect(result.receipts.V0).not.toHaveProperty('evidence.supportSeam')
  expect(result.receipts.V0).not.toHaveProperty('evidence.move')
  expect(result).not.toHaveProperty('candidates')
})
