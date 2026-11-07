// SPDX-License-Identifier: AGPL-3.0-only
// Synthetic OCCT fixture only. Samples below are not topology or G1 certificates.
import { describe, expect, it } from 'vitest'
import type { ShapeHandle } from 'occt-wasm'
import { SurfaceEditorKernel } from '../editorKernel'
import { replaceSurface, surfaceTable, type Net, type Point } from '../brep'
import {
  proposeExperimentalCurvedSeamTangency,
  validateExperimentalCurvedSeamTangencyResult,
  type ExperimentalCurvedSeamRequest,
} from '../compatibleCurvedTangency'

function makeFixtureNet(startX: number, bounds: { uMin: number; uMax: number; vMin: number; vMax: number }): Net {
  const x = [startX, startX + 5, startX + 10], y = [0, 5, 10], z = [0, 2, 0]
  const poles: Point[] = []
  for (let u = 0; u < 3; u++) for (let v = 0; v < 3; v++) {
    const seam = [10, y[v], z[v]] as Point
    if (startX < 10) poles.push([x[u], y[v], z[v]])
    else poles.push([x[u], y[v], z[v] + (u === 1 ? [0, 4, 0][v] : u === 2 ? [0, 8, 0][v] : 0)])
    // Keep the shared boundary at x=10 with the same non-linear controls.
    if (startX < 10 && u === 2) poles[poles.length - 1] = seam
    if (startX >= 10 && u === 0) poles[poles.length - 1] = seam
  }
  return { nu: 3, nv: 3, du: 2, dv: 2, poles, weights: poles.map(() => 1), rational: [0, 0],
    ku: [bounds.uMin, bounds.uMax], kv: [bounds.vMin, bounds.vMax], mu: [3, 3], mv: [3, 3] }
}

async function fixture() {
  const editor = await SurfaceEditorKernel.load(), k = editor.kernel, owned: ShapeHandle[] = []
  const own = (h: ShapeHandle) => { owned.push(h); return h }
  const build = (startX: number) => {
    const corners = [
      { x: startX, y: 0, z: 0 }, { x: startX + 10, y: 0, z: 0 },
      { x: startX + 10, y: 10, z: 0 }, { x: startX, y: 10, z: 0 },
    ]
    const wire = own(k.makeWire(corners.map((p, i) => own(k.makeLineEdge(p, corners[(i + 1) % 4])))))
    const seed = own(k.makeFace(wire)), brep = k.toBREP(seed)
    const record = surfaceTable(brep).find(r => r.kind === 1)!, bounds = k.uvBounds(seed)
    const net = makeFixtureNet(startX, bounds)
    const support = own(k.fromBREP(replaceSurface(brep, record, net)))
    const edge = (ids: number[]) => {
      const points = ids.map(i => net.poles[i]), first = points[0], last = points.at(-1)!
      const delta = last.map((v, d) => v - first[d]), length = Math.hypot(...delta)
      const straight = points.every(p => Math.hypot(...p.map((v, d) => {
        const projection = p.reduce((sum, q, j) => sum + (q - first[j]) * delta[j] / length, 0)
        return v - first[d] - delta[d] / length * projection
      })) < 1e-10)
      if (straight) return own(k.makeLineEdge({ x: first[0], y: first[1], z: first[2] }, { x: last[0], y: last[1], z: last[2] }))
      return own(k.makeBSplineEdge(points.flat(), ids.map(() => 1), net.kv, net.mv, net.dv))
    }
    const boundary = own(k.makeWire([
      edge([0, 1, 2]), edge([2, 5, 8]), edge([8, 7, 6]), edge([6, 3, 0]),
    ]))
    const face = own(k.fixShape(own(k.makeFaceOnSurface(support, boundary))))
    return { face, net }
  }
  try {
    const selected = build(0), support = build(10)
    return { editor, k, selected, support, own,
      dispose: () => { owned.reverse().forEach(h => k.release(h)); editor.dispose() } }
  } catch (error) {
    owned.reverse().forEach(h => k.release(h)); editor.dispose(); throw error
  }
}

function gapSamples(k: Awaited<ReturnType<typeof SurfaceEditorKernel.load>>['kernel'], a: ShapeHandle, b: ShapeHandle) {
  const ab = k.uvBounds(a), bb = k.uvBounds(b)
  let maxGap = 0
  for (let i = 0; i <= 32; i++) {
    const t = i / 32
    const p = k.pointOnSurface(a, ab.uMax, ab.vMin + t * (ab.vMax - ab.vMin))
    const q = k.pointOnSurface(b, bb.uMin, bb.vMin + t * (bb.vMax - bb.vMin))
    maxGap = Math.max(maxGap, Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z))
  }
  return maxGap
}

function normalSamples(k: Awaited<ReturnType<typeof SurfaceEditorKernel.load>>['kernel'], a: ShapeHandle, b: ShapeHandle) {
  const ab = k.uvBounds(a), bb = k.uvBounds(b), dots: number[] = []
  let maxCross = 0
  for (let i = 0; i <= 32; i++) {
    const t = i / 32
    const n0 = k.surfaceNormal(a, ab.uMax, ab.vMin + t * (ab.vMax - ab.vMin))
    const n1 = k.surfaceNormal(b, bb.uMin, bb.vMin + t * (bb.vMax - bb.vMin))
    const l0 = Math.hypot(n0.x, n0.y, n0.z), l1 = Math.hypot(n1.x, n1.y, n1.z)
    expect(l0).toBeGreaterThan(0); expect(l1).toBeGreaterThan(0)
    const x = [n0.x / l0, n0.y / l0, n0.z / l0], y = [n1.x / l1, n1.y / l1, n1.z / l1]
    const cross = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]]
    maxCross = Math.max(maxCross, Math.hypot(...cross))
    dots.push(x.reduce((sum, value, d) => sum + value * y[d], 0))
  }
  const direction = dots.every(x => x > 0) ? 1 : dots.every(x => x < 0) ? -1 : 0
  return { maxCross, direction, minAbsDot: Math.min(...dots.map(Math.abs)), sampleCount: dots.length }
}

describe('experimental curved seam tangency: synthetic OCCT fixture', () => {
  it('changes the selected tangent row, sews a valid sampled-gap result, and preserves the request', async () => {
    const f = await fixture(), { k } = f
    const selectedFaces: ShapeHandle[] = [], supportFaces: ShapeHandle[] = []
    let shared: ShapeHandle[] = []
    try {
      const source = k.sew([f.selected.face, f.support.face], 1e-7)
      f.own(source)
      expect(k.isValid(source)).toBe(true)
      const sourceFaces = k.getSubShapes(source, 'face')
      f.own(sourceFaces[0]); f.own(sourceFaces[1])
      shared = k.sharedEdges(sourceFaces[0], sourceFaces[1]); shared.forEach(f.own)
      expect(shared).toHaveLength(1)
      expect(k.curveType(shared[0])).toBe('bspline')
      for (const face of sourceFaces) {
        const b = k.uvBounds(face), p = k.pointOnSurface(face, (b.uMin + b.uMax) / 2, (b.vMin + b.vMax) / 2)
        if (p.x < 10) selectedFaces.push(face); else supportFaces.push(face)
      }
      expect(selectedFaces).toHaveLength(1); expect(supportFaces).toHaveLength(1)
      const beforeNormals = normalSamples(k, selectedFaces[0], supportFaces[0])
      expect(beforeNormals.sampleCount).toBe(33)
      expect(beforeNormals.maxCross).toBeGreaterThan(0.1)
      expect(beforeNormals.direction).not.toBe(0)

      const request: ExperimentalCurvedSeamRequest = {
        net: structuredClone(f.selected.net), supportNet: structuredClone(f.support.net),
        edge: 'U1', supportEdge: 'U0', preserveTangentEdges: [],
      }
      const saved = structuredClone(request)
      const proposal = proposeExperimentalCurvedSeamTangency(request)
      expect(proposal.changedIndices).toEqual([4])
      expect(proposal.net.poles[4]).not.toEqual(request.net.poles[4])
      expect(proposal.validation).toMatchObject({ globalG1Certified: false })
      expect(proposal.validation.maxSeamDepartureUpperBound).toBeGreaterThan(0)
      expect(validateExperimentalCurvedSeamTangencyResult(request, proposal.net)).toEqual(proposal.validation)
      expect(request).toEqual(saved)
      // Every seam coefficient and clamped, non-rational basis is unchanged.
      for (const i of [6, 7, 8]) expect(proposal.net.poles[i]).toEqual(request.net.poles[i])
      expect(proposal.net.weights).toEqual(request.net.weights)
      expect(proposal.net.rational).toEqual([0, 0])
      expect(proposal.net.mv).toEqual([3, 3])

      const selectedSupport = ownRebuiltFace(f, proposal.net)
      const sewn = k.sew([selectedSupport, f.support.face], 1e-7); f.own(sewn)
      expect(k.isValid(sewn)).toBe(true)
      const faces = k.getSubShapes(sewn, 'face'); f.own(faces[0]); f.own(faces[1])
      selectedFaces.length = 0; supportFaces.length = 0
      for (const face of faces) {
        const b = k.uvBounds(face), p = k.pointOnSurface(face, (b.uMin + b.uMax) / 2, (b.vMin + b.vMax) / 2)
        if (p.x < 10) selectedFaces.push(face); else supportFaces.push(face)
      }
      expect(selectedFaces).toHaveLength(1); expect(supportFaces).toHaveLength(1)
      const sampledGap = gapSamples(k, selectedFaces[0], supportFaces[0])
      expect(sampledGap).toBeLessThan(1e-7)
      const afterNormals = normalSamples(k, selectedFaces[0], supportFaces[0])
      expect(afterNormals.sampleCount).toBe(33)
      expect(afterNormals.direction).toBe(beforeNormals.direction)
      expect(afterNormals.maxCross).toBeLessThan(1e-6)
      expect(afterNormals.maxCross).toBeLessThan(beforeNormals.maxCross / 1000)
      console.info('SYNTHETIC_OCCT_CURVED_SEAM_SAMPLES', JSON.stringify({
        count: beforeNormals.sampleCount, beforeMaxUnitNormalCross: beforeNormals.maxCross,
        afterMaxUnitNormalCross: afterNormals.maxCross, beforeAfterNormalDirection: beforeNormals.direction,
        minAbsNormalDotAfter: afterNormals.minAbsDot, sampledGapMm: sampledGap,
      }))
      // These finite samples do not certify topology, continuous G1, or Tubo coverage.
      expect(proposal.validation.globalG1Certified).toBe(false)
    } finally {
      f.dispose()
    }
  }, 60000)
})

function ownRebuiltFace(f: Awaited<ReturnType<typeof fixture>>, net: Net): ShapeHandle {
  const { k } = f, edges = [
    k.makeLineEdge({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }),
    k.makeLineEdge({ x: 10, y: 0, z: 0 }, { x: 10, y: 10, z: 0 }),
    k.makeLineEdge({ x: 10, y: 10, z: 0 }, { x: 0, y: 10, z: 0 }),
    k.makeLineEdge({ x: 0, y: 10, z: 0 }, { x: 0, y: 0, z: 0 }),
  ]
  edges.forEach(f.own)
  const seedWire = f.own(k.makeWire(edges)), seed = f.own(k.makeFace(seedWire))
  const text = k.toBREP(seed), record = surfaceTable(text).find(r => r.kind === 1)!
  const support = f.own(k.fromBREP(replaceSurface(text, record, net)))
  const edge = (ids: number[]) => {
    const points = ids.map(i => net.poles[i]), first = points[0], last = points.at(-1)!
    const delta = last.map((v, d) => v - first[d]), length = Math.hypot(...delta)
    const straight = points.every(p => Math.hypot(...p.map((v, d) => {
      const projection = p.reduce((sum, q, j) => sum + (q - first[j]) * delta[j] / length, 0)
      return v - first[d] - delta[d] / length * projection
    })) < 1e-10)
    return straight ? f.own(k.makeLineEdge({ x: first[0], y: first[1], z: first[2] }, { x: last[0], y: last[1], z: last[2] }))
      : f.own(k.makeBSplineEdge(points.flat(), ids.map(() => 1), net.kv, net.mv, net.dv))
  }
  const wire = f.own(k.makeWire([edge([0, 1, 2]), edge([2, 5, 8]), edge([8, 7, 6]), edge([6, 3, 0])]))
  return f.own(k.fixShape(f.own(k.makeFaceOnSurface(support, wire))))
}
