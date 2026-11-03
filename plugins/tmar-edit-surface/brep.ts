// SPDX-License-Identifier: AGPL-3.0-only
// OCCT V3 ASCII surface table. Edits replace one support-surface record;
// knot insertion can refine its control net exactly before pole movement.
// This adapter leaves topology/pcurve records intact; unsupported records fail closed.
export type Point = [number, number, number]
export interface Net {
  nu: number; nv: number; du: number; dv: number
  poles: Point[]; weights: number[]; rational: [number, number]
  ku: number[]; kv: number[]; mu: number[]; mv: number[]
}
export interface RecordSpan { start: number; end: number; kind: number; values: number[]; net?: Net }
export function surfaceTable(brep: string): RecordSpan[] {
  if (!brep.includes('CASCADE Topology V3') || !/^Locations 0\s*$/m.test(brep)) throw new Error('BREP con trasformazioni o versione non supportata. Esportare prima il corpo in STEP.')
  const header = /^Surfaces (\d+)\s*$/m.exec(brep)
  if (!header) throw new Error('Tabella superfici assente.')
  const begin = header.index + header[0].length, end = brep.indexOf('Triangulations ', begin)
  if (end < 0) throw new Error('Tabella superfici incompleta.')
  const tokens = [...brep.slice(begin, end).matchAll(/\S+/g)].map(m => ({ value: Number(m[0]), start: begin + m.index!, end: begin + m.index! + m[0].length }))
  let cursor = 0
  const take = () => { const t = tokens[cursor++]; if (!t || !Number.isFinite(t.value)) throw new Error('Record BREP non valido.'); return t.value }
  const integer = (min: number, max: number) => { const n = take(); if (!Number.isInteger(n) || n < min || n > max) throw new Error('Dimensione BREP non supportata.'); return n }
  const skip = (n: number) => { for (let i = 0; i < n; i++) take() }
  const record = (): RecordSpan => {
    const first = cursor, kind = integer(1, 11)
    let net: Net | undefined
    if (kind <= 5) skip([0, 12, 13, 14, 13, 14][kind])
    else if (kind === 9 || kind === 8) {
      const rational: [number, number] = [integer(0, 1), integer(0, 1)]
      const periodic = kind === 9 ? [integer(0, 1), integer(0, 1)] : [0, 0]
      const du = integer(1, 25), dv = integer(1, 25)
      const nu = kind === 9 ? integer(2, 500) : du + 1, nv = kind === 9 ? integer(2, 500) : dv + 1
      const nku = kind === 9 ? integer(2, 1000) : 2, nkv = kind === 9 ? integer(2, 1000) : 2
      if (nu * nv > 25000) throw new Error('Reticolo troppo grande per questo editor.')
      const poles: Point[] = [], weights: number[] = []
      for (let i = 0; i < nu * nv; i++) { poles.push([take(), take(), take()]); const w = rational.some(Boolean) ? take() : 1; if (w <= 0) throw new Error('Peso NURBS non positivo.'); weights.push(w) }
      const ku: number[] = [], kv: number[] = [], mu: number[] = [], mv: number[] = []
      if (kind === 9) {
        for (let i = 0; i < nku; i++) { ku.push(take()); mu.push(integer(1, du + 1)) }
        for (let i = 0; i < nkv; i++) { kv.push(take()); mv.push(integer(1, dv + 1)) }
      }
      if (kind === 9 && !periodic.some(Boolean)) net = { nu, nv, du, dv, poles, weights, rational, ku, kv, mu, mv }
    } else if (kind === 10) { skip(4); record() }
    else if (kind === 11) { skip(1); record() }
    else throw new Error('Superfici di rivoluzione/estrusione generiche non ancora supportate dall’adattatore.')
    return { start: tokens[first].start, end: tokens[cursor - 1].end, kind, values: tokens.slice(first, cursor).map(t => t.value), net }
  }
  const count = Number(header[1]); if (count > 10000) throw new Error('Troppe superfici.')
  const records = Array.from({ length: count }, record)
  if (cursor !== tokens.length) throw new Error('Dati BREP inattesi dopo le superfici.')
  return records
}
export const signature = (r: RecordSpan) => r.values.join(' ')
export function encodeNet(n: Net): string {
  const poles = n.poles.map((p, i) => [...p, ...(n.rational.some(Boolean) ? [n.weights[i]] : [])].join(' '))
  return `9 ${n.rational.join(' ')} 0 0 ${n.du} ${n.dv} ${n.nu} ${n.nv} ${n.ku.length} ${n.kv.length}\n${poles.join('\n')}\n${n.ku.map((k, i) => `${k} ${n.mu[i]}`).join(' ')}\n${n.kv.map((k, i) => `${k} ${n.mv[i]}`).join(' ')}`
}
export function replaceSurface(brep: string, r: RecordSpan, net: Net): string { return brep.slice(0, r.start) + encodeNet(net) + brep.slice(r.end) }
export function planeNet(r: RecordSpan, bounds: [number, number, number, number]): Net {
  if (r.kind !== 1) throw new Error('Faccia non piana.')
  const [u0, u1, v0, v1] = bounds, a = r.values
  // Cubic, one internal knot: Greville abscissae give an EXACT plane, not a fit.
  const g = [0, 1 / 6, 1 / 2, 5 / 6, 1], poles: Point[] = []
  for (const gu of g) for (const gv of g) { const u = u0 + gu * (u1 - u0), v = v0 + gv * (v1 - v0); poles.push([a[1] + u * a[7] + v * a[10], a[2] + u * a[8] + v * a[11], a[3] + u * a[9] + v * a[12]]) }
  return { nu: 5, nv: 5, du: 3, dv: 3, poles, weights: poles.map(() => 1), rational: [0, 0], ku: [u0, (u0 + u1) / 2, u1], kv: [v0, (v0 + v1) / 2, v1], mu: [4, 1, 4], mv: [4, 1, 4] }
}
// Eight spans keep movement local around a protected trim. Cubic Greville
// coordinates reproduce the original plane exactly in the original UV domain.
export function perforatedPlaneNet(plane: RecordSpan, bounds: [number, number, number, number]): Net {
  const spans = 8, degree = 3, count = spans + degree
  const knots = (min: number, max: number) => Array.from({ length: spans + 1 }, (_, i) =>
    i === spans ? max : min + (max - min) * i / spans)
  const ku = knots(bounds[0], bounds[1]), kv = knots(bounds[2], bounds[3])
  const mult = ku.map((_, i) => i === 0 || i === spans ? 4 : 1)
  const greville = (k: number[]) => {
    const full = k.flatMap((value, i) => Array(mult[i]).fill(value) as number[])
    return Array.from({ length: count }, (_, i) => (full[i+1] + full[i+2] + full[i+3]) / 3)
  }
  const a = plane.values, vs = greville(kv)
  const poles = greville(ku).flatMap(u => vs.map(v =>
    [0,1,2].map(d => a[1+d] + u*a[7+d] + v*a[10+d]) as Point))
  return { nu: count, nv: count, du: degree, dv: degree, poles,
    weights: poles.map(() => 1), rational: [0,0], ku, kv, mu: mult, mv: [...mult] }
}
export function boundaryLocked(n: Net, index: number, continuity: 'G0' | 'G1'): boolean {
  const i = Math.floor(index / n.nv), j = index % n.nv, rings = continuity === 'G1' ? 2 : 1
  return Math.min(i, j, n.nu - 1 - i, n.nv - 1 - j) < rings
}
// Exact midpoint knot insertion in homogeneous coordinates. A bicubic Bezier
// patch has no free poles when both boundary rings are locked for G1. Inserting
// one knot in each direction exposes one interior pole without fitting or
// changing its geometry, parameter domain, degree or boundary derivatives.
export function enrichBicubic(n: Net): Net {
  if (n.nu !== 4 || n.nv !== 4 || n.du !== 3 || n.dv !== 3 ||
      n.ku.length !== 2 || n.kv.length !== 2 ||
      n.mu.join() !== '4,4' || n.mv.join() !== '4,4') return n
  const homogeneous = n.poles.map((p, i) => [...p.map(x => x * n.weights[i]), n.weights[i]])
  const insert = (row: number[][]) => [row[0], ...row.slice(0, 3).map((p, i) => p.map((x, d) => (x + row[i + 1][d]) / 2)), row[3]]
  const alongV = Array.from({ length: 4 }, (_, u) => insert(homogeneous.slice(u * 4, u * 4 + 4)))
  const columns = Array.from({ length: 5 }, (_, v) => insert(alongV.map(row => row[v])))
  const points = Array.from({ length: 25 }, (_, i) => columns[i % 5][Math.floor(i / 5)])
  const midpoint = (knots: number[]) => [knots[0], knots[0] + (knots[1] - knots[0]) / 2, knots[1]]
  return { ...n, nu: 5, nv: 5, poles: points.map(p => p.slice(0, 3).map(x => x / p[3]) as Point),
    weights: points.map(p => p[3]), ku: midpoint(n.ku), kv: midpoint(n.kv), mu: [4, 1, 4], mv: [4, 1, 4] }
}
export function assertNet(base: Net, n: Net, continuity: 'G0' | 'G1') {
  if (n.poles.length !== base.poles.length || JSON.stringify({ ...base, poles: [] }) !== JSON.stringify({ ...n, poles: [] })) throw new Error('Grado, nodi, pesi e parametrizzazione devono restare invariati.')
  n.poles.forEach((p, i) => {
    if (p.length !== 3 || p.some(x => !Number.isFinite(x))) throw new Error('Coordinate non valide.')
    if (boundaryLocked(base, i, continuity) && p.some((x, j) => x !== base.poles[i][j])) throw new Error('Un punto protetto è stato modificato.')
  })
}
