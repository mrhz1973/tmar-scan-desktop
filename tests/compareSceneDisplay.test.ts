// SPDX-License-Identifier: AGPL-3.0-only
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CompareScene } from '../src/viewer/CompareScene'
import { sceneTheme } from '../src/viewer/viewThemes'

interface ViewportHarness {
  tick(): void
  invalidate: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
}

const harness = vi.hoisted(() => ({ views: [] as ViewportHarness[] }))

// Exercise the real comparison scene and materials without allocating WebGL.
// The harness controls when its renderer asks the owner for the next frame.
vi.mock('../src/viewer/orthoViewport', () => ({
  OrthoViewport: class {
    scene = new THREE.Scene()
    renderer = { localClippingEnabled: false }
    invalidate = vi.fn()
    dispose = vi.fn()
    frameCamera = vi.fn()
    tick: () => void

    constructor(_container: HTMLDivElement, options: { onTick?: () => void }) {
      this.tick = () => options.onTick?.()
      harness.views.push(this)
    }
  },
}))

const fixtures: { compare: CompareScene; geometry: THREE.BufferGeometry }[] = []

function fixture() {
  // An open sheet has no section cap, so the fixture needs no texture/DOM.
  const geometry = new THREE.PlaneGeometry(2, 2)
  const compare = new CompareScene({} as HTMLDivElement, geometry, sceneTheme(null, true))
  fixtures.push({ compare, geometry })
  const mesh = compare.referenceMesh()!
  return {
    compare,
    geometry,
    mesh,
    material: mesh.material as THREE.MeshStandardMaterial,
    viewport: harness.views.at(-1)!,
  }
}

afterEach(() => {
  for (const { compare, geometry } of fixtures) {
    compare.dispose()
    geometry.dispose()
  }
  fixtures.length = 0
  harness.views.length = 0
  vi.restoreAllMocks()
})

describe('comparison display layers', () => {
  it('lets overlays read the current section before every rendered frame', () => {
    const { compare, material, viewport } = fixture()
    let section: THREE.Plane | null = null
    compare.followSection(() => section)
    const observed: ({ normal: number[]; constant: number } | null)[] = []
    compare.addDisplayLayer({
      tick: () => {
        const plane = material.clippingPlanes?.[0]
        observed.push(plane ? { normal: plane.normal.toArray(), constant: plane.constant } : null)
      },
      dispose: vi.fn(),
    })

    viewport.tick()
    section = new THREE.Plane(new THREE.Vector3(1, 0, 0), -1)
    viewport.tick()
    section.constant = -4
    viewport.tick()
    section = null
    viewport.tick()

    expect(observed).toEqual([
      null,
      { normal: [1, 0, 0], constant: -1 },
      { normal: [1, 0, 0], constant: -4 },
      null,
    ])
  })

  it('wakes its renderer when layers change and removes only the selected layer', () => {
    const { compare, viewport } = fixture()
    const first = { tick: vi.fn(), dispose: vi.fn() }
    const second = { tick: vi.fn(), dispose: vi.fn() }
    viewport.invalidate.mockClear()
    const removeFirst = compare.addDisplayLayer(first)
    const removeSecond = compare.addDisplayLayer(second)
    expect(viewport.invalidate).toHaveBeenCalledTimes(2)
    compare.invalidate()
    expect(viewport.invalidate).toHaveBeenCalledTimes(3)
    viewport.tick()
    expect(first.tick).toHaveBeenCalledTimes(1)
    expect(second.tick).toHaveBeenCalledTimes(1)

    removeFirst()
    removeFirst()
    viewport.tick()
    expect(first.dispose).toHaveBeenCalledTimes(1)
    expect(first.tick).toHaveBeenCalledTimes(1)
    expect(second.tick).toHaveBeenCalledTimes(2)
    expect(second.dispose).not.toHaveBeenCalled()
    expect(viewport.invalidate).toHaveBeenCalledTimes(4)

    compare.dispose()
    removeSecond()
    expect(first.dispose).toHaveBeenCalledTimes(1)
    expect(second.dispose).toHaveBeenCalledTimes(1)
  })

  it('releases layers before host resources, exactly once, without owning the reference geometry', () => {
    const { compare, geometry, mesh, material, viewport } = fixture()
    const geometryDispose = vi.spyOn(geometry, 'dispose')
    const released: string[] = []
    const materialDispose = vi.spyOn(material, 'dispose').mockImplementation(() => { released.push('material') })
    viewport.dispose.mockImplementation(() => { released.push('viewport') })
    const layer = { dispose: vi.fn(() => { released.push('layer') }) }
    const remove = compare.addDisplayLayer(layer)
    expect(mesh.geometry).toBe(geometry)

    compare.dispose()
    remove()
    compare.dispose()

    expect(released).toEqual(['layer', 'material', 'viewport'])
    expect(layer.dispose).toHaveBeenCalledTimes(1)
    expect(materialDispose).toHaveBeenCalledTimes(1)
    expect(viewport.dispose).toHaveBeenCalledTimes(1)
    expect(geometryDispose).not.toHaveBeenCalled()
    expect(mesh.geometry).toBe(geometry)
    expect(compare.referenceMesh()).toBeNull()
  })

  it('cleans a late layer without waking an already disposed renderer', () => {
    const { compare, viewport } = fixture()
    compare.dispose()
    viewport.invalidate.mockClear()
    const layer = { tick: vi.fn(), dispose: vi.fn() }
    const remove = compare.addDisplayLayer(layer)
    compare.invalidate()
    remove()
    remove()
    compare.dispose()

    expect(layer.dispose).toHaveBeenCalledTimes(1)
    expect(layer.tick).not.toHaveBeenCalled()
    expect(viewport.invalidate).not.toHaveBeenCalled()
  })
})
