// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { cadBoundarySegments } from '../src/core/geometry/cadBoundaries'
import { parseSTEP } from '../src/core/parsers/step'
import { cubeStep } from './stepFixtures'
import { autoTessellation, estimateStepSize, importStep } from 'meshstep'
const square = new Float32Array([0,0,0, 1,0,0, 1,1,0, 0,1,0])
const triangles = new Uint32Array([0,1,2, 0,2,3])
describe('STEP CAD boundaries, not triangle wireframe', () => {
  it('excludes the internal diagonal of a planar face', () => {
    expect(cadBoundarySegments(square, triangles, [1,1]).length / 6).toBe(4)
  })
  it('keeps a genuine face boundary even between tangent/coplanar faces', () => {
    expect(cadBoundarySegments(square, triangles, [1,2]).length / 6).toBe(5)
  })
  it('does not classify boundaries by a normal/angle threshold', () => {
    const bent = square.slice(); bent[8] = 2
    expect(cadBoundarySegments(bent, triangles, [1,1]).length / 6).toBe(4)
  })
  it('rejects missing face identities instead of drawing every triangle', () => {
    expect(() => cadBoundarySegments(square, triangles, [])).toThrow('face labels')
  })
  it('does not modify source vertices, indices or tags', () => {
    const a=Array.from(square), b=Array.from(triangles), tags=[1,2]
    cadBoundarySegments(square,triangles,tags)
    expect(Array.from(square)).toEqual(a);expect(Array.from(triangles)).toEqual(b);expect(tags).toEqual([1,2])
  })
  it('preserves STEP tessellation exactly while exposing only cube edges', () => {
    const text=cubeStep(20), size=estimateStepSize(text)!, auto=autoTessellation(size.diag)
    const original=importStep(text,{surfaceDeviation:auto.surfaceDeviation,maxEdge:Math.max(size.diag*.1,auto.maxEdge)})
    const parsed=parseSTEP(new TextEncoder().encode(text).buffer)
    expect(parsed.mesh.positions).toEqual(Float32Array.from(original.mesh.positions))
    expect(parsed.mesh.indices).toEqual(original.mesh.indices)
    // A straight CAD edge can contain several tessellation segments. Check
    // their geometric support and total length, not their subdivision count.
    const edges = parsed.cadEdges!, supports = new Set<string>()
    let length = 0
    for (let i=0;i<edges.length;i+=6) {
      const fixed = [0,1,2].filter(k=>edges[i+k]===edges[i+3+k] && (edges[i+k]===0 || edges[i+k]===20))
      expect(fixed.length).toBe(2)
      supports.add(fixed.map(k=>`${k}:${edges[i+k]}`).join('|'))
      length += Math.hypot(edges[i]-edges[i+3],edges[i+1]-edges[i+4],edges[i+2]-edges[i+5])
    }
    expect(supports.size).toBe(12)
    expect(length).toBeCloseTo(240,4)
  })
})


describe('STEP opened as Scan keeps its CAD boundaries', () => {
  it('preserves dense scan tessellation exactly and excludes all face-internal diagonals', () => {
    const text = cubeStep(20), size = estimateStepSize(text)!, auto = autoTessellation(size.diag)
    const original = importStep(text, { surfaceDeviation: auto.surfaceDeviation, maxEdge: Math.max(size.diag / 250, auto.maxEdge) })
    const parsed = parseSTEP(new TextEncoder().encode(text).buffer, undefined, true)
    expect(parsed.mesh.positions).toEqual(Float32Array.from(original.mesh.positions))
    expect(parsed.mesh.indices).toEqual(original.mesh.indices)
    const edges = parsed.cadEdges!, supports = new Set<string>()
    expect(edges.length).toBeGreaterThan(0)
    let length = 0
    for (let i = 0; i < edges.length; i += 6) {
      const fixed = [0, 1, 2].filter(k => edges[i+k] === edges[i+3+k] && (edges[i+k] === 0 || edges[i+k] === 20))
      expect(fixed.length).toBe(2)
      supports.add(fixed.map(k => `${k}:${edges[i+k]}`).join('|'))
      length += Math.hypot(edges[i]-edges[i+3], edges[i+1]-edges[i+4], edges[i+2]-edges[i+5])
    }
    expect(supports.size).toBe(12)
    expect(length).toBeCloseTo(240, 2)
  }, 60000)
})
