// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { sameReticleFrame, sameReticleStamp, validatedReticleFrame, worldReticleBox } from '../src/viewer/editorReticleFrame'
import type { ReticleFrame } from '../src/plugins/workspaceEditorTypes'

const stamp = { sessionId: 'session-1', sourceEpoch: 1, selectionEpoch: 2, draftEpoch: 3 }
const source: ReticleFrame = { min: [0, 0, 0], max: [10, 20, 5], stamp }
describe('host-owned reticle geometry', () => {
  it('copies and compares a valid part-frame target', () => {
    const valid = validatedReticleFrame(source)!
    expect(valid).not.toBe(source)
    expect(valid.min).not.toBe(source.min)
    expect(sameReticleFrame(valid, source)).toBe(true)
    expect(sameReticleStamp(valid.stamp, stamp)).toBe(true)
    expect(sameReticleStamp(valid.stamp, { ...stamp, draftEpoch: 4 })).toBe(false)
  })
  it('rejects reversed, infinite and nonnumeric bounds and invalid stamps', () => {
    expect(validatedReticleFrame({ ...source, min: [11, 0, 0] })).toBeNull()
    expect(validatedReticleFrame({ ...source, max: [Infinity, 0, 0] })).toBeNull()
    expect(validatedReticleFrame({ ...source, min: [NaN, 0, 0] })).toBeNull()
    expect(validatedReticleFrame({ ...source, stamp: { ...stamp, selectionEpoch: -1 } })).toBeNull()
    expect(validatedReticleFrame({ ...source, stamp: { ...stamp, sessionId: '' } })).toBeNull()
  })
  it('transforms all eight corners of rotated and translated part-frame bounds', () => {
    const transform = new THREE.Matrix4().compose(new THREE.Vector3(30, -15, 9),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 4),
      new THREE.Vector3(1, 1, 1))
    const world = worldReticleBox(source, transform)!
    for (let x of [0, 10]) for (let y of [0, 20]) for (let z of [0, 5]) {
      expect(world.containsPoint(new THREE.Vector3(x, y, z).applyMatrix4(transform))).toBe(true)
    }
    expect(world.min.x).toBeLessThan(30 - 14)
    expect(world.max.y).toBeGreaterThan(-15 + 14)
  })
  it('adds visible margin to point-like reticles', () => {
    const p = { ...source, min: [1, 2, 3] as const, max: [1, 2, 3] as const }
    const box = worldReticleBox(p, new THREE.Matrix4())!
    expect(box.getSize(new THREE.Vector3()).x).toBeGreaterThanOrEqual(0.2 - 1e-12)
  })
  it('fails closed for singular or nonfinite part transforms', () => {
    expect(worldReticleBox(source, new THREE.Matrix4().makeScale(0, 1, 1))).toBeNull()
    const bad = new THREE.Matrix4().makeTranslation(Infinity, 0, 0)
    expect(worldReticleBox(source, bad)).toBeNull()
  })
})
