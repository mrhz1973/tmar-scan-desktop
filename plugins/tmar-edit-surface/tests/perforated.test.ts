// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { SurfaceEditorKernel } from '../editorKernel'
import { boundaryLocked } from '../brep'

it('moves an imported planar STEP face while preserving its through hole', async () => {
  const editor = await SurfaceEditorKernel.load(), k = editor.kernel
  const block = k.makeBox(48, 48, 10), tool = k.makeCylinder(3, 14)
  const positioned = k.translate(tool, 12, 12, -2), drilled = k.cut(block, positioned)
  try {
    const step = k.exportStep(drilled)
    const { faces } = editor.open(step)
    const index = faces.find(f => f.trimLocks.length && editor.select(f.index).poles.every(p => Math.abs(p[2]-10)<1e-7))?.index
    expect(index).toBeDefined()
    const info = faces[index!], net = editor.select(index!)
    const free = net.poles.findIndex((p,i) => !boundaryLocked(net,i,'G1') && !info.trimLocks.includes(i) && p[0]>25 && p[1]>25)
    expect(free).toBeGreaterThan(-1)
    const blocked = info.trimLocks.find(i => !boundaryLocked(net,i,'G1'))!
    const bad = structuredClone(net); bad.poles[blocked][2] += 1
    expect(()=>editor.evaluate(bad,'G1')).toThrow(/protetto/)
    net.poles[free][2] += 2
    const exportResult = editor.evaluate(net,'G1',true)
    const recipe = await editor.createRecipe(net,'G1',[],'drilled-plate')
    const replayed = await editor.replayRecipe(step,recipe,'drilled-plate')
    expect(replayed.valid).toBe(true)
    expect(replayed.volume).toBeCloseTo(exportResult.volume,8)
    const reopened = k.importStep(exportResult.step!), fs = k.getSubShapes(reopened,'face')
    try {
      expect(k.isValid(reopened)).toBe(true)
      expect(fs.length).toEqual(faces.length)
      expect(k.getVolume(reopened)).toBeGreaterThan(k.getVolume(drilled)+1)
      const top = fs.find(f=>k.surfaceType(f).toLowerCase().includes('spline'))!
      expect(top).toBeDefined()
      const wires = k.getSubShapes(top,'wire')
      expect(wires.length).toBe(2)
      wires.forEach(w=>k.release(w))
      for(let i=0;i<36;i++) {
        const a=2*Math.PI*i/36, q={x:12+3*Math.cos(a),y:12+3*Math.sin(a),z:10}
        const uv=k.uvFromPoint(top,q), p=k.pointOnSurface(top,uv.u,uv.v), n=k.surfaceNormal(top,uv.u,uv.v)
        expect(Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z)).toBeLessThan(1e-7)
        expect(Math.abs(n.z)).toBeGreaterThan(1-1e-9)
      }
    } finally { fs.forEach(f=>k.release(f)); k.release(reopened) }
  } finally { [drilled,positioned,tool,block].forEach(h=>k.release(h)); editor.dispose() }
},60000)
