// SPDX-License-Identifier: AGPL-3.0-only
// Lift fitting constraints only AFTER scan cells/UV maps have been constructed.
// Shared node and curve targets are made once; scan samples and incidence stay put.
import type { Vec3 } from '../../../src/core/types'
import type { NetworkFeature } from './features'
import type { TracedNetwork } from './network'
import type { PolygonSplit } from './networkSplit'
import { fitProvisional, type CurveTrace } from './networkCurve'
import { centreOffsetPoint, readCentreOffset } from './networkNormalMotion'
import { blendDelta, curvePoints, offsetDelta, nonzeroOffset } from './networkPointMotion'

export function liftedCentreGraph(graph: TracedNetwork, split: PolygonSplit | null,
  data: Pick<NetworkFeature, 'nodes' | 'curves' | 'cells'>, spacing: number) {
  const offsets = new Map<number, Vec3>()
  const nodeAt = new Map(graph.nodes.map(n => [n.id, n.at]))
  const putTarget = (id: number, at: Vec3) => {
    const anchor = nodeAt.get(id)
    if (!anchor) throw Error('Nodo della rete non trovato durante lo spostamento 3D.')
    const delta = at.map((x, i) => x - anchor[i]) as Vec3
    const old = offsets.get(id)
    if (old && Math.hypot(...old.map((v, i) => v - delta[i])) > 1e-5)
      throw Error('Spostamenti incompatibili sul nodo condiviso.')
    offsets.set(id, delta)
  }
  for (const n of data.nodes) if (nonzeroOffset(n.offset)) {
    const anchor = nodeAt.get(n.id)
    if (!anchor) continue
    const o = readCentreOffset(n.offset)
    if (Math.hypot(...anchor.map((v, i) => v - o.anchor[i])) > Math.max(1e-5, spacing * .05))
      throw Error('Ancora del nodo cambiata: riagganciare prima di spostare.')
    putTarget(n.id, anchor.map((v, i) => v + offsetDelta(o)[i]) as Vec3)
  }
  // Split sides retain the same original sample indices and displaced endpoints.
  for (const c of graph.curves) if (c.fitPoints) {
    const p = c.fitPoints.points, last = p.length - 3
    putTarget(c.from, [p[0], p[1], p[2]])
    putTarget(c.to, [p[last], p[last+1], p[last+2]])
  }
  const centres = (split?.centres ?? []).map(c => {
    const raw = data.cells[c.cell]?.centreOffset
    if (!raw) return { ...c, at: [...c.at] as Vec3 }
    const o = readCentreOffset(raw)
    if (Math.hypot(...c.at.map((v, i) => v - o.anchor[i])) > Math.max(1e-5, spacing * .05))
      throw Error('Ancora del centro cambiata: riagganciare prima di spostare.')
    const at = [...centreOffsetPoint(o)] as Vec3
    putTarget(c.node, at)
    return { ...c, at }
  })
  data.cells.forEach((c, i) => {
    if (c.centreOffset && !split?.centres.some(x => x.cell === i))
      throw Error('La quota normale richiede un centro interno di una cella suddivisa.')
  })
  if (!offsets.size && !graph.curves.some(c => c.fitPoints))
    return { graph, centres, spokes: split?.spokes ?? [] }
  const nodes = graph.nodes.map(n => ({ ...n, at: n.at.map((v, i) => v + (offsets.get(n.id)?.[i] ?? 0)) as Vec3 }))
  const curves = graph.curves.map(c => {
    const a: Vec3 = offsets.get(c.from) ?? [0,0,0], b: Vec3 = offsets.get(c.to) ?? [0,0,0]
    if (!c.fitPoints && !a.some(Boolean) && !b.some(Boolean)) return c
    if (c.exact) throw Error('Spostamento 3D su un bordo CAD vincolato non consentito.')
    let own = c.fitPoints
    if (!own) {
      const points = c.trace.points.slice()
      for (let j = 0; j < points.length/3; j++) {
        const delta = blendDelta(a, b, c.trace.length > 0 ? c.trace.at[j]/c.trace.length : 0)
        for (let k = 0; k < 3; k++) points[j*3+k] += delta[k]
      }
      own = curvePoints(points)
    }
    const trace: CurveTrace = { ...c.trace, ...own }
    return { ...c, trace, fit: fitProvisional(trace, spacing) }
  })
  const by = new Map(curves.map(c => [c.id, c]))
  return { graph: { ...graph, nodes, curves }, centres,
    spokes: (split?.spokes ?? []).map(s => ({ ...s, points: by.get(s.curve)?.trace.points ?? s.points })) }
}
