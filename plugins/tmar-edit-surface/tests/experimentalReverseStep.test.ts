// SPDX-License-Identifier: AGPL-3.0-only
import { OcctKernel, type ShapeHandle } from 'occt-wasm'
import { expect, it } from 'vitest'
import { replaceSurface, surfaceTable, type Net, type Point } from '../brep'
import { listExperimentalSharedBSplineEdges, resolveExperimentalSharedBSplineEdge } from '../compatibleCurvedSupportTopology'
import { associateSerializedEdgeCurve } from '../experimentalEdgeCurveAssociation'
import { matchNaturalSideCurve } from '../experimentalNaturalSideCurveMatch'
import { sha256 } from '../recipe'

const xyz = ([x, y, z]: Point) => ({ x, y, z })
const numbers = (line: string) => line.trim().split(/\s+/).map(Number)

it('compares a reversed natural side against the real shared 3D curve after STEP roundtrip', async () => {
  const k = await OcctKernel.init()
  const owned: ShapeHandle[] = []
  const own = (h: ShapeHandle) => { owned.push(h); return h }
  const many = (hs: ShapeHandle[]) => { owned.push(...hs); return hs }

  const face = (start: number, rise: number, reverseV: boolean) => {
    const rectangle: Point[] = [[start, 0, 0], [start + 6, 0, 0], [start + 6, 8, 0], [start, 8, 0]]
    const seedWire = own(k.makeWire(rectangle.map((p, i) => own(k.makeLineEdge(xyz(p), xyz(rectangle[(i + 1) % 4]))))))
    const seed = own(k.makeFace(seedWire))
    const seedBrep = k.toBREP(seed)
    const { uMin, uMax, vMin, vMax } = k.uvBounds(seed)
    const poles: Point[] = []
    const yValues = reverseV ? [8, 4, 0] : [0, 4, 8]
    // The sloped patch uses a 6-8-10 triangle to keep its side lengths exact.
    for (const u of [0, 0.5, 1]) {
      for (const y of yValues) poles.push([start + 6 * u, y, rise * u + (y === 4 ? 4 : 0)])
    }
    const net: Net = {
      nu: 3, nv: 3, du: 2, dv: 2, ku: [uMin, uMax], kv: [vMin, vMax],
      mu: [3, 3], mv: [3, 3], rational: [0, 0], poles, weights: poles.map(() => 1)
    }
    const basis = own(k.fromBREP(replaceSurface(seedBrep, surfaceTable(seedBrep)[0], net)))
    const line = (a: number, b: number) => own(k.makeLineEdge(xyz(poles[a]), xyz(poles[b])))
    const curve = (offset: number) => own(k.makeBSplineEdge(
      poles.slice(offset, offset + 3).flat(), [1, 1, 1], net.kv, net.mv, net.dv))
    const wire = own(k.makeWire([line(0, 6), curve(6), line(8, 2), own(k.reverseShape(curve(0)))]))
    return own(k.fixShape(own(k.makeFaceOnSurface(basis, wire))))
  }

  try {
    const shell = own(k.sew([face(0, 0, false), face(6, 8, true)], 1e-7))
    const imported = own(k.importStep(k.exportStep(shell)))
    const sourceBrep = k.toBREP(imported)
    expect(k.isValid(imported)).toBe(true)
    const faces = many(k.getSubShapes(imported, 'face'))
    expect(faces).toHaveLength(2)
    const shared = many(k.sharedEdges(faces[0], faces[1]))
    expect(shared).toHaveLength(1)
    expect(k.curveType(shared[0])).toBe('bspline')

    const edgeBrep = k.toBREP(shared[0])
    const { curve, pcurveCount, range } = associateSerializedEdgeCurve(edgeBrep)
    expect(pcurveCount).toBe(2)
    expect(range).toEqual([-4, 4])
    expect(curve).toMatchObject({
      degree: 2, rational: false, periodic: false,
      poles: [[6, 0, 0], [6, 4, 4], [6, 8, 0]], knots: [-4, 4], multiplicities: [3, 3]
    })

    // Read back this fixture's actual OCCT representations. The first pcurve
    // is a line and the second a complete clamped degree-one segment.
    const table = /^Curve2ds 2\s*\n([\s\S]*?)^Curves /m.exec(edgeBrep)
    expect(table).not.toBeNull()
    const [line, segment, segmentKnots] = table![1].trim().split(/\r?\n/).map(numbers)
    expect(line).toEqual([1, 3, 0, 0, 1])
    expect(segment).toEqual([7, 0, 0, 1, 2, 2, -3, 4, -3, -4])
    expect(segmentKnots).toEqual([-4, 2, 4, 2])
    const [, u, v, du, dv] = line
    const endpoints = [
      range.map(t => [u + du * t, v + dv * t]),
      [segment.slice(6, 8), segment.slice(8, 10)]
    ]

    const edgeRecords = surfaceTable(edgeBrep)
    const reps = [...edgeBrep.matchAll(/^2[ \t]+(\d+)[ \t]+(\d+)[ \t]+0[ \t]+-4[ \t]+4[ \t]*$/gm)]
    expect(reps).toHaveLength(2)
    const sides = faces.map(face => {
      const occurrences = many(k.getSubShapes(face, 'edge')).filter(edge => k.isSame(edge, shared[0]))
      expect(occurrences).toHaveLength(1)
      const faceBrep = k.toBREP(face)
      const faceSurface = /^Fa\s*\n\s*[01]\s+\S+\s+(\d+)\s+0\s*$/m.exec(faceBrep)
      expect(faceSurface).not.toBeNull()
      const net = surfaceTable(faceBrep)[Number(faceSurface![1]) - 1].net!
      expect(net).toBeDefined()
      const ownReps = reps.filter(rep => JSON.stringify(edgeRecords[Number(rep[2]) - 1].net) === JSON.stringify(net))
      expect(ownReps).toHaveLength(1)
      const [first, last] = endpoints[Number(ownReps[0][1]) - 1]
      expect(first[0]).toBe(last[0])
      expect([first[1], last[1]].sort((a, b) => a - b)).toEqual(net.kv)
      expect([net.ku[0], net.ku.at(-1)]).toContain(first[0])
      const side = first[0] === net.ku[0] ? 'uMin' : 'uMax'
      const direction = last[1] > first[1] ? 1 : -1
      expect(matchNaturalSideCurve(net, side, curve, direction).comparison).toEqual({
        comparable: true, exact: true, maxPoleDistance: 0,
        sameWeights: true, sameKnots: true, sameMultiplicity: true
      })
      expect(matchNaturalSideCurve(net, side, curve, direction === 1 ? -1 : 1).comparison.exact).toBe(false)
      return { side, direction, orientation: k.shapeOrientation(occurrences[0]) }
    })
    expect(sides).toEqual(expect.arrayContaining([
      expect.objectContaining({ side: 'uMax', direction: 1 }),
      expect.objectContaining({ side: 'uMin', direction: -1 })
    ]))
    expect(sides.map(s => s.orientation).sort()).toEqual(['forward', 'reversed'])

    const sourceId = 'brep-sha256:' + await sha256(sourceBrep)
    for (const faceIndex of [0, 1]) {
      const stamp = { sourceId, sourceRevision: 1, selectionRevision: 2, faceIndex }
      const candidates = await listExperimentalSharedBSplineEdges(k, sourceBrep, stamp)
      expect(candidates).toHaveLength(1)
      const [candidate] = candidates
      const supportFaceIndex = 1 - faceIndex
      expect(candidate).toMatchObject({ stamp, supportFaceIndex, degree: 2 })
      for (const [witness, edgeIndex, index] of [
        [candidate.selectedWitness, candidate.edgeIndex, faceIndex],
        [candidate.supportWitness, candidate.supportEdgeIndex, supportFaceIndex]
      ] as const) {
        const { side, direction } = sides[index]
        expect(witness.sides[edgeIndex]).toMatchObject({ side, direction, parameterRange: range })
        const edges = many(k.getSubShapes(faces[index], 'edge'))
        expect(k.isSame(edges[edgeIndex], shared[0])).toBe(true)
      }
      expect(await resolveExperimentalSharedBSplineEdge(k, sourceBrep, stamp, candidate)).toEqual(candidate)
    }
    expect(k.toBREP(imported)).toBe(sourceBrep)
  } finally {
    owned.reverse().forEach(h => k.release(h))
  }
}, 60_000)
