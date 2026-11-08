// SPDX-License-Identifier: AGPL-3.0-only
import { OcctKernel, type ShapeHandle } from 'occt-wasm'
import { expect, it } from 'vitest'
import type { Net, Point } from '../brep'
import { makeExperimentalNaturalPeriodicFixtureSide, type ExperimentalPreservedFixtureRim } from './experimentalPeriodicClosedSolid.fixture'

it('preserves a trimmed closed nonperiodic rim and its native affine pcurve while moving the cut', async () => {
  const k = await OcctKernel.init(), handles: ShapeHandle[] = []
  const own = (shape: ShapeHandle) => { handles.push(shape); return shape }
  const ring: Point[] = [[10, 0, 0], [10, 8, 0], [0, 10, 0], [-10, 0, 0], [0, -10, 0], [10, -8, 0]]
  const poles = ring.flatMap(([x, y]) => Array.from({ length: 6 }, (_, v): Point => [x, y, v]))
  const net: Net = { du: 2, dv: 5, nu: 6, nv: 6, ku: [0, 1, 2, 3, 4, 5], mu: [2, 1, 1, 1, 1, 2],
    kv: [0, 5], mv: [6, 6], periodic: [1, 0], rational: [0, 0], poles, weights: poles.map(() => 1) }
  // The middle five spans describe the U ring. Constant extensions outside
  // the edge trim keep the underlying curve's knot interval strictly wider.
  const base = ring[0], extended = [base, base, ...ring, base, base, base]
  const input: ExperimentalPreservedFixtureRim = { curve: { degree: 2, periodic: false, rational: false,
    poles: extended.flat(), weights: [], knots: [-5, -2, 1, 4, 7, 10, 13, 17],
    multiplicities: [3, 2, 1, 1, 1, 1, 2, 3] }, range: [-2, 13],
    pcurve: { range: [-2, 13], start: [0, 0], end: [5, 0] } }
  const rim = (face: ShapeHandle) => {
    const matches = k.getSubShapes(face, 'edge').map(own).filter(e => k.curveParameters(e).first === -2)
    expect(matches).toHaveLength(1)
    return matches[0]
  }
  try {
    const source = own(makeExperimentalNaturalPeriodicFixtureSide(k, net, input)), original = rim(source)
    const curve = k.getNurbsCurveData(original), range = k.curveParameters(original)
    expect(curve).toEqual(input.curve)
    expect(range).toEqual({ first: -2, last: 13 })
    const edited = structuredClone(net)
    for (let u = 0; u < edited.nu; u++) edited.poles[u * edited.nv + 1][0] += 1 / 32
    const stored = { ...input, curve, range: [range.first, range.last] as const }
    const candidate = own(makeExperimentalNaturalPeriodicFixtureSide(k, edited, stored)), copied = rim(candidate)
    expect(k.curveIsClosed(copied)).toBe(true)
    expect(k.curveIsPeriodic(copied)).toBe(false)
    expect(k.getNurbsCurveData(copied)).toEqual(curve)
    expect(k.curveParameters(copied)).toEqual(range)
    for (const face of [source, candidate]) {
      const edge = rim(face), text = k.toBREP(edge)
      expect(text).toMatch(/^2\s+\d+\s+\d+\s+0\s+-2\s+13$/m)
      const serializedPcurve = /^Curve2ds 1\s*\n([\s\S]*?)^Curves /m.exec(text)
      expect(serializedPcurve?.[1].trim().replace(/\s+/g, ' ')).toBe('7 0 0 1 2 2 0 0 5 0 -2 2 13 2')
      const vertex = k.getSubShapes(edge, 'vertex').map(own)
      expect(vertex).toHaveLength(1)
      expect(k.vertexPosition(vertex[0])).toEqual({ x: 10, y: 0, z: 0 })
      const cut = k.getSubShapes(face, 'edge').map(own).filter(e => !k.curveIsClosed(e))
      expect(cut).toHaveLength(1)
      expect(k.getSubShapes(cut[0], 'vertex').map(own).some(v => k.isSame(v, vertex[0]))).toBe(true)
      for (const t of [-2, 1, 4, 7, 10, 13]) {
        const p = k.curvePointAtParam(edge, t), q = k.pointOnSurface(face, (t + 2) / 3, 0)
        expect(Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)).toBeLessThan(1e-7)
      }
    }
    expect(k.pointOnSurface(candidate, 0, 1).x).toBeGreaterThan(k.pointOnSurface(source, 0, 1).x)
    expect(() => makeExperimentalNaturalPeriodicFixtureSide(k, edited, { ...stored,
      pcurve: { ...stored.pcurve, range: [0, 5] } })).toThrow('Unsupported preserved rim range or pcurve')
    expect(() => makeExperimentalNaturalPeriodicFixtureSide(k, edited, { ...stored,
      pcurve: { ...stored.pcurve, end: [4, 0] } })).toThrow('Unsupported preserved rim range or pcurve')
    const inconsistent = structuredClone(stored)
    inconsistent.curve.poles[3 * 4 + 1] += 1
    expect(() => makeExperimentalNaturalPeriodicFixtureSide(k, edited, inconsistent)).toThrow('Preserved rim')
  } finally {
    handles.reverse().forEach(handle => k.release(handle))
    k[Symbol.dispose]()
  }
}, 30_000)
