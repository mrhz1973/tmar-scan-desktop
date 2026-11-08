// SPDX-License-Identifier: AGPL-3.0-only
import { OcctKernel, type ShapeHandle, type Vec3 } from 'occt-wasm'
import { expect, it } from 'vitest'
import { encodeNet, signature, surfaceTable, type Net, type Point } from '../brep'
import { exclusiveFaceSurface } from '../exclusiveSurface'
import { prepareExperimentalPeriodicUBasis } from '../experimentalPeriodicUBasis'
import { makeExperimentalNaturalPeriodicFixtureSide } from './experimentalPeriodicClosedSolid.fixture'

const ring = [[10, 0], [10, 8], [0, 10], [-10, 0], [0, -10], [10, -8]]
const tolerance = 1e-7
const gap = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const netSignature = (net: Net) => encodeNet(net).trim().split(/\s+/).map(Number).join(' ')

function band(first: number, last: number, radius: number, editRow?: number): Net {
  const poles = ring.flatMap(([x, y]) => Array.from({ length: 6 }, (_, v): Point => {
    const scale = radius + (v === editRow ? 1 / 512 : 0)
    return [x * scale, y * scale, first + (last - first) * v / 5]
  }))
  return { poles, nu: 6, nv: 6, du: 2, dv: 5, ku: [0, 1, 2, 3, 4, 5], mu: [2, 1, 1, 1, 1, 2],
    kv: [first, last], mv: [6, 6], weights: poles.map(() => 1), rational: [0, 0], periodic: [1, 0] }
}

function sectionArea(knots: number[], point: (u: number) => number[]) {
  const cross = (a: number[], b: number[]) => a[0] * b[1] - a[1] * b[0]
  return knots.slice(0, -1).reduce((area, left, i) => {
    const right = knots[i + 1], a = point(left), b = point((left + right) / 2), c = point(right)
    // Reconstruct the quadratic in local coordinates. Simpson integrates
    // its degree-two Green's theorem integrand exactly in real arithmetic.
    const d1 = a.map((x, axis) => 4 * b[axis] - 3 * x - c[axis])
    const d2 = a.map((x, axis) => 2 * (c[axis] + x - 2 * b[axis]))
    return area + (cross(a, d1) + 4 * cross(b, d1.map((x, axis) => x + d2[axis])) +
      cross(c, d1.map((x, axis) => x + 2 * d2[axis]))) / 12
  }, 0)
}

function modelSectionArea(net: Net) {
  const basis = prepareExperimentalPeriodicUBasis(net.du, net.ku, net.mu)
  return sectionArea(net.ku, u => {
    const { indices, values } = basis.evaluate(u)
    return [0, 1].map(axis => indices.reduce((sum, i, j) => sum + values[j] * net.poles[i * net.nv][axis], 0))
  })
}

// Gauss–Legendre on [-1, 1], exact through degree 11 in real arithmetic.
const gaussPairs = [[0.2386191860831969, 0.4679139345726910], [0.6612093864662645, 0.3607615730481386],
  [0.9324695142031521, 0.1713244923791704]]

it('round-trips both moving seams under an independent sectional volume check on a hollow solid', async () => {
  const k = await OcctKernel.init(), handles: ShapeHandle[] = []
  const own = (shape: ShapeHandle) => { handles.push(shape); return shape }
  const face = (net: Net) => own(makeExperimentalNaturalPeriodicFixtureSide(k, net))
  const uses = (f: ShapeHandle) => k.getSubShapes(f, 'wire').map(own).flatMap(w => k.iterShapes(w).map(own))
  const wire = (net: Net, row: number) => own(k.makeWire([own(k.makeBSplineEdge(
    Array.from({ length: net.nu }, (_, u) => net.poles[u * net.nv + row]).flat(), [], net.ku, net.mu, net.du, true,
  ))]))
  const cap = (outer: Net, row: number, inner: Net) => own(k.addHolesInFace(own(k.makeFace(wire(outer, row))),
    [own(k.reverseShape(wire(inner, row)))]))
  const solid = (faces: ShapeHandle[]) => own(k.sewAndSolidify(faces, tolerance))
  const counts = (shape: ShapeHandle) => (['solid', 'shell', 'face', 'wire', 'edge', 'vertex'] as const)
    .map(kind => k.subShapeCount(shape, kind))
  function inspect(shape: ShapeHandle) {
    expect(k.isSolid(shape)).toBe(true)
    expect(k.isValid(shape)).toBe(true)
    const faces = k.getSubShapes(shape, 'face').map(own), text = k.toBREP(shape)
    expect(faces).toHaveLength(6)
    const occurrences = faces.flatMap(uses)
    for (const edge of k.getSubShapes(shape, 'edge').map(own))
      expect(occurrences.filter(use => k.isSame(use, edge)).map(use => k.shapeOrientation(use)).sort())
        .toEqual(['forward', 'reversed'])
    const sides = faces.filter(f => k.surfaceType(f) === 'bspline').sort((a, b) =>
      k.getSurfaceCenterOfMass(a).z - k.getSurfaceCenterOfMass(b).z)
    const lateral = (vMin: number, vMax: number) => {
      const matching = sides.filter(f => k.uvBounds(f).vMin === vMin && k.uvBounds(f).vMax === vMax)
      expect(matching).toHaveLength(1)
      return matching[0]
    }
    const outer = [lateral(0, 5), lateral(5, 10), lateral(10, 15)], inner = lateral(0, 15)
    const caps = faces.filter(f => !sides.includes(f)).sort((a, b) => k.getSurfaceCenterOfMass(a).z - k.getSurfaceCenterOfMass(b).z)
    const protectedFaces = [outer[1], inner, ...caps]
    const record = (f: ShapeHandle) => exclusiveFaceSurface(text, k.toBREP(f), faces.length)
    const named = [...outer, inner, ...caps]
    const expectedLinks = ['0-1', '0-4', '1-2', '2-5', '3-4', '3-5']
    for (const [i, left] of named.entries()) for (let j = i + 1; j < named.length; j++) {
      const common = k.sharedEdges(left, named[j]).map(own)
      expect(common).toHaveLength(expectedLinks.includes(`${i}-${j}`) ? 1 : 0)
      if (common.length) expect(k.curveIsClosed(common[0])).toBe(true)
    }
    return { outer, inner, caps, protectedFaces, record, text, orientations: named.map(f => k.shapeOrientation(f)) }
  }
  function capMeasurements(f: ShapeHandle) {
    const edges = uses(f)
    expect(edges).toHaveLength(2)
    const z = k.getSurfaceCenterOfMass(f).z
    for (const [x, expected] of [[0, 'out'], [8, 'in'], [12, 'out']] as const) {
      const { u, v } = k.uvFromPoint(f, { x, y: 0, z })
      expect(k.classifyPointOnFace(f, u, v)).toBe(expected)
    }
    const areas = edges.map(edge => {
      const curve = k.getNurbsCurveData(edge), range = k.curveParameters(edge)
      expect(curve.degree).toBe(2)
      expect([range.first, range.last]).toEqual([curve.knots[0], curve.knots.at(-1)])
      return Math.abs(sectionArea(curve.knots, u => {
        const { x, y } = k.curvePointAtParam(edge, u)
        return [x, y]
      }))
    }).sort((a, b) => a - b)
    return { inner: areas[0], outer: areas[1], green: areas[1] - areas[0], occt: k.getSurfaceArea(f) }
  }
  function integrateCadSide(f: ShapeHandle, knots: number[]) {
    const { vMin, vMax } = k.uvBounds(f), midpoint = (vMin + vMax) / 2, half = (vMax - vMin) / 2
    // The fixture has z=v. Use actual CAD-evaluated sections, no poles or
    // mass properties. Each U piece is quadratic and each area in V has
    // degree ten, so the spanwise Green and Gauss rules fit the fixture.
    return half * gaussPairs.reduce((sum, [node, weight]) => sum + weight * [-1, 1].reduce((pairSum, sign) => {
      const v = midpoint + sign * half * node
      return pairSum + sectionArea(knots, u => {
        const { x, y, z } = k.pointOnSurface(f, u, v)
        expect(z).toBeCloseTo(v, 11)
        return [x, y]
      })
    }, 0), 0)
  }
  function checkCut(f: ShapeHandle, expectedSupport: string) {
    const all = uses(f), cut = all.filter(edge => all.filter(other => k.isSame(edge, other)).length === 2)
    expect(cut.map(edge => k.shapeOrientation(edge)).sort()).toEqual(['forward', 'reversed'])
    const edgeText = k.toBREP(cut[0])
    const pair = /^3[ \t]+(\d+)[ \t]+(\d+)[ \t]*(CN|[CG][0-9])[ \t]+(\d+)[ \t]+0[ \t]+([-+\d.eE]+)[ \t]+([-+\d.eE]+)[ \t]*\r?$/m.exec(edgeText)
    expect(pair, edgeText.split(/\r?\n/).filter(line => /^3\s/.test(line)).join(' | ')).not.toBeNull()
    expect(pair![1]).not.toBe(pair![2])
    expect(signature(surfaceTable(edgeText)[Number(pair![4]) - 1])).toBe(expectedSupport)
    const { first, last } = k.curveParameters(cut[0]), { uMin, uMax, vMin, vMax } = k.uvBounds(f)
    expect(first).toBeCloseTo(vMin, 10)
    expect(last).toBeCloseTo(vMax, 10)
    expect(Number(pair![5])).toBeCloseTo(vMin, 10)
    expect(Number(pair![6])).toBeCloseTo(vMax, 10)
    const lines = /(?:^|\n)Curve2ds (\d+)\r?\n([\s\S]+?)(?:^|\n)Curves /m.exec(edgeText)
    const pcurves = lines![2].trim().split(/\r?\n/).map(line => line.trim().split(/\s+/).map(Number))
    expect(pcurves).toHaveLength(Number(lines![1]))
    const isoLines = pair!.slice(1, 3).map(id => pcurves[Number(id) - 1])
    expect(isoLines.map(line => line[1]).sort((a, b) => a - b)).toEqual([uMin, uMax])
    expect(isoLines.every(([kind, , v, du, dv]) => kind === 1 && v === 0 && du === 0 && dv === 1)).toBe(true)
    let worst = 0
    for (let i = 0; i <= 32; i++) {
      const t = first + (last - first) * i / 32, edgePoint = k.curvePointAtParam(cut[0], t)
      for (const u of [uMin, uMax]) worst = Math.max(worst, gap(edgePoint, k.pointOnSurface(f, u, t)))
    }
    expect(worst).toBeLessThan(tolerance)
    return pair![3]
  }
  try {
    const lower = band(0, 5, 1), center = band(5, 10, 1), upper = band(10, 15, 1), inner = band(0, 15, 0.6)
    const source = solid([face(lower), face(center), face(upper), own(k.reverseShape(face(inner))),
      own(k.reverseShape(cap(lower, 0, inner))), cap(upper, 5, inner)])
    const before = inspect(source)
    const protectedSignatures = before.protectedFaces.map(f => signature(before.record(f))).sort()
    // Reconstruct both entire faces including newly moved 3D cut curves.
    // Only copies of the protected source faces enter the isolated sewing.
    const edited = [band(0, 5, 1, 4), band(10, 15, 1, 1)]
    const candidate = solid([...edited.map(face), ...before.protectedFaces.map(f => own(k.copy(f)))])
    const after = inspect(candidate)
    expect(counts(candidate)).toEqual(counts(source))
    expect(after.orientations).toEqual(before.orientations)
    expect(after.protectedFaces.map(f => signature(after.record(f))).sort()).toEqual(protectedSignatures)
    for (const [index, outerIndex] of [0, 2].entries()) {
      expect(checkCut(after.outer[outerIndex], netSignature(edited[index]))).toBe('C0')
      expect(signature(after.record(after.outer[outerIndex]))).toBe(netSignature(edited[index]))
      const { vMin, vMax } = k.uvBounds(after.outer[outerIndex])
      for (let i = 0; i <= 32; i++) for (const v of [vMin, vMax]) {
        const u = 5 * i / 32
        expect(gap(k.pointOnSurface(before.outer[outerIndex], u, v), k.pointOnSurface(after.outer[outerIndex], u, v))).toBeLessThan(tolerance)
      }
      const v = outerIndex === 0 ? 2.5 : 12.5
      expect(gap(k.pointOnSurface(before.outer[outerIndex], 0, v), k.pointOnSurface(after.outer[outerIndex], 0, v))).toBeGreaterThan(0.002)
    }
    // Kernel closest-distance readings give a fixture sanity check on the
    // unchanged inner wall, with comfortable margin over its 2 mm floor.
    const wallClearance = (stage: typeof before) => Math.min(...stage.outer.map(f => k.distanceBetween(f, stage.inner)))
    const clearanceBefore = wallClearance(before), clearanceAfter = wallClearance(after)
    expect(clearanceBefore).toBeGreaterThan(2)
    expect(clearanceAfter).toBeGreaterThan(2)
    const volumeBefore = k.getVolume(source), volumeAfter = k.getVolume(candidate)
    expect(volumeBefore).toBeGreaterThan(0)
    // Independent delta from the section scaling (same polynomial cross
    // section): integral(B_i^5)=1/6 and integral((B_i^5)^2)=25/495 for i=1 or 4.
    const area = modelSectionArea(lower), a = 1 / 512
    const expectedDelta = 10 * area * (2 * a / 6 + a ** 2 * 25 / 495)
    expect(area).toBeCloseTo(745 / 3, 10)
    const measuredDelta = volumeAfter - volumeBefore
    expect(measuredDelta).toBeGreaterThan(0)
    const wallArea = area * (1 - 0.6 ** 2)
    const capChecks = [before, after].map(stage => stage.caps.map(capMeasurements))
    for (const { inner, outer, green } of capChecks.flat()) {
      expect(inner).toBeCloseTo(area * 0.6 ** 2, 10)
      expect(outer).toBeCloseTo(area, 10)
      expect(green).toBeCloseTo(wallArea, 10)
    }
    const cadVolume = (stage: typeof before) => stage.outer.reduce((sum, f) => sum + integrateCadSide(f, lower.ku), 0) -
      integrateCadSide(stage.inner, inner.ku)
    const sectionalBefore = cadVolume(before), sectionalAfter = cadVolume(after)
    expect(sectionalBefore).toBeCloseTo(15 * wallArea, 9)
    expect(sectionalAfter - sectionalBefore).toBeCloseTo(expectedDelta, 9)
    console.info({ capChecks: capChecks.flat(), sectionalBefore, sectionalAfter, volumeBefore, volumeAfter, expectedDelta, measuredDelta })
    const volumeAgreementLimit = 1e-4
    const verdict = Math.abs(measuredDelta - expectedDelta) <= volumeAgreementLimit ? 'within-volume-budget' : 'volume-oracle-mismatch'
    expect(verdict, JSON.stringify({ measuredDelta, expectedDelta, volumeBefore })).toBe('volume-oracle-mismatch')
    // An independent synthetic route can proceed only after the section,
    // trim, topology and wall checks above. Keep the legacy veto recorded.
    const step = k.exportStep(candidate)
    expect(step).toContain('ISO-10303-21;')
    const reimport = own(k.importStep(step)), reopened = inspect(reimport)
    expect(counts(reimport)).toEqual(counts(candidate))
    expect(reopened.orientations).toEqual(after.orientations)
    const reopenedSeamTags = [0, 2].map(i => checkCut(reopened.outer[i], signature(reopened.record(reopened.outer[i]))))
    // STEP import can infer C2 metadata for this seam. The actual one-sided
    // second derivatives are unequal, so the imported label is not evidence.
    const seamSecondY = (f: ShapeHandle, v: number, a: number, b: number) =>
      4 * (k.pointOnSurface(f, a, v).y - 2 * k.pointOnSurface(f, (a + b) / 2, v).y + k.pointOnSurface(f, b, v).y)
    for (const [i, f] of [reopened.outer[0], reopened.outer[2]].entries()) {
      const v = i ? 12.5 : 2.5
      expect(Math.abs(seamSecondY(f, v, 0, 1) - seamSecondY(f, v, 4, 5))).toBeGreaterThan(1)
    }
    for (const [i, expected] of [edited[0], center, edited[1], inner].entries()) {
      const f = i < 3 ? reopened.outer[i] : reopened.inner
      const actual = reopened.record(f).periodicNet
      expect(actual).toMatchObject({ du: expected.du, dv: expected.dv, nu: expected.nu, nv: expected.nv,
        ku: expected.ku, kv: expected.kv, mu: expected.mu, mv: expected.mv, weights: expected.weights })
      for (const [j, p] of expected.poles.entries()) for (const [axis, value] of p.entries())
        expect(actual!.poles[j][axis]).toBeCloseTo(value, 10)
    }
    const clearanceReopened = wallClearance(reopened)
    expect(clearanceReopened).toBeGreaterThan(2)
    for (const cap of reopened.caps) expect(capMeasurements(cap).green).toBeCloseTo(wallArea, 9)
    const sectionalReopened = cadVolume(reopened)
    expect(sectionalReopened).toBeCloseTo(sectionalAfter, 8)
    console.info({ reopenedSeamTags, seamParametricC2: false, sectionalReopened, clearanceBefore, clearanceAfter, clearanceReopened })
    expect(k.toBREP(source)).toBe(before.text)
  } finally {
    handles.reverse().forEach(handle => k.release(handle))
    k[Symbol.dispose]()
  }
}, 30_000)
