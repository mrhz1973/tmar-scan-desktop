// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { ZebraLayer, type ZebraOptions } from '../ZebraLayer'
import { PATTERN_SIZE, stripePattern } from '../pattern'

const defaults: ZebraOptions = { target: 'visible', selectedIds: [], orientation: 'horizontal', width: 1, color: '#5388b1' }
const body = (): THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())
const overlays = (mesh: THREE.Mesh) => mesh.children.filter((child) => child.name === 'tmar-zebra-overlay') as THREE.Mesh[]

describe('zebra display layer', () => {
  it('keeps original geometry/materials and picking, follows target selection, and restores on dispose', () => {
    const first = body(), second = body(), scan = body()
    const sourceMaterial = first.material, sourceGeometry = first.geometry
    const geometryDispose = vi.spyOn(sourceGeometry, 'dispose')
    const originalDispose = vi.spyOn(sourceMaterial, 'dispose')
    const invalidate = vi.fn(), countChanged = vi.fn()
    const bodies = new Map([[1, first], [2, second]])
    const layer = new ZebraLayer({ bodies: () => bodies, scan: () => scan, invalidate, countChanged }, defaults)
    layer.tick()
    expect(first.material).toBe(sourceMaterial)
    expect(first.geometry).toBe(sourceGeometry)
    expect(overlays(first)).toHaveLength(1)
    expect(overlays(second)).toHaveLength(1)
    expect(overlays(first)[0].geometry).toBe(sourceGeometry)
    first.position.set(12, -3, 4)
    first.rotation.y = 0.7
    first.updateMatrixWorld(true)
    expect(overlays(first)[0].matrixWorld.elements).toEqual(first.matrixWorld.elements)
    const hits: THREE.Intersection[] = []
    overlays(first)[0].raycast(new THREE.Raycaster(), hits)
    expect(hits).toHaveLength(0)
    layer.setOptions({ ...defaults, target: 'selected', selectedIds: [2] })
    expect(overlays(first)).toHaveLength(0)
    expect(overlays(second)).toHaveLength(1)
    layer.setOptions({ ...defaults, target: 'scan' })
    expect(overlays(second)).toHaveLength(0)
    expect(overlays(scan)).toHaveLength(1)
    layer.dispose()
    layer.dispose()
    expect(overlays(scan)).toHaveLength(0)
    expect(geometryDispose).not.toHaveBeenCalled()
    expect(originalDispose).not.toHaveBeenCalled()
    expect(countChanged).toHaveBeenCalledWith(2)
    expect(invalidate).toHaveBeenCalled()
  })

  it('tracks hidden, replaced, clipped, rebuilt and removed objects without retaining overlays', () => {
    const original = body(), replacement = body()
    const bodies = new Map([[1, original]])
    const counts: number[] = []
    const layer = new ZebraLayer({ bodies: () => bodies, scan: () => null, invalidate: () => {}, countChanged: (n) => counts.push(n) }, defaults)
    const planes = [new THREE.Plane(new THREE.Vector3(1, 0, 0), 0)]
    original.material.clippingPlanes = planes
    layer.tick()
    expect((overlays(original)[0].material as THREE.Material).clippingPlanes).toBe(planes)
    original.visible = false
    layer.tick()
    expect(overlays(original)[0].visible).toBe(false)
    original.visible = true
    original.material.visible = false
    layer.tick()
    expect(overlays(original)[0].visible).toBe(false)
    original.material.visible = true
    layer.tick()
    expect(overlays(original)[0].visible).toBe(true)
    const oldOverlay = overlays(original)[0]
    const overlayMaterialDispose = vi.spyOn(oldOverlay.material as THREE.Material, 'dispose')
    original.geometry = new THREE.SphereGeometry(1, 8, 6)
    layer.tick()
    expect(overlayMaterialDispose).toHaveBeenCalledOnce()
    expect(overlays(original)[0].geometry).toBe(original.geometry)
    bodies.set(1, replacement)
    layer.tick()
    expect(overlays(original)).toHaveLength(0)
    expect(overlays(replacement)).toHaveLength(1)
    bodies.clear()
    layer.tick()
    expect(overlays(replacement)).toHaveLength(0)
    expect(counts).toContain(0)
    layer.dispose()
  })
})

describe('zebra stripes', () => {
  it('alternates bands in the requested direction and rejects invalid settings', () => {
    const h = stripePattern(1, 'horizontal', '#123456')
    const v = stripePattern(1, 'vertical', '#123456')
    const pixel = (data: Uint8Array, x: number, y: number) => [...data.slice((y * PATTERN_SIZE + x) * 4, (y * PATTERN_SIZE + x) * 4 + 4)]
    expect(pixel(h, 0, 0)).toEqual([210, 210, 210, 255])
    expect(pixel(h, 0, 8)).toEqual([18, 52, 86, 255])
    expect(pixel(h, 8, 0)).toEqual([210, 210, 210, 255])
    expect(pixel(v, 8, 0)).toEqual([18, 52, 86, 255])
    expect(() => stripePattern(0, 'horizontal', '#123456')).toThrow()
    expect(() => stripePattern(1, 'horizontal', 'wrong')).toThrow()
  })
})
