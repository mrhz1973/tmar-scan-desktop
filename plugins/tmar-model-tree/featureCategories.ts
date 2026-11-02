// SPDX-License-Identifier: AGPL-3.0-only
// A display classification, never a reordering of the CAD build history.
export type FeatureCategory = 'sketches' | 'sections' | 'surfaces' | 'bodies' | 'other'
export interface FeatureIdentity {
  id: number
  kind: string
  suppressed?: boolean
  plane?: { kind: string }
}
export const FEATURE_CATEGORIES: readonly { id: FeatureCategory; label: string; hint: string }[] = [
  { id: 'sketches', label: 'Sketches / profiles', hint: 'Only sketch visibility changes. Solid and surface bodies are kept.' },
  { id: 'sections', label: 'Sketches from sections', hint: 'Sketches attached to section planes. Hiding them keeps the source sections and all bodies.' },
  { id: 'surfaces', label: 'Surface operations', hint: 'Only current surface-body outputs are shown or hidden. Solid bodies are kept.' },
  { id: 'bodies', label: 'Solid-body operations', hint: 'These operations can share a current body. Show/Hide affects only their current solid-body outputs.' },
  { id: 'other', label: 'Other features', hint: 'Unclassified feature types stay visible in the list. Use the original history controls to inspect them.' },
]
const SURFACE_KINDS = new Set(['sheet', 'surface', 'network'])
const BODY_KINDS = new Set([
  'extrude', 'revolve', 'fillet', 'chamfer', 'shell', 'hole', 'thread', 'draft',
  'mirror', 'boolean', 'split', 'loft', 'sweep', 'pattern', 'moveBody',
  'offsetBody', 'extract', 'import', 'trim', 'thicken', 'cutPlane', 'moveFace', 'deleteFace',
])
export function featureCategory(feature: FeatureIdentity): FeatureCategory {
  if (feature.kind === 'sketch') return feature.plane?.kind === 'section' ? 'sections' : 'sketches'
  if (SURFACE_KINDS.has(feature.kind)) return 'surfaces'
  if (BODY_KINDS.has(feature.kind)) return 'bodies'
  return 'other' // Unknown kinds must not gain body visibility permissions.
}
export function categoryFeatureIds(features: readonly FeatureIdentity[], category: FeatureCategory): number[] {
  return features.filter((f) => featureCategory(f) === category).map((f) => f.id)
}
export interface VisibilityState {
  features: readonly FeatureIdentity[]
  bodies: readonly { id: number; surface?: boolean }[]
  results: Readonly<Record<number, { bodies?: readonly number[] } | undefined>>
}
/** A stale or mixed selection is filtered again at the action boundary. The
 * optional unscoped form is retained only for existing diagnostic callers. */
export function resolveFeatureTargets(state: VisibilityState, ids: readonly number[], category?: FeatureCategory) {
  const features = new Map(state.features.map((f) => [f.id, f]))
  const built = new Map(state.bodies.map((b) => [b.id, b]))
  const sketches: number[] = [], bodies = new Set<number>(), skipped: number[] = []
  for (const id of new Set(ids)) {
    const feature = features.get(id)
    if (!feature || feature.suppressed || (category !== undefined &&
      (category === 'other' || featureCategory(feature) !== category))) {
      skipped.push(id); continue
    }
    if (feature.kind === 'sketch') { sketches.push(id); continue }
    const output = [...(state.results[id]?.bodies ?? []), id].filter((bodyId) => {
      const body = built.get(bodyId)
      if (!body) return false
      if (category === 'surfaces') return body.surface === true
      if (category === 'bodies') return body.surface !== true
      return category === undefined
    })
    if (!output.length) skipped.push(id)
    for (const body of output) bodies.add(body)
  }
  return { sketches, bodies: [...bodies], skipped }
}
