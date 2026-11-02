// SPDX-License-Identifier: AGPL-3.0-only
// A display layer over borrowed STEP geometry. Only its own line buffers are
// disposed. No triangle-wireframe fallback; mesh-only references have no CAD topology.
import * as THREE from 'three'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import type { SceneManager } from '../../src/viewer/SceneManager'
import { silhouetteSegments } from '../reverse/core/silhouette'
import type { EdgePrefs } from './edgePrefs'
export class ReferenceEdges {
  readonly group = new THREE.Group()
  private readonly material = new LineMaterial({ color: 0x171b20, linewidth: 2, worldUnits: false, transparent: true, opacity: 1, depthTest: true, depthWrite: false, toneMapped: false })
  private outline: LineSegments2 | null = null
  private silhouette: LineSegments2 | null = null
  private mesh: THREE.Mesh | null = null
  private edges: Float32Array | null = null
  private geometry: THREE.BufferGeometry | null = null
  private direction: THREE.Vector3 | null = null
  private matrix = new THREE.Matrix4()
  private clipping: readonly THREE.Plane[] | null = null
  private disposed = false
  constructor(private readonly scene: SceneManager) {
    this.group.name = 'tmar-reference-cad-edges'
    this.group.matrixAutoUpdate = false
    scene.layerHost().scene.add(this.group)
  }
  private drop(line: LineSegments2 | null): null {
    if (line) { line.removeFromParent(); line.geometry.dispose() }
    return null
  }
  private line(segments: Float32Array, name: string): LineSegments2 | null {
    if (!segments.length) return null
    const geometry = new LineSegmentsGeometry(); geometry.setPositions(segments)
    const line = new LineSegments2(geometry, this.material)
    line.name = name; line.renderOrder = 5; line.raycast = () => {}
    this.group.add(line); return line
  }
  tick(prefs: EdgePrefs, active: boolean, width: number, height: number): void {
    if (this.disposed) return
    const source = this.scene.referenceDisplay()
    if (source?.mesh !== this.mesh || source?.cadEdges !== this.edges || source?.mesh.geometry !== this.geometry) {
      this.outline = this.drop(this.outline); this.silhouette = this.drop(this.silhouette)
      this.mesh = source?.mesh ?? null; this.edges = source?.cadEdges ?? null
      this.geometry = source?.mesh.geometry as THREE.BufferGeometry ?? null; this.direction = null
      if (this.edges) this.outline = this.line(this.edges, 'tmar-step-face-boundaries')
    }
    let shown = !!this.mesh && this.edges !== null && active && prefs.enabled
    for (let p: THREE.Object3D | null = this.mesh; p; p = p.parent) if (!p.visible) shown = false
    const material = this.mesh ? (Array.isArray(this.mesh.material) ? this.mesh.material[0] : this.mesh.material) : null
    if (!material?.visible) shown = false
    this.group.visible = shown
    this.material.color.set(prefs.color); this.material.linewidth = prefs.width
    this.material.resolution.set(width, height)
    const planes = material?.clippingPlanes ?? null
    if (this.clipping !== planes) { this.clipping = planes; this.material.clippingPlanes = planes; this.material.needsUpdate = true }
    if (!shown || !this.mesh || !this.geometry) return
    this.mesh.updateWorldMatrix(true, false)
    const changedMatrix = !this.matrix.equals(this.mesh.matrixWorld)
    this.matrix.copy(this.mesh.matrixWorld); this.group.matrix.copy(this.matrix); this.group.matrixWorldNeedsUpdate = true
    const dir = this.scene.layerHost().camera().getWorldDirection(new THREE.Vector3()).transformDirection(this.matrix.clone().invert())
    if (!changedMatrix && this.direction && this.direction.dot(dir) > 0.999994) return
    this.direction = dir
    this.silhouette = this.drop(this.silhouette)
    const pos = this.geometry.getAttribute('position'), normal = this.geometry.getAttribute('normal'), index = this.geometry.getIndex()
    if (pos && normal && index) this.silhouette = this.line(silhouetteSegments(pos.array, normal.array, index.array,
      [[0, index.count / 3]], { dir: [dir.x, dir.y, dir.z] }), 'tmar-step-silhouette')
  }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.outline = this.drop(this.outline); this.silhouette = this.drop(this.silhouette)
    this.group.removeFromParent(); this.material.dispose(); this.mesh = null; this.geometry = null; this.edges = null
  }
}
