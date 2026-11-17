// SPDX-License-Identifier: AGPL-3.0-only
import type * as THREE from 'three'
import type { SceneManager } from './SceneManager'

/** Display-only layers run in the comparison renderer, after its camera and
 *  section plane have caught up. They do not participate in picking. */
export interface ComparisonDisplayLayer {
  tick?(): void
  dispose(): void
}

export interface ComparisonDisplayHost {
  /** Borrowed mesh: a layer may attach an overlay, but never owns its geometry
   *  or material. Null after the comparison viewport has been disposed. */
  referenceMesh(): THREE.Mesh | null
  /** Removal disposes the layer. Host disposal removes any remaining layers. */
  addDisplayLayer(layer: ComparisonDisplayLayer): () => void
  invalidate(): void
}

const views = new WeakMap<SceneManager, { host: ComparisonDisplayHost }>()
const listeners = new Set<() => void>()

/** The owner's live comparison viewport, including while it is paused/hidden.
 *  The caller chooses whether its display belongs there or in the main view. */
export function comparisonViewOf(owner: SceneManager | null): ComparisonDisplayHost | null {
  return owner ? views.get(owner)?.host ?? null : null
}

/** Compatible with useSyncExternalStore; read comparisonViewOf for the current
 *  snapshot, including a host attached before subscription. */
export function subscribeComparisonViews(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Publish a fully configured viewport. Detach it before disposing the host;
 *  stale cleanup must not remove a newer registration for the same owner. */
export function attachComparisonView(owner: SceneManager, host: ComparisonDisplayHost): () => void {
  const registration = { host }
  views.set(owner, registration)
  for (const listener of listeners) listener()
  return () => {
    if (views.get(owner) !== registration) return
    views.delete(owner)
    for (const listener of listeners) listener()
  }
}
