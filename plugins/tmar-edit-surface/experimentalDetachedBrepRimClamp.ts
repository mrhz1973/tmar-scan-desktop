// SPDX-License-Identifier: AGPL-3.0-only
import type { Point } from './brep'
import { clampExperimentalPolynomialBSpline, type ExperimentalPolynomialBSpline } from './experimentalClampedBSplineTrim'

type Range = readonly [number, number]
type Request = { sourceCurve: ExperimentalPolynomialBSpline; range: Range }
type Stop = 'invalid-request' | 'nonexact-clamping' | 'unsupported-detached-brep' | 'unsupported-curve-table' |
  'ambiguous-source-curve' | 'unsupported-vertex-table' | 'unsupported-edge-table' | 'ambiguous-edge-owner' | 'edge-range-or-pcurve-unverified'
const integer = (x: number, maximum: number) => Number.isInteger(x) && x > 0 && x <= maximum
const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]))
const finite = (x: string) => /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(x) && Number.isFinite(Number(x))

function curveSpans(text: string, start: number, end: number, count: number) {
  const tokens = [...text.slice(start, end).matchAll(/\S+/g)]
  if (tokens.some(token => !finite(token[0]))) throw Error()
  let cursor = 0
  const take = () => Number(tokens[cursor++]?.[0])
  const curves = Array.from({ length: count }, () => {
    const first = tokens[cursor]?.index
    const kind = take(), rational = take(), periodic = take(), degree = take(), poleCount = take(), knotCount = take()
    if (first === undefined || kind !== 7 || ![0, 1].includes(rational) || ![0, 1].includes(periodic) || !integer(degree, 25) ||
        !integer(poleCount, 25000) || !integer(knotCount, 25000) || knotCount < 2 ||
        cursor + (3 + rational) * poleCount + 2 * knotCount > tokens.length) throw Error()
    const poles = Array.from({ length: poleCount }, () => {
      const p: Point = [take(), take(), take()]
      if (rational) take()
      return p
    })
    const knots: number[] = [], multiplicities: number[] = []
    for (let i = 0; i < knotCount; i++) { knots.push(take()); multiplicities.push(take()) }
    const last = tokens[cursor - 1]
    return { degree, rational, periodic, poles, knots, multiplicities, start: start + first, end: start + last.index! + last[0].length }
  })
  if (cursor !== tokens.length) throw Error()
  return curves
}

function edges(text: string, edgeCount: number, curveCount: number, uvCount: number, surfaceCount: number) {
  const rows = [...text.matchAll(/^Ed[ \t]*\r?\n([^\r\n]*)\r?\n([\s\S]*?)^0[ \t]*\r?$/gm)]
  if (rows.length !== edgeCount) throw Error()
  const range = (a: string, b: string): Range => {
    if (!finite(a) || !finite(b) || !(Number(a) < Number(b))) throw Error()
    return [Number(a), Number(b)]
  }
  const ref = (id: string, limit: number) => { if (!integer(Number(id), limit)) throw Error(); return Number(id) }
  return rows.map(([, header, body]) => {
    const curves: { index: number; range: Range }[] = [], pcurves: { surface: number; range: Range; seam: boolean }[] = []
    for (const row of body.trim().split(/\r?\n/)) {
      const t = row.trim().split(/\s+/)
      if (t[0] === '1' && t.length === 5 && t[2] === '0') curves.push({ index: ref(t[1], curveCount), range: range(t[3], t[4]) })
      else if (t[0] === '2' && t.length === 6 && t[3] === '0') {
        ref(t[1], uvCount)
        pcurves.push({ surface: ref(t[2], surfaceCount), range: range(t[4], t[5]), seam: false })
      } else if (t[0] === '3') {
        const seam = /^3\s+(\d+)\s+(\d+)\s*(?:CN|C[0-3]|G[12])\s+(\d+)\s+0\s+(\S+)\s+(\S+)$/.exec(row.trim())
        if (!seam) throw Error()
        ref(seam[1], uvCount); ref(seam[2], uvCount)
        pcurves.push({ surface: ref(seam[3], surfaceCount), range: range(seam[4], seam[5]), seam: true })
      } else if (t[0] === '4' && t.length === 6 && /^(?:CN|C[0-3]|G[12])$/.test(t[1]) && t[3] === '0' && t[5] === '0') {
        ref(t[2], surfaceCount); ref(t[4], surfaceCount)
      } else throw Error()
    }
    return { header: header.trim().split(/\s+/), curves, pcurves }
  })
}

/**
 * Replace only a uniquely owned 3D curve-table entry in a detached OCCT
 * BREP V3 face. The target curve must clamp exactly on the existing edge
 * interval. All pcurves, references, tolerances and topology stay bytewise
 * intact. Only B-spline curve-table records and unlocated geometry are
 * supported. Vertices with parametric representations are refused because
 * they can refer to the same curve independently of its edge owner.
 * Geometry evaluation, sewing and STEP readback are separate.
 */
export function clampExperimentalDetachedBrepRim(brep: string, request: Request) {
  const stop = (reason: Stop) => ({ status: 'inconclusive' as const, reason })
  if (!request || !Array.isArray(request.range)) return stop('invalid-request')
  const clamped = clampExperimentalPolynomialBSpline(request.sourceCurve, request.range)
  if (clamped.status !== 'converted') return stop('invalid-request')
  if (!clamped.exactInBinary64) return stop('nonexact-clamping')
  if (typeof brep !== 'string' || brep.length > 8_000_000 || !/^CASCADE Topology V3/m.test(brep) ||
      !/^Locations 0[ \t]*\r?$/m.test(brep) || !/[\r\n][+-]1 0[ \t\r\n]*$/.test(brep)) return stop('unsupported-detached-brep')
  const header = /^Curves (\d+)[ \t]*\r?\n/m.exec(brep), next = /^Polygon3D 0[ \t]*\r?$/m.exec(brep)
  const uvCount = Number(/^Curve2ds (\d+)[ \t]*\r?$/m.exec(brep)?.[1])
  const surfaceCount = Number(/^Surfaces (\d+)[ \t]*\r?$/m.exec(brep)?.[1])
  const top = /^TShapes (\d+)[ \t]*\r?\n/m.exec(brep)
  if (!header || !next || !top || !(header.index < next.index && next.index < top.index) ||
      !integer(Number(header[1]), 512) || !integer(uvCount, 1024) || !integer(surfaceCount, 512) ||
      !/^PolygonOnTriangulations 0[ \t]*\r?$/m.test(brep) || !/^Triangulations 0[ \t]*\r?$/m.test(brep)) return stop('unsupported-detached-brep')
  const topology = brep.slice(top.index + top[0].length), kinds = [...topology.matchAll(/^(Ve|Ed|Wi|Fa)[ \t]*\r?$/gm)]
  const face = [...topology.matchAll(/^Fa[ \t]*\r?\n\s*[01]\s+\S+\s+(\d+)\s+0[ \t]*\r?$/gm)]
  const ownSurface = Number(face[0]?.[1])
  if (kinds.length !== Number(top[1]) || kinds.at(-1)?.[1] !== 'Fa' || kinds.filter(kind => kind[1] === 'Fa').length !== 1 ||
      face.length !== 1 || !integer(ownSurface, surfaceCount)) return stop('unsupported-detached-brep')
  // A BREP vertex can carry PointOnCurve records into the shared Curves table.
  // This adapter only handles vertices whose representation list is empty.
  const vertices = [...topology.matchAll(/^Ve[ \t]*\r?\n([^\r\n]+)\r?\n([^\r\n]+)\r?\n[ \t]*0[ \t]+0[ \t]*\r?$/gm)]
  if (vertices.length !== kinds.filter(kind => kind[1] === 'Ve').length || vertices.some(([, tolerance, point]) => {
    const xyz = point.trim().split(/\s+/)
    return !finite(tolerance.trim()) || Number(tolerance) < 0 || xyz.length !== 3 || !xyz.every(finite)
  })) return stop('unsupported-vertex-table')
  let curves: ReturnType<typeof curveSpans>
  try { curves = curveSpans(brep, header.index + header[0].length, next.index, Number(header[1])) }
  catch { return stop('unsupported-curve-table') }
  const source = request.sourceCurve
  const matching = curves.flatMap((c, i) => !c.periodic && !c.rational && c.degree === source.degree && same(c.knots, source.knots) &&
    same(c.multiplicities, source.multiplicities) && c.poles.length === source.poles.length &&
    c.poles.every((p, j) => same(p, source.poles[j])) ? [i] : [])
  if (matching.length !== 1) return stop('ambiguous-source-curve')
  const index = matching[0] + 1
  let topologyEdges: ReturnType<typeof edges>
  try { topologyEdges = edges(topology, kinds.filter(kind => kind[1] === 'Ed').length, curves.length, uvCount, surfaceCount) }
  catch { return stop('unsupported-edge-table') }
  const owners = topologyEdges.filter(edge => edge.curves.some(curve => curve.index === index))
  if (owners.length !== 1 || owners[0].curves.length !== 1) return stop('ambiguous-edge-owner')
  const owner = owners[0], tolerance = Number(owner.header[0])
  if (!finite(owner.header[0]) || tolerance < 0 || tolerance > 1e-6 || owner.header.slice(1).join() !== '1,1,0' ||
      !same(owner.curves[0].range, request.range) || owner.pcurves.filter(p => p.surface === ownSurface).length !== 1 ||
      owner.pcurves.some(p => p.seam || !same(p.range, request.range))) return stop('edge-range-or-pcurve-unverified')
  const { degree, knots, multiplicities, poles } = clamped.curve, span = curves[index - 1]
  const replacement = [`7 0 0 ${degree} ${poles.length} ${knots.length}`, ...poles.map(p => p.join(' ')),
    ...knots.map((knot, i) => `${knot} ${multiplicities[i]}`)].join('\n')
  return { status: 'rewritten' as const, brep: brep.slice(0, span.start) + replacement + brep.slice(span.end), curveIndex: index }
}
