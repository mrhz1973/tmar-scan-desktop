// SPDX-License-Identifier: AGPL-3.0-only
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { snapAlong } from '../snap'

function plane(z: number, kind: 'scan' | 'cad', label: string): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  )
  mesh.position.z = z
  mesh.userData.snapKind = kind
  mesh.userData.snapLabel = label
  mesh.updateMatrixWorld(true)
  return mesh
}

describe('snapAlong', () => {
  it('snaps to a scan plane and returns its metadata', () => {
    const scan = plane(2, 'scan', 'scan surface')
    const hit = snapAlong(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 1), 3, [scan])

    expect(hit).not.toBeNull()
    expect(hit).toMatchObject({ kind: 'scan', label: 'scan surface' })
    expect(hit!.point.distanceTo(new THREE.Vector3(0, 0, 2))).toBeLessThan(1e-9)
  })

  it('snaps to a CAD plane and returns its metadata', () => {
    const cad = plane(1.5, 'cad', 'nearby face')
    const hit = snapAlong(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 1), 2, [cad])

    expect(hit).not.toBeNull()
    expect(hit).toMatchObject({ kind: 'cad', label: 'nearby face' })
    expect(hit!.point.distanceTo(new THREE.Vector3(0, 0, 1.5))).toBeLessThan(1e-9)
  })

  it('chooses the nearest hit across scan and CAD targets on either side', () => {
    const fartherScan = plane(2, 'scan', 'far scan')
    const nearerCad = plane(-0.75, 'cad', 'near CAD')
    const hit = snapAlong(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 1),
      3,
      [fartherScan, nearerCad],
    )

    expect(hit).not.toBeNull()
    expect(hit).toMatchObject({ kind: 'cad', label: 'near CAD' })
    expect(hit!.point.distanceTo(new THREE.Vector3(0, 0, -0.75))).toBeLessThan(1e-9)
  })

  it('finds hits in both directions along the line', () => {
    const positive = plane(2, 'scan', 'positive side')
    const negative = plane(-1, 'cad', 'negative side')

    const forward = snapAlong(new THREE.Vector3(), new THREE.Vector3(0, 0, 4), 3, [positive])
    const backward = snapAlong(new THREE.Vector3(), new THREE.Vector3(0, 0, 4), 3, [negative])

    expect(forward?.point.z).toBeCloseTo(2)
    expect(backward?.point.z).toBeCloseTo(-1)
  })

  it('accepts a hit at the distance limit and rejects one beyond it', () => {
    const atLimit = plane(2, 'scan', 'at limit')
    const beyond = plane(2.001, 'cad', 'beyond limit')

    expect(snapAlong(new THREE.Vector3(), new THREE.Vector3(0, 0, 1), 2, [atLimit])?.point.z).toBeCloseTo(2)
    expect(snapAlong(new THREE.Vector3(), new THREE.Vector3(0, 0, 1), 2, [beyond])).toBeNull()
  })

  it('returns null for degenerate or non-finite inputs', () => {
    const target = plane(1, 'scan', 'scan')
    const validCandidate = new THREE.Vector3()
    const validDirection = new THREE.Vector3(0, 0, 1)

    expect(snapAlong(validCandidate, new THREE.Vector3(), 2, [target])).toBeNull()
    expect(snapAlong(new THREE.Vector3(Number.NaN, 0, 0), validDirection, 2, [target])).toBeNull()
    expect(snapAlong(validCandidate, new THREE.Vector3(0, Number.POSITIVE_INFINITY, 1), 2, [target])).toBeNull()
    expect(snapAlong(validCandidate, validDirection, 0, [target])).toBeNull()
    expect(snapAlong(validCandidate, validDirection, -1, [target])).toBeNull()
    expect(snapAlong(validCandidate, validDirection, Number.POSITIVE_INFINITY, [target])).toBeNull()
  })

  it('does not mutate candidate, direction, or targets', () => {
    const candidate = new THREE.Vector3(0.25, -0.5, 0)
    const direction = new THREE.Vector3(0, 0, 2)
    const target = plane(1, 'cad', 'fixed CAD')
    const candidateBefore = candidate.clone()
    const directionBefore = direction.clone()
    const targetPositionBefore = target.position.clone()
    const targetMatrixBefore = target.matrixWorld.clone()

    const hit = snapAlong(candidate, direction, 2, [target])

    expect(hit).not.toBeNull()
    expect(candidate.equals(candidateBefore)).toBe(true)
    expect(direction.equals(directionBefore)).toBe(true)
    expect(target.position.equals(targetPositionBefore)).toBe(true)
    expect(target.matrixWorld.equals(targetMatrixBefore)).toBe(true)
  })
})
