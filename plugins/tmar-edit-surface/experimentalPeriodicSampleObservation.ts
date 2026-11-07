// SPDX-License-Identifier: AGPL-3.0-only
import type { prepareExperimentalPeriodicUBasis } from './experimentalPeriodicUBasis'

export type PeriodicObservationCandidate = { t: number; lateralU: number; supportU: number; lateral: number; support: number }
type Basis = ReturnType<typeof prepareExperimentalPeriodicUBasis>
type Weights = { index: number; squared: number }[]

const spanPair = ({ lateral, support }: PeriodicObservationCandidate) => `${lateral}:${support}`

/** One bounded sweep of quota-preserving training exchanges. Scores are proposals only. */
export function improveExperimentalPeriodicSampleObservation(
  seed: PeriodicObservationCandidate[], holdout: PeriodicObservationCandidate[], pool: PeriodicObservationCandidate[],
  basis: Basis, firstSeamU: number, maxComparisons: number,
) {
  const weights = (u: number): Weights => {
    const { indices, values } = basis.evaluate(u)
    return indices.flatMap((index, j) => index === 0 ? [] : [{ index: index - 1, squared: values[j] ** 2 }])
  }
  const masses = Array<number>(basis.poleCount - 1).fill(0)
  const updateMasses = (row: Weights) => {
    for (const { index, squared } of row) masses[index] += squared
  }
  updateMasses(weights(firstSeamU))
  const training = [...seed].sort((a, b) => a.t - b.t)
  for (const point of training) updateMasses(weights(point.lateralU))

  const groups = new Map<string, PeriodicObservationCandidate[]>()
  for (const point of pool) {
    const key = spanPair(point), group = groups.get(key)
    if (group) group.push(point)
    else groups.set(key, [point])
  }
  const occupiedLateral = new Set([...training, ...holdout].map(point => point.lateralU))
  const occupiedSupport = new Set([...training, ...holdout].map(point => point.supportU))
  const cache = new Map<number, Weights | null>()
  const cachedWeights = (u: number) => {
    if (!cache.has(u)) {
      try { cache.set(u, weights(u)) }
      catch { cache.set(u, null) }
    }
    return cache.get(u)
  }

  let comparisons = 0, proposedExchanges = 0, comparisonBudgetExhausted = false
  for (const [slot, current] of training.entries()) {
    const old = weights(current.lateralU)
    const without = old.map(({ index, squared }) => Math.max(0, masses[index] - squared))
    occupiedLateral.delete(current.lateralU)
    occupiedSupport.delete(current.supportU)
    let selected = current, selectedWeights = old, bestObservedDelta = 0, bestLogDelta = 0
    for (const candidate of groups.get(spanPair(current)) ?? []) {
      if (comparisons === maxComparisons) { comparisonBudgetExhausted = true; break }
      comparisons++
      if (candidate.t === current.t || occupiedLateral.has(candidate.lateralU) || occupiedSupport.has(candidate.supportU)) continue
      const replacement = cachedWeights(candidate.lateralU)
      if (!replacement || replacement.length !== old.length || replacement.some(({ index }, j) => index !== old[j].index)) continue
      // Prefer observing more free columns, then increase the sum of log
      // squared column masses. No floor is used for an unobserved column.
      let observedDelta = 0, logDelta = 0
      for (const [j, { index, squared }] of replacement.entries()) {
        const before = masses[index], after = without[j] + squared
        observedDelta += Number(after > 0) - Number(before > 0)
        logDelta += (after > 0 ? Math.log(after) : 0) - (before > 0 ? Math.log(before) : 0)
      }
      if (observedDelta > bestObservedDelta || (observedDelta === bestObservedDelta && logDelta > bestLogDelta)) {
        selected = candidate
        selectedWeights = replacement
        bestObservedDelta = observedDelta
        bestLogDelta = logDelta
      }
    }
    occupiedLateral.add(selected.lateralU)
    occupiedSupport.add(selected.supportU)
    if (selected !== current) {
      proposedExchanges++
      training[slot] = selected
      for (const [j, { index, squared }] of selectedWeights.entries()) masses[index] = without[j] + squared
    }
    if (comparisonBudgetExhausted) break
  }
  return { training, comparisons, proposedExchanges, comparisonBudgetExhausted }
}
