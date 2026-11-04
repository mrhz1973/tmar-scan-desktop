// SPDX-License-Identifier: AGPL-3.0-only
import * as THREE from 'three'

export interface SnapHit { point: THREE.Vector3; kind: 'scan' | 'cad'; label: string }

/** Closest surface intersection along the permitted motion, in part mm.
 * The reference meshes and their BVHs are borrowed, never modified here. */
export function snapAlong(candidate: THREE.Vector3, direction: THREE.Vector3, maxDistance: number, targets: THREE.Mesh[]): SnapHit | null {
  if (![...candidate.toArray(), ...direction.toArray(), maxDistance].every(Number.isFinite) ||
      maxDistance <= 0 || direction.lengthSq() < 1e-20 || !targets.length) return null
  const raycaster = new THREE.Raycaster() as THREE.Raycaster & { firstHitOnly?: boolean }
  raycaster.firstHitOnly = true
  raycaster.far = maxDistance
  const axis = direction.clone().normalize()
  let best: THREE.Intersection | undefined
  for (const sign of [1, -1]) {
    raycaster.set(candidate, axis.clone().multiplyScalar(sign))
    const hit = raycaster.intersectObjects(targets, false)[0]
    if (hit && (!best || hit.distance < best.distance)) best = hit
  }
  if (!best) return null
  const kind = best.object.userData.snapKind
  if (kind !== 'scan' && kind !== 'cad') return null
  return { point: best.point.clone(), kind, label: String(best.object.userData.snapLabel ?? (kind === 'scan' ? 'Scansione' : 'CAD')) }
}
