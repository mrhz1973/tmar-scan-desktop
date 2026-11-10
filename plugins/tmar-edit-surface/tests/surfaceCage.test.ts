// SPDX-License-Identifier: AGPL-3.0-only
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { Net } from '../brep'
import { populateSurfaceCage, type SurfaceCageOptions } from '../surfaceCage'

const net: Net = {
  nu: 2, nv: 2, du: 1, dv: 1,
  poles: [[0, 0, 0], [0, 2, 0], [2, 0, 0], [2, 2, 0]],
  weights: [1, 1, 1, 1], rational: [0, 0],
  ku: [0, 1], kv: [0, 1], mu: [2, 2], mv: [2, 2],
}

function create(overrides: Partial<SurfaceCageOptions> = {}) {
  const group = new THREE.Group()
  populateSurfaceCage(group, {
    net, selected: [], locked: [], hiddenPoles: [], showNet: true,
    dragMode: 'axis', axis: 2, mirrorAxis: 0, mirrorOffset: 0,
    mirrorPartners: null, radius: 10, ...overrides,
  })
  return group
}

function dispose(group: THREE.Group) {
  group.traverse(object => {
    const item = object as THREE.Mesh
    item.geometry?.dispose()
    if (Array.isArray(item.material)) item.material.forEach(material => material.dispose())
    else item.material?.dispose()
  })
  group.clear()
}

describe('surface control cage', () => {
  it('shows selected, protected and mirrored poles while excluding hidden poles and their segments', () => {
    const group = create({ selected: [0], locked: [1], hiddenPoles: [3], mirrorPartners: [2, 3, 0, 1] })
    const poles = group.children.filter(item => item.userData.point !== undefined) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[]
    expect(poles.map(item => item.userData.point)).toEqual([0, 1, 2])
    expect(poles.map(item => item.material.color.getHexString())).toEqual(['ffcf35', '89939c', 'f785ff'])
    const segments = group.children.find(item => item instanceof THREE.LineSegments) as THREE.LineSegments
    expect(segments.geometry.getAttribute('position').count).toBe(4)
    expect(group.children.some(item => item instanceof THREE.LineLoop)).toBe(true)
    expect(group.children.some(item => item instanceof THREE.ArrowHelper)).toBe(true)
    dispose(group)
  })

  it('keeps poles selectable while the connecting net is hidden and omits the arrow in screen mode', () => {
    const group = create({ selected: [0], showNet: false, dragMode: 'screen' })
    expect(group.children.filter(item => item.userData.point !== undefined)).toHaveLength(4)
    expect(group.children.some(item => item instanceof THREE.LineSegments)).toBe(false)
    expect(group.children.some(item => item instanceof THREE.ArrowHelper)).toBe(false)
    dispose(group)
  })

  it('uses the caller\'s part frame and owns independent arrow geometry', () => {
    const frame = new THREE.Group()
    frame.position.set(4, -3, 2)
    frame.rotation.z = Math.PI / 2
    const first = new THREE.Group()
    frame.add(first)
    populateSurfaceCage(first, {
      net, selected: [2], locked: [], hiddenPoles: [], showNet: true,
      dragMode: 'axis', axis: 2, mirrorAxis: 0, mirrorOffset: 0,
      mirrorPartners: null, radius: 10,
    })
    const point = first.children.find(item => item.userData.point === 2)!
    const world = point.getWorldPosition(new THREE.Vector3())
    expect(world.x).toBeCloseTo(4)
    expect(world.y).toBeCloseTo(-1)
    expect(world.z).toBeCloseTo(2)

    const second = create({ selected: [2] })
    const a = first.children.find(item => item instanceof THREE.ArrowHelper) as THREE.ArrowHelper
    const b = second.children.find(item => item instanceof THREE.ArrowHelper) as THREE.ArrowHelper
    expect(a.line.geometry).not.toBe(b.line.geometry)
    expect(a.cone.geometry).not.toBe(b.cone.geometry)
    dispose(first)
    expect(b.line.geometry.getAttribute('position').count).toBeGreaterThan(0)
    dispose(second)
  })
})
