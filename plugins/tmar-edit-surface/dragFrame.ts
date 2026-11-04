// SPDX-License-Identifier: AGPL-3.0-only
import * as THREE from 'three'
import type { Point } from './brep'

type Point3 = readonly [number, number, number]
type Rect = Pick<DOMRectReadOnly, 'left' | 'top' | 'width' | 'height'>

/** Coordinates and directions are in the part's CAD frame, in mm. The camera
 * and part matrix are snapshots supplied by the host; this module never changes
 * them. Direction may be a world axis expressed in the part frame or a local
 * surface direction. */
export type DragFrameInput = {
  readonly camera: THREE.Camera
  readonly partWorld: THREE.Matrix4
  readonly rect: Rect
  readonly anchor: Point3
  readonly clientX: number
  readonly clientY: number
} & ({ readonly mode: 'axis'; readonly direction: Point3 } | { readonly mode: 'screen' })

export interface DragFrame {
  /** Delta in part-frame millimetres. Null means this pointer ray is degenerate. */
  deltaAt(clientX: number, clientY: number): Point | null
}

const finite = (values: readonly number[]) => values.every(Number.isFinite)
const close = (a: number, b: number, epsilon = 1e-6) => Math.abs(a - b) <= epsilon

/** Isometry: translation plus an orthonormal basis, with no scale or shear.
 * Either handedness is acceptable for displacement vectors. */
function isRigid(matrix: THREE.Matrix4): boolean {
  const e = matrix.elements
  if (!finite(e) || !close(e[3], 0, 1e-9) || !close(e[7], 0, 1e-9) ||
      !close(e[11], 0, 1e-9) || !close(e[15], 1, 1e-9)) return false
  const a = new THREE.Vector3(e[0], e[1], e[2])
  const b = new THREE.Vector3(e[4], e[5], e[6])
  const c = new THREE.Vector3(e[8], e[9], e[10])
  return close(a.lengthSq(), 1) && close(b.lengthSq(), 1) && close(c.lengthSq(), 1) &&
    close(a.dot(b), 0) && close(a.dot(c), 0) && close(b.dot(c), 0) &&
    close(Math.abs(matrix.determinant()), 1, 3e-6)
}

function snapshotCamera(camera: THREE.Camera): THREE.PerspectiveCamera | THREE.OrthographicCamera | null {
  const perspective = (camera as THREE.PerspectiveCamera).isPerspectiveCamera
  const orthographic = (camera as THREE.OrthographicCamera).isOrthographicCamera
  if (!perspective && !orthographic) return null
  if (![camera.matrixWorld, camera.matrixWorldInverse, camera.projectionMatrix,
    camera.projectionMatrixInverse].every(m => finite(m.elements)) ||
    Math.abs(camera.projectionMatrix.determinant()) < 1e-15) return null
  const copy = camera.clone(false) as THREE.PerspectiveCamera | THREE.OrthographicCamera
  // Preserve the already evaluated world matrix even if the camera has a parent.
  copy.matrixWorld.copy(camera.matrixWorld)
  copy.matrixWorldInverse.copy(camera.matrixWorldInverse)
  copy.projectionMatrix.copy(camera.projectionMatrix)
  copy.projectionMatrixInverse.copy(camera.projectionMatrixInverse)
  return copy
}

/** Captures a single gesture. The camera, viewport, part transform, anchor and
 * motion direction stay fixed for the gesture, including an off-centre grab. */
export function createDragFrame(input: DragFrameInput): DragFrame | null {
  const { rect, clientX, clientY, anchor, partWorld } = input
  if (!finite([rect.left, rect.top, rect.width, rect.height, clientX, clientY, ...anchor]) ||
      rect.width <= 0 || rect.height <= 0 || !isRigid(partWorld)) return null
  const camera = snapshotCamera(input.camera)
  if (!camera) return null
  const part = partWorld.clone(), localFromWorld = new THREE.Matrix3().setFromMatrix4(part.clone().invert())
  const worldAnchor = new THREE.Vector3(...anchor).applyMatrix4(part)
  const clip = new THREE.Vector4(worldAnchor.x, worldAnchor.y, worldAnchor.z, 1)
    .applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix)
  if (!finite(clip.toArray()) || clip.w <= 1e-12 || clip.z < -clip.w || clip.z > clip.w) return null
  const viewport = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  const raycaster = new THREE.Raycaster()
  const rayAt = (x: number, y: number): THREE.Ray | null => {
    if (!finite([x, y])) return null
    const ndc = new THREE.Vector2((x - viewport.left) * 2 / viewport.width - 1,
      1 - (y - viewport.top) * 2 / viewport.height)
    raycaster.setFromCamera(ndc, camera)
    return finite([...raycaster.ray.origin.toArray(), ...raycaster.ray.direction.toArray()])
      ? raycaster.ray : null
  }
  const startRay = rayAt(clientX, clientY)
  if (!startRay) return null

  if (input.mode === 'screen') {
    // A fixed plane through the anchor, parallel to the captured view plane.
    const normal = new THREE.Vector3(0, 0, -1).transformDirection(camera.matrixWorld)
    if (!finite(normal.toArray()) || normal.lengthSq() < 1e-20) return null
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, worldAnchor)
    const start = startRay.intersectPlane(plane, new THREE.Vector3())
    if (!start || !finite(start.toArray())) return null
    return { deltaAt(x, y) {
      const ray = rayAt(x, y)
      const hit = ray?.intersectPlane(plane, new THREE.Vector3())
      if (!hit) return null
      const local = hit.sub(start).applyMatrix3(localFromWorld)
      return finite(local.toArray()) ? local.toArray() as Point : null
    } }
  }

  if (!finite(input.direction) || new THREE.Vector3(...input.direction).lengthSq() < 1e-20) return null
  const localAxis = new THREE.Vector3(...input.direction).normalize()
  const worldAxis = localAxis.clone().transformDirection(part)
  // Closest points between the pointer ray and the allowed axis. This works
  // for both projection types, unlike a fixed pixels-per-mm approximation.
  const parameter = (ray: THREE.Ray): number | null => {
    const cosine = ray.direction.dot(worldAxis), denominator = 1 - cosine * cosine
    if (denominator < 1e-6) return null
    const offset = ray.origin.clone().sub(worldAnchor)
    const value = (offset.dot(worldAxis) - cosine * offset.dot(ray.direction)) / denominator
    // A line-line closest point behind the camera is not a valid pointer hit.
    const alongRay = cosine * value - offset.dot(ray.direction)
    return Number.isFinite(value) && Number.isFinite(alongRay) && alongRay >= 0 ? value : null
  }
  const start = parameter(startRay)
  if (start === null) return null
  return { deltaAt(x, y) {
    const ray = rayAt(x, y), current = ray ? parameter(ray) : null
    if (current === null) return null
    const delta = localAxis.clone().multiplyScalar(current - start)
    return finite(delta.toArray()) ? delta.toArray() as Point : null
  } }
}
