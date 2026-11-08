// SPDX-License-Identifier: AGPL-3.0-only
import type { NurbsCurveData, OcctKernel, ShapeHandle } from 'occt-wasm'
import { encodeNet, type Net, type Point } from '../brep'

const tolerance = 1e-7
type Own = (shape: ShapeHandle) => ShapeHandle

function sideNet(lower: boolean): Net {
  const nu = 16, nv = 4
  const poles = Array.from({ length: nu }, (_, u) => {
    const angle = 2 * Math.PI * u / nu
    // At the U cut both sides are straight in V. The tangency edit can
    // change the rest of the side while retaining the existing seam edge.
    const flare = u < 2 ? 0 : 0.25 * (1 - Math.cos((u - 1) * 2 * Math.PI / (nu - 1)))
    return Array.from({ length: nv }, (_, v): Point => {
      const radius = lower ? 10 : 10 + v * flare
      return [radius * Math.cos(angle), radius * Math.sin(angle), lower ? v - 3 : v]
    })
  }).flat()
  return {
    nu, nv, du: 2, dv: 3, poles, weights: poles.map(() => 1), rational: [0, 0], periodic: [1, 0],
    ku: Array.from({ length: nu + 1 }, (_, u) => u), mu: Array(nu + 1).fill(1),
    kv: lower ? [0, 4] : [7, 9], mv: [4, 4],
  }
}

function rim(n: Net, row: number) {
  return Array.from({ length: n.nu }, (_, u) => n.poles[u * n.nv + row])
}

function insertFixtureKnot(k: OcctKernel, net: Net, knot: number, own: Own): Net {
  const rows = Array.from({ length: net.nv }, (_, v) => {
    const edge = own(k.makeBSplineEdge(rim(net, v).flat(), [], net.ku, net.mu, net.du, true))
    const inserted = k.curveKnotInsert(edge, knot, 1)
    if (inserted !== edge) own(inserted)
    return k.getNurbsCurveData(inserted)
  })
  const { knots: ku, multiplicities: mu } = rows[0]
  const nu = rows[0].poles.length / 3
  const poles = Array.from({ length: nu }, (_, u) => rows.map(row => row.poles.slice(3 * u, 3 * u + 3) as Point)).flat()
  return { ...net, nu, ku, mu, poles, weights: poles.map(() => 1) }
}

export interface ExperimentalPreservedFixtureRim {
  curve: NurbsCurveData
  range: readonly [number, number]
  pcurve: { range: readonly [number, number]; start: readonly [number, number]; end: readonly [number, number] }
}

export function makeExperimentalNaturalPeriodicFixtureSide(k: OcctKernel, n: Net, lowerRim?: ExperimentalPreservedFixtureRim) {
  const v0 = n.kv[0], v1 = n.kv.at(-1)!, u0 = n.ku[0], u1 = n.ku.at(-1)!
  const saturated = n.mu[0] === n.du && n.mu.at(-1) === n.du
  const uniformQuadraticCut = n.du === 2 && n.ku[1] - u0 === u1 - n.ku.at(-2)! &&
    [n.mu[0], n.mu[1], n.mu.at(-2), n.mu.at(-1)].every(m => m === 1)
  if (n.periodic?.[0] !== 1 || n.periodic[1] !== 0 || n.weights.some(w => w !== 1) ||
      n.rational.some(Boolean) || n.mv[0] !== n.dv + 1 || n.mv.at(-1) !== n.dv + 1 ||
      (!saturated && !uniformQuadraticCut)) throw new Error('Unsupported natural periodic fixture basis')
  // Saturated cut uses U0. The other fixture uses a uniform quadratic
  // basis near the cut, where the cut is the average of the first two U poles.
  const seam = saturated ? n.poles.slice(0, n.nv) :
    n.poles.slice(0, n.nv).map((a, v) => a.map((x, d) => (x + n.poles[n.nv + v][d]) / 2))
  const curve = (poles: number[][], knots: number[], mult: number[], degree: number, periodic: number) =>
    [`7 0 ${periodic} ${degree} ${poles.length} ${knots.length}`,
      ...poles.map(p => p.join(' ')), ...knots.map((knot, i) => `${knot} ${mult[i]}`)].join('\n')
  let lowerCurve = curve(rim(n, 0), n.ku, n.mu, n.du, 1)
  let lowerPcurve = `1 0 ${v0} 1 0`, lowerRange: readonly [number, number] = [u0, u1]
  if (lowerRim) {
    const { curve: data, range, pcurve } = lowerRim, [first, last] = range
    if (!saturated || data.periodic || data.rational || data.weights.some(w => w !== 1) ||
        ![...data.poles, ...data.knots, first, last].every(Number.isFinite) || !(last > first) ||
        !(first >= data.knots[0] && last <= data.knots.at(-1)!) ||
        pcurve.range[0] !== first || pcurve.range[1] !== last ||
        pcurve.start[0] !== u0 || pcurve.end[0] !== u1 || pcurve.start[1] !== v0 || pcurve.end[1] !== v0)
      throw new Error('Unsupported preserved rim range or pcurve')
    const poles = Array.from({ length: data.poles.length / 3 }, (_, i) => data.poles.slice(3 * i, 3 * i + 3))
    lowerCurve = curve(poles, data.knots, data.multiplicities, data.degree, 0)
    lowerRange = range
    lowerPcurve = `7 0 0 1 2 2 ${pcurve.start.join(' ')} ${pcurve.end.join(' ')} ${first} 2 ${last} 2`
  }
  const vertex = (point: number[]) => `Ve\n${tolerance}\n${point.join(' ')}\n0 0\n\n0101101\n*`
  // The four uses are upper rim, cut, lower rim, and the reverse cut.
  const result = k.fromBREP(`CASCADE Topology V3, (c) Open Cascade
Locations 0
Curve2ds 4
1 0 ${v1} 1 0
1 ${u1} 0 0 1
1 ${u0} 0 0 1
${lowerPcurve}
Curves 3
${curve(rim(n, n.nv - 1), n.ku, n.mu, n.du, 1)}
${curve(seam, n.kv, n.mv, n.dv, 0)}
${lowerCurve}
Polygon3D 0
PolygonOnTriangulations 0
Surfaces 1
${encodeNet(n)}
Triangulations 0

TShapes 7
${vertex(seam.at(-1)!)}
Ed
 ${tolerance} 1 1 0
1 1 0 ${u0} ${u1}
2 1 1 0 ${u0} ${u1}
0

0101000
+7 0 -7 0 *
${vertex(seam[0])}
Ed
 ${tolerance} 1 1 0
1 2 0 ${v0} ${v1}
3 2 3${saturated ? 'C0' : 'CN'} 1 0 ${v0} ${v1}
0

0101000
-7 0 +5 0 *
Ed
 ${tolerance} 1 1 0
1 3 0 ${lowerRange.join(' ')}
2 4 1 0 ${lowerRange.join(' ')}
0

0101000
+5 0 -5 0 *
Wi

0101100
-6 0 +4 0 +3 0 -4 0 *
Fa
0 ${tolerance} 1 0

0111000
+2 0 *

+1 0
`)
  if (lowerRim) {
    let edges: ShapeHandle[] = []
    try {
      edges = k.getSubShapes(result, 'edge')
      const candidates = edges.filter(edge => {
        const { first, last } = k.curveParameters(edge)
        return k.curveIsClosed(edge) && !k.curveIsPeriodic(edge) && first === lowerRange[0] && last === lowerRange[1]
      })
      if (candidates.length !== 1 || !k.isValid(result)) throw new Error('Preserved rim invalid after reconstruction')
      const edge = candidates[0]
      for (let j = 0; j <= 32; j++) {
        const f = j / 32
        const p = k.curvePointAtParam(edge, lowerRange[0] + f * (lowerRange[1] - lowerRange[0]))
        const q = k.pointOnSurface(result, u0 + f * (u1 - u0), v0)
        if (!(Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) <= tolerance)) throw new Error('Preserved rim geometry mismatch')
      }
    } catch (error) { k.release(result); throw error }
    finally { edges.forEach(edge => k.release(edge)) }
  }
  return result
}

export function makeExperimentalPeriodicClosedSolid(k: OcctKernel, own: Own) {
  const lower = insertFixtureKnot(k, sideNet(true), 3.5, own)
  const upper = insertFixtureKnot(k, sideNet(false), 11.5, own)
  const cap = (net: Net, row: number) => {
    const edge = own(k.makeBSplineEdge(rim(net, row).flat(), [], net.ku, net.mu, net.du, true))
    return own(k.makeFace(own(k.makeWire([edge]))))
  }
  const faces = [own(makeExperimentalNaturalPeriodicFixtureSide(k, lower)), own(makeExperimentalNaturalPeriodicFixtureSide(k, upper)), cap(lower, 0), cap(upper, upper.nv - 1)]
  if (faces.some(face => !k.isValid(face))) throw new Error('Invalid fixture face')
  return own(k.sewAndSolidify(faces, tolerance))
}
