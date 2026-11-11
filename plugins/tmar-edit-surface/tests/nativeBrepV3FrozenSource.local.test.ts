// SPDX-License-Identifier: AGPL-3.0-only
// Gated, new native regression: source BREP bytes are never committed or edited.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { it, expect } from 'vitest'
import { OcctKernel, type ShapeHandle } from 'occt-wasm'
import { surfaceTable, type Net } from '../brep'
import { rewriteDetachedTubeFaceV3, type NativeV3Curve } from '../experimentalNativeBrepV3'

const frozenDir=process.env.TMAR_NATIVE_V3_FROZEN_DIR
const pins:Record<number,string>={
  321:'10c20fdbd4752cb4642ffd9ec8a4d6f7860dd8d4ef9c93d979bcc7e6cda5ce0a',
  322:'9ee0420ec25064f89bdaa049f9f1e6899c6c0a185d4797f53831bd0212ccfa64',
  323:'be5d618395055efb262e53c200e435754a5675b870a9d19e8d422f2156ef2148',
}
const sha=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex')
const read=(id:number)=>{if(!frozenDir)throw Error('No frozen directory')
  const b=readFileSync(join(frozenDir,'face-'+id+'.source.brep'))
  expect(sha(b)).toBe(pins[id]);return b.toString('utf8')
}
const support=(s:string):Net=>{const n=surfaceTable(s)[0].periodicNet
  if(!n)throw Error('Missing native support');return n}
const curve=(net:Net):NativeV3Curve=>({
  degree:net.dv,poles:net.poles.slice(0,net.nv).map(p=>[...p]),
  knots:[...net.kv],multiplicities:[...net.mv],periodic:false,rational:false,
})
;(frozenDir?it:it.skip)('new frozen-source V3 identity, guarded synthetic perturbation and native readback',async()=>{
  const k=await OcctKernel.init(),owned:ShapeHandle[]=[]
  const own=(x:ShapeHandle)=>{owned.push(x);return x}
  try {
    const b322=read(322),b322sha=sha(b322)
    for(const face of [321,323] as const){
      const original=read(face),base=support(original)
      const unmodified=rewriteDetachedTubeFaceV3({face,sourceBrep:original,candidateNet:base,candidateSeam:curve(base)})
      console.info('V3_DIAGNOSTIC', face, unmodified.status, unmodified.status==='inconclusive'?unmodified.reason:'ok')
      expect(unmodified.status).toBe('rewritten')
      if(unmodified.status!=='rewritten')throw Error(unmodified.reason)
      expect(support(unmodified.brep).poles).toEqual(base.poles)
      expect(unmodified.topologyAndPcurvesByteIdentical).toBe(true)
      const edited:Net={...base,poles:base.poles.map(p=>[...p])}
      edited.poles[10*base.nv+5][2]+=1e-4
      const materialized=rewriteDetachedTubeFaceV3({face,sourceBrep:original,candidateNet:edited,candidateSeam:curve(edited)})
      expect(materialized.status).toBe('rewritten')
      if(materialized.status!=='rewritten')throw Error(materialized.reason)
      expect(support(materialized.brep).poles[10*base.nv+5][2]-base.poles[10*base.nv+5][2]).toBeCloseTo(1e-4,6)
      const a=own(k.fromBREP(original)),b=own(k.fromBREP(materialized.brep))
      expect(k.isValid(a)).toBe(true);expect(k.isValid(b)).toBe(true)
      expect(k.shapeOrientation(b)).toBe(k.shapeOrientation(a))
      const af=k.getSubShapes(a,'face').map(own),bf=k.getSubShapes(b,'face').map(own)
      const ae=k.getSubShapes(a,'edge').map(own),be=k.getSubShapes(b,'edge').map(own)
      expect(af.length).toBe(1);expect(bf.length).toBe(1);expect(ae.length).toBe(be.length)
      const bad:Net={...base,poles:base.poles.map(p=>[...p])}
      bad.poles[11*base.nv][0]+=1e-3
      expect(rewriteDetachedTubeFaceV3({face,sourceBrep:original,candidateNet:bad,candidateSeam:curve(bad)}))
        .toEqual({status:'inconclusive',reason:'protected-v-boundary-changed'})
      const mismatched=curve(edited);mismatched.poles[1][2]+=1e-2
      expect(rewriteDetachedTubeFaceV3({face,sourceBrep:original,candidateNet:edited,candidateSeam:mismatched}))
        .toEqual({status:'inconclusive',reason:'seam-is-not-exact-candidate-u0'})
      expect(sha(read(face))).toBe(pins[face])
    }
    expect(sha(read(322))).toBe(b322sha)
  }finally{
    for(const h of owned.reverse())k.release(h)
    k[Symbol.dispose]()
  }
},120_000)

;(frozenDir?it:it.skip)('new seam-curve replacement readback: own 3D curve and both UV branches',async()=>{
  const k=await OcctKernel.init(),owned:ShapeHandle[]=[]
  const own=(h:ShapeHandle)=>{owned.push(h);return h}
  try {
    for(const face of [321,323] as const) {
      const raw=read(face),n=support(raw)
      // This distinct synthetic perturbation targets U0, unlike the previous
      // internal-pole fixture. Both protected V end rows stay exactly fixed.
      const modified:Net={...n,poles:n.poles.map(p=>[...p])}
      modified.poles[5][2]+=1e-4
      const candidate=rewriteDetachedTubeFaceV3({face,sourceBrep:raw,candidateNet:modified,candidateSeam:curve(modified)})
      expect(candidate.status).toBe('rewritten')
      if(candidate.status!=='rewritten')throw Error(candidate.reason)
      const native=own(k.fromBREP(candidate.brep))
      expect(k.isValid(native)).toBe(true)
      const faces=k.getSubShapes(native,'face').map(own)
      const edges=k.getSubShapes(native,'edge').map(own)
      expect(faces).toHaveLength(1)
      expect(edges).toHaveLength(3)
      const matches=edges.flatMap(e=>{
        const c=k.getNurbsCurveData(e)
        return c.degree===5&&c.poles.length===36?[{edge:e,curve:c}]:[]
      })
      expect(matches).toHaveLength(1)
      const edge=matches[0].edge, observed=matches[0].curve
      expect(observed.poles).toEqual(modified.poles.slice(0,12).flat())
      const interval=k.curveParameters(edge)
      expect(interval.first).toBe(0);expect(interval.last).toBe(1)
      const uv=k.uvBounds(faces[0])
      for(const v of [0.25,0.5,0.75]) {
        const at=k.curvePointAtParam(edge,v)
        const left=k.pointOnSurface(faces[0],uv.uMin,v)
        const right=k.pointOnSurface(faces[0],uv.uMax,v)
        const gap=(p:typeof at)=>Math.hypot(at.x-p.x,at.y-p.y,at.z-p.z)
        expect(gap(left)).toBeLessThanOrEqual(1e-7)
        expect(gap(right)).toBeLessThanOrEqual(1e-7)
      }
      console.info('NATIVE_NEW_U_SEAM',face,{valid:true,curvePoles:12,pcurveBranches:2})
    }
  }finally { for(const h of owned.reverse())k.release(h);k[Symbol.dispose]() }
},120_000)



;(frozenDir?it:it.skip)('new refusal coverage: wrong source face, altered seam pcurve and candidate metadata',()=>{
  for(const face of [321,323] as const) {
    const original=read(face),net=support(original)
    const a=rewriteDetachedTubeFaceV3({face:322 as never,sourceBrep:original,
      candidateNet:net,candidateSeam:curve(net)})
    expect(a).toEqual({status:'inconclusive',reason:'invalid-request'})
    const badWeights:Net={...net,weights:[...net.weights]}
    badWeights.weights[0]=1.01
    expect(rewriteDetachedTubeFaceV3({face,sourceBrep:original,
      candidateNet:badWeights,candidateSeam:curve(badWeights)}))
      .toEqual({status:'inconclusive',reason:'candidate-support-metadata-or-poles-invalid'})
    const tampered=original.replace('3  3 4C2 1 0 0 1','3  3 4C2 2 0 0 1')
    expect(tampered).not.toBe(original)
    expect(rewriteDetachedTubeFaceV3({face,sourceBrep:tampered,
      candidateNet:net,candidateSeam:curve(net)}))
      .toEqual({status:'inconclusive',reason:'own-u-seam-dual-uv-graph-mismatch'})
  }
})
