import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Preview } from '../editorKernel'
import { WorkspacePreview } from '../workspacePreview'

function faceMesh(offset = 0): Preview['faceMeshes'][number] {
  return {
    positions: new Float32Array([offset, 0, 0, offset + 1, 0, 0, offset, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    vertexCount: 3,
    triangleCount: 1,
  }
}

function preview(faces = [faceMesh(), faceMesh(2)]): Preview {
  return {
    mesh: faces[0], faceMeshes: faces, valid: true, volume: 1,
    maxBoundaryError: 0, minimumNormalDot: 1,
  }
}

function sourceFixture() {
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const material = new THREE.MeshStandardMaterial({ color: 'orange' })
  const source = new THREE.Mesh(geometry, material)
  const session = new THREE.Group()
  let maskCount = 0
  let restoreCount = 0
  const maskSource = () => {
    const before = source.visible
    source.visible = false
    maskCount++
    let restored = false
    return () => {
      if (restored) return
      restored = true
      source.visible = before
      restoreCount++
    }
  }
  return { source, geometry, material, session, maskSource, counts: () => ({ maskCount, restoreCount }) }
}

afterEach(() => vi.restoreAllMocks())

describe('WorkspacePreview', () => {
  it('owns face meshes, preserves face indices, and restores the source mask on hide and dispose', () => {
    const f = sourceFixture(), invalidate = vi.fn()
    const layer = new WorkspacePreview({ session: f.session, maskSource: f.maskSource, invalidate })
    const input = preview()

    layer.setPreview(input, 1)
    expect(f.session.children).toEqual([layer.group])
    expect(layer.group.children).toHaveLength(2)
    expect(f.source.visible).toBe(false)
    expect(f.source.geometry).toBe(f.geometry)
    expect(f.source.material).toBe(f.material)
    expect(layer.group.children.map(mesh => mesh.userData.face)).toEqual([0, 1])
    expect((layer.group.children[1] as THREE.Mesh).material).not.toBe(f.material)
    expect((layer.group.children[0] as THREE.Mesh).geometry.getAttribute('position').array).not.toBe(input.faceMeshes[0].positions)

    layer.setActiveFace(0)
    expect(((layer.group.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHexString()).toBe('6ebde4')
    expect(((layer.group.children[1] as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHexString()).toBe('a4acb0')

    layer.setVisible(false)
    expect(layer.group.visible).toBe(false)
    expect(f.source.visible).toBe(true)
    layer.setVisible(true)
    expect(layer.group.visible).toBe(true)
    expect(f.source.visible).toBe(false)
    layer.dispose()
    layer.dispose()

    expect(f.source.visible).toBe(true)
    expect(f.source.geometry).toBe(f.geometry)
    expect(f.source.material).toBe(f.material)
    expect(layer.group.parent).toBeNull()
    expect(layer.group.children).toHaveLength(0)
    expect(f.counts()).toEqual({ maskCount: 2, restoreCount: 2 })
    expect(invalidate).toHaveBeenCalled()
  })

  it('copies clipping planes to owned materials and refreshes them without changing the provider array', () => {
    const f = sourceFixture(), first = new THREE.Plane(new THREE.Vector3(1, 0, 0), 2)
    const second = new THREE.Plane(new THREE.Vector3(0, 1, 0), 3)
    const planes = [first]
    let intersection = false
    const layer = new WorkspacePreview({
      session: f.session, maskSource: f.maskSource, invalidate: () => undefined,
      clipping: () => ({ planes, intersection }),
    })
    layer.setPreview(preview(), 0)

    const material = (layer.group.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial
    expect(material.clippingPlanes).toEqual([first])
    expect(material.clippingPlanes).not.toBe(planes)
    expect(material.clipIntersection).toBe(false)

    planes.splice(0, 1, second)
    intersection = true
    layer.refreshClipping()
    expect(material.clippingPlanes).toEqual([second])
    expect(material.clippingPlanes).not.toBe(planes)
    expect(material.clipIntersection).toBe(true)
    expect(planes).toEqual([second])
    layer.dispose()
  })

  it('rolls back staged meshes and restores the source if invalidation fails', () => {
    const f = sourceFixture()
    const invalidate = vi.fn().mockImplementationOnce(() => { throw new Error('host repaint failed') })
    const layer = new WorkspacePreview({ session: f.session, maskSource: f.maskSource, invalidate })

    expect(() => layer.setPreview(preview())).toThrow('host repaint failed')
    expect(layer.group.children).toHaveLength(0)
    expect(f.source.visible).toBe(true)
    expect(f.counts()).toEqual({ maskCount: 1, restoreCount: 1 })
    expect(f.session.children).toEqual([layer.group])
    layer.dispose()
    expect(f.source.visible).toBe(true)
  })

  it('disposes staged meshes if clipping lookup fails and preserves the current preview and mask', () => {
    const f = sourceFixture()
    const clipping = vi.fn<() => { planes: readonly THREE.Plane[] | null }>(() => ({ planes: null }))
    const layer = new WorkspacePreview({ session: f.session, maskSource: f.maskSource, invalidate: () => undefined, clipping })
    layer.setPreview(preview())
    const previous = [...layer.group.children]
    const geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose')
    const materialDispose = vi.spyOn(THREE.Material.prototype, 'dispose')
    clipping.mockImplementation(() => { throw new Error('clip state unavailable') })

    expect(() => layer.setPreview(preview([faceMesh(4), faceMesh(6)]))).toThrow('clip state unavailable')
    expect(geometryDispose).toHaveBeenCalledTimes(2)
    expect(materialDispose).toHaveBeenCalledTimes(2)
    expect(layer.group.children).toEqual(previous)
    expect(f.source.visible).toBe(false)
    expect(f.counts()).toEqual({ maskCount: 1, restoreCount: 0 })
    layer.dispose()
    expect(f.source.visible).toBe(true)
  })

  it('rejects a preview face without triangles before masking and disposes earlier staged faces', () => {
    const f = sourceFixture(), maskSource = vi.fn(f.maskSource)
    const layer = new WorkspacePreview({ session: f.session, maskSource, invalidate: () => undefined })
    const geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose')
    const materialDispose = vi.spyOn(THREE.Material.prototype, 'dispose')
    const empty: Preview['faceMeshes'][number] = {
      positions: new Float32Array(), normals: new Float32Array(), indices: new Uint32Array(),
      vertexCount: 0, triangleCount: 0,
    }

    expect(() => layer.setPreview(preview([faceMesh(), empty]))).toThrow('Triangolazione non valida per la faccia 1.')
    expect(layer.group.children).toHaveLength(0)
    expect(f.source.visible).toBe(true)
    expect(maskSource).not.toHaveBeenCalled()
    expect(geometryDispose).toHaveBeenCalledTimes(1)
    expect(materialDispose).toHaveBeenCalledTimes(1)
    layer.dispose()
  })

  it('disposes staged meshes and leaves source visibility unchanged if mask acquisition fails', () => {
    const f = sourceFixture()
    const maskSource = vi.fn(() => { throw new Error('mask unavailable') })
    const layer = new WorkspacePreview({ session: f.session, maskSource, invalidate: () => undefined })
    const geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose')
    const materialDispose = vi.spyOn(THREE.Material.prototype, 'dispose')

    expect(() => layer.setPreview(preview())).toThrow('mask unavailable')
    expect(geometryDispose).toHaveBeenCalledTimes(2)
    expect(materialDispose).toHaveBeenCalledTimes(2)
    expect(layer.group.children).toHaveLength(0)
    expect(f.source.visible).toBe(true)
    expect(maskSource).toHaveBeenCalledTimes(1)
    layer.dispose()
    expect(f.source.visible).toBe(true)
  })

  it('restores source and repaints when mesh disposal throws during clear paths', () => {
    for (const clearPreview of [
      (layer: WorkspacePreview) => layer.clear(),
      (layer: WorkspacePreview) => layer.setPreview(null),
    ]) {
      const f = sourceFixture(), invalidate = vi.fn()
      const layer = new WorkspacePreview({ session: f.session, maskSource: f.maskSource, invalidate })
      layer.setPreview(preview())
      expect(f.source.visible).toBe(false)
      const repaintCount = invalidate.mock.calls.length
      const dispose = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose')
        .mockImplementationOnce(() => { throw new Error('dispose failed') })

      expect(() => clearPreview(layer)).toThrow('dispose failed')
      expect(layer.group.children).toHaveLength(0)
      expect(f.source.visible).toBe(true)
      expect(f.counts()).toEqual({ maskCount: 1, restoreCount: 1 })
      expect(invalidate).toHaveBeenCalledTimes(repaintCount + 1)
      dispose.mockRestore()
      layer.dispose()
    }
  })

  it('clears only its own meshes and restores source visibility when no preview is selected', () => {
    const f = sourceFixture(), sibling = new THREE.Group()
    f.session.add(sibling)
    const layer = new WorkspacePreview({ session: f.session, maskSource: f.maskSource, invalidate: () => undefined })
    layer.setPreview(preview())
    layer.setPreview(null)

    expect(layer.group.children).toHaveLength(0)
    expect(f.session.children).toEqual([sibling, layer.group])
    expect(f.source.visible).toBe(true)
    expect(f.geometry).toBe(f.source.geometry)
    layer.dispose()
    expect(f.session.children).toEqual([sibling])
  })
})
