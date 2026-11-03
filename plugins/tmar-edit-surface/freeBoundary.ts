// SPDX-License-Identifier: AGPL-3.0-only
import type { OcctKernel, ShapeHandle } from 'occt-wasm'
import { encodeNet, signature, surfaceTable, type Net } from './brep'

/** Rebuild the natural rectangular rim of a single open NURBS face.
 *  The four curves are exact isoparametric B-splines of the edited net.
 *  The caller supplies the modified support and owns the returned face. */
export function rebuildFreeBoundary(k: OcctKernel, support: ShapeHandle, net: Net): ShapeHandle {
  const owned: ShapeHandle[] = []
  const keep = (shape: ShapeHandle) => { owned.push(shape); return shape }
  let result: ShapeHandle | null = null
  try {
    const v0 = Array.from({ length: net.nv }, (_, v) => v)
    const u1 = Array.from({ length: net.nu }, (_, u) => u * net.nv + net.nv - 1)
    const v1 = Array.from({ length: net.nv }, (_, v) => (net.nu - 1) * net.nv + v)
    const u0 = Array.from({ length: net.nu }, (_, u) => u * net.nv)
    const edge = (indices: number[], direction: 'u' | 'v') => keep(k.makeBSplineEdge(
      indices.flatMap(i => net.poles[i]), indices.map(i => net.weights[i]),
      direction === 'u' ? net.ku : net.kv, direction === 'u' ? net.mu : net.mv,
      direction === 'u' ? net.du : net.dv,
    ))
    const wire = keep(k.makeWire([edge(v0, 'v'), edge(u1, 'u'), edge(v1, 'v'), edge(u0, 'u')]))
    const raw = keep(k.makeFaceOnSurface(support, wire))
    // Materialize missing edge pcurves and verify the exact support afterwards.
    result = k.fixShape(raw)
    const faces = k.getSubShapes(result, 'face'), wires = k.getSubShapes(result, 'wire'), edges = k.getSubShapes(result, 'edge')
    try {
      if (!k.isValid(result) || faces.length !== 1 || wires.length !== 1 || edges.length !== 4)
        throw new Error('Il bordo spostato non forma una faccia CAD valida.')
      const expected = encodeNet(net).trim().split(/\s+/).map(Number).join(' ')
      const surfaces = surfaceTable(k.toBREP(faces[0])).filter(record => signature(record) === expected)
      if (surfaces.length !== 1) throw new Error('La ricostruzione ha alterato la superficie NURBS.')
      const bounds = k.uvBounds(support), actual = k.uvBounds(faces[0])
      const tolerance = 1e-7 * Math.max(1, bounds.uMax - bounds.uMin, bounds.vMax - bounds.vMin)
      if (Math.abs(bounds.uMin - actual.uMin) > tolerance || Math.abs(bounds.uMax - actual.uMax) > tolerance ||
          Math.abs(bounds.vMin - actual.vMin) > tolerance || Math.abs(bounds.vMax - actual.vMax) > tolerance)
        throw new Error('Il contorno non copre il dominio originale della superficie.')
      for (let u = 0; u <= 8; u++) for (let v = 0; v <= 8; v++) {
        const x = bounds.uMin + (bounds.uMax - bounds.uMin) * u / 8
        const y = bounds.vMin + (bounds.vMax - bounds.vMin) * v / 8
        if (!['in', 'on'].includes(k.classifyPointOnFace(faces[0], x, y)))
          throw new Error('Il contorno della faccia non è chiuso sul dominio NURBS.')
      }
    } finally { [...faces, ...wires, ...edges].forEach(shape => k.release(shape)) }
    const face = result
    result = null
    return face
  } finally {
    if (result !== null) k.release(result)
    owned.reverse().forEach(shape => k.release(shape))
  }
}
