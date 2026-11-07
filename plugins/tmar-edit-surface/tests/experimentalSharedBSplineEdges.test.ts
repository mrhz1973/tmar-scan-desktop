// SPDX-License-Identifier: AGPL-3.0-only
import { OcctKernel, type ShapeHandle } from 'occt-wasm'
import { expect, it } from 'vitest'
import { replaceSurface, surfaceTable, type Net, type Point } from '../brep'
import { listCompatibleCurvedSupportCandidates, listExperimentalSharedBSplineEdges } from '../compatibleCurvedSupportTopology'
import { sha256 } from '../recipe'

const xyz = ([x, y, z]: Point) => ({ x, y, z })

it('identifies a real STEP shared curved edge and requires topology, pcurves and matching coefficients', async () => {
  const k = await OcctKernel.init()
  const owned: ShapeHandle[] = []
  const own = (h: ShapeHandle) => { owned.push(h); return h }
  const many = (hs: ShapeHandle[]) => { owned.push(...hs); return hs }
  const stampFor = async (brep: string, faceIndex = 0) => ({
    sourceId: 'brep-sha256:' + await sha256(brep), sourceRevision: 1, selectionRevision: 2, faceIndex
  })

  const face = (start: number, rise: number) => {
    const rectangle: Point[] = [[start, 0, 0], [start + 6, 0, 0], [start + 6, 8, 0], [start, 8, 0]]
    const seedWire = own(k.makeWire(rectangle.map((p, i) => own(k.makeLineEdge(xyz(p), xyz(rectangle[(i + 1) % 4]))))))
    const seed = own(k.makeFace(seedWire)), seedBrep = k.toBREP(seed)
    const { uMin, uMax, vMin, vMax } = k.uvBounds(seed)
    const poles: Point[] = []
    // The sloped face uses a 6-8-10 triangle for exactly represented side lengths.
    for (const u of [0, 0.5, 1]) for (const y of [0, 4, 8]) poles.push([start + 6 * u, y, rise * u + (y === 4 ? 4 : 0)])
    const net: Net = { nu: 3, nv: 3, du: 2, dv: 2, ku: [uMin, uMax], kv: [vMin, vMax], mu: [3, 3], mv: [3, 3],
      rational: [0, 0], poles, weights: poles.map(() => 1) }
    const basis = own(k.fromBREP(replaceSurface(seedBrep, surfaceTable(seedBrep)[0], net)))
    const line = (a: number, b: number) => own(k.makeLineEdge(xyz(poles[a]), xyz(poles[b])))
    const curve = (startIndex: number) => own(k.makeBSplineEdge(poles.slice(startIndex, startIndex + 3).flat(), [1, 1, 1], net.kv, net.mv, 2))
    const wire = own(k.makeWire([line(0, 6), curve(6), line(8, 2), own(k.reverseShape(curve(0)))]))
    return own(k.fixShape(own(k.makeFaceOnSurface(basis, wire))))
  }

  try {
    const left = face(0, 0), right = face(6, 8)
    const shell = own(k.sew([left, right], 1e-7))
    const step = k.exportStep(shell), imported = own(k.importStep(step)), brep = k.toBREP(imported)
    expect(k.isValid(imported)).toBe(true)
    const faces = many(k.getSubShapes(imported, 'face'))
    expect(faces).toHaveLength(2)
    const shared = many(k.sharedEdges(faces[0], faces[1]))
    expect(shared).toHaveLength(1)
    expect(k.curveType(shared[0])).toBe('bspline')
    const stamp = await stampFor(brep)
    const matches = await listExperimentalSharedBSplineEdges(k, brep, stamp)
    expect(matches).toHaveLength(1)
    const match = matches[0]
    expect(match).toMatchObject({ kind: 'experimental-shared-bspline-edge', stamp, degree: 2 })
    expect(match.lengthMm).toBeGreaterThan(8)
    const a = match.selectedWitness.sides[match.edgeIndex], b = match.supportWitness.sides[match.supportEdgeIndex]
    expect(a).toMatchObject({ side: 'uMax', direction: 1 })
    expect(b).toMatchObject({ side: 'uMin', direction: 1 })
    const edgeA = many(k.getSubShapes(faces[0], 'edge'))[match.edgeIndex]
    const edgeB = many(k.getSubShapes(faces[1], 'edge'))[match.supportEdgeIndex]
    expect(k.isSame(edgeA, shared[0])).toBe(true)
    expect(k.isSame(edgeB, shared[0])).toBe(true)
    const normalA = k.surfaceNormal(faces[0], match.selectedWitness.domain[1], 0)
    const normalB = k.surfaceNormal(faces[1], match.supportWitness.domain[0], 0)
    expect(Math.abs(normalA.x * normalB.x + normalA.y * normalB.y + normalA.z * normalB.z)).toBeLessThan(0.9)
    expect(await listCompatibleCurvedSupportCandidates(k, brep, stamp)).toEqual([])
    const other = await listExperimentalSharedBSplineEdges(k, brep, await stampFor(brep, 1))
    expect(other).toHaveLength(1)
    expect(other[0]).toMatchObject({ edgeIndex: match.supportEdgeIndex, supportEdgeIndex: match.edgeIndex })

    const unsewn = own(k.makeCompound([left, right]))
    const unsewnFaces = many(k.getSubShapes(unsewn, 'face')), unsewnBrep = k.toBREP(unsewn)
    expect(unsewnFaces).toHaveLength(2)
    expect(many(k.sharedEdges(unsewnFaces[0], unsewnFaces[1]))).toEqual([])
    expect(await listExperimentalSharedBSplineEdges(k, unsewnBrep, await stampFor(unsewnBrep))).toEqual([])
    await expect(listExperimentalSharedBSplineEdges(k, brep, { ...stamp, sourceId: 'brep-sha256:' + '0'.repeat(64) }))
      .rejects.toThrow('fingerprint')

    // Inject controlled serialized evidence while keeping the real STEP topology intact.
    const curveHeader = /(^Curves 1\s*\n7\s+0\s+0\s+2\s+3\s+2\s+6\s+0\s+0\s+6\s+4\s+)4(\s+6\s+8\s+0\b)/m
    const testRead = (alter: (text: string) => string) => {
      let changed = 0
      const kernel = new Proxy(k, { get(target, key) {
        if (key === 'toBREP') return (handle: ShapeHandle) => {
          const text = target.toBREP(handle), modified = curveHeader.test(text) ? alter(text) : text
          if (modified !== text) changed++
          return modified
        }
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      } })
      return { kernel, changed: () => changed }
    }
    const mismatchedCurve = testRead(text => text.replace(curveHeader, (_match, before: string, after: string) => `${before}3${after}`))
    expect(await listExperimentalSharedBSplineEdges(mismatchedCurve.kernel, brep, stamp)).toEqual([])
    expect(mismatchedCurve.changed()).toBeGreaterThan(0)
    const wrongPcurveRange = testRead(text => text.replace(/(^2\s+\d+\s+\d+\s+0\s+)-4( 4\s*$)/m, '$1-3$2'))
    await expect(listExperimentalSharedBSplineEdges(wrongPcurveRange.kernel, brep, stamp)).rejects.toThrow('intervalli')
    expect(wrongPcurveRange.changed()).toBeGreaterThan(0)
    expect(k.toBREP(imported)).toBe(brep)
  } finally {
    owned.reverse().forEach(h => k.release(h))
  }
}, 60_000)
