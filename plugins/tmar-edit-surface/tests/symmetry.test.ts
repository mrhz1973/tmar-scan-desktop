// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { mirrorPartners, mirrorEdit } from '../symmetry'
import { SurfaceEditorKernel } from '../editorKernel'
import { boundaryLocked, type Point } from '../brep'

it('edits reflected poles on an imported solid, preserves the edges and reopens a symmetric STEP', async () => {
  const editor = await SurfaceEditorKernel.load(), k = editor.kernel
  const box = k.makeBox(20, 30, 10), step = k.exportStep(box)
  k.release(box)
  try {
    const opened = editor.open(step)
    const face = opened.faces.find(f=>editor.select(f.index).poles.every(p=>Math.abs(p[2]-10)<1e-7))!
    const net = editor.select(face.index), pairs = mirrorPartners(net.poles,0,10)
    const locks = net.poles.flatMap((_,i)=>boundaryLocked(net,i,'G0')?[i]:[])
    const i = net.poles.findIndex((p,i)=>p[0]<10-1e-7 && !locks.includes(i))
    const j = pairs[i]
    expect(i).toBeGreaterThanOrEqual(0); expect(j).toBeGreaterThanOrEqual(0); expect(i).not.toBe(j)
    const request = structuredClone(net.poles)
    request[i][2]+=2
    expect(()=>mirrorEdit(net.poles,request,pairs,0,10,[...locks,j])).toThrow(/bloccato/)
    const poles = mirrorEdit(net.poles,request,pairs,0,10,locks)
    expect(poles[j][2]).toBeCloseTo(request[i][2],10)
    const result = editor.evaluate({...net,poles},'G0',true)
    expect(result.valid).toBe(true); expect(result.volume).toBeGreaterThan(6000)
    expect(result.maxBoundaryError).toBeLessThan(1e-7)
    const shape=k.importStep(result.step!), faces=k.getSubShapes(shape,'face')
    try {
      expect(k.isValid(shape)).toBe(true)
      expect(faces).toHaveLength(6)
      const top=faces.find(f=>{const b=k.uvBounds(f);return k.pointOnSurface(f,(b.uMin+b.uMax)/2,(b.vMin+b.vMax)/2).z>10})!
      const b=k.uvBounds(top)
      const points=Array.from({length:9},(_,u)=>Array.from({length:9},(_,v)=>k.pointOnSurface(top,b.uMin+(b.uMax-b.uMin)*u/8,b.vMin+(b.vMax-b.vMin)*v/8))).flat()
      for(const p of points) expect(points.some(q=>Math.hypot(q.x-(20-p.x),q.y-p.y,q.z-p.z)<1e-7)).toBe(true)
    }finally{faces.forEach(f=>k.release(f));k.release(shape)}
  }finally{editor.dispose()}
})

it('constrains points on the plane and refuses ambiguous or missing pairs',()=>{
  const start:Point[]=[[0,3,4],[1,0,0],[-1,0,0],[-1,0,0],[5,6,7]]
  const pairs=mirrorPartners(start,0,0)
  const req=structuredClone(start);req[0]=[4,7,9]
  expect(mirrorEdit(start,req,pairs,0,0,[])[0]).toEqual([0,7,9])
  for(const i of [1,2,3,4]){
    const edit=structuredClone(start);edit[i][2]++
    expect(()=>mirrorEdit(start,edit,pairs,0,0,[])).toThrow()
  }
})
