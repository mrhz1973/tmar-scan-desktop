// SPDX-License-Identifier: AGPL-3.0-only
import { OcctKernel, type ShapeHandle, type Vec3 } from 'occt-wasm'
import { expect, it } from 'vitest'
import { replaceSurface, surfaceTable, type Net, type Point } from '../brep'
import { comparePeriodicCurves } from '../experimentalPeriodicCurveWitness'
import { refineLinearPeriodicV } from '../periodic'

const gap = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

it('sews a closed periodic B-spline boundary between two distinct U bases', async () => {
  const k = await OcctKernel.init()
  const owned: ShapeHandle[] = []
  const own = (h: ShapeHandle) => { owned.push(h); return h }
  const many = (hs: ShapeHandle[]) => { owned.push(...hs); return hs }
  const uControlCurve = (net: Net, v: number) => {
    const indices = Array.from({ length: net.nu }, (_, i) => i * net.nv + v)
    return own(k.makeBSplineEdge(indices.flatMap(i => net.poles[i]),
      indices.map(i => net.weights[i]), net.ku, net.mu, net.du, true))
  }
  const refineU = (net: Net, u: number): Net => {
    // Insert the same knot in every homogeneous U section using OCCT.
    const sections = Array.from({ length: net.nv }, (_, v) =>
      k.getNurbsCurveData(own(k.curveKnotInsert(uControlCurve(net, v), u, 1))))
    const { knots, multiplicities } = sections[0]
    const nu = sections[0].poles.length / 3
    const poles: Point[] = [], weights: number[] = []
    for (const section of sections) {
      expect(section).toMatchObject({ periodic: true, knots, multiplicities, degree: net.du })
      expect(section.weights).toHaveLength(nu)
    }
    for (let i = 0; i < nu; i++) {
      for (const section of sections) {
        poles.push(section.poles.slice(i * 3, i * 3 + 3) as Point)
        weights.push(section.weights[i])
      }
    }
    return { ...net, nu, poles, weights, ku: knots, mu: multiplicities }
  }
  const faceNet = (face: ShapeHandle) => {
    const brep = k.toBREP(face)
    // A sewn edge also serializes its adjacent supports. Read the face's own record.
    const support = /^Fa\s*\n\s*[01]\s+\S+\s+(\d+)\s+0\s*$/m.exec(brep)
    expect(support).not.toBeNull()
    return surfaceTable(brep)[Number(support![1]) - 1].periodicNet
  }
  const radius = 10, height = 12
  const makeSide = (z: number, insertU: boolean) => {
    const seed = own(k.makeCylinder(radius, height))
    const translated = own(k.generalTransform(seed, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, z]))
    const brep = k.toBREP(translated), record = surfaceTable(brep).find(r => r.periodicNet)
    expect(record?.periodicNet?.periodic).toEqual([1, 0])
    const net = refineLinearPeriodicV(record!.periodicNet!)
    const refined = insertU ? refineU(net, (net.ku[1] + net.ku[2]) / 2) : net
    const body = own(k.fromBREP(replaceSurface(brep, record!, refined)))
    expect(k.isValid(body)).toBe(true)
    const sides = many(k.getSubShapes(body, 'face')).filter(f => faceNet(f)?.periodic?.join() === '1,0')
    expect(sides).toHaveLength(1)
    return sides[0]
  }
  const verifyGeometry = (lower: ShapeHandle, upper: ShapeHandle, edge: ShapeHandle, knots: number[]) => {
    expect(k.curveType(edge)).toBe('bspline')
    expect(k.curveIsClosed(edge)).toBe(true)
    expect(k.curveIsPeriodic(edge)).toBe(true)
    expect(many(k.getSubShapes(edge, 'vertex'))).toHaveLength(1)
    const { first, last } = k.curveParameters(edge)
    const a = k.uvBounds(lower), b = k.uvBounds(upper)
    expect(last - first).toBeGreaterThan(6)
    for (const bounds of [a, b]) {
      expect(bounds.uMin).toBeCloseTo(first, 8)
      expect(bounds.uMax).toBeCloseTo(last, 8)
    }
    const samples = Array.from({ length: 65 }, (_, i) => first + (last - first) * i / 64)
    for (const u of new Set([...samples, ...knots])) {
      const p = k.curvePointAtParam(edge, u)
      const q = k.pointOnSurface(lower, u, a.vMax)
      const r = k.pointOnSurface(upper, u, b.vMin)
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(radius, 8)
      expect(p.z).toBeCloseTo(height, 8)
      expect(gap(p, q)).toBeLessThan(1e-8)
      expect(gap(p, r)).toBeLessThan(1e-8)
      expect(gap(q, r)).toBeLessThan(1e-8)
    }
  }

  try {
    const lower = makeSide(0, false), upper = makeSide(height, true)
    const a = faceNet(lower)!, b = faceNet(upper)!
    expect(a.du).toBe(b.du)
    expect(b.nu).toBe(a.nu + 1)
    expect(b.ku).toHaveLength(a.ku.length + 1)
    expect(b.ku).toEqual([a.ku[0], a.ku[1], (a.ku[1] + a.ku[2]) / 2, ...a.ku.slice(2)])
    // At clamped V endpoints the first and last U control curves are the
    // surface isocurves. Compare the two supports before sewing.
    expect(a.mv.at(-1)).toBe(a.dv + 1)
    expect(b.mv[0]).toBe(b.dv + 1)
    const witness = comparePeriodicCurves(k, uControlCurve(a, a.nv - 1), uControlCurve(b, 0))
    expect(witness).toEqual({
      degree: b.du, knots: b.ku, multiplicities: b.mu,
      sameRefinedCoefficients: true, maxRefinedPoleDistance: 0,
    })
    expect(many(k.sharedEdges(lower, upper))).toEqual([])
    const verifyShell = (shape: ShapeHandle) => {
      expect(k.isValid(shape)).toBe(true)
      expect(many(k.getSubShapes(shape, 'shell'))).toHaveLength(1)
      const faces = many(k.getSubShapes(shape, 'face'))
      expect(faces).toHaveLength(2)
      const sorted = faces.map(face => {
        const { uMin, vMin, vMax } = k.uvBounds(face)
        return { face, z: k.pointOnSurface(face, uMin, (vMin + vMax) / 2).z }
      }).sort((x, y) => x.z - y.z)
      expect(sorted[0].z).toBeCloseTo(height / 2, 8)
      expect(sorted[1].z).toBeCloseTo(3 * height / 2, 8)
      const [low, high] = sorted.map(entry => entry.face)
      for (const [face, original] of [[low, a], [high, b]] as const) {
        const net = faceNet(face)
        expect(net).toMatchObject({ du: original.du, nu: original.nu, mu: original.mu, periodic: [1, 0] })
        expect(net!.ku).toHaveLength(original.ku.length)
        net!.ku.forEach((knot, i) => expect(knot).toBeCloseTo(original.ku[i], 8))
      }
      const shared = many(k.sharedEdges(low, high))
      expect(shared).toHaveLength(1)
      const occurrences = [low, high].map(face => {
        const matches = many(k.getSubShapes(face, 'edge')).filter(edge => k.isSame(edge, shared[0]))
        expect(matches).toHaveLength(1)
        return matches[0]
      })
      expect(k.isSame(occurrences[0], occurrences[1])).toBe(true)
      expect(occurrences.map(edge => k.shapeOrientation(edge)).sort()).toEqual(['forward', 'reversed'])
      verifyGeometry(low, high, shared[0], faceNet(high)!.ku)
    }
    const shell = own(k.sew([lower, upper], 1e-7))
    verifyShell(shell)
    verifyShell(own(k.importStep(k.exportStep(shell))))
  } finally {
    owned.reverse().forEach(h => k.release(h))
    k[Symbol.dispose]()
  }
}, 60_000)
