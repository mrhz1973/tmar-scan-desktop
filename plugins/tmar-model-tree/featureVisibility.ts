// SPDX-License-Identifier: AGPL-3.0-only
import { historyAction, registerHistory } from '../../src/state/historyStore'
import { useStore } from '../../src/state/store'
import { useCommandActivity } from '../../src/commands/activity'
import { reEditorOpen, useReverse, type ReState } from '../reverse/state/reStore'
import type { Feature } from '../reverse/core/features'

/** Only actual displayed outputs are affected. Hiding never suppresses a feature. */
export function featureTargets(state: Pick<ReState, 'features' | 'bodies' | 'results'>, ids: readonly number[]) {
  const wanted = new Set(ids), built = new Set(state.bodies.map((b) => b.id))
  const sketches: number[] = [], bodies = new Set<number>(), skipped: number[] = []
  for (const id of wanted) {
    const feature = state.features.find((f) => f.id === id)
    if (!feature || feature.suppressed) { skipped.push(id); continue }
    if (feature.kind === 'sketch') { sketches.push(id); continue }
    const output = [...(state.results[id]?.bodies ?? []), id].filter((body) => built.has(body))
    if (!output.length) skipped.push(id)
    for (const body of output) bodies.add(body)
  }
  return { sketches, bodies: [...bodies], skipped }
}
export function setFeatureVisibility(ids: readonly number[], visible: boolean): void {
  const s = useReverse.getState()
  if (s.building || reEditorOpen(s) || s.playback || useStore.getState().busy || useCommandActivity.getState().running) return
  const targets = featureTargets(s, ids)
  const sketches = new Set(targets.sketches), bodies = new Set(targets.bodies)
  if (!sketches.size && !bodies.size) { useStore.getState().setStatus('No displayed output in this selection. Rolled-back, suppressed or consumed features cannot be shown independently.'); return }
  historyAction(`${visible ? 'Show' : 'Hide'} selected feature outputs`, () => {
    useReverse.setState((state) => {
      const change = (f: Feature) => sketches.has(f.id) && f.visible !== visible ? { ...f, visible } : f
      const features = state.features.map(change)
      const hidden = new Set(state.hiddenBodies)
      for (const id of bodies) { if (visible) hidden.delete(id); else hidden.add(id) }
      return {
        features: features.some((f, i) => f !== state.features[i]) ? features : state.features,
        hiddenBodies: [...hidden],
        bodies: state.bodies.map((body) => bodies.has(body.id) && body.visible !== visible ? { ...body, visible } : body),
      }
    })
  })
  useStore.getState().setStatus(`${targets.sketches.length} sketches and ${targets.bodies.length} body outputs ${visible ? 'shown' : 'hidden'}.${targets.skipped.length ? ` ${targets.skipped.length} features have no independent displayed output; unchanged.` : ''}`)
}
export function registerFeatureVisibilityHistory(): () => void {
  return registerHistory({ sections: [{
    key: 'tmarFeatureVisibility',
    capture: () => ({ hiddenBodies: useReverse.getState().hiddenBodies }),
    apply: (value) => {
      const hiddenBodies = (value as { hiddenBodies: number[] }).hiddenBodies
      const hidden = new Set(hiddenBodies)
      useReverse.setState((s) => ({ hiddenBodies, bodies: s.bodies.map((b) => ({ ...b, visible: !hidden.has(b.id) })) }))
    },
  }] })
}
