// SPDX-License-Identifier: AGPL-3.0-only
// Display-only reflected stripes. Adapted from the owner's SurfaceLab
// zebra-editor.js; this layer never replaces or disposes the host materials.
import * as THREE from 'three'
import type { SceneLayer } from '../../src/viewer/sceneLayers'
import { PATTERN_SIZE, stripePattern, type Orientation } from './pattern'

export type ZebraTarget = 'visible' | 'selected' | 'scan' | 'reference'
export interface ZebraOptions {
  target: ZebraTarget
  selectedIds: readonly number[]
  orientation: Orientation
  width: number
  color: string
}

export interface ZebraSources {
  bodies(): ReadonlyMap<number, THREE.Mesh>
  scan(): THREE.Mesh | null
  reference?(): THREE.Mesh | null
  invalidate(): void
  countChanged?(count: number): void
}

const projection = `
vec2 zebraUV(vec3 p, vec3 n) {
  vec3 view = vec3(0.0, 0.0, zebraDistance) - p;
  if (dot(n,n) < 0.00000011920928955078125 || dot(view,view) < 0.00000011920928955078125) return vec2(0.5);
  n = normalize(n); view = normalize(view);
  vec3 r = normalize(2.0 * dot(n,view) * n - view);
  float d = 2.0 * length(vec3(r.xy, max(0.0,r.z) + 1.0));
  return d < 0.00000001 ? vec2(0.5) : r.xy / d + vec2(0.5);
}`

function sourceMaterial(mesh: THREE.Mesh): THREE.Material | null {
  return Array.isArray(mesh.material) ? mesh.material[0] ?? null : mesh.material
}

/** An overlay shares the geometry only: the original material, picking and
 *  data stay owned by the host. Removing a layer never disposes that geometry. */
export class ZebraLayer implements SceneLayer {
  readonly order = 100
  private readonly overlays = new Map<THREE.Mesh, THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>()
  private readonly distance = { value: 1 }
  private readonly center = { value: new THREE.Vector3() }
  private readonly frame = new THREE.Box3()
  private readonly bounds = new WeakMap<THREE.BufferGeometry, { position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute; version: number; box: THREE.Box3 }>()
  private readonly worldBounds = new THREE.Box3()
  private readonly frameCenter = new THREE.Vector3()
  private readonly frameSize = new THREE.Vector3()
  private readonly vertex = new THREE.Vector3()
  private readonly texture: THREE.DataTexture
  private options: ZebraOptions
  private count = -1
  private disposed = false

  constructor(private readonly sources: ZebraSources, options: ZebraOptions) {
    this.options = { ...options, selectedIds: [...options.selectedIds] }
    this.texture = new THREE.DataTexture(stripePattern(options.width, options.orientation, options.color), PATTERN_SIZE, PATTERN_SIZE, THREE.RGBAFormat)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.wrapS = this.texture.wrapT = THREE.RepeatWrapping
    this.texture.magFilter = this.texture.minFilter = THREE.LinearFilter
    this.texture.generateMipmaps = false
    this.texture.needsUpdate = true
  }

  setOptions(options: ZebraOptions): void {
    if (this.disposed) return
    const old = this.options
    if (old.width !== options.width || old.orientation !== options.orientation || old.color !== options.color) {
      this.texture.image.data = stripePattern(options.width, options.orientation, options.color)
      this.texture.needsUpdate = true
    }
    this.options = { ...options, selectedIds: [...options.selectedIds] }
    this.sync()
    this.sources.invalidate()
  }

  private makeOverlay(parent: THREE.Mesh): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
    const original = sourceMaterial(parent)
    const material = new THREE.MeshBasicMaterial({
      map: this.texture, color: 0xffffff, side: THREE.FrontSide,
      transparent: true, opacity: 1, depthTest: true, depthWrite: true,
      polygonOffset: true,
      polygonOffsetFactor: original?.polygonOffset && original.polygonOffsetFactor > 0 ? original.polygonOffsetFactor * 0.5 : -2,
      polygonOffsetUnits: original?.polygonOffset && original.polygonOffsetUnits > 0 ? original.polygonOffsetUnits * 0.5 : -2,
      clippingPlanes: original?.clippingPlanes ?? null, toneMapped: false,
    })
    material.onBeforeCompile = (shader) => {
      shader.uniforms.zebraDistance = this.distance
      shader.uniforms.zebraCenter = this.center
      const varying = 'varying vec2 zebraReflectedUV;\n'
      // QS generates reflection UVs at the vertices, with a virtual eye
      // relative to the model centre. Camera pan/dolly must not change that
      // virtual eye: use only the rotation from viewMatrix here.
      shader.vertexShader = `uniform float zebraDistance;\nuniform vec3 zebraCenter;\n${varying}${projection}\n` + shader.vertexShader
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
vec3 zebraPosition = mat3(viewMatrix) * ((modelMatrix * vec4(position, 1.0)).xyz - zebraCenter);
zebraReflectedUV = zebraUV(zebraPosition, normalMatrix * normal);`)
      shader.fragmentShader = varying + shader.fragmentShader
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '#ifdef USE_MAP\ndiffuseColor *= texture2D(map, zebraReflectedUV);\n#endif')
    }
    material.customProgramCacheKey = () => 'tmar-zebra-reflection-v2'
    const overlay = new THREE.Mesh(parent.geometry as THREE.BufferGeometry, material)
    overlay.name = 'tmar-zebra-overlay'
    overlay.userData.tmarZebra = true
    overlay.renderOrder = parent.renderOrder + 1
    overlay.raycast = () => {} // Selection continues to hit the host object.
    parent.add(overlay)
    return overlay
  }

  /** Bounds are derived from the inspected geometry, never the camera or the
   *  scan's radius when looking at CAD. Cache only the local position bounds;
   *  transformations and visibility remain live. No host buffers are changed. */
  private updateFrame(meshes: Iterable<THREE.Mesh>): boolean {
    this.frame.makeEmpty()
    for (const mesh of meshes) {
      if (!sourceMaterial(mesh)?.visible) continue
      let shown = true
      for (let parent: THREE.Object3D | null = mesh; parent; parent = parent.parent) {
        if (!parent.visible) { shown = false; break }
      }
      if (!shown) continue
      const geometry = mesh.geometry as THREE.BufferGeometry
      const position = geometry.getAttribute('position')
      if (!position) continue
      const version = position instanceof THREE.InterleavedBufferAttribute ? position.data.version : position.version
      let cached = this.bounds.get(geometry)
      if (!cached || cached.position !== position || cached.version !== version) {
        const box = new THREE.Box3()
        for (let i = 0; i < position.count; i++) {
          box.expandByPoint(this.vertex.set(position.getX(i), position.getY(i), position.getZ(i)))
        }
        cached = { position, version, box }
        this.bounds.set(geometry, cached)
      }
      mesh.updateWorldMatrix(true, false)
      this.frame.union(this.worldBounds.copy(cached.box).applyMatrix4(mesh.matrixWorld))
    }
    if (this.frame.isEmpty()) return false
    this.frame.getCenter(this.frameCenter)
    const distance = Math.max(this.frame.getSize(this.frameSize).length() * 0.6, 1e-6)
    const changed = !this.center.value.equals(this.frameCenter) || this.distance.value !== distance
    this.center.value.copy(this.frameCenter)
    this.distance.value = distance
    return changed
  }

  private sync(): void {
    if (this.disposed) return
    const wanted = new Set<THREE.Mesh>()
    if (this.options.target === 'scan' || this.options.target === 'reference') {
      const scan = this.options.target === 'reference' ? this.sources.reference?.() : this.sources.scan()
      if (scan) wanted.add(scan)
    } else {
      const selected = new Set(this.options.selectedIds)
      for (const [id, mesh] of this.sources.bodies()) {
        if (this.options.target === 'visible' || selected.has(id)) wanted.add(mesh)
      }
    }
    let changed = false
    for (const [parent, overlay] of this.overlays) {
      if (wanted.has(parent) && parent.geometry === overlay.geometry) continue
      overlay.removeFromParent()
      overlay.material.dispose()
      this.overlays.delete(parent)
      changed = true
    }
    let visible = 0
    for (const parent of wanted) {
      if (!parent.geometry.getAttribute('normal')) continue
      let overlay = this.overlays.get(parent)
      if (!overlay) {
        overlay = this.makeOverlay(parent)
        this.overlays.set(parent, overlay)
        changed = true
      }
      const original = sourceMaterial(parent)
      const shown = parent.visible && !!original?.visible
      if (overlay.visible !== shown) { overlay.visible = shown; changed = true }
      if (shown) visible++
      const planes = original?.clippingPlanes ?? null
      if (overlay.material.clippingPlanes !== planes) {
        overlay.material.clippingPlanes = planes
        overlay.material.needsUpdate = true
        changed = true
      }
    }
    // Selecting only some bodies changes which receive stripes, not their
    // common reflected environment. Hidden bodies never expand the frame.
    if (this.updateFrame(this.options.target === 'scan' || this.options.target === 'reference' ? wanted : this.sources.bodies().values())) changed = true
    if (this.count !== visible) { this.count = visible; this.sources.countChanged?.(visible) }
    if (changed) this.sources.invalidate()
  }

  tick(): void { this.sync() }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const overlay of this.overlays.values()) { overlay.removeFromParent(); overlay.material.dispose() }
    this.overlays.clear()
    this.texture.dispose()
    this.sources.invalidate()
  }
}
