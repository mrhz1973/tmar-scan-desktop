// SPDX-License-Identifier: AGPL-3.0-only
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createDragFrame } from '../dragFrame'

const rect = { left: 100, top: 50, width: 800, height: 600 }
type Point3 = [number, number, number]
function camera(kind: 'orthographic' | 'perspective', target = new THREE.Vector3()) {
  const result = kind === 'orthographic'
    ? new THREE.OrthographicCamera(-4, 4, 3, -3, 0.1, 100)
    : new THREE.PerspectiveCamera(50, rect.width / rect.height, 0.1, 100)
  result.position.copy(target).add(new THREE.Vector3(0, 0, 10))
  result.lookAt(target)
  result.updateProjectionMatrix()
  result.updateMatrixWorld(true)
  return result
}
function client(local: Point3, part: THREE.Matrix4, cam: THREE.Camera) {
  const p = new THREE.Vector3(...local).applyMatrix4(part).project(cam)
  return { clientX: rect.left + (p.x + 1) * rect.width / 2,
    clientY: rect.top + (1 - p.y) * rect.height / 2 }
}
function expectPoint(actual: Point3 | null, expected: Point3, digits = 8) {
  expect(actual).not.toBeNull()
  for (let i = 0; i < 3; i++) expect(actual![i]).toBeCloseTo(expected[i], digits)
}

describe.each(['orthographic', 'perspective'] as const)('%s camera', kind => {
  it('moves along an oblique CAD direction without approximating its perspective projection', () => {
    const cam = camera(kind), part = new THREE.Matrix4(), anchor: Point3 = [0, 0, 0]
    const direction = new THREE.Vector3(1, 0.2, 0.4).normalize(), distance = 2
    const start = client(anchor, part, cam)
    const drag = createDragFrame({ camera: cam, partWorld: part, rect, anchor, ...start,
      mode: 'axis', direction: direction.toArray() as Point3 })
    const target = client(direction.clone().multiplyScalar(distance).toArray() as Point3, part, cam)
    expectPoint(drag?.deltaAt(target.clientX, target.clientY) ?? null,
      direction.clone().multiplyScalar(distance).toArray() as Point3)
    expectPoint(drag?.deltaAt(start.clientX, start.clientY) ?? null, [0, 0, 0])
  })

  it('returns part-frame movement for a rotated and translated part', () => {
    const part = new THREE.Matrix4().makeRotationZ(Math.PI / 2)
    part.setPosition(5, -3, 2)
    const anchor: Point3 = [1, 2, 0]
    const targetWorld = new THREE.Vector3(...anchor).applyMatrix4(part)
    const cam = camera(kind, targetWorld), start = client(anchor, part, cam)
    const drag = createDragFrame({ camera: cam, partWorld: part, rect, anchor, ...start,
      mode: 'axis', direction: [1, 0, 0] })
    const end = client([3.5, 2, 0], part, cam)
    expectPoint(drag?.deltaAt(end.clientX, end.clientY) ?? null, [2.5, 0, 0])
  })

  it('moves in the screen plane while returning part-frame coordinates', () => {
    const part = new THREE.Matrix4().makeRotationZ(Math.PI / 2)
    part.setPosition(6, 3, 1)
    const anchor: Point3 = [0, 0, 0], cam = camera(kind, new THREE.Vector3(6, 3, 1))
    const start = client(anchor, part, cam)
    const drag = createDragFrame({ camera: cam, partWorld: part, rect, anchor, ...start, mode: 'screen' })
    const end = client([1.2, -0.7, 0], part, cam)
    expectPoint(drag?.deltaAt(end.clientX, end.clientY) ?? null, [1.2, -0.7, 0])
  })

  it('returns no gesture when looking directly along the permitted axis', () => {
    const cam = camera(kind), part = new THREE.Matrix4(), anchor: Point3 = [0, 0, 0]
    expect(createDragFrame({ camera: cam, partWorld: part, rect, anchor, ...client(anchor, part, cam),
      mode: 'axis', direction: [0, 0, 1] })).toBeNull()
  })

  it('lets a pole move in depth with a vertical drag when explicitly enabled', () => {
    const cam = camera(kind), part = new THREE.Matrix4(), anchor: Point3 = [0, 0, 0]
    const at = client(anchor, part, cam), start = {clientX: at.clientX + 4, clientY: at.clientY - 3}
    const drag = createDragFrame({camera: cam, partWorld: part, rect, anchor, ...start,
      mode: 'axis', direction: [0, 0, 1], allowViewAlignedDepth: true})
    const scale = kind === 'orthographic' ? 6 / rect.height : 20 * Math.tan(25 * Math.PI / 180) / rect.height
    expectPoint(drag?.deltaAt(start.clientX, start.clientY) ?? null, [0, 0, 0])
    expectPoint(drag?.deltaAt(start.clientX + 70, start.clientY - 40) ?? null, [0, 0, 40 * scale])
    expectPoint(drag?.deltaAt(start.clientX, start.clientY + 40) ?? null, [0, 0, -40 * scale])
    expect(drag?.deltaAt(Number.NaN, start.clientY)).toBeNull()
    expect(drag?.deltaAt(start.clientX, start.clientY - 100000)).toBeNull()
  })

  it('keeps depth displacement in part coordinates when the part is rotated', () => {
    const cam = camera(kind), part = new THREE.Matrix4().makeRotationY(Math.PI / 2), anchor: Point3 = [0, 0, 0]
    const start = client(anchor, part, cam)
    const drag = createDragFrame({camera: cam, partWorld: part, rect, anchor, ...start,
      mode: 'axis', direction: [1, 0, 0], allowViewAlignedDepth: true})
    const scale = kind === 'orthographic' ? 6 / rect.height : 20 * Math.tan(25 * Math.PI / 180) / rect.height
    expectPoint(drag?.deltaAt(start.clientX, start.clientY - 40) ?? null, [40 * scale, 0, 0])
  })

  it('keeps near-aligned depth movement on the chosen axis with a frozen camera', () => {
    const cam = camera(kind), part = new THREE.Matrix4(), anchor: Point3 = [0, 0, 0]
    const start = client(anchor, part, cam), angle = 2 * Math.PI / 180
    const direction: Point3 = [Math.sin(angle), 0, Math.cos(angle)]
    const drag = createDragFrame({camera: cam, partWorld: part, rect, anchor, ...start,
      mode: 'axis', direction, allowViewAlignedDepth: true})
    const scale = kind === 'orthographic' ? 6 / rect.height : 20 * Math.tan(25 * Math.PI / 180) / rect.height
    cam.position.set(0,0,50);cam.updateMatrixWorld(true)
    expectPoint(drag?.deltaAt(start.clientX, start.clientY - 40) ?? null,
      direction.map(value => value * 40 * scale) as Point3)
  })
})

it('does not jump when a handle is grabbed off-centre', () => {
  const cam = camera('orthographic'), part = new THREE.Matrix4(), anchor: Point3 = [0, 0, 0]
  const at = client(anchor, part, cam), start = { clientX: at.clientX + 17, clientY: at.clientY - 11 }
  const drag = createDragFrame({ camera: cam, partWorld: part, rect, anchor, ...start,
    mode: 'axis', direction: [2, 0, 0] })
  expectPoint(drag?.deltaAt(start.clientX, start.clientY) ?? null, [0, 0, 0])
  expectPoint(drag?.deltaAt(start.clientX + 50, start.clientY) ?? null, [0.5, 0, 0])
})

it('freezes the camera, part transform and viewport for the gesture without changing inputs', () => {
  const part = new THREE.Matrix4().makeRotationZ(0.3)
  part.setPosition(4, 5, 1)
  const anchor: Point3 = [0, 0, 0], direction: Point3 = [1, 0, 0]
  const cam = camera('perspective', new THREE.Vector3(4, 5, 1)), start = client(anchor, part, cam)
  const end = client([1, 0, 0], part, cam)
  const inputRect = { ...rect }, beforePart = part.clone(), beforeWorld = cam.matrixWorld.clone()
  const beforeInverse = cam.matrixWorldInverse.clone(), beforeProjection = cam.projectionMatrix.clone()
  const drag = createDragFrame({ camera: cam, partWorld: part, rect: inputRect, anchor, direction, ...start, mode: 'axis' })
  expect(part.equals(beforePart)).toBe(true)
  expect(cam.matrixWorld.equals(beforeWorld)).toBe(true)
  expect(cam.matrixWorldInverse.equals(beforeInverse)).toBe(true)
  expect(cam.projectionMatrix.equals(beforeProjection)).toBe(true)
  expect(anchor).toEqual([0, 0, 0]); expect(direction).toEqual([1, 0, 0]); expect(inputRect).toEqual(rect)
  part.makeTranslation(-100, 0, 0)
  cam.position.set(0, 0, 50); cam.updateMatrixWorld(true)
  inputRect.width = 200
  expectPoint(drag?.deltaAt(end.clientX, end.clientY) ?? null, [1, 0, 0])
})

it('rejects a non-rigid part, invalid viewport, direction or coordinates', () => {
  const cam = camera('orthographic'), part = new THREE.Matrix4(), anchor: Point3 = [0, 0, 0]
  const start = client(anchor, part, cam)
  const input = { camera: cam, partWorld: part, rect, anchor, ...start, mode: 'axis' as const, direction: [1, 0, 0] as Point3 }
  expect(createDragFrame({ ...input, partWorld: new THREE.Matrix4().makeScale(2, 1, 1) })).toBeNull()
  expect(createDragFrame({ ...input, partWorld: new THREE.Matrix4().makeShear(0.2, 0, 0, 0, 0, 0) })).toBeNull()
  expect(createDragFrame({ ...input, rect: { ...rect, width: 0 } })).toBeNull()
  expect(createDragFrame({ ...input, direction: [0, 0, 0] })).toBeNull()
  expect(createDragFrame({ ...input, direction: [Number.NaN, 0, 0] })).toBeNull()
  expect(createDragFrame({ ...input, clientX: Number.POSITIVE_INFINITY })).toBeNull()
})

it('rejects unsupported cameras and anchors outside camera near/far depth', () => {
  const cam = camera('orthographic'), part = new THREE.Matrix4(), anchor: Point3 = [0, 0, 0]
  const input = { camera: cam, partWorld: part, rect, anchor, ...client(anchor, part, cam), mode: 'screen' as const }
  expect(createDragFrame({ ...input, camera: new THREE.Camera() })).toBeNull()
  expect(createDragFrame({ ...input, anchor: [0, 0, 10.05] })).toBeNull()
  expect(createDragFrame({ ...input, anchor: [0, 0, -100] })).toBeNull()
})

it('returns null for non-finite pointer updates instead of corrupting the draft', () => {
  const cam = camera('orthographic'), part = new THREE.Matrix4(), anchor: Point3 = [0, 0, 0]
  const drag = createDragFrame({ camera: cam, partWorld: part, rect, anchor, ...client(anchor, part, cam), mode: 'screen' })
  expect(drag?.deltaAt(Number.NaN, 0)).toBeNull()
  expect(drag?.deltaAt(0, Number.POSITIVE_INFINITY)).toBeNull()
})


it('rejects an axis solution lying behind a perspective camera', () => {
  const cam = camera('perspective'), part = new THREE.Matrix4(), anchor: Point3 = [0, 0, 0]
  const drag = createDragFrame({ camera: cam, partWorld: part, rect, anchor, ...client(anchor, part, cam),
    mode: 'axis', direction: [1, 0, 1] })
  expect(drag).not.toBeNull()
  const behind = client([12, 0, 12], part, cam)
  expect(drag?.deltaAt(behind.clientX, behind.clientY)).toBeNull()
})
