// SPDX-License-Identifier: AGPL-3.0-only
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { Net } from '../brep'
import { pickNetAt } from '../netPicking'
import type { NetSelectionMode } from '../netSelection'

const rect = { left: 0, top: 0, width: 400, height: 400 }
const net: Net = {
  nu: 2, nv: 2, du: 1, dv: 1,
  poles: [[-1, -1, 0], [-1, 1, 0], [1, -1, 0], [1, 1, 0]],
  weights: [1, 1, 1, 1], rational: [0, 0],
  ku: [0, 1], kv: [0, 1], mu: [2, 2], mv: [2, 2],
}
const identity = new THREE.Matrix4()

function makeCamera(kind: 'orthographic' | 'perspective', target = new THREE.Vector3()): THREE.Camera {
  const camera = kind === 'orthographic'
    ? new THREE.OrthographicCamera(-2.2, 2.2, 2.2, -2.2, 0.1, 100)
    : new THREE.PerspectiveCamera(50, 1, 0.1, 100)
  camera.position.copy(target).add(new THREE.Vector3(0, 0, 8))
  camera.lookAt(target)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
  return camera
}

function clientAt(local: readonly number[], camera: THREE.Camera, partWorld = identity) {
  const p = new THREE.Vector3(...local as [number, number, number]).applyMatrix4(partWorld).project(camera)
  return { clientX: (p.x + 1) * rect.width / 2, clientY: (1 - p.y) * rect.height / 2 }
}

function pick(camera: THREE.Camera, local: readonly number[], mode: NetSelectionMode = 'auto', hiddenPoles: number[] = [], partWorld = identity) {
  return pickNetAt({ net, mode, hiddenPoles, camera, partWorld, rect, ...clientAt(local, camera, partWorld) })
}

describe.each(['orthographic', 'perspective'] as const)('%s net picking', kind => {
  const camera = makeCamera(kind)

  it('prioritizes a pole over the segment and cell under the same cursor', () => {
    expect(pick(camera, net.poles[0])).toEqual([0])
  })

  it('selects a segment when no pole is within its pixel radius', () => {
    expect(pick(camera, [0, -1, 0])).toEqual([0, 2])
  })

  it('selects the nearest-depth cell when no point or segment is close', () => {
    expect(pick(camera, [0, 0, 0])).toEqual([0, 2, 3, 1])
  })

  it('respects point, edge, cell and mixed selection filters', () => {
    expect(pick(camera, [0, 0, 0], 'points')).toBeNull()
    expect(pick(camera, net.poles[0], 'edges')).toEqual([0, 2])
    expect(pick(camera, [0, 0, 0], 'cells')).toEqual([0, 2, 3, 1])
    expect(pick(camera, [0, 0, 0], 'mixed')).toBeNull()
  })

  it('does not pick a hidden pole, an edge containing it, or a cell containing it', () => {
    expect(pick(camera, net.poles[0], 'points', [0])).toBeNull()
    expect(pick(camera, [0, -1, 0], 'edges', [0])).toBeNull()
    expect(pick(camera, [0, 0, 0], 'cells', [0])).toBeNull()
  })
})

it('projects through a rigid part transform without changing returned net indices', () => {
  const partWorld = new THREE.Matrix4().makeRotationZ(Math.PI / 2)
  partWorld.setPosition(13, -7, 2)
  const camera = makeCamera('perspective', new THREE.Vector3(13, -7, 2))
  expect(pick(camera, net.poles[0], 'auto', [], partWorld)).toEqual([0])
  expect(pick(camera, [0, -1, 0], 'edges', [], partWorld)).toEqual([0, 2])
  expect(pick(camera, [0, 0, 0], 'cells', [], partWorld)).toEqual([0, 2, 3, 1])
})

it('rejects cell intersections clipped by either camera depth plane', () => {
  const camera = new THREE.OrthographicCamera(-2.2, 2.2, 2.2, -2.2, 1, 10)
  camera.position.set(0, 0, 8)
  camera.lookAt(0, 0, 0)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
  const beforeNear = new THREE.Matrix4().makeTranslation(0, 0, 7.5)
  const beyondFar = new THREE.Matrix4().makeTranslation(0, 0, -5)
  const atVisibleDepth = new THREE.Matrix4()
  expect(pick(camera, [0, 0, 0], 'cells', [], beforeNear)).toBeNull()
  expect(pick(camera, [0, 0, 0], 'cells', [], beyondFar)).toBeNull()
  expect(pick(camera, [0, 0, 0], 'cells', [], atVisibleDepth)).toEqual([0, 2, 3, 1])
})

it('does not mutate the net, camera, or part transform', () => {
  const camera = makeCamera('perspective')
  const partWorld = new THREE.Matrix4().makeRotationY(0.2)
  partWorld.setPosition(1, 2, 3)
  const polesBefore = structuredClone(net.poles)
  const cameraWorldBefore = camera.matrixWorld.clone()
  const cameraProjectionBefore = camera.projectionMatrix.clone()
  const transformBefore = partWorld.clone()
  expect(pick(camera, [0, 0, 0], 'cells', [], partWorld)).toEqual([0, 2, 3, 1])
  expect(net.poles).toEqual(polesBefore)
  expect(camera.matrixWorld.equals(cameraWorldBefore)).toBe(true)
  expect(camera.projectionMatrix.equals(cameraProjectionBefore)).toBe(true)
  expect(partWorld.equals(transformBefore)).toBe(true)
})

it('returns null for invalid viewport, net, or pixel radii', () => {
  const camera = makeCamera('orthographic')
  expect(pickNetAt({ net, mode: 'auto', hiddenPoles: [], camera, partWorld: identity, rect: { ...rect, width: 0 }, clientX: 200, clientY: 200 })).toBeNull()
  expect(pickNetAt({ net: { ...net, poles: net.poles.slice(0, 3) }, mode: 'auto', hiddenPoles: [], camera, partWorld: identity, rect, clientX: 200, clientY: 200 })).toBeNull()
  expect(pickNetAt({ net, mode: 'auto', hiddenPoles: [], camera, partWorld: identity, rect, clientX: 200, clientY: 200, pointRadiusPx: Number.NaN })).toBeNull()
})

it('leaves point picking to the caller when the point radius is zero', () => {
  const camera = makeCamera('orthographic')
  expect(pickNetAt({ net, mode: 'points', hiddenPoles: [], camera, partWorld: identity, rect,
    ...clientAt(net.poles[0], camera), pointRadiusPx: 0 })).toBeNull()
})
