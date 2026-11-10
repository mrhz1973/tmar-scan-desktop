// SPDX-License-Identifier: AGPL-3.0-only
import * as THREE from 'three'

export interface SnapHit { point: THREE.Vector3; kind: 'scan' | 'cad'; label: string }

/** Closest surface intersection along the permitted motion, in part mm.
 * The reference meshes and their BVHs are borrowed, never modified here. */
export function snapAlong(candidate: THREE.Vector3, direction: THREE.Vector3, maxDistance: number,
  targets: THREE.Mesh[], section: readonly THREE.Plane[] = []): SnapHit | null {
  if (![...candidate.toArray(), ...direction.toArray(), maxDistance].every(Number.isFinite) ||
      maxDistance <= 0 || direction.lengthSq() < 1e-20 || !targets.length) return null
  const raycaster = new THREE.Raycaster() as THREE.Raycaster & { firstHitOnly?: boolean }
  raycaster.firstHitOnly = true
  const axis = direction.clone().normalize()
  const halfSpaces = section.map(plane => ({ at:plane.distanceToPoint(candidate), slope:plane.normal.dot(axis) }))
  if (halfSpaces.some(({at,slope}) => !Number.isFinite(at) || !Number.isFinite(slope))) return null
  let best: THREE.Intersection | undefined
  for (const sign of [1, -1]) {
    // Clip the query interval before BVH traversal so a hidden front hit
    // cannot hide a farther visible hit on the same reference.
    let near = 0, far = maxDistance
    for (const {at,slope} of halfSpaces) {
      const along = slope*sign
      if (along > 0) near = Math.max(near,-at/along)
      else if (along < 0) far = Math.min(far,-at/along)
      else if (at < 0) far = -1
    }
    if (near > far) continue
    raycaster.near = near
    raycaster.far = far
    raycaster.set(candidate, axis.clone().multiplyScalar(sign))
    const hit = raycaster.intersectObjects(targets, false).find(item => section.every(plane => plane.distanceToPoint(item.point) >= 0))
    if (hit && (!best || hit.distance < best.distance)) best = hit
  }
  if (!best) return null
  const kind = best.object.userData.snapKind
  if (kind !== 'scan' && kind !== 'cad') return null
  return { point: best.point.clone(), kind, label: String(best.object.userData.snapLabel ?? (kind === 'scan' ? 'Scansione' : 'CAD')) }
}
