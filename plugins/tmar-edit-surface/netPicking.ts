// SPDX-License-Identifier: AGPL-3.0-only
import * as THREE from 'three'
import type { Net } from './brep'
import { netEdges, type NetSelectionMode } from './netSelection'

export interface NetPickInput {
  net: Net
  mode: NetSelectionMode
  hiddenPoles: readonly number[]
  camera: THREE.Camera
  /** Maps control-net coordinates into the scene's world coordinates. */
  partWorld: THREE.Matrix4
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>
  clientX: number
  clientY: number
  pointRadiusPx?: number
  edgeRadiusPx?: number
}

const finite = (values: number[]) => values.every(Number.isFinite)
const clampRadius = (value: number | undefined, fallback: number) => value === undefined ? fallback : value

function clipProjectSegment(a: THREE.Vector3, b: THREE.Vector3, camera: THREE.Camera,
  rect: NetPickInput['rect']): { a: THREE.Vector2; b: THREE.Vector2; za: number; zb: number } | null {
  const ca = new THREE.Vector4(a.x, a.y, a.z, 1)
    .applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix)
  const cb = new THREE.Vector4(b.x, b.y, b.z, 1)
    .applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix)
  if (![...ca.toArray(), ...cb.toArray()].every(Number.isFinite)) return null
  // Clip in homogeneous coordinates so perspective segments crossing the near
  // plane remain pickable without projecting a point behind the camera.
  const planes = [
    (p: THREE.Vector4) => p.x + p.w, (p: THREE.Vector4) => p.w - p.x,
    (p: THREE.Vector4) => p.y + p.w, (p: THREE.Vector4) => p.w - p.y,
    (p: THREE.Vector4) => p.z + p.w, (p: THREE.Vector4) => p.w - p.z,
  ]
  let lo = 0, hi = 1
  for (const value of planes) {
    const f0 = value(ca), f1 = value(cb)
    if (f0 < 0 && f1 < 0) return null
    if ((f0 < 0) !== (f1 < 0)) {
      const t = f0 / (f0 - f1)
      if (f0 < 0) lo = Math.max(lo, t)
      else hi = Math.min(hi, t)
      if (lo > hi) return null
    }
  }
  const at = (t: number) => ca.clone().lerp(cb, t)
  const p0 = at(lo), p1 = at(hi)
  if (p0.w <= 1e-12 || p1.w <= 1e-12) return null
  const za = p0.z / p0.w, zb = p1.z / p1.w
  const screen = (p: THREE.Vector4) => new THREE.Vector2(
    rect.left + (p.x / p.w + 1) * rect.width / 2,
    rect.top + (1 - p.y / p.w) * rect.height / 2,
  )
  const pa = screen(p0), pb = screen(p1)
  return finite([...pa.toArray(), ...pb.toArray(), za, zb]) ? { a: pa, b: pb, za, zb } : null
}

function visiblePoint(point: THREE.Vector3, camera: THREE.Camera): { screen: THREE.Vector2; depth: number } | null {
  const clip = new THREE.Vector4(point.x, point.y, point.z, 1)
    .applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix)
  if (!finite(clip.toArray()) || clip.w <= 1e-12) return null
  const x = clip.x / clip.w, y = clip.y / clip.w, z = clip.z / clip.w
  if (x < -1 || x > 1 || y < -1 || y > 1 || z < -1 || z > 1) return null
  return { screen: new THREE.Vector2(x, y), depth: z }
}

function nearestPoint(input: NetPickInput, world: THREE.Vector3[], radius: number, x: number, y: number): number[] | null {
  if (radius <= 0 || input.mode === 'edges' || input.mode === 'cells') return null
  let best = radius, index = -1, depth = Infinity
  input.net.poles.forEach((_, i) => {
    if (input.hiddenPoles.includes(i)) return
    const p = visiblePoint(world[i], input.camera)
    if (!p) return
    const sx = input.rect.left + (p.screen.x + 1) * input.rect.width / 2
    const sy = input.rect.top + (1 - p.screen.y) * input.rect.height / 2
    const d = Math.hypot(x - sx, y - sy)
    if (d < best || (d === best && p.depth < depth)) { best = d; index = i; depth = p.depth }
  })
  return index < 0 ? null : [index]
}

function nearestEdge(input: NetPickInput, world: THREE.Vector3[], radius: number, x: number, y: number): number[] | null {
  if (input.mode === 'points' || input.mode === 'cells') return null
  let best = radius, result: [number, number] | null = null, depth = Infinity
  for (const indices of netEdges(input.net)) {
    if (indices.some(i => input.hiddenPoles.includes(i))) continue
    const segment = clipProjectSegment(world[indices[0]], world[indices[1]], input.camera, input.rect)
    if (!segment) continue
    const d = new THREE.Vector2(segment.b.x - segment.a.x, segment.b.y - segment.a.y)
    const lengthSq = d.lengthSq()
    if (lengthSq < 1e-12) continue
    const mouse = new THREE.Vector2(x, y)
    const t = THREE.MathUtils.clamp(mouse.sub(segment.a).dot(d) / lengthSq, 0, 1)
    const distance = mouse.copy(new THREE.Vector2(x, y)).distanceTo(segment.a.clone().addScaledVector(d, t))
    const z = segment.za + (segment.zb - segment.za) * t
    if (distance < best || (distance === best && z < depth)) { best = distance; result = indices; depth = z }
  }
  return result ? [...result] : null
}

function nearestCell(input: NetPickInput, world: THREE.Vector3[]): number[] | null {
  if (input.mode !== 'auto' && input.mode !== 'cells') return null
  if (input.rect.width <= 0 || input.rect.height <= 0) return null
  const ndc = new THREE.Vector2(
    (input.clientX - input.rect.left) * 2 / input.rect.width - 1,
    1 - (input.clientY - input.rect.top) * 2 / input.rect.height,
  )
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(ndc, input.camera)
  let best = Infinity, result: number[] | null = null
  const hit = new THREE.Vector3()
  const { nu, nv } = input.net
  for (let u = 0; u < nu - 1; u++) for (let v = 0; v < nv - 1; v++) {
    const a = u * nv + v, b = a + nv, c = b + 1, d = a + 1
    const indices = [a, b, c, d]
    if (indices.some(i => input.hiddenPoles.includes(i))) continue
    for (const [j, k] of [[b, c], [c, d]] as const) {
      if (!raycaster.ray.intersectTriangle(world[a], world[j], world[k], false, hit)) continue
      // Raycaster.far does not inherit the camera's near/far clip planes.
      // Discard intersections outside the actual rendered depth range.
      if (!visiblePoint(hit, input.camera)) continue
      const depth = hit.distanceToSquared(raycaster.ray.origin)
      if (depth < best) { best = depth; result = indices }
    }
  }
  return result
}

/** Picks the nearest eligible net item in screen pixels: point, then segment,
 * then cell. Cell hits use the camera ray and nearest visible triangle depth. */
export function pickNetAt(input: NetPickInput): number[] | null {
  const { net, partWorld, rect, clientX, clientY } = input
  if (!Number.isInteger(net.nu) || !Number.isInteger(net.nv) || net.nu < 2 || net.nv < 2 || net.poles.length !== net.nu * net.nv ||
      !finite([rect.left, rect.top, rect.width, rect.height, clientX, clientY]) || rect.width <= 0 || rect.height <= 0) return null
  if (!net.poles.every(p => p.length === 3 && finite(p)) || !partWorld.elements.every(Number.isFinite)) return null
  const pointRadius = clampRadius(input.pointRadiusPx, 8), edgeRadius = clampRadius(input.edgeRadiusPx, 7)
  if (!Number.isFinite(pointRadius) || pointRadius < 0 || !Number.isFinite(edgeRadius) || edgeRadius < 0) return null
  const world = net.poles.map(p => new THREE.Vector3(...p).applyMatrix4(partWorld))
  return nearestPoint(input, world, pointRadius, clientX, clientY) ??
    nearestEdge(input, world, edgeRadius, clientX, clientY) ??
    nearestCell(input, world)
}
