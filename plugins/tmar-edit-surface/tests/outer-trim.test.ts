// SPDX-License-Identifier: AGPL-3.0-only
import { it, expect } from 'vitest'
import type { OcctKernel, ShapeHandle } from 'occt-wasm'
import { SurfaceEditorKernel } from '../editorKernel'
import { boundaryLocked } from '../brep'

function topologyTolerances(k: OcctKernel, shape: ShapeHandle) {
  const text=k.toBREP(shape)
  const read=(kind:string)=>Array.from(text.matchAll(new RegExp(`^${kind}\\s*\\n\\s*([\\deE+.-]+)`,'gm')),m=>Number(m[1]))
  return {edges:read('Ed'),vertices:read('Ve')}
}

it('deforms the middle of a STEP disk while keeping its circular outside edge', async () => {
  const editor = await SurfaceEditorKernel.load(), k = editor.kernel
  const cylinder = k.makeCylinder(24,10), input=k.exportStep(cylinder), source=k.importStep(input)
  try {
    const before=topologyTolerances(k,source)
    expect(before.edges.length).toBeGreaterThan(0);expect(before.vertices.length).toBeGreaterThan(0)
    const opened = editor.open(input)
    // Keep the unqualified analytic side closed to editing; rejecting it must
    // still leave the supported planar cap available for a safe CAD edit.
    const side=opened.faces.find(f=>f.kind==='cylinder')
    expect(side?.reason).toBeTruthy()
    expect(()=>editor.select(side!.index)).toThrow()
    const face = opened.faces.find(f=>!f.reason && editor.select(f.index).poles.every(p=>Math.abs(p[2]-10)<1e-7))
    expect(face).toBeDefined()
    const net = editor.select(face!.index)
    const center = net.poles.findIndex(p=>Math.hypot(p[0],p[1])<1e-7)
    expect(center).toBeGreaterThan(-1)
    expect(boundaryLocked(net,center,'G1') || face!.trimLocks.includes(center)).toBe(false)
    net.poles[center][2] += 2
    const edited = editor.evaluate(net,'G1',true)
    const solid=k.importStep(edited.step!), faces=k.getSubShapes(solid,'face')
    try {
      expect(k.isValid(solid)).toBe(true)
      expect(k.getVolume(solid)).toBeGreaterThan(k.getVolume(cylinder)+1)
      const after=topologyTolerances(k,solid)
      expect(after.edges.length).toBe(before.edges.length);expect(after.vertices.length).toBe(before.vertices.length)
      expect(Math.max(...after.edges)).toBeLessThanOrEqual(Math.max(...before.edges)+1e-9)
      expect(Math.max(...after.vertices)).toBeLessThanOrEqual(Math.max(...before.vertices)+1e-9)
      const top=faces.find(f=>k.surfaceType(f).toLowerCase().includes('spline'))!
      const wire=k.outerWire(top)
      try {
        for(let i=0;i<72;i++){
          const x=24*Math.cos(i*Math.PI/36), y=24*Math.sin(i*Math.PI/36)
          const v=k.makeVertex(x,y,10)
          try { expect(k.distanceBetween(v,wire)).toBeLessThan(1e-7) } finally {k.release(v)}
          const uv=k.uvFromPoint(top,{x,y,z:10}), point=k.pointOnSurface(top,uv.u,uv.v)
          expect(Math.hypot(point.x-x,point.y-y,point.z-10)).toBeLessThan(1e-7)
        }
      } finally {k.release(wire)}
    } finally {faces.forEach(f=>k.release(f));k.release(solid)}
  } finally {k.release(source);k.release(cylinder);editor.dispose()}
},60000)
