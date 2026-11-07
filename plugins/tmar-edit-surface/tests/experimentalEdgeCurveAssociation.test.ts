// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { ShapeHandle } from 'occt-wasm'
import { SurfaceEditorKernel } from '../editorKernel'
import { replaceSurface, surfaceTable, type Net, type Point } from '../brep'
import { associateSerializedEdgeCurve } from '../experimentalEdgeCurveAssociation'

async function serializedEdge() {
  const editor = await SurfaceEditorKernel.load(), k = editor.kernel
  const edge = k.makeBSplineEdge([0,0,0, 1,1,0, 2,1,0, 3,0,0], [], [0,1], [4,4], 3)
  try { return k.toBREP(edge) }
  finally { k.release(edge); editor.dispose() }
}

function seamNet(startX: number, bounds: {uMin:number;uMax:number;vMin:number;vMax:number}): Net {
  const poles: Point[] = [], x = [startX,startX+5,startX+10], y = [0,5,10], z = [0,2,0]
  for (let u=0;u<3;u++) for (let v=0;v<3;v++) {
    const q: Point = [x[u],y[v],z[v] + (startX >= 10 && u === 1 ? [0,4,0][v] : startX >= 10 && u === 2 ? [0,8,0][v] : 0)]
    if (startX < 10 && u === 2) q[0] = 10
    if (startX >= 10 && u === 0) q[0] = 10
    poles.push(q)
  }
  return {nu:3,nv:3,du:2,dv:2,poles,weights:poles.map(()=>1),rational:[0,0],ku:[bounds.uMin,bounds.uMax],kv:[bounds.vMin,bounds.vMax],mu:[3,3],mv:[3,3]}
}

async function serializedSharedEdge() {
  const editor = await SurfaceEditorKernel.load(), k = editor.kernel, owned: ShapeHandle[] = []
  const own = (h: ShapeHandle) => { owned.push(h); return h }
  try {
    const build = (startX: number) => {
      const corners = [{x:startX,y:0,z:0},{x:startX+10,y:0,z:0},{x:startX+10,y:10,z:0},{x:startX,y:10,z:0}]
      const wire = own(k.makeWire(corners.map((p,i)=>own(k.makeLineEdge(p,corners[(i+1)%4])))))
      const seed = own(k.makeFace(wire)), seedText = k.toBREP(seed), record = surfaceTable(seedText).find(r=>r.kind===1)!
      const net = seamNet(startX,k.uvBounds(seed)), support = own(k.fromBREP(replaceSurface(seedText,record,net)))
      const edge = (ids:number[]) => own(k.makeBSplineEdge(ids.flatMap(i=>net.poles[i]),ids.map(()=>1),net.kv,net.mv,net.dv))
      const boundary = own(k.makeWire([edge([0,1,2]),edge([2,5,8]),edge([8,7,6]),edge([6,3,0])]))
      return own(k.fixShape(own(k.makeFaceOnSurface(support,boundary))))
    }
    const joined = own(k.sew([build(0),build(10)],1e-7)), faces = k.getSubShapes(joined,'face')
    faces.forEach(own)
    const shared = k.sharedEdges(faces[0],faces[1]); shared.forEach(own)
    expect(shared).toHaveLength(1)
    return k.toBREP(shared[0])
  } finally { owned.reverse().forEach(h=>k.release(h)); editor.dispose() }
}

it('associates an actual serialized OCCT edge with its indexed complete curve record', async () => {
  const text = await serializedEdge()
  const result = associateSerializedEdgeCurve(text)
  expect(result.curveIndex).toBe(1)
  expect(result.range).toEqual([result.curve.knots[0], result.curve.knots.at(-1)])
  expect(result.curve.source).toBe('curve-table')
}, 60000)

it('reads pcurve and continuity representations on an actual shared OCCT edge', async () => {
  const text = await serializedSharedEdge()
  const result = associateSerializedEdgeCurve(text)
  expect(result.pcurveCount).toBeGreaterThanOrEqual(2)
  expect(result.continuityCount).toBeGreaterThanOrEqual(1)
  const pcurve = /^(2\s+\d+\s+\d+\s+0\s+)([-\deE+.]+)(\s+[-\deE+.]+)$/m
  const reject = (bad:string) => expect(() => associateSerializedEdgeCurve(bad)).toThrow()
  reject(text.replace(pcurve, (_all,prefix:string,first:string,last:string)=>`${prefix}${Number(first)+0.1}${last}`))
  reject(text.replace(pcurve, (_all,prefix:string,first:string,last:string)=>`${prefix.trim().split(/\s+/).map((x:string,i:number)=>i===1?'999':x).join(' ')} ${first}${last}`))
  reject(text.replace(pcurve, (_all,prefix:string,first:string,last:string)=>`${prefix.trim().split(/\s+/).map((x:string,i:number)=>i===3?'1':x).join(' ')} ${first}${last}`))
}, 60000)

it('fails closed for missing flags, transforms, wrong indices, trims, and ambiguous edges', async () => {
  const text = await serializedEdge()
  const edgeHeader = /^Ed\s*\n([^\n]*)$/m
  const rep = /^(1\s+\d+\s+0\s+)([-\deE+.]+)(\s+[-\deE+.]+)$/m
  expect(text).toMatch(edgeHeader)
  expect(text).toMatch(rep)
  const reject = (bad: string) => expect(() => associateSerializedEdgeCurve(bad)).toThrow()

  reject(text.replace(edgeHeader, (_all, h: string) => `Ed\n${h.trim().split(/\s+/).map((x: string, i: number) => i === 1 ? '0' : x).join(' ')}`))
  reject(text.replace(rep, '$1')) // incomplete representation
  reject(text.replace(rep, (_all, prefix: string, first: string, last: string) => `${prefix.trim().split(/\s+/).map((x: string, i: number) => i === 2 ? '1' : x).join(' ')} ${first}${last}`))
  reject(text.replace(rep, (_all, prefix: string, first: string, last: string) => `${prefix.trim().split(/\s+/).map((x: string, i: number) => i === 1 ? '99' : x).join(' ')} ${first}${last}`))
  reject(text.replace(rep, (_all, prefix: string, first: string, last: string) => `${prefix}${Number(first) + 0.1}${last}`))
  const edgeRecord = text.match(/^Ed\s*\n[^\n]*\n[\s\S]*?^0\s*$/m)![0]
  reject(text.replace(edgeRecord, `${edgeRecord}\n${edgeRecord}`))
}, 60000)
