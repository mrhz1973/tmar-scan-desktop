// SPDX-License-Identifier: AGPL-3.0-only
import { mapPeriodicKnotsAffineRounded } from './experimentalPeriodicAffineKnotMap'
import { prepareExperimentalPeriodicUBasis } from './experimentalPeriodicUBasis'
import { boundExperimentalPeriodicUObservationGram } from './experimentalPeriodicUObservationGram'
import { improveExperimentalPeriodicSampleObservation,
  type PeriodicObservationCandidate as Candidate } from './experimentalPeriodicSampleObservation'

type Period = readonly [number, number]
type AxisInput = { knots: readonly number[]; uAtEdgeEnds: Period }
type Quota = { perSpan: number; minimumInterior: number }
type AxisName = 'lateral' | 'support'
type Group = 'training' | 'holdout'
type Counts = Record<AxisName, number[]>

export interface ExperimentalPeriodicIndependentSamplesRequest {
  edgePeriod: Period
  lateral: AxisInput
  support: AxisInput
  training: Quota
  holdout: Quota
  searchDepth: number
  maxAttempts: number
}

export interface ExperimentalPeriodicObservedSamplesRequest extends ExperimentalPeriodicIndependentSamplesRequest {
  observation: {
    degree: number
    multiplicities: readonly number[]
    maxComparisons: number
    maxRows: number
    maxFreeColumns: number
  }
}

const maxInteriorSamples = 4094
const fail = (reason: string): never => { throw new Error(`Campioni periodici indipendenti rifiutati: ${reason}`) }
const bits = new DataView(new ArrayBuffer(8))

function adjacent(value: number, up: boolean): number {
  if (value === 0) return up ? Number.MIN_VALUE : -Number.MIN_VALUE
  bits.setFloat64(0, value)
  bits.setBigUint64(0, bits.getBigUint64(0) + ((value > 0) === up ? 1n : -1n))
  return bits.getFloat64(0)
}

function validPeriod(period: Period) {
  return Array.isArray(period) && period.length === 2 &&
    Number.isFinite(period[0]) && Number.isFinite(period[1]) && period[0] < period[1]
}

function prepareAxis(input: AxisInput, edge: Period) {
  if (!input || !Array.isArray(input.knots) || input.knots.length < 2 || input.knots.length > 256 ||
      !Array.isArray(input.uAtEdgeEnds) || input.uAtEdgeEnds.length !== 2 ||
      Array.from(input.knots).some((value, i) => !Number.isFinite(value) || (i > 0 && value <= input.knots[i - 1])))
    fail('nodi o estremi U non validi')
  const { knots, uAtEdgeEnds: [start, end] } = input
  const first = knots[0], last = knots.at(-1)!
  if (!((start === first && end === last) || (start === last && end === first)))
    fail('la mappa U deve coprire un intero periodo')
  const direction = start < end ? 1 : -1
  const positive: Period = [direction * start, direction * end]
  const forward = (samples: readonly number[]) =>
    mapPeriodicKnotsAffineRounded(samples, ...positive).knots.map(u => direction * u)
  const inverse = (u: number) => mapPeriodicKnotsAffineRounded([positive[0], direction * u, positive[1]], ...edge).knots[1]
  const spanAt = (u: number) => {
    let lo = 0, hi = knots.length - 1
    while (hi - lo > 1) {
      const middle = Math.floor((lo + hi) / 2)
      if (u < knots[middle]) hi = middle
      else lo = middle
    }
    return knots[lo] < u && u < knots[hi] ? lo : -1
  }
  return { knots, forward, inverse, spanAt }
}

function emptyCounts(lateral: number, support: number): Counts {
  return { lateral: Array<number>(lateral).fill(0), support: Array<number>(support).fill(0) }
}

function assign(candidates: Candidate[], sizes: Record<AxisName, number>, quotas: Record<Group, Quota>) {
  const axes = ['lateral', 'support'] as const, groups = ['training', 'holdout'] as const
  const pools = {
    lateral: Array.from({ length: sizes.lateral }, () => [] as Candidate[]),
    support: Array.from({ length: sizes.support }, () => [] as Candidate[]),
  }
  for (const item of candidates) for (const axis of axes) pools[axis][item[axis]].push(item)
  const obligations = axes.flatMap(axis => pools[axis].map((pool, span) => ({ axis, span, pool })))
    .sort((a, b) => a.pool.length - b.pool.length)
  const chosen: Record<Group, Candidate[]> = { training: [], holdout: [] }
  const counts = { training: emptyCounts(sizes.lateral, sizes.support), holdout: emptyCounts(sizes.lateral, sizes.support) }
  const usedLateral = new Set<number>(), usedSupport = new Set<number>()
  const unused = (item: Candidate) => !usedLateral.has(item.lateralU) && !usedSupport.has(item.supportU)
  const take = (group: Group, item: Candidate) => {
    if (chosen[group].length >= maxInteriorSamples) return false
    chosen[group].push(item)
    usedLateral.add(item.lateralU)
    usedSupport.add(item.supportU)
    for (const axis of axes) counts[group][axis][item[axis]]++
    return true
  }
  for (const { axis, span, pool } of obligations) for (const group of groups) {
    const other = axis === 'lateral' ? 'support' : 'lateral'
    while (counts[group][axis][span] < quotas[group].perSpan) {
      // Prefer a point that also covers a currently deficient opposite span.
      const available = pool.filter(unused)
      const selected = available.find(item => counts[group][other][item[other]] < quotas[group].perSpan) ?? available[0]
      if (selected === undefined || !take(group, selected)) return undefined
    }
  }
  for (const group of groups) while (chosen[group].length < quotas[group].minimumInterior) {
    const selected = candidates.find(unused)
    if (selected === undefined || !take(group, selected)) return undefined
  }
  return chosen
}

/**
 * Search for distinct training and holdout grids after the same exact
 * affine rounding used by the sampler. Both sets contain the two seam
 * names. Every interior sample lies in an open span on both axes and its
 * mapped U is unique across the two sets on each axis.
 *
 * Dyadic/ULP trials and the greedy allocation are bounded and incomplete.
 * An inconclusive result carries no grids. Coverage and disjointness
 * concern the rounded affine model and leave fit rank and CAD separate.
 */
export function generateExperimentalPeriodicIndependentSamples(request: ExperimentalPeriodicIndependentSamplesRequest) {
  return searchIndependentSamples(request)
}

type Selection = NonNullable<ReturnType<typeof assign>>

function searchIndependentSamples(request: ExperimentalPeriodicIndependentSamplesRequest,
  choose?: (baseline: Selection, pool: Candidate[], baselineAttempts: number) => Selection,
) {
  if (!request || !validPeriod(request.edgePeriod)) fail('periodo del bordo non valido')
  const { edgePeriod: edge, training, holdout, searchDepth, maxAttempts } = request
  if (![training, holdout].every(quota => quota && Number.isInteger(quota.perSpan) &&
      quota.perSpan >= 1 && quota.perSpan <= maxInteriorSamples && Number.isInteger(quota.minimumInterior) &&
      quota.minimumInterior >= 1 && quota.minimumInterior <= maxInteriorSamples) ||
      !Number.isInteger(searchDepth) || searchDepth < 1 || searchDepth > 8 ||
      !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 65_536)
    fail('quote o budget di ricerca non validi')
  const lateral = prepareAxis(request.lateral, edge), support = prepareAxis(request.support, edge)
  const evidenceScope = 'rounded-affine-independent-periodic-samples' as const
  let attempts = 0
  const stop = (reason: string, at?: { axis: AxisName; span: number }) =>
    ({ status: 'inconclusive' as const, reason, at, attempts, evidenceScope })
  const spans = (['lateral', 'support'] as const).flatMap(axis => {
    const mapping = axis === 'lateral' ? lateral : support
    return mapping.knots.slice(0, -1).map((first, span) =>
      ({ axis, span, first, last: mapping.knots[span + 1], inverse: mapping.inverse }))
  })
  if (adjacent(edge[0], true) >= edge[1]) return stop('no-binary64-edge-interior')
  const emptySpan = spans.find(({ first, last }) => adjacent(first, true) >= last)
  if (emptySpan) return stop('no-binary64-knot-span-interior', { axis: emptySpan.axis, span: emptySpan.span })
  const sizes = { lateral: lateral.knots.length - 1, support: support.knots.length - 1 }
  if ([training, holdout].some(quota => quota.perSpan * Math.max(sizes.lateral, sizes.support) > maxInteriorSamples))
    return stop('coverage-exceeds-sampler-cap')
  const candidates: Candidate[] = [], tried = new Set<number>()
  const inverseTrials = new Set<number>()
  const reserve = () => {
    if (attempts >= maxAttempts) return false
    attempts++
    return true
  }
  const trial = (t: number) => {
    if (!(t > edge[0] && t < edge[1]) || tried.has(t)) return
    if (!reserve()) return
    tried.add(t)
    try {
      const grid = [edge[0], t, edge[1]]
      const lateralU = lateral.forward(grid)[1], supportU = support.forward(grid)[1]
      const i = lateral.spanAt(lateralU), j = support.spanAt(supportU)
      if (i >= 0 && j >= 0) candidates.push({ t, lateralU, supportU, lateral: i, support: j })
    } catch { /* This trial could not produce two interior rounded parameters. */ }
  }
  const seed = (span: typeof spans[number], u: number, neighbors: boolean) => {
    if (!(u > span.first && u < span.last) || !reserve()) return
    let t: number
    try { t = span.inverse(u) } catch { return }
    inverseTrials.add(t)
    trial(t)
    if (neighbors) {
      trial(adjacent(t, false))
      trial(adjacent(t, true))
    }
  }

  const quotas = { training, holdout }
  let chosen: ReturnType<typeof assign>
  let baselineAttempts = 0
  for (let depth = 1; (chosen === undefined || choose !== undefined) && attempts < maxAttempts && depth <= searchDepth; depth++) {
    const denominator = 2 ** depth
    for (let i = 1; i < denominator && attempts < maxAttempts; i += 2) {
      const fraction = i / denominator
      for (const span of spans) {
        const width = span.last - span.first
        const u = Number.isFinite(width) ? span.first + fraction * width : (1 - fraction) * span.first + fraction * span.last
        seed(span, u, false)
        if (attempts === maxAttempts) break
      }
    }
    if (chosen === undefined) {
      chosen = assign(candidates, sizes, quotas)
      if (chosen !== undefined) baselineAttempts = attempts
    }
  }
  if (chosen === undefined && attempts < maxAttempts) {
    trial(adjacent(edge[0], true))
    trial(adjacent(edge[1], false))
    for (const t of inverseTrials) {
      trial(adjacent(t, false))
      trial(adjacent(t, true))
      if (attempts === maxAttempts) break
    }
    for (const span of spans) {
      seed(span, adjacent(span.first, true), true)
      seed(span, adjacent(span.last, false), true)
      if (attempts === maxAttempts) break
    }
    chosen = assign(candidates, sizes, quotas)
    if (chosen !== undefined) baselineAttempts = attempts
  }
  if (chosen === undefined)
    return stop(attempts === maxAttempts ? 'candidate-budget-exhausted' : 'insufficient-independent-coverage')

  const selection = choose ? choose(chosen, candidates, baselineAttempts) : chosen
  const grid = (group: Group) => [edge[0], ...selection[group].map(item => item.t).sort((a, b) => a - b), edge[1]]
  const trainingGrid = grid('training'), holdoutGrid = grid('holdout')
  const coverage = { training: emptyCounts(sizes.lateral, sizes.support), holdout: emptyCounts(sizes.lateral, sizes.support) }
  try {
    for (const [name, mapping] of [['lateral', lateral], ['support', support]] as const) {
      const used = new Set<number>()
      for (const [group, samples] of [['training', trainingGrid], ['holdout', holdoutGrid]] as const) {
        if (samples.length - 2 < quotas[group].minimumInterior) return stop('mapping-verification-refused')
        for (const u of mapping.forward(samples).slice(1, -1)) {
          const span = mapping.spanAt(u)
          if (span < 0 || used.has(u)) return stop('mapping-verification-refused')
          used.add(u)
          coverage[group][name][span]++
        }
        if (coverage[group][name].some(count => count < quotas[group].perSpan))
          return stop('mapping-verification-refused')
      }
    }
  } catch { return stop('mapping-verification-refused') }
  return { status: 'generated' as const, training: trainingGrid, holdout: holdoutGrid, coverage, attempts, evidenceScope }
}

/**
 * Improve the sampled free-U Gram inverse norm at fixed training cardinality.
 * The greedy seed and its holdout grid are unchanged until proposed exchanges
 * pass independent Gram comparison. Exchanges stay within the same two
 * rounded native spans. A certified baseline is retained when no strict
 * improvement is proved. A baseline whose Gram cannot be certified yields
 * an inconclusive result. The method does not search for rank recovery.
 */
export function generateExperimentalPeriodicObservedSamples(request: ExperimentalPeriodicObservedSamplesRequest) {
  const limits = request?.observation
  if (!limits || !Array.isArray(limits.multiplicities) ||
      !Number.isInteger(limits.maxComparisons) || limits.maxComparisons < 1 || limits.maxComparisons > 1_000_000 ||
      !Number.isInteger(limits.maxRows) || limits.maxRows < 1 || limits.maxRows > 4096 ||
      !Number.isInteger(limits.maxFreeColumns) || limits.maxFreeColumns < 1 || limits.maxFreeColumns > 256)
    fail('budget di osservazione non validi')
  const { degree, multiplicities, maxRows, maxFreeColumns, maxComparisons } = limits
  const knots = request.lateral?.knots
  const firstSeamU = request.lateral?.uAtEdgeEnds?.[0]
  if (!Array.isArray(knots) || !Number.isFinite(firstSeamU)) fail('base laterale di osservazione non valida')
  const basis = prepareExperimentalPeriodicUBasis(degree, knots, multiplicities)
  const gram = (training: Candidate[]) => boundExperimentalPeriodicUObservationGram({
    degree, knots, multiplicities, maxRows, maxFreeColumns,
    parameters: [firstSeamU, ...training.map(point => point.lateralU).sort((a, b) =>
      firstSeamU === knots[0] ? a - b : b - a)],
  })
  type Gram = ReturnType<typeof gram>
  type Report = { selection: 'baseline-not-certified' | 'baseline-retained' | 'certified-improvement'; baselineAttempts: number; baseline: Gram;
    trial?: Gram; comparisons: number; proposedExchanges: number; comparisonBudgetExhausted: boolean }
  let observation: Report | undefined
  const result = searchIndependentSamples(request, (baseline, pool, baselineAttempts) => {
    const initial = gram(baseline.training)
    const report: Report = { selection: initial.status === 'certified-full-rank' ? 'baseline-retained' : 'baseline-not-certified',
      baselineAttempts, baseline: initial,
      comparisons: 0, proposedExchanges: 0, comparisonBudgetExhausted: false }
    observation = report
    if (initial.status !== 'certified-full-rank') return baseline

    const { training, ...work } = improveExperimentalPeriodicSampleObservation(
      baseline.training, baseline.holdout, pool, basis, firstSeamU, maxComparisons,
    )
    Object.assign(report, work)
    if (report.proposedExchanges === 0) return baseline
    const trial = report.trial = gram(training)
    if (trial.status !== 'certified-full-rank' || !(trial.inverseInfinityNormUpper < initial.inverseInfinityNormLower))
      return baseline
    report.selection = 'certified-improvement'
    return { training, holdout: baseline.holdout }
  })
  if (result.status !== 'generated') return result
  if (observation?.baseline.status !== 'certified-full-rank') {
    const { attempts, evidenceScope } = result
    return { status: 'inconclusive' as const, reason: 'observation-gram-inconclusive', attempts, evidenceScope, observation }
  }
  return { ...result, observation }
}
