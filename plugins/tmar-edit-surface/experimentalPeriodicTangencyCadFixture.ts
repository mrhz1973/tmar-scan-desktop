// SPDX-License-Identifier: AGPL-3.0-only
import type { OcctKernel, ShapeHandle, Vec3 } from 'occt-wasm'
import { encodeNet, surfaceTable, type Net, type Point } from './brep'
import { refineExperimentalPeriodicSurfaceU } from './experimentalPeriodicSurfaceRefinement'
import { proposeExperimentalPeriodicTangency } from './experimentalPeriodicTangency'
import { verifyExperimentalPeriodicTangencyReplay } from './experimentalPeriodicTangencyReplay'

const tolerance = 1e-7
const fail = (reason: string): never => { throw new Error(`Fixture CAD periodica rifiutata: ${reason}`) }
const gap = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

function fixtureNet(selected: boolean): Net {
  // Same flared/cylindrical seam scenario as the coefficient fixtures, with a
  // uniform polynomial U basis to construct the two natural topologies exactly.
  const nu = 16, nv = 4
  const poles = Array.from({ length: nu }, (_, u) => {
    const angle = 2 * Math.PI * u / nu, x = Math.cos(angle), y = Math.sin(angle)
    return Array.from({ length: nv }, (_, v): Point => {
      const distance = selected ? 3 - v : v
      const radius = selected ? 10 : 10 + distance * (0.25 + x / 8)
      return [radius * x, radius * y, (selected ? -distance : distance) * (1 + y / 8)]
    })
  }).flat()
  return { nu, nv, du: 2, dv: 3, poles, weights: poles.map(() => 1), rational: [0, 0], periodic: [1, 0],
    ku: Array.from({ length: nu + 1 }, (_, u) => u), mu: Array(nu + 1).fill(1),
    kv: selected ? [0, 4] : [7, 9], mv: [4, 4] }
}

/**
 * Materialize the entire natural face of the synthetic polynomial fixture.
 * Both rim curves are clamped-V isocurves. At the locally uniform cut of the
 * quadratic U basis, the seam poles are the averages of the first two U rows.
 * The BREP has two rim edges and one seam edge with two distinct pcurves.
 */
function fixtureFace(k: OcctKernel, n: Net): ShapeHandle {
  const [v0, v1] = n.kv, u0 = n.ku[0], u1 = n.ku.at(-1)!
  const rim = (row: number) => Array.from({ length: n.nu }, (_, u) => n.poles[u * n.nv + row])
  // The fixture's inserted knots stay away from the cut. Require the same
  // quadratic basis there before using the two-pole average for the seam.
  if (n.du !== 2 || n.rational.some(Boolean) || n.ku[1] - u0 !== 1 || u1 - n.ku.at(-2)! !== 1 ||
      [n.mu[0], n.mu[1], n.mu.at(-2), n.mu.at(-1)].some(m => m !== 1))
    return fail('base della cucitura U inattesa')
  const seam = n.poles.slice(0, n.nv).map((a, v) => a.map((x, d) => (x + n.poles[n.nv + v][d]) / 2))
  const curve = (poles: number[][], knots: number[], mult: number[], degree: number, periodic: number) =>
    [`7 0 ${periodic} ${degree} ${poles.length} ${knots.length}`,
      ...poles.map(p => p.join(' ')), ...knots.map((knot, i) => `${knot} ${mult[i]}`)].join('\n')
  const vertex = (point: number[]) => `Ve\n${tolerance}\n${point.join(' ')}\n0 0\n\n0101101\n*`
  // The two oriented uses of edge 4 close the single wire at the U cut.
  return k.fromBREP(`CASCADE Topology V3, (c) Open Cascade
Locations 0
Curve2ds 4
1 0 ${v1} 1 0
1 ${u1} 0 0 1
1 ${u0} 0 0 1
1 0 ${v0} 1 0
Curves 3
${curve(rim(n.nv - 1), n.ku, n.mu, n.du, 1)}
${curve(seam, n.kv, n.mv, n.dv, 0)}
${curve(rim(0), n.ku, n.mu, n.du, 1)}
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
3 2 3CN 1 0 ${v0} ${v1}
0

0101000
-7 0 +5 0 *
Ed
 ${tolerance} 1 1 0
1 3 0 ${u0} ${u1}
2 4 1 0 ${u0} ${u1}
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
}

// Build the mismatched sources by inserting one different interior knot in
// each face, independently of the common-basis routine under test. The two
// insertions have disjoint local supports, keeping the shared rim coefficients
// exactly equal when the common basis is computed in either order.
function insertFixtureKnot(k: OcctKernel, net: Net, knot: number, own: (shape: ShapeHandle) => ShapeHandle): Net {
  const rows = Array.from({ length: net.nv }, (_, v) => {
    const poles = Array.from({ length: net.nu }, (_, u) => net.poles[u * net.nv + v]).flat()
    const edge = own(k.makeBSplineEdge(poles, [], net.ku, net.mu, net.du, true))
    const inserted = k.curveKnotInsert(edge, knot, 1)
    if (inserted !== edge) own(inserted)
    return k.getNurbsCurveData(inserted)
  })
  const { knots: ku, multiplicities: mu } = rows[0]
  const nu = rows[0].poles.length / 3
  const poles = Array.from({ length: nu }, (_, u) => rows.map(row => row.poles.slice(3 * u, 3 * u + 3) as Point)).flat()
  return { ...net, nu, ku, mu, poles, weights: poles.map(() => 1) }
}

function readNet(k: OcctKernel, face: ShapeHandle): Net {
  const brep = k.toBREP(face)
  // A sewn rim stores pcurves on both supports, so the face's record index
  // identifies the support even when its serialized table contains both.
  const headers = [...brep.matchAll(/^Fa\s*\n[ \t]*[01][ \t]+\S+[ \t]+(\d+)[ \t]+0[ \t]*\r?$/gm)]
  if (headers.length !== 1) return fail('supporto proprio ambiguo')
  return surfaceTable(brep)[Number(headers[0][1]) - 1]?.periodicNet ?? fail('supporto periodico proprio assente')
}

function normalSin(a: Vec3, b: Vec3) {
  const length = Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z)
  if (!(length > 0) || !(a.x * b.x + a.y * b.y + a.z * b.z > 0))
    return fail('normali non regolari o discordi')
  return Math.hypot(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x) / length
}

/** Build, apply, and validate the fixed two-face fixture in a disposable kernel session. */
export function runExperimentalPeriodicTangencyCadFixture(k: OcctKernel) {
  return runCadFixture(k, false)
}

/** Bring two different U bases together before applying and replaying tangency. */
export function runExperimentalPeriodicRefinementTangencyCadFixture(k: OcctKernel) {
  return runCadFixture(k, true)
}

function runCadFixture(k: OcctKernel, refine: boolean) {
  const handles: ShapeHandle[] = []
  const own = (shape: ShapeHandle) => { handles.push(shape); return shape }
  const children = (shape: ShapeHandle, kind: 'face' | 'wire') =>
    k.getSubShapes(shape, kind).map(own)
  const opposite = (edges: ShapeHandle[]) =>
    edges.length === 2 && edges.map(edge => k.shapeOrientation(edge)).sort().join() === 'forward,reversed'
  const checkFace = (face: ShapeHandle, net: Net) => {
    const { uMin, uMax, vMin, vMax } = k.uvBounds(face)
    const expected = [net.ku[0], net.ku.at(-1)!, net.kv[0], net.kv.at(-1)!]
    const wires = children(face, 'wire')
    if (!k.isFace(face) || !k.isValid(face) || wires.length !== 1 ||
        k.subShapeCount(face, 'edge') !== 3 || k.subShapeCount(face, 'vertex') !== 2 ||
        ![uMin, uMax, vMin, vMax].every((value, i) => Math.abs(value - expected[i]) <= tolerance))
      fail('faccia naturale non valida')
    // Direct wire children preserve both uses of the same U seam edge.
    const uses = k.iterShapes(wires[0]).map(own)
    const seam = uses.filter(a => uses.filter(b => k.isSame(a, b)).length === 2)
    if (uses.length !== 4 || !opposite(seam) || k.curveIsClosed(seam[0]))
      fail('usi della cucitura U non validi')
    if (readNet(k, face).periodic?.join() !== '1,0') fail('periodicità U non conservata')
    for (const t of [0, 0.125, 0.5, 0.875, 1]) {
      const v = vMin + (vMax - vMin) * t
      if (!(gap(k.pointOnSurface(face, uMin, v), k.pointOnSurface(face, uMax, v)) <= tolerance &&
          normalSin(k.surfaceNormal(face, uMin, v), k.surfaceNormal(face, uMax, v)) <= tolerance))
        fail('chiusura periodica campionata non verificata')
    }
    return uses
  }
  const sampleU = (knots: number[]) => knots.flatMap((u, i) => i === knots.length - 1
    ? [u] : [u, ...[0.125, 0.5, 0.875].map(t => u + (knots[i + 1] - u) * t)])
  const sample = (selected: ShapeHandle, support: ShapeHandle, net: Net, supportNet: Net) => {
    let maxGapMm = 0, maxNormalSin = 0
    const uValues = sampleU([...new Set([...net.ku, ...supportNet.ku])].sort((a, b) => a - b))
    const selectedV = net.kv.at(-1)!, supportV = supportNet.kv[0]
    for (const u of uValues) {
      maxGapMm = Math.max(maxGapMm, gap(k.pointOnSurface(selected, u, selectedV), k.pointOnSurface(support, u, supportV)))
      maxNormalSin = Math.max(maxNormalSin, normalSin(k.surfaceNormal(selected, u, selectedV), k.surfaceNormal(support, u, supportV)))
    }
    if (!(maxGapMm <= tolerance)) fail('distanza campionata al bordo oltre tolleranza')
    return { samples: uValues.length, maxGapMm, maxNormalSin }
  }
  const inspectShell = (shell: ShapeHandle, net: Net, supportNet: Net) => {
    const faces = children(shell, 'face')
    if (!k.isShell(shell) || k.shapeOrientation(shell) !== 'forward' || !k.isValid(shell) ||
        k.subShapeCount(shell, 'solid') !== 0 || faces.length !== 2 ||
        k.subShapeCount(shell, 'edge') !== 5 || k.subShapeCount(shell, 'vertex') !== 3)
      fail('guscio aperto a due facce non valido')
    const selected = faces.find(face => Math.abs(k.uvBounds(face).vMax - net.kv.at(-1)!) <= tolerance)
    const support = faces.find(face => Math.abs(k.uvBounds(face).vMin - supportNet.kv[0]) <= tolerance)
    if (selected === undefined || support === undefined || selected === support) return fail('ruoli delle facce ambigui')
    if ([selected, support].some(face => k.shapeOrientation(face) !== 'forward'))
      fail('orientamento delle facce rispetto alla fixture non conservato')
    const uses = [...checkFace(selected, net), ...checkFace(support, supportNet)]
    const shared = k.sharedEdges(selected, support).map(own)
    if (shared.length !== 1 || !k.curveIsClosed(shared[0]) || !k.curveIsPeriodic(shared[0]))
      fail('bordo periodico comune assente o ambiguo')
    if (!opposite(uses.filter(edge => k.isSame(edge, shared[0]))))
      fail('incidenza del bordo comune non valida')
    const { first, last } = k.curveParameters(shared[0])
    for (const t of [first, first + (last - first) / 3, first + 2 * (last - first) / 3]) {
      const point = k.curvePointAtParam(shared[0], t)
      for (const [face, v] of [[selected, net.kv.at(-1)!], [support, supportNet.kv[0]]] as const) {
        const uv = k.uvFromPoint(face, point)
        if (!(Math.abs(uv.v - v) <= tolerance && gap(k.pointOnSurface(face, uv.u, v), point) <= tolerance))
          fail('bordo topologico comune diverso dalla giunzione naturale')
      }
    }
    return { selected, support, seam: sample(selected, support, net, supportNet) }
  }
  const requestParameters = { edge: 'V1', supportEdge: 'V0', scale: 0.5 } as const
  const checkUnrefinedProposal = (net: Net, supportNet: Net) => {
    try {
      proposeExperimentalPeriodicTangency({ net, supportNet, ...requestParameters })
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Tangenza periodica rifiutata: basi U diverse'))
        return true as const
      throw error
    }
    return fail('proposta accettata con basi U sorgente diverse')
  }

  try {
    const seed = (selected: boolean) => {
      const net = fixtureNet(selected)
      return refine ? insertFixtureKnot(k, net, selected ? 3.5 : 11.5, own) : net
    }
    const selected = own(fixtureFace(k, seed(true))), support = own(fixtureFace(k, seed(false)))
    const selectedBrep = k.toBREP(selected), supportBrep = k.toBREP(support)
    const sourceNet = readNet(k, selected), sourceSupportNet = readNet(k, support)
    if ([selected, support].some(face => k.shapeOrientation(face) !== 'forward'))
      fail('orientamento iniziale delle facce inatteso')
    if (refine) {
      checkFace(selected, sourceNet)
      checkFace(support, sourceSupportNet)
    }
    const before = inspectShell(own(k.sew([own(k.copy(selected)), own(k.copy(support))], tolerance)), sourceNet, sourceSupportNet)
    const mismatchedBasesRefused = refine && checkUnrefinedProposal(sourceNet, sourceSupportNet)
    const common = refine ? refineExperimentalPeriodicSurfaceU(k, sourceNet, sourceSupportNet) :
      { left: sourceNet, right: sourceSupportNet }
    const net = common.left, supportNet = common.right
    const sameNet = (a: Net, b: Net) => encodeNet(a) === encodeNet(b)
    const refinedSelected = refine ? own(fixtureFace(k, net)) : selected
    const refinedSupport = refine ? own(fixtureFace(k, supportNet)) : support
    const compareRefined = (source: ShapeHandle, refined: ShapeHandle, n: Net) => {
      checkFace(refined, n)
      if (!sameNet(readNet(k, refined), n)) fail('coefficienti della base comune modificati in BREP')
      let maxGapMm = 0, maxNormalSin = 0, samples = 0
      for (const u of sampleU(n.ku)) for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
        const v = n.kv[0] + (n.kv.at(-1)! - n.kv[0]) * fraction
        maxGapMm = Math.max(maxGapMm, gap(k.pointOnSurface(source, u, v), k.pointOnSurface(refined, u, v)))
        maxNormalSin = Math.max(maxNormalSin, normalSin(k.surfaceNormal(source, u, v), k.surfaceNormal(refined, u, v)))
        samples++
      }
      if (!(maxGapMm <= tolerance && maxNormalSin <= tolerance)) fail('geometria campionata modificata dal raffinamento')
      return { samples, maxGapMm, maxNormalSin }
    }
    const refinement = refine ? {
      mismatchedBasesRefused,
      sourceKnots: [sourceNet.ku, sourceSupportNet.ku],
      commonKnots: net.ku,
      commonMultiplicities: net.mu,
      selected: compareRefined(selected, refinedSelected, net),
      support: compareRefined(support, refinedSupport, supportNet),
    } : undefined
    const request = { net, supportNet, ...requestParameters }
    const proposal = proposeExperimentalPeriodicTangency(request)
    const replay = verifyExperimentalPeriodicTangencyReplay(k, refinedSelected, request, proposal.net)
    const edited = own(fixtureFace(k, proposal.net))
    const result = own(k.sew([edited, own(k.copy(refinedSupport))], tolerance))
    const after = inspectShell(result, net, supportNet)
    if (!sameNet(readNet(k, after.selected), proposal.net) || !sameNet(readNet(k, after.support), supportNet))
      fail('coefficienti modificati durante la costruzione del guscio')
    const step = k.exportStep(result)
    const reopened = inspectShell(own(k.importStep(step)), net, supportNet)
    if (!(before.seam.maxNormalSin > 0.25 && after.seam.maxNormalSin <= tolerance && reopened.seam.maxNormalSin <= tolerance))
      fail('correzione G1 campionata non verificata')
    for (const u of net.ku) {
      const v = net.kv[0]
      if (!(gap(k.pointOnSurface(before.selected, u, v), k.pointOnSurface(after.selected, u, v)) <= tolerance &&
          normalSin(k.surfaceNormal(before.selected, u, v), k.surfaceNormal(after.selected, u, v)) <= tolerance))
        fail('bordo opposto modificato')
    }
    let maxStepSurfaceGapMm = 0
    for (const [face, imported, n] of [[after.selected, reopened.selected, net], [after.support, reopened.support, supportNet]] as const) {
      for (const u of n.ku.slice(0, -1).map((knot, i) => (knot + n.ku[i + 1]) / 2)) {
        for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
          const v = n.kv[0] + (n.kv.at(-1)! - n.kv[0]) * fraction
          maxStepSurfaceGapMm = Math.max(maxStepSurfaceGapMm, gap(k.pointOnSurface(face, u, v), k.pointOnSurface(imported, u, v)))
        }
      }
    }
    if (!(maxStepSurfaceGapMm <= tolerance)) fail('geometria campionata modificata durante il passaggio STEP')
    if (k.toBREP(selected) !== selectedBrep || k.toBREP(support) !== supportBrep)
      fail('facce sorgente modificate')
    return { scope: 'synthetic-two-face-open-shell' as const, sourceFacesPreserved: true as const,
      globalG1Certified: false as const, ...(refinement && { refinement }), replay, step, maxStepSurfaceGapMm,
      before: before.seam, after: after.seam, reopened: reopened.seam }
  } finally {
    handles.reverse().forEach(handle => k.release(handle))
  }
}
