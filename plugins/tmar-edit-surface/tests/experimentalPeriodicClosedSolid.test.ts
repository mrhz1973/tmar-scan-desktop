// SPDX-License-Identifier: AGPL-3.0-only
import { OcctKernel, type ShapeHandle, type Vec3 } from 'occt-wasm'
import { expect, it } from 'vitest'
import { encodeNet, replaceSurface, signature, surfaceTable, type Net } from '../brep'
import { exclusiveFaceSurface } from '../exclusiveSurface'
import { refineExperimentalPeriodicSurfaceU } from '../experimentalPeriodicSurfaceRefinement'
import { proposeExperimentalPeriodicTangency } from '../experimentalPeriodicTangency'
import { verifyExperimentalPeriodicTangencyReplay } from '../experimentalPeriodicTangencyReplay'
import { makeExperimentalPeriodicClosedSolid } from './experimentalPeriodicClosedSolid.fixture'

const tolerance = 1e-7
const gap = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]

it('checks two periodic support replacements on a synthetic closed solid', async () => {
  const k = await OcctKernel.init()
  const handles: ShapeHandle[] = []
  const own = (shape: ShapeHandle) => { handles.push(shape); return shape }
  function inspect(shape: ShapeHandle, label: string) {
    const kinds = ['solid', 'shell', 'face', 'wire', 'edge', 'vertex'] as const
    const counts = kinds.map(kind => k.subShapeCount(shape, kind))
    const valid = k.isValid(shape)
    const volume = k.getVolume(shape)
    console.info(label, { valid, counts, volume })
    expect(valid, label).toBe(true)
    expect(k.isSolid(shape), `${label} solid root`).toBe(true)
    const children = k.iterShapes(shape).map(own)
    expect(children, `${label} shell occurrences`).toHaveLength(1)
    expect(k.isShell(children[0]), `${label} direct shell`).toBe(true)
    const directFaces = k.iterShapes(children[0]).map(own)
    expect(directFaces, `${label} face occurrences`).toHaveLength(4)
    expect(directFaces.every(face => k.isFace(face)), `${label} direct faces`).toBe(true)
    expect(counts, label).toEqual([1, 1, 4, 4, 5, 3])
    expect(Number.isFinite(volume) && volume > 0, label).toBe(true)

    const faces = k.getSubShapes(shape, 'face').map(own)
    const edges = k.getSubShapes(shape, 'edge').map(own)
    const faceUses = (face: ShapeHandle) => k.getSubShapes(face, 'wire').map(own)
      .flatMap(wire => k.iterShapes(wire).map(own))
    const uses = faces.flatMap(faceUses)
    for (const edge of edges) {
      const orientations = uses.filter(use => k.isSame(edge, use)).map(use => k.shapeOrientation(use))
      expect(orientations.sort(), `${label} edge incidence`).toEqual(['forward', 'reversed'])
    }
    const byVBound = (bound: 'vMin' | 'vMax', value: number) => {
      const matching = faces.filter(face => Math.abs(k.uvBounds(face)[bound] - value) <= tolerance)
      expect(matching, `${label} side ${bound}=${value}`).toHaveLength(1)
      return matching[0]
    }
    const selected = byVBound('vMax', 4), support = byVBound('vMin', 7)
    const shared = k.sharedEdges(selected, support).map(own)
    expect(shared, `${label} shared rim`).toHaveLength(1)
    expect(k.curveIsClosed(shared[0]), `${label} closed rim`).toBe(true)
    const brep = k.toBREP(shape)
    const record = (face: ShapeHandle) => exclusiveFaceSurface(brep, k.toBREP(face), faces.length)
    const selectedRecord = record(selected), supportRecord = record(support)
    expect(selectedRecord.periodicNet?.periodic, label).toEqual([1, 0])
    expect(supportRecord.periodicNet?.periodic, label).toEqual([1, 0])
    for (const [face, faceRecord] of [[selected, selectedRecord], [support, supportRecord]] as const) {
      const uses = faceUses(face)
      const cut = uses.filter(edge => uses.filter(other => k.isSame(edge, other)).length === 2)
      expect(uses, `${label} side wire uses`).toHaveLength(4)
      expect(cut.map(edge => k.shapeOrientation(edge)).sort(), `${label} U cut uses`).toEqual(['forward', 'reversed'])
      const text = k.toBREP(cut[0])
      const pcurves = [...text.matchAll(/^3[ \t]+(\d+)[ \t]+(\d+)[ \t]*(?:CN|C[0-9]|G[0-9])[ \t]+(\d+)[ \t]+/gm)]
      expect(pcurves, `${label} U cut pcurve pair`).toHaveLength(1)
      const [, firstCurve, secondCurve, surface] = pcurves[0]
      const curveCount = Number(/^Curve2ds (\d+)/m.exec(text)?.[1])
      expect(Number(firstCurve)).toBeGreaterThan(0)
      expect(Number(secondCurve)).toBeGreaterThan(0)
      expect(Math.max(Number(firstCurve), Number(secondCurve))).toBeLessThanOrEqual(curveCount)
      expect(firstCurve).not.toBe(secondCurve)
      expect(signature(surfaceTable(text)[Number(surface) - 1])).toBe(signature(faceRecord))
      const { first, last } = k.curveParameters(cut[0])
      const { uMin, uMax, vMin, vMax } = k.uvBounds(face)
      for (let i = 0; i <= 16; i++) {
        const point = k.curvePointAtParam(cut[0], first + (last - first) * i / 16)
        const v = vMin + (vMax - vMin) * i / 16
        for (const u of [uMin, uMax]) expect(gap(k.pointOnSurface(face, u, v), point)).toBeLessThan(tolerance)
      }
    }
    const caps = faces.filter(face => face !== selected && face !== support).map(face => ({
      face, record: record(face), z: k.getSurfaceCenterOfMass(face).z, uses: faceUses(face),
    })).sort((a, b) => a.z - b.z)
    expect(caps.map(cap => cap.uses.length), `${label} cap rim occurrences`).toEqual([1, 1])
    return { selected, support, brep, selectedRecord, supportRecord, caps, volume }
  }

  const uvSamples = (face: ShapeHandle) => {
    const { uMin, uMax, vMin, vMax } = k.uvBounds(face)
    return Array.from({ length: 65 }, (_, i) => [0, 0.25, 0.5, 0.75, 1].map(t =>
      [uMin + (uMax - uMin) * i / 64, vMin + (vMax - vMin) * t])).flat()
  }
  const compare = (source: ShapeHandle, candidate: ShapeHandle) => Math.max(...uvSamples(source).map(([u, v]) =>
    gap(k.pointOnSurface(source, u, v), k.pointOnSurface(candidate, u, v))))
  function compareBoundary(source: ShapeHandle, candidate: ShapeHandle) {
    const { uMin, uMax, vMin, vMax } = k.uvBounds(source)
    const gaps = Array.from({ length: 73 }, (_, i) => {
      const u = uMin + (uMax - uMin) * i / 72, v = vMin + (vMax - vMin) * i / 72
      return [[u, vMin], [u, vMax], [uMin, v], [uMax, v]].map(([u, v]) =>
        gap(k.pointOnSurface(source, u, v), k.pointOnSurface(candidate, u, v)))
    })
    return Math.max(...gaps.flat())
  }
  function compareCaps(source: ReturnType<typeof inspect>, candidate: ReturnType<typeof inspect>) {
    for (const [i, cap] of source.caps.entries()) {
      const actual = candidate.caps[i]
      expect(Math.abs(actual.z - cap.z)).toBeLessThan(tolerance)
      expect(Math.abs(k.getSurfaceArea(actual.face) - k.getSurfaceArea(cap.face))).toBeLessThan(tolerance)
      expect(k.shapeOrientation(actual.face)).toBe(k.shapeOrientation(cap.face))
      const [before, after] = [cap.uses[0], actual.uses[0]]
      const sample = (edge: ShapeHandle, i: number) => {
        const { first, last } = k.curveParameters(edge)
        return k.curvePointAtParam(edge, first + (last - first) * i / 32)
      }
      for (let i = 0; i <= 32; i++) expect(gap(sample(before, i), sample(after, i))).toBeLessThan(tolerance)
    }
  }
  function estimateLowerVolume(face: ShapeHandle, slices: number, sectionSamples: number) {
    const { uMin, uMax, vMin, vMax } = k.uvBounds(face)
    // The lower fixture side has affine Z in V. Integrate polygonal XY
    // section areas with midpoint slices independently of OCCT mass properties.
    const height = 3
    let volume = 0
    for (let j = 0; j < slices; j++) {
      const v = vMin + (vMax - vMin) * (j + 0.5) / slices
      const points = Array.from({ length: sectionSamples }, (_, i) =>
        k.pointOnSurface(face, uMin + (uMax - uMin) * i / sectionSamples, v))
      let twiceArea = 0
      for (const [i, a] of points.entries()) {
        const b = points[(i + 1) % sectionSamples]
        twiceArea += a.x * b.y - a.y * b.x
      }
      volume += twiceArea * height / (2 * slices)
    }
    return volume
  }
  function seam(selected: ShapeHandle, support: ShapeHandle) {
    let maxGap = 0, maxNormalSin = 0
    for (let i = 0; i <= 72; i++) {
      const u = 16 * i / 72
      maxGap = Math.max(maxGap, gap(k.pointOnSurface(selected, u, 4), k.pointOnSurface(support, u, 7)))
      const a = k.surfaceNormal(selected, u, 4), b = k.surfaceNormal(support, u, 7)
      expect(a.x * b.x + a.y * b.y + a.z * b.z).toBeGreaterThan(0)
      maxNormalSin = Math.max(maxNormalSin, Math.hypot(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z,
        a.x * b.y - a.y * b.x) / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z)))
    }
    return { maxGap, maxNormalSin }
  }
  function replaceBoth(base: ReturnType<typeof inspect>, selected: Net, support: Net) {
    const edits = [{ record: base.selectedRecord, net: selected }, { record: base.supportRecord, net: support }]
    edits.sort((a, b) => b.record.start - a.record.start)
    const brep = edits.reduce((brep, { record, net }) => replaceSurface(brep, record, net), base.brep)
    return own(k.fromBREP(brep))
  }
  function requireSameVolume(source: number, candidate: number, label: string) {
    const delta = Math.abs(candidate - source), limit = Math.max(1e-5, Math.abs(source) * 1e-8)
    console.info(label, { source, candidate, delta, limit })
    expect(delta, label).toBeLessThan(limit)
  }

  try {
    const source = makeExperimentalPeriodicClosedSolid(k, own)
    const initial = inspect(source, 'source')
    const converted = inspect(own(k.generalTransform(source, identity)), 'identity conversion')
    const conversionGaps = [compare(initial.selected, converted.selected), compare(initial.support, converted.support)]
    console.info({ conversionGaps })
    expect(Math.max(...conversionGaps)).toBeLessThan(tolerance)
    requireSameVolume(initial.volume, converted.volume, 'identity conversion volume')

    const parameters = { edge: 'V1', supportEdge: 'V0', scale: 0.5 } as const
    const sourceNet = converted.selectedRecord.periodicNet!, sourceSupport = converted.supportRecord.periodicNet!
    expect(() => proposeExperimentalPeriodicTangency({ net: sourceNet, supportNet: sourceSupport, ...parameters }))
      .toThrow('basi U diverse')
    const common = refineExperimentalPeriodicSurfaceU(k, sourceNet, sourceSupport)
    const refinedShape = replaceBoth(converted, common.left, common.right)
    const refined = inspect(refinedShape, 'common basis, two replacements')
    expect(compare(converted.selected, refined.selected)).toBeLessThan(tolerance)
    expect(compare(converted.support, refined.support)).toBeLessThan(tolerance)
    requireSameVolume(converted.volume, refined.volume, 'common basis volume')

    const request = { net: refined.selectedRecord.periodicNet!, supportNet: refined.supportRecord.periodicNet!, ...parameters }
    const proposal = proposeExperimentalPeriodicTangency(request)
    const replay = verifyExperimentalPeriodicTangencyReplay(k, refined.selected, request, proposal.net)
    expect(replay.changedIndices.length).toBeGreaterThan(0)
    const editedShape = own(k.fromBREP(replaceSurface(refined.brep, refined.selectedRecord, proposal.net)))
    const edited = inspect(editedShape, 'tangency replacement')
    expect(encodeNet(edited.selectedRecord.periodicNet!)).toBe(encodeNet(proposal.net))
    expect(encodeNet(edited.supportRecord.periodicNet!)).toBe(encodeNet(request.supportNet))
    const editedBoundaryGap = compareBoundary(refined.selected, edited.selected)
    const editedSurfaceGap = compare(refined.selected, edited.selected)
    expect(editedBoundaryGap).toBeLessThan(tolerance)
    expect(editedSurfaceGap).toBeGreaterThan(0.1)
    expect(edited.caps.map(cap => signature(cap.record))).toEqual(refined.caps.map(cap => signature(cap.record)))
    compareCaps(refined, edited)
    const volumeChangeMm3 = edited.volume - refined.volume
    const estimateChange = (slices: number, sectionSamples: number) =>
      estimateLowerVolume(edited.selected, slices, sectionSamples) - estimateLowerVolume(refined.selected, slices, sectionSamples)
    const coarseVolumeChangeMm3 = estimateChange(32, 128)
    const estimatedVolumeChangeMm3 = estimateChange(64, 256)
    expect(volumeChangeMm3).toBeLessThan(-1)
    expect(Math.abs(coarseVolumeChangeMm3 - estimatedVolumeChangeMm3)).toBeLessThan(0.02)
    expect(Math.abs(volumeChangeMm3 - estimatedVolumeChangeMm3)).toBeLessThan(0.1)
    const step = k.exportStep(editedShape)
    expect(step).toContain('ISO-10303-21;')
    const reopened = inspect(own(k.importStep(step)), 'STEP reopened')
    requireSameVolume(edited.volume, reopened.volume, 'STEP volume')
    expect(compare(edited.selected, reopened.selected)).toBeLessThan(tolerance)
    expect(compare(edited.support, reopened.support)).toBeLessThan(tolerance)
    compareCaps(edited, reopened)
    const beforeSeam = seam(refined.selected, refined.support)
    const afterSeam = seam(edited.selected, edited.support)
    const stepSeam = seam(reopened.selected, reopened.support)
    console.info({ beforeSeam, afterSeam, stepSeam, editedBoundaryGap, editedSurfaceGap, replay,
      volumeChangeMm3, coarseVolumeChangeMm3, estimatedVolumeChangeMm3 })
    expect(beforeSeam.maxNormalSin).toBeGreaterThan(0.25)
    for (const check of [beforeSeam, afterSeam, stepSeam]) expect(check.maxGap).toBeLessThan(tolerance)
    for (const check of [afterSeam, stepSeam]) expect(check.maxNormalSin).toBeLessThan(tolerance)
    expect(k.toBREP(source)).toBe(initial.brep)
    expect(k.toBREP(refinedShape)).toBe(refined.brep)
  } finally {
    handles.reverse().forEach(handle => k.release(handle))
    k[Symbol.dispose]()
  }
}, 30_000)
