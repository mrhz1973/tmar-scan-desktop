// SPDX-License-Identifier: AGPL-3.0-only
import * as THREE from 'three'
import type { Preview } from './editorKernel'

export interface WorkspacePreviewClipping {
  readonly planes: readonly THREE.Plane[] | null
  readonly intersection?: boolean
}

/** Dependencies supplied by the eventual session/host integration. The mask
 * function must be atomic and return an idempotent restore function; this
 * renderer never reads or writes the host body's material or visibility. */
export interface WorkspacePreviewOptions {
  /** Session group whose coordinates are already in the part frame. */
  readonly session: THREE.Group
  /** Acquire a temporary source-body mask and return how to restore it. */
  readonly maskSource: () => () => void
  /** Ask the owner of the shared renderer to repaint. */
  readonly invalidate: () => void
  /** Current host clipping state; planes are copied into owned materials. */
  readonly clipping?: () => WorkspacePreviewClipping
}

const colorForFace = (index: number, activeFace: number) => index === activeFace ? '#6ebde4' : '#a4acb0'

/** Owns only its dedicated child group, mesh geometries and materials. It
 * deliberately creates no camera, renderer, loop, layer registration or host API. */
export class WorkspacePreview {
  readonly group = new THREE.Group()
  private readonly session: THREE.Group
  private readonly maskSource: () => () => void
  private readonly invalidate: () => void
  private readonly clipping?: () => WorkspacePreviewClipping
  private restoreSource: (() => void) | null = null
  private activeFace = -1
  private visible = true
  private disposed = false

  constructor(options: WorkspacePreviewOptions) {
    this.session = options.session
    this.maskSource = options.maskSource
    this.invalidate = options.invalidate
    this.clipping = options.clipping
    this.group.name = 'tmar-edit-surface-preview'
    this.session.add(this.group)
  }

  /** Replace the preview with owned meshes; `userData.face` keeps face picking stable. */
  setPreview(preview: Pick<Preview,'faceMeshes'> | null, activeFace = this.activeFace): void {
    this.assertActive()
    if (!preview) {
      this.activeFace = activeFace
      this.group.visible = this.visible
      this.clearAndRestore()
      return
    }

    const next: THREE.Mesh[] = []
    let nextDisposed = false
    const disposeNext = () => {
      if (nextDisposed) return
      nextDisposed = true
      disposeMeshes(next)
    }
    try {
      preview.faceMeshes.forEach((face, index) => next.push(this.makeFace(face, index, activeFace)))
    } catch (error) {
      try { disposeNext() } catch { /* Preserve the construction failure. */ }
      throw error
    }
    const shouldMask = this.visible && next.length > 0
    let acquired: (() => void) | null = null
    let acquiredRestored = false
    let committed = false
    try {
      this.applyClipping(next)
      if (shouldMask && !this.restoreSource) acquired = this.acquireMask()

      const old = [...this.group.children]
      try {
        for (const mesh of next) this.group.add(mesh)
        for (const mesh of old) this.group.remove(mesh)
        this.group.visible = this.visible
        this.invalidate()
      } catch (error) {
        for (const mesh of next) this.group.remove(mesh)
        for (const mesh of old) this.group.add(mesh)
        this.group.visible = this.visible
        try { disposeNext() } catch { /* Preserve the replacement failure. */ }
        if (acquired) {
          try { acquired(); acquiredRestored = true } catch { /* Retry below; preserve the original failure. */ }
        }
        throw error
      }

      if (acquired) this.restoreSource = acquired
      this.activeFace = activeFace
      committed = true
      let cleanupFailure: unknown
      if (!shouldMask) {
        try { this.restoreIfUnneeded() } catch (error) { cleanupFailure = error }
      }
      try { disposeMeshes(old as THREE.Mesh[]) } catch (error) { cleanupFailure ??= error }
      if (cleanupFailure) throw cleanupFailure
    } catch (error) {
      // Failures before commit leave the previous preview intact and dispose
      // every staged resource. The host mask is released only if this call
      // acquired it; an existing preview keeps its existing mask.
      if (!committed) {
        if (!nextDisposed) try { disposeNext() } catch { /* Preserve the original failure. */ }
        if (acquired && !acquiredRestored && this.restoreSource !== acquired) {
          try { acquired() } catch { /* The host release remains available to its owner. */ }
        }
      }
      throw error
    }
  }

  /** Hide/show only this renderer's group, acquiring/releasing the source mask as needed. */
  setVisible(visible: boolean): void {
    this.assertActive()
    if (this.visible === visible) return
    if (visible && this.group.children.length > 0 && !this.restoreSource) {
      const acquired = this.acquireMask()
      this.restoreSource = acquired
    }
    this.visible = visible
    this.group.visible = visible
    try {
      if (!visible) this.restoreIfUnneeded(true)
      this.invalidate()
    } catch (error) {
      // Fail closed if visibility or invalidation cannot be completed.
      this.visible = false
      this.group.visible = false
      try { this.restoreIfUnneeded(true) } catch { /* Preserve the original failure. */ }
      try { this.invalidate() } catch { /* Best-effort repaint after rollback. */ }
      throw error
    }
  }

  /** Update the highlighted face without replacing or mutating its geometry. */
  setActiveFace(face: number): void {
    this.assertActive()
    if (this.activeFace === face) return
    this.activeFace = face
    for (const child of this.group.children) {
      const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
      mesh.material.color.set(colorForFace(mesh.userData.face as number, face))
    }
    this.invalidate()
  }

  /** Re-copy clipping state after host clipping changes. */
  refreshClipping(): void {
    this.assertActive()
    this.applyClipping(this.group.children as THREE.Mesh[])
    this.invalidate()
  }

  /** Clear this preview and release its temporary source mask. */
  clear(): void {
    if (this.disposed) return
    this.clearAndRestore()
  }

  /** Idempotently remove owned resources and restore the host's temporary mask. */
  dispose(): void {
    if (this.disposed && !this.restoreSource) return
    this.disposed = true
    let failure: unknown
    try { this.clearMeshes() } catch (error) { failure = error }
    this.group.removeFromParent()
    try { this.restoreIfUnneeded(true) } catch (error) { failure ??= error }
    try { this.invalidate() } catch (error) { failure ??= error }
    if (failure) throw failure
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Anteprima superficie già chiusa.')
  }

  private acquireMask(): () => void {
    const restore = this.maskSource()
    if (typeof restore !== 'function') throw new Error('La maschera host non ha restituito il ripristino.')
    return restore
  }

  private restoreIfUnneeded(force = false): void {
    if (!this.restoreSource || (!force && this.visible && this.group.children.length > 0)) return
    const restore = this.restoreSource
    restore()
    this.restoreSource = null
  }

  private clearMeshes(): void {
    const children = [...this.group.children]
    for (const child of children) this.group.remove(child)
    disposeMeshes(children as THREE.Mesh[])
  }

  /** Complete cleanup steps even when disposal or host callbacks throw. */
  private clearAndRestore(): void {
    let failure: unknown
    try { this.clearMeshes() } catch (error) { failure = error }
    try { this.restoreIfUnneeded(true) } catch (error) { failure ??= error }
    try { this.invalidate() } catch (error) { failure ??= error }
    if (failure) throw failure
  }

  private makeFace(face: Preview['faceMeshes'][number], index: number, activeFace: number): THREE.Mesh {
    const vertexCount = face.positions.length / 3
    let valid = vertexCount >= 3 && face.positions.length % 3 === 0 &&
      face.normals.length === face.positions.length && face.indices.length >= 3 && face.indices.length % 3 === 0
    for (let i = 0; valid && i < face.positions.length; i++)
      valid = Number.isFinite(face.positions[i]) && Number.isFinite(face.normals[i])
    for (let i = 0; valid && i < face.indices.length; i++) valid = face.indices[i] < vertexCount
    if (!valid) {
      throw new Error(`Triangolazione non valida per la faccia ${index}.`)
    }
    const geometry = new THREE.BufferGeometry()
    let material: THREE.MeshStandardMaterial | null = null
    try {
      geometry.setAttribute('position', new THREE.BufferAttribute(face.positions.slice(), 3))
      geometry.setAttribute('normal', new THREE.BufferAttribute(face.normals.slice(), 3))
      geometry.setIndex(new THREE.BufferAttribute(face.indices.slice(), 1))
      geometry.computeBoundingBox()
      geometry.computeBoundingSphere()
      material = new THREE.MeshStandardMaterial({
        color: colorForFace(index, activeFace), metalness: 0.05, roughness: 0.55,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.userData.face = index
      return mesh
    } catch (error) {
      geometry.dispose()
      material?.dispose()
      throw error
    }
  }

  private applyClipping(meshes: readonly THREE.Mesh[]): void {
    const state = this.clipping?.() ?? { planes: null, intersection: false }
    const planes = state.planes ? [...state.planes] : null
    for (const child of meshes) {
      const materials = Array.isArray(child.material) ? child.material : [child.material]
      for (const material of materials) {
        material.clippingPlanes = planes ? [...planes] : null
        material.clipIntersection = state.intersection ?? false
      }
    }
  }
}

function disposeMeshes(meshes: readonly THREE.Mesh[]): void {
  let failure: unknown
  for (const mesh of meshes) {
    try { mesh.geometry.dispose() } catch (error) { failure ??= error }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) try { material.dispose() } catch (error) { failure ??= error }
  }
  if (failure) throw failure
}
