// SPDX-License-Identifier: AGPL-3.0-only
// Display-only reflected stripes. Adapted from the owner's SurfaceLab
// zebra-editor.js; this layer never replaces or disposes the host materials.
import * as THREE from 'three'
import type { SceneLayer } from '../../src/viewer/sceneLayers'
import { PATTERN_SIZE, stripePattern, type Orientation } from './pattern'

export type ZebraTarget = 'visible' | 'selected' | 'scan'
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
  radius(): number
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
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      clippingPlanes: original?.clippingPlanes ?? null, toneMapped: false,
    })
    material.onBeforeCompile = (shader) => {
      shader.uniforms.zebraDistance = this.distance
      const varyings = 'varying vec3 zebraPosition;\nvarying vec3 zebraNormal;\n'
      shader.vertexShader = varyings + shader.vertexShader
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nzebraPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;\nzebraNormal = normalMatrix * normal;')
      shader.fragmentShader = `uniform float zebraDistance;\n${varyings}${projection}\n` + shader.fragmentShader
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '#ifdef USE_MAP\ndiffuseColor *= texture2D(map, zebraUV(zebraPosition, zebraNormal));\n#endif')
    }
    material.customProgramCacheKey = () => 'tmar-zebra-reflection-v1'
    const overlay = new THREE.Mesh(parent.geometry as THREE.BufferGeometry, material)
    overlay.name = 'tmar-zebra-overlay'
    overlay.userData.tmarZebra = true
    overlay.renderOrder = parent.renderOrder + 1
    overlay.raycast = () => {} // Selection continues to hit the host object.
    parent.add(overlay)
    return overlay
  }

  private sync(): void {
    if (this.disposed) return
    const wanted = new Set<THREE.Mesh>()
    if (this.options.target === 'scan') {
      const scan = this.sources.scan()
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
    const radius = Math.max(this.sources.radius() * 1.2, 1e-6)
    if (this.distance.value !== radius) { this.distance.value = radius; changed = true }
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
