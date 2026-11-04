// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { ReScene } from '../viewer/reScene'
describe('independent editor rendering masks', () => {
  it('keeps scoped source masks independent from shared preview and user visibility', () => {
    const re = Object.create(ReScene.prototype), mesh = new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial())
    re.bodyMeshes = new Map([[1,mesh]]); re.replacedBodies = new Set(); re.editorMasks = new Map(); re.bodyPreview = null
    re.host = { invalidate:vi.fn() }; re.showOverlaps = vi.fn(); re.recap = vi.fn(); re.bodyPicks = { setPreviewEdges:vi.fn(), setEditorMasked:vi.fn() }
    const a = re.leaseBodyRenderMask(1), b = re.leaseBodyRenderMask(1)
    expect(mesh.material.visible).toBe(false)
    re.setBodyPreview(null,'#fff'); expect(mesh.material.visible).toBe(false)
    a(); a(); expect(mesh.material.visible).toBe(false)
    mesh.visible = false; b(); expect(mesh.material.visible).toBe(true); expect(mesh.visible).toBe(false)
    mesh.geometry.dispose(); mesh.material.dispose()
  })
})
