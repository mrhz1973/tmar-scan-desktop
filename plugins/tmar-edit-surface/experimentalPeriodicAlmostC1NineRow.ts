// SPDX-License-Identifier: AGPL-3.0-only
import type { Net, Point } from './brep'
import { boundPeriodicLinearVRefinement } from './experimentalPeriodicLinearVRefinementBound'
import { proposeExperimentalPeriodicNineRowStrip } from './experimentalPeriodicNineRowStrip'
import { prepareExperimentalPeriodicOneSidedSurfaceDerivatives } from './experimentalPeriodicOneSidedSurfaceDerivatives'
import { boundExperimentalPeriodicSeamDerivativeGap } from './experimentalPeriodicSeamDerivativeGap'
import { sampleExperimentalPeriodicTransverseDerivatives } from './experimentalPeriodicTransverseSamples'
import { prepareExperimentalPeriodicUBasis } from './experimentalPeriodicUBasis'
import { fitExperimentalPeriodicUVectorSamples } from './experimentalPeriodicUVectorFit'
import { refineLinearPeriodicV } from './periodic'

type Edge = 'V0' | 'V1'
type Side = 'left' | 'right'
type Phase = 'preflight' | 'refinement' | 'seam' | 'sampling' | 'fit' | 'proposal' | 'holdout' | 'interior'
type Location = {
  role?: string; joint?: Edge; t?: number; stripU?: number; supportU?: number; v?: number; supportV?: number; seamSide?: Side
}
type Maximum = { value: number; at: Location }
type SamplerRequest = Parameters<typeof sampleExperimentalPeriodicTransverseDerivatives>[0]
type Sample = ReturnType<typeof sampleExperimentalPeriodicTransverseDerivatives>['samples'][number]

interface Joint {
  support: SamplerRequest['support']
  stripUAtEdgeEnds: readonly [number, number]
  edgePeriod: readonly [number, number]
  training: readonly number[]
  holdout: readonly number[]
  lambda: number
}

interface Budgets {
  refinementPosition: number
  candidateDisplacement: number
  seamDerivativeGap: number
  sampledPosition: number
  trainingDerivativeResidual: number
  holdoutDerivativeResidual: number
  storageDerivativeResidual: number
  minimumSampledNormalNorm: number
  jointNormalChord: number
  interiorNormalChord: number
}

interface JointEvidence {
  trainingGap?: Maximum
  holdoutGap?: Maximum
  trainingResidual?: Maximum
  holdoutFitResidual?: Maximum
  storedHoldoutResidual?: Maximum
  originalJointNormalChord?: Maximum
  candidateJointNormalChord?: Maximum
  rank?: number
  pivotRatio?: number
  trainingCount?: number
  holdoutCount?: number
}

export interface ExperimentalAlmostC1NineRowRequest {
  source: Net
  /** Joint at the strip's V0, followed by the joint at V1. */
  joints: readonly [Joint, Joint]
  budgets: Budgets
  interiorVFractions: readonly number[]
  lockIndices?: readonly number[]
}

const fail = (reason: string): never => { throw new Error(reason) }
const maximum = (previous: Maximum | undefined, value: number, at: Location): Maximum =>
  previous === undefined || value > previous.value ? { value, at } : previous
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const signV = (edge: Edge) => edge === 'V0' ? 1 : -1
const signU = (ends: readonly [number, number]) => ends[0] < ends[1] ? 1 : -1
const vAt = (net: Net, edge: Edge) => edge === 'V0' ? net.kv[0] : net.kv.at(-1)!
const mappedSide = (side: Side, sign: number): Side => sign > 0 ? side : side === 'left' ? 'right' : 'left'
const sampleLocation = (joint: Edge, sample: Sample): Location =>
  ({ joint, t: sample.edgeParameter, stripU: sample.parameter, supportU: sample.supportParameter })
const holdoutCoverage = {
  fitResidual: 'interior-only',
  gap: 'interior-and-seam',
  storedResidual: 'interior-and-both-seam-sides',
  jointNormalChord: 'interior-and-both-seam-sides',
} as const

function unitNormal(normal: Point, minimum: number, sign = 1): Point {
  const norm = Math.hypot(...normal)
  if (!Number.isFinite(norm) || norm < minimum) fail('norma campionata non rappresentabile o sotto soglia')
  return normal.map(x => sign * (x / norm)) as Point
}

function requireIsolatedSeam(net: Net) {
  if (net.mu[0] !== net.du || net.mu.slice(1, -1).some(m => m >= net.du) ||
      net.mv.slice(1, -1).some(m => m >= net.dv))
    fail('richiesta cucitura U strutturalmente C0 isolata, con nodi interni C1')
}

/**
 * Coefficient-only diagnostic for a nine-row proposal with a saturated U
 * seam on all three inputs and C1 internal knots. The supplied affine maps already express the intended edge
 * correspondence. Budgets refer to the native parameters of each metric.
 * Normal chords and cross-surface residuals are floating-point samples.
 * The fitted holdout residual excludes the seam used in training. The
 * planned gap includes the seam, and stored residuals and joint normals
 * include both seam sides. An internal nonpositive sampled normal dot
 * stops the diagnostic independently of the chord budget.
 * The successful status records these diagnostics and their budgets only.
 * Continuous joint and normal certification, kernel evaluation, topology
 * and all CAD acceptance are outside this routine.
 */
export function measureExperimentalAlmostC1NineRow(request: ExperimentalAlmostC1NineRowRequest) {
  const evidence: {
    refinement?: ReturnType<typeof boundPeriodicLinearVRefinement>
    displacement?: ReturnType<typeof boundPeriodicLinearVRefinement>
    seams: { role: string; result: ReturnType<typeof boundExperimentalPeriodicSeamDerivativeGap> }[]
    joints: Record<Edge, JointEvidence>
    holdoutCoverage: typeof holdoutCoverage
    storage?: ReturnType<typeof proposeExperimentalPeriodicNineRowStrip>['validation']
    changedIndices?: number[]
    interiorNormalChord?: Maximum
  } = { seams: [], joints: { V0: {}, V1: {} }, holdoutCoverage: { ...holdoutCoverage } }
  const evidenceScope = 'coefficient-diagnostics-only' as const
  let phase: Phase = 'preflight', location: Location = {}
  const stop = (status: 'declined' | 'inconclusive', reason: string) =>
    ({ status, phase, location, reason, evidence, evidenceScope })

  try {
    if (!request) fail('richiesta diagnostica mancante')
    const { source, joints, budgets, interiorVFractions, lockIndices } = request
    if (!Array.isArray(joints) || joints.length !== 2 || !joints[0] || !joints[1] || !budgets)
      fail('servono due giunti e budget espliciti')
    const limits = [budgets.refinementPosition, budgets.candidateDisplacement, budgets.seamDerivativeGap,
      budgets.sampledPosition, budgets.trainingDerivativeResidual, budgets.holdoutDerivativeResidual,
      budgets.storageDerivativeResidual, budgets.minimumSampledNormalNorm, budgets.jointNormalChord,
      budgets.interiorNormalChord]
    if (limits.some(value => !Number.isFinite(value) || value < 0) ||
        budgets.storageDerivativeResidual === 0 || budgets.minimumSampledNormalNorm === 0 ||
        budgets.jointNormalChord > 2 || budgets.interiorNormalChord > 2)
      fail('budget diagnostici non validi')
    if (!Array.isArray(interiorVFractions) || interiorVFractions.length < 1 || interiorVFractions.length > 32 ||
        Array.from(interiorVFractions).some((v, i) => !Number.isFinite(v) ||
          v <= 0 || v >= 1 || (i > 0 && v <= interiorVFractions[i - 1])))
      fail('quote V interne non valide')

    const checkSeam = (net: Net, role: string) => {
      phase = 'seam'
      location = { role }
      const result = boundExperimentalPeriodicSeamDerivativeGap(net, budgets.seamDerivativeGap)
      requireIsolatedSeam(net)
      evidence.seams.push({ role, result })
      if (result.status === 'inconclusive') return stop('inconclusive', result.reason)
    }
    for (const [role, net] of [['source', source], ['support-V0', joints[0].support.net],
      ['support-V1', joints[1].support.net]] as const) {
      const stopped = checkSeam(net, role)
      if (stopped) return stopped
    }

    phase = 'refinement'
    location = { role: 'refined' }
    const refined = refineLinearPeriodicV(source, 9)
    const refinement = boundPeriodicLinearVRefinement(source, refined)
    evidence.refinement = refinement
    if (refinement.maxPositionError > budgets.refinementPosition || refinement.maxBoundaryPositionError !== 0)
      return stop('inconclusive', 'limite di raffinamento o conservazione dei bordi non comprovati')
    const refinedSeam = checkSeam(refined, 'refined')
    if (refinedSeam) return refinedSeam

    const basis = prepareExperimentalPeriodicUBasis(refined.du, refined.ku, refined.mu)
    const fitJoint = (joint: Joint, edge: Edge) => {
      phase = 'sampling'
      location = { joint: edge }
      const report = evidence.joints[edge]
      const sampler: SamplerRequest = {
        strip: { net: refined, edge, uAtEdgeEnds: joint.stripUAtEdgeEnds }, support: joint.support,
        edgePeriod: joint.edgePeriod, edgeParameters: joint.training,
        lambda: joint.lambda, positionTolerance: Number.MAX_VALUE,
      }
      const training = sampleExperimentalPeriodicTransverseDerivatives(sampler).samples.slice(0, -1)
      for (const sample of training) report.trainingGap = maximum(report.trainingGap, sample.sampledGap, sampleLocation(edge, sample))
      if (report.trainingGap!.value > budgets.sampledPosition) {
        location = report.trainingGap!.at
        fail('distanza campionata dei bordi del fit oltre budget')
      }
      const holdout = sampleExperimentalPeriodicTransverseDerivatives({ ...sampler, edgeParameters: joint.holdout })
        .samples.slice(0, -1)
      for (const sample of holdout) report.holdoutGap = maximum(report.holdoutGap, sample.sampledGap, sampleLocation(edge, sample))
      if (report.holdoutGap!.value > budgets.sampledPosition) {
        location = report.holdoutGap!.at
        fail('distanza campionata dei bordi holdout oltre budget')
      }
      const trainedStrip = new Set(training.map(sample => sample.parameter))
      const trainedSupport = new Set(training.map(sample => sample.supportParameter))
      for (const sample of holdout.slice(1)) if (trainedStrip.has(sample.parameter) || trainedSupport.has(sample.supportParameter)) {
        location = sampleLocation(edge, sample)
        fail('holdout sovrapposto ai campioni del fit dopo la mappatura')
      }
      phase = 'fit'
      report.trainingCount = training.length
      report.holdoutCount = holdout.length - 1
      const fit = fitExperimentalPeriodicUVectorSamples(refined.du, refined.ku, refined.mu, training)
      report.rank = fit.rank
      report.pivotRatio = fit.pivotRatio
      for (const [i, residual] of fit.residuals.entries())
        report.trainingResidual = maximum(report.trainingResidual, residual, sampleLocation(edge, training[i]))
      if (report.trainingResidual!.value > budgets.trainingDerivativeResidual) {
        location = report.trainingResidual!.at
        fail('residuo campionato del fit oltre budget')
      }
      for (const sample of holdout.slice(1)) {
        location = sampleLocation(edge, sample)
        const { indices, values } = basis.evaluate(sample.parameter)
        const fitted = sample.value.map((_, axis) => indices.reduce((sum, index, j) =>
          sum + values[j] * fit.coefficients[index][axis], 0)) as Point
        const residual = distance(fitted, sample.value)
        if (!Number.isFinite(residual)) fail('residuo holdout non rappresentabile')
        report.holdoutFitResidual = maximum(report.holdoutFitResidual, residual, location)
      }
      if (report.holdoutFitResidual!.value > budgets.holdoutDerivativeResidual) {
        location = report.holdoutFitResidual!.at
        fail('residuo holdout del fit oltre budget')
      }
      return { joint, edge, holdout, coefficients: fit.coefficients }
    }

    const lower = fitJoint(joints[0], 'V0'), upper = fitJoint(joints[1], 'V1')
    phase = 'proposal'
    location = { role: 'candidate' }
    const proposal = proposeExperimentalPeriodicNineRowStrip({ net: refined, targetInwardV0: lower.coefficients,
      targetInwardV1: upper.coefficients, derivativeTolerance: budgets.storageDerivativeResidual, lockIndices })
    const candidate = proposal.net
    evidence.storage = proposal.validation
    evidence.changedIndices = proposal.changedIndices
    const displacement = boundPeriodicLinearVRefinement(source, candidate)
    evidence.displacement = displacement
    // Zero endpoint displacement keeps the measured boundary gaps valid
    // for the stored candidate in the coefficient model.
    if (displacement.maxPositionError > budgets.candidateDisplacement || displacement.maxBoundaryPositionError !== 0)
      return stop('inconclusive', 'limite di spostamento o conservazione dei bordi non comprovati')
    const candidateSeam = checkSeam(candidate, 'candidate')
    if (candidateSeam) return candidateSeam

    phase = 'holdout'
    location = { role: 'source' }
    const original = prepareExperimentalPeriodicOneSidedSurfaceDerivatives(source)
    location = { role: 'candidate' }
    const stored = prepareExperimentalPeriodicOneSidedSurfaceDerivatives(candidate)
    for (const { joint, edge, holdout } of [lower, upper]) {
      location = { joint: edge }
      const support = prepareExperimentalPeriodicOneSidedSurfaceDerivatives(joint.support.net)
      const report = evidence.joints[edge]
      const stripDirection = signU(joint.stripUAtEdgeEnds), supportDirection = signU(joint.support.uAtEdgeEnds)
      const stripV = vAt(candidate, edge), supportV = vAt(joint.support.net, joint.support.edge)
      for (const [i, sample] of holdout.entries()) {
        const sides: (Side | undefined)[] = i === 0 ? ['left', 'right'] : [undefined]
        for (const side of sides) {
          location = { ...sampleLocation(edge, sample), v: stripV, supportV, seamSide: side }
          const stripSides = side === undefined ? {} : { u: mappedSide(side, stripDirection) }
          const supportSides = side === undefined ? {} : { u: mappedSide(side, supportDirection) }
          const old = original.evaluate(sample.parameter, stripV, stripSides)
          const next = stored.evaluate(sample.parameter, stripV, stripSides)
          const neighbor = support.evaluate(sample.supportParameter, supportV, supportSides)
          const target = neighbor.dv.map(x => -joint.lambda * signV(joint.support.edge) * x) as Point
          const inward = next.dv.map(x => signV(edge) * x) as Point
          const residual = distance(inward, target)
          if (!Number.isFinite(residual)) fail('residuo del candidato non rappresentabile')
          report.storedHoldoutResidual = maximum(report.storedHoldoutResidual, residual, location)
          const commonStrip = stripDirection * signV(edge)
          const commonSupport = -supportDirection * signV(joint.support.edge)
          const normal = unitNormal(neighbor.normal, budgets.minimumSampledNormalNorm, commonSupport)
          const before = distance(unitNormal(old.normal, budgets.minimumSampledNormalNorm, commonStrip), normal)
          const after = distance(unitNormal(next.normal, budgets.minimumSampledNormalNorm, commonStrip), normal)
          report.originalJointNormalChord = maximum(report.originalJointNormalChord, before, location)
          report.candidateJointNormalChord = maximum(report.candidateJointNormalChord, after, location)
          if (residual > budgets.holdoutDerivativeResidual) fail('residuo campionato del candidato oltre budget')
          if (after > budgets.jointNormalChord) fail('distanza campionata delle normali al giunto oltre budget')
        }
      }
    }

    phase = 'interior'
    location = {}
    const firstV = source.kv[0], lastV = source.kv.at(-1)!
    const vParameters = interiorVFractions.map(f => firstV + (lastV - firstV) * f)
    if (vParameters.some((v, i) => !(v > firstV && v < lastV) || (i > 0 && v <= vParameters[i - 1])))
      fail('quote V interne non rappresentabili')
    const uParameters = new Set([source.ku[0], ...[...lower.holdout.slice(1), ...upper.holdout.slice(1)]
      .map(sample => sample.parameter)])
    if ((uParameters.size + 1) * vParameters.length > 32_768) fail('limite dei campioni interni superato')
    for (const u of uParameters) for (const v of vParameters) {
      const sides: (Side | undefined)[] = u === source.ku[0] ? ['left', 'right'] : [undefined]
      for (const side of sides) {
        location = { stripU: u, v, seamSide: side }
        const old = original.evaluate(u, v, { u: side }), next = stored.evaluate(u, v, { u: side })
        const oldUnit = unitNormal(old.normal, budgets.minimumSampledNormalNorm)
        const nextUnit = unitNormal(next.normal, budgets.minimumSampledNormalNorm)
        const chord = distance(oldUnit, nextUnit)
        evidence.interiorNormalChord = maximum(evidence.interiorNormalChord, chord, location)
        const normalDot = oldUnit[0] * nextUnit[0] + oldUnit[1] * nextUnit[1] + oldUnit[2] * nextUnit[2]
        if (!(normalDot > 0)) fail('prodotto scalare campionato delle normali interne non positivo')
        if (chord > budgets.interiorNormalChord) fail('distanza campionata delle normali interne oltre budget')
      }
    }
    return { status: 'diagnostic-only' as const, evidence, evidenceScope, candidate }
  } catch (error) {
    return stop('declined', error instanceof Error ? error.message : 'diagnostica non completata')
  }
}
