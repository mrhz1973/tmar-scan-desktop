// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { SurfaceEditorKernel } from '../editorKernel'
import { boundaryLocked, signature, surfaceTable } from '../brep'

describe('embedded OCCT curve record boundaries', () => {
  const examples = [
    '1 1 2 3 1 0 0',
    '2 1 2 3 0 0 1 1 0 0 0 1 0 4',
    '3 1 2 3 0 0 1 1 0 0 0 1 0 5 4',
    '4 1 2 3 0 0 1 1 0 0 0 1 0 16',
    '5 1 2 3 0 0 1 1 0 0 0 1 0 5 4',
    '6 1 2 0 0 0 1 1 0 0 1 2 0 0 1',
    '7 1 1 2 3 3 0 0 0 1 1 0 0 1 2 0 0 1 0 1 0.5 1 1 1',
    '8 0 1 7 0 0 2 3 2 0 0 0 1 0 0 2 0 0 0 3 1 3',
    '9 2 0 1 0 1 1 2 3 1 0 0',
  ]
  it.each(examples)('keeps the following surface separate for curve %s', curve => {
    const sentinel = '1 2 3 4 0 0 1 1 0 0 0 1 0'
    const input = `CASCADE Topology V3\nLocations 0\nSurfaces 2\n6 0 0 1\n${curve}\n${sentinel}\nTriangulations 0\n`
    const records = surfaceTable(input)
    expect(records.map(r => r.kind)).toEqual([6, 1])
    expect(input.slice(records[0].start, records[0].end)).toBe(`6 0 0 1\n${curve}`)
    expect(input.slice(records[1].start, records[1].end)).toBe(sentinel)
  })
  it('rejects an unrecognized embedded curve instead of guessing its boundary', () => {
    const input = 'CASCADE Topology V3\nLocations 0\nSurfaces 1\n6 0 0 1 12 0\nTriangulations 0\n'
    expect(() => surfaceTable(input)).toThrow()
  })
})

describe('STEP solids with mixed support surfaces', () => {
  it('edits an eligible plane without changing an adjacent spline extrusion', async () => {
    const editor = await SurfaceEditorKernel.load(), k = editor.kernel
    const p = (x: number, y: number) => ({ x, y, z: 0 })
    const spline = k.makeBSplineEdge([0,0,0, 3,-1,0, 7,-1,0, 10,0,0], [], [0,1], [4,4], 3)
    const a = k.makeLineEdge(p(10,0),p(10,10)), b = k.makeLineEdge(p(10,10),p(0,10))
    const c = k.makeLineEdge(p(0,10),p(0,0)), wire = k.makeWire([spline,a,b,c]), face = k.makeFace(wire)
    const solid = k.extrude(face,0,0,10)
    try {
      expect(k.isValid(solid)).toBe(true)
      const step = k.exportStep(solid), baseline = k.importStep(step)
      let supportBefore: string
      try {
        const kinds = k.getSubShapes(baseline, 'face')
        try { expect(kinds.some(f => k.surfaceType(f) === 'extrusion')).toBe(true) }
        finally { kinds.forEach(f => k.release(f)) }
        supportBefore = signature(surfaceTable(k.toBREP(baseline)).find(r => r.kind === 6)!)
      } finally { k.release(baseline) }
      const opened = editor.open(step)
      expect(opened.faces.find(f => f.kind === 'extrusion')?.reason).toBeTruthy()
      const plane = opened.faces.find(f => f.kind === 'plane' && !f.reason &&
        editor.select(f.index).poles.every(pole => Math.abs(pole[1]-10) < 1e-7))
      expect(plane).toBeDefined()
      const net = editor.select(plane!.index), changed = structuredClone(net)
      changed.poles[12][1] += 0.1
      const result = editor.evaluate(changed, 'G1', true)
      expect(result.valid).toBe(true)
      expect(Math.abs(result.volume-k.getVolume(solid))).toBeGreaterThan(1e-4)
      expect(result.maxBoundaryError).toBeLessThan(1e-8)
      const copy = k.importStep(result.step!)
      try {
        expect(k.isValid(copy)).toBe(true)
        const solids = k.getSubShapes(copy, 'solid')
        try { expect(solids).toHaveLength(1) } finally { solids.forEach(s => k.release(s)) }
        expect(signature(surfaceTable(k.toBREP(copy)).find(r => r.kind === 6)!)).toBe(supportBefore)
      } finally { k.release(copy) }
    } finally { [solid,face,wire,c,b,a,spline].forEach(h => k.release(h)); editor.dispose() }
  }, 60000)

  it('edits an eligible plane while preserving a neighboring surface of revolution', async () => {
    const editor = await SurfaceEditorKernel.load(), k = editor.kernel
    const p = (x: number, z: number) => ({ x, y: 0, z })
    const spline = k.makeBSplineEdge([6,0,0, 7,0,-1, 9,0,-1, 10,0,0], [], [0,1], [4,4], 3)
    const a = k.makeLineEdge(p(10,0),p(10,10)), b = k.makeLineEdge(p(10,10),p(6,10))
    const c = k.makeLineEdge(p(6,10),p(6,0)), wire = k.makeWire([spline,a,b,c]), face = k.makeFace(wire)
    const solid = k.revolve(face, { point:p(0,0), direction:{x:0,y:0,z:1} }, Math.PI/2)
    try {
      expect(k.isValid(solid)).toBe(true)
      const step = k.exportStep(solid), baseline = k.importStep(step)
      let supportBefore: string
      try { supportBefore = signature(surfaceTable(k.toBREP(baseline)).find(r => r.kind === 7)!) }
      finally { k.release(baseline) }
      const opened = editor.open(step)
      expect(opened.faces.find(f => f.kind === 'revolution')?.reason).toBeTruthy()
      const eligible = opened.faces.filter(f => f.kind === 'plane' && !f.reason).map(info => {
        const net = editor.select(info.index)
        return { info, net, pole: net.poles.findIndex((_,i) => !info.trimLocks.includes(i) && !boundaryLocked(net,i,'G1')) }
      }).find(item => item.pole >= 0)
      expect(eligible).toBeDefined()
      const net = editor.select(eligible!.info.index), changed = structuredClone(net)
      const a = net.poles[0], b = net.poles[(net.nu-1)*net.nv], c = net.poles[net.nv-1]
      const u = b.map((v,i) => v-a[i]), v = c.map((n,i) => n-a[i])
      const cross = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]
      const length = Math.hypot(...cross)
      expect(length).toBeGreaterThan(0)
      for (let d=0; d<3; d++) changed.poles[eligible!.pole][d] += cross[d] / length * 0.05
      const result = editor.evaluate(changed, 'G1', true)
      expect(result.valid).toBe(true)
      expect(result.maxBoundaryError).toBeLessThan(1e-8)
      expect(Math.abs(result.volume-k.getVolume(solid))).toBeGreaterThan(1e-6)
      const copy = k.importStep(result.step!)
      try {
        expect(k.isValid(copy)).toBe(true)
        const solids = k.getSubShapes(copy, 'solid')
        try { expect(solids).toHaveLength(1) } finally { solids.forEach(s => k.release(s)) }
        expect(signature(surfaceTable(k.toBREP(copy)).find(r => r.kind === 7)!)).toBe(supportBefore)
      } finally { k.release(copy) }
    } finally { [solid,face,wire,c,b,a,spline].forEach(h => k.release(h)); editor.dispose() }
  }, 60000)
})
