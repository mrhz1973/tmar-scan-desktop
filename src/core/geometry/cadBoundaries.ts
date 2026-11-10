// SPDX-License-Identifier: AGPL-3.0-only
// Display-only STEP face boundaries. Internal diagonals have the SAME face
// identity on both sides, even on a curved or tangent surface: never draw them.
export function cadBoundarySegments(positions: ArrayLike<number>, indices: ArrayLike<number>, faces: ArrayLike<number>): Float32Array {
  if (indices.length % 3 || faces.length !== indices.length / 3) throw new Error('CAD face labels do not match the tessellation.')
  const edges = new Map<string, { a: number; b: number; face: number; count: number; boundary: boolean }>()
  for (let t = 0; t < faces.length; t++) for (let k = 0; k < 3; k++) {
    const a = indices[t * 3 + k], b = indices[t * 3 + (k + 1) % 3]
    if (a === b) continue
    const key = a < b ? `${a}:${b}` : `${b}:${a}`
    const old = edges.get(key)
    if (old) { old.count++; old.boundary ||= old.face !== faces[t] }
    else edges.set(key, { a, b, face: faces[t], count: 1, boundary: false })
  }
  const out: number[] = []
  for (const e of edges.values()) {
    if (!e.boundary && e.count !== 1) continue
    const a = e.a * 3, b = e.b * 3
    if (positions[a] === positions[b] && positions[a+1] === positions[b+1] && positions[a+2] === positions[b+2]) continue
    const segment = [positions[a], positions[a+1], positions[a+2], positions[b], positions[b+1], positions[b+2]]
    if (segment.every(Number.isFinite)) out.push(...segment)
  }
  return new Float32Array(out)
}
