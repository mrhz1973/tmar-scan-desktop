// SPDX-License-Identifier: AGPL-3.0-only
import type { OcctKernel, ShapeHandle } from 'occt-wasm'

/** Preliminary source gate only. It does not establish pcurve/seam integrity,
 * conversion equivalence, or permission to edit. Handles remain caller-owned. */
export function assertSimpleCylinderSource(k: OcctKernel, shape: ShapeHandle, face: ShapeHandle): void {
  if (!k.isValid(shape)) throw new Error('Solido sorgente non valido.')
  let solids: ShapeHandle[] = [], faces: ShapeHandle[] = [], edges: ShapeHandle[] = [], vertices: ShapeHandle[] = []
  let wires: ShapeHandle[] = [], rim: ShapeHandle[] = []
  try {
    solids = k.getSubShapes(shape, 'solid')
    faces = k.getSubShapes(shape, 'face')
    edges = k.getSubShapes(shape, 'edge')
    vertices = k.getSubShapes(shape, 'vertex')
    if (solids.length !== 1 || faces.length !== 3 || edges.length !== 3 || vertices.length !== 2 ||
        faces.filter(f => k.isSame(f, face)).length !== 1 || k.surfaceType(face) !== 'cylinder')
      throw new Error('Topologia cilindrica non supportata.')
    const other = faces.filter(f => !k.isSame(f, face))
    if (other.length !== 2 || other.some(f => k.surfaceType(f) !== 'plane'))
      throw new Error('Il cilindro deve avere due sole facce piane terminali.')
    const cylinder = k.getFaceCylinderData(face), uv = k.uvBounds(face)
    if (!cylinder || !Number.isFinite(cylinder.radius) || cylinder.radius <= 0 ||
        ![uv.uMin, uv.uMax, uv.vMin, uv.vMax].every(Number.isFinite) ||
        uv.vMax <= uv.vMin || Math.abs((uv.uMax - uv.uMin) - 2 * Math.PI) > 1e-7)
      throw new Error('Dominio del cilindro completo non riconosciuto.')
    wires = k.getSubShapes(face, 'wire')
    if (wires.length !== 1) throw new Error('Contorni cilindrici non supportati.')
    rim = k.getSubShapes(wires[0], 'edge')
    if (rim.length !== 3) throw new Error('Bordi cilindrici non supportati.')
    const circles = rim.filter(e => k.curveType(e) === 'circle' && k.curveIsClosed(e))
    const lines = rim.filter(e => k.curveType(e) === 'line')
    if (circles.length !== 2 || lines.length !== 1 ||
        circles.some(e => {
          const length = k.curveLength(e)
          return !Number.isFinite(length) || Math.abs(length - 2 * Math.PI * cylinder.radius) > 1e-6 * Math.max(1, cylinder.radius)
        }))
      throw new Error('Bordi del cilindro completo non riconosciuti.')
    const matchedCircles = new Set<number>()
    for (const cap of other) {
      const capEdges = k.getSubShapes(cap, 'edge')
      try {
        const circle = capEdges.length === 1 ? circles.findIndex(e => k.isSame(e, capEdges[0])) : -1
        if (circle < 0 || matchedCircles.has(circle))
          throw new Error('Bordo del piano terminale non riconosciuto.')
        matchedCircles.add(circle)
      } finally { capEdges.forEach(e => k.release(e)) }
    }
    // A rectangular UV bounding box alone does not prove the trimmed face is
    // complete; sample its interior, but leave exact seam/pcurve validation to
    // the subsequent conversion qualification.
    for (let i = 1; i < 8; i++) for (let j = 1; j < 8; j++) {
      const u = uv.uMin + (uv.uMax - uv.uMin) * i / 8
      const v = uv.vMin + (uv.vMax - uv.vMin) * j / 8
      if (k.classifyPointOnFace(face, u, v) !== 'in') throw new Error('Area cilindrica ritagliata o ambigua.')
    }
  } finally { [...solids, ...faces, ...edges, ...vertices, ...wires, ...rim].forEach(h => k.release(h)) }
}
