// SPDX-License-Identifier: AGPL-3.0-only
import { historyAction, registerHistory } from '../../src/state/historyStore'
import { useStore } from '../../src/state/store'
import { useCommandActivity } from '../../src/commands/activity'
import { reEditorOpen, useReverse, type ReState } from '../reverse/state/reStore'
import type { Feature } from '../reverse/core/features'
import { FEATURE_CATEGORIES, resolveFeatureTargets, type FeatureCategory } from './featureCategories'

/** Legacy diagnostics may omit the category; UI writes always require one. */
export function featureTargets(state: Pick<ReState, 'features' | 'bodies' | 'results'>, ids: readonly number[], category?: FeatureCategory) {
  return resolveFeatureTargets(state, ids, category)
}
export function setFeatureVisibility(ids: readonly number[], visible: boolean, category: FeatureCategory): void {
  // Runtime guard as well as TypeScript: no accidental global action.
  if (!FEATURE_CATEGORIES.some((item) => item.id === category) || category === 'other') return
  const s = useReverse.getState()
  if (s.building || reEditorOpen(s) || s.playback || useStore.getState().busy || useCommandActivity.getState().running) return
  const targets = featureTargets(s, ids, category)
  const sketches = new Set(targets.sketches), bodies = new Set(targets.bodies)
  if (!sketches.size && !bodies.size) { useStore.getState().setStatus('No independent displayed output of this category is selected. Other categories and body visibility are unchanged.'); return }
  historyAction(`${visible ? 'Show' : 'Hide'} selected ${category} outputs`, () => {
    useReverse.setState((state) => {
      const change = (f: Feature) => sketches.has(f.id) && f.visible !== visible ? { ...f, visible } : f
      const features = state.features.map(change)
      const hidden = new Set(state.hiddenBodies)
      for (const id of bodies) { if (visible) hidden.delete(id); else hidden.add(id) }
      return {
        features: features.some((f, i) => f !== state.features[i]) ? features : state.features,
        hiddenBodies: bodies.size ? [...hidden] : state.hiddenBodies,
        bodies: bodies.size ? state.bodies.map((body) => bodies.has(body.id) && body.visible !== visible ? { ...body, visible } : body) : state.bodies,
      }
    })
  })
  useStore.getState().setStatus(`${targets.sketches.length} sketches and ${targets.bodies.length} body outputs ${visible ? 'shown' : 'hidden'} in ${category} only.${targets.skipped.length ? ` ${targets.skipped.length} incompatible or unavailable outputs unchanged.` : ''}`)
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
