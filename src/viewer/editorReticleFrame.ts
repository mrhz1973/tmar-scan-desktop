// SPDX-License-Identifier: AGPL-3.0-only
// Host-owned, read-only reticle framing; a plugin may publish bounds but never move the camera.
import * as THREE from 'three'
import type { DraftStamp, ReticleFrame, Vec3 } from '../plugins/workspaceEditorTypes'

export function sameReticleStamp(a: DraftStamp, b: DraftStamp): boolean {
  return a.sessionId === b.sessionId && a.sourceEpoch === b.sourceEpoch &&
    a.selectionEpoch === b.selectionEpoch && a.draftEpoch === b.draftEpoch
}

/** Copy and validate all plugin input before storing it in the host lease. */
export function validatedReticleFrame(frame: ReticleFrame | null): ReticleFrame | null {
  if (frame === null) return null
  if (!frame || !Array.isArray(frame.min) || !Array.isArray(frame.max) ||
      frame.min.length !== 3 || frame.max.length !== 3 || !frame.stamp ||
      typeof frame.stamp.sessionId !== 'string' || !frame.stamp.sessionId.trim() ||
      ![frame.stamp.sourceEpoch, frame.stamp.selectionEpoch, frame.stamp.draftEpoch]
        .every(n => Number.isSafeInteger(n) && n >= 0)) return null
  for (let i = 0; i < 3; i++) {
    if (!Number.isFinite(frame.min[i]) || !Number.isFinite(frame.max[i]) ||
        frame.min[i] > frame.max[i]) return null
  }
  return {
    min: [...frame.min] as unknown as Vec3,
    max: [...frame.max] as unknown as Vec3,
    stamp: { sessionId: frame.stamp.sessionId, sourceEpoch: frame.stamp.sourceEpoch,
      selectionEpoch: frame.stamp.selectionEpoch, draftEpoch: frame.stamp.draftEpoch },
  }
}

export function sameReticleFrame(a: ReticleFrame | null, b: ReticleFrame | null): boolean {
  return a === b || !!a && !!b && sameReticleStamp(a.stamp, b.stamp) &&
    a.min.every((v, i) => v === b.min[i]) && a.max.every((v, i) => v === b.max[i])
}

/** Map all eight part-frame box corners into world coordinates, conservatively enclosing rotation. */
export function worldReticleBox(frame: ReticleFrame, partToWorld: THREE.Matrix4): THREE.Box3 | null {
  if (partToWorld.elements.some(v => !Number.isFinite(v)) ||
      !Number.isFinite(partToWorld.determinant()) || Math.abs(partToWorld.determinant()) < 1e-15) return null
  const box = new THREE.Box3(new THREE.Vector3(...frame.min), new THREE.Vector3(...frame.max))
  box.applyMatrix4(partToWorld)
  if (box.isEmpty() || ![...box.min, ...box.max].every(v => Number.isFinite(v))) return null
  // Include the screen-space control handles; safely frame a flat or point-like net as well.
  const span = box.getSize(new THREE.Vector3()).length()
  box.expandByScalar(Math.max(0.1, span * 0.08))
  return box
}
