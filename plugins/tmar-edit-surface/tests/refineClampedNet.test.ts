// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { OcctKernel } from 'occt-wasm'
import { perforatedPlaneNet, replaceSurface, signature, surfaceTable, type Net } from '../brep'
import { refineClampedNet, type KnotInsertion } from '../refineClampedNet'

const fixture = (): Net => ({nu:4,nv:3,du:3,dv:2,ku:[-7,13],kv:[4,19],mu:[4,4],mv:[3,3],rational:[1,1],
  poles:Array.from({length:12},(_,i)=>[Math.floor(i/3)*3,i%3,Math.sin(i)]), weights:Array.from({length:12},(_,i)=>1+i/13)})

it('inserts both axes, existing/repeated knots, preserves source and allocates independent arrays',()=>{
  const original=fixture(), saved=structuredClone(original)
  const once=refineClampedNet(original,[{axis:'U',value:-2,count:1}])
  const next=refineClampedNet(once,[{axis:'U',value:-2,count:2},{axis:'V',value:9,count:2}])
  expect([next.nu,next.nv]).toEqual([7,5]); expect(next.mu).toEqual([4,3,4]); expect(next.mv).toEqual([3,2,3])
  expect(next.weights.every(w=>w>0)).toBe(true); expect(new Set(next.weights).size).toBeGreaterThan(1)
  expect(original).toEqual(saved); next.poles[0][0]=99; expect(original).toEqual(saved)
  const clone=refineClampedNet(original,[]); clone.ku[0]=99; expect(original).toEqual(saved)
})

it('refuses unsupported nets, invalid insertions, resource overflow and arithmetic overflow without mutation',()=>{
  const n=fixture(), saved=structuredClone(n)
  const invalid:KnotInsertion[][]=[ [{axis:'U',value:-7,count:1}], [{axis:'V',value:19,count:1}],
    [{axis:'V',value:9,count:3}], [{axis:'U',value:NaN,count:1}], [{axis:'U',value:0,count:0}],
    [{axis:'U',value:0,count:1.5}], [{axis:'U',value:0,count:2},{axis:'U',value:0,count:2}] ]
  for(const ops of invalid) expect(()=>refineClampedNet(n,ops)).toThrow()
  expect(()=>refineClampedNet(n,[{axis:'U',value:0,count:1}],12)).toThrow()
  for(const broken of [ {...n,periodic:[1,0] as [number,number]}, {...n,mu:[3,4]}, {...n,ku:[13,-7]},
    {...n,weights:n.weights.map(()=>0)}, {...n,rational:[0,0] as [number,number]}, {...n,du:0} ])
    expect(()=>refineClampedNet(broken,[])).toThrow()
  const huge={...n,poles:n.poles.map(()=>[Number.MAX_VALUE,0,0] as [number,number,number]),weights:n.weights.map(()=>Number.MAX_VALUE)}
  expect(()=>refineClampedNet(huge,[{axis:'U',value:0,count:1}])).toThrow()
  expect(n).toEqual(saved)
})

it.each([false,true])('preserves rational OCCT support, normals and trims (partial support and hole: %s)',async hole=>{
  const k=await OcctKernel.init(), owned:ReturnType<typeof k.makeBox>[]=[]
  const own=<T extends ReturnType<typeof k.makeBox>>(h:T):T=>{owned.push(h);return h}
  try {
    const box=own(k.makeBox(48,48,10)), cutter=hole?own(k.makeCylinder(2,14)):null
    const moved=cutter?own(k.translate(cutter,8,8,-2)):null, body=moved?own(k.cut(box,moved)):box
    const faces=k.getSubShapes(body,'face'); owned.push(...faces)
    const top=faces.find(f=>{const b=k.uvBounds(f);return Math.abs(k.pointOnSurface(f,(b.uMin+b.uMax)/2,(b.vMin+b.vMax)/2).z-10)<1e-8})!
    const b=k.uvBounds(top), plane=surfaceTable(k.toBREP(top)).find(r=>r.kind===1)!, text=k.toBREP(body)
    const rec=surfaceTable(text).find(r=>signature(r)===signature(plane))!, padding=hole?12:0
    const net=perforatedPlaneNet(plane,[b.uMin-padding,b.uMax+padding,b.vMin-padding,b.vMax+padding])
    net.rational=[1,1]
    const center=Math.floor(net.nu/2)*net.nv+Math.floor(net.nv/2)
    net.weights[center]=1.37; net.poles[center][2]+=.4
    const raw=own(k.fromBREP(replaceSurface(text,rec,net))), prepared=own(k.fixShape(raw))
    expect(k.isValid(prepared)).toBe(true)
    const baseline=own(k.importStep(k.exportStep(prepared))), baselineText=k.toBREP(baseline)
    const target=surfaceTable(baselineText).find(r=>r.net)!, base=target.net!
    const u=base.ku[0]+.31*(base.ku.at(-1)!-base.ku[0]), v=base.kv[0]+.63*(base.kv.at(-1)!-base.kv[0])
    const refined=refineClampedNet(base,[{axis:'U',value:u,count:2},{axis:'V',value:v,count:2},
      {axis:'U',value:base.ku[2],count:1}])
    const changed=replaceSurface(baselineText,target,refined)
    // The support record is the only changed byte range: pcurves, trim/topology,
    // tolerances and every unrelated support record remain exactly as stored.
    expect(changed.slice(0,target.start)).toBe(baselineText.slice(0,target.start))
    expect(changed.endsWith(baselineText.slice(target.end))).toBe(true)
    const after=own(k.fromBREP(changed)); expect(k.isValid(after)).toBe(true)
    const round=own(k.importStep(k.exportStep(after))); expect(k.isValid(round)).toBe(true)
    const beforeFaces=k.getSubShapes(baseline,'face');owned.push(...beforeFaces)
    for(const shape of [after,round]) {
      const afterFaces=k.getSubShapes(shape,'face');owned.push(...afterFaces)
      expect(afterFaces.length).toBe(beforeFaces.length)
      for(let f=0;f<beforeFaces.length;f++) {
        const original=beforeFaces[f], current=afterFaces[f], bounds=k.uvBounds(original)
        expect(k.uvBounds(current)).toEqual(bounds)
        for(let i=0;i<=16;i++) for(let j=0;j<=16;j++) {
          const uu=bounds.uMin+(bounds.uMax-bounds.uMin)*i/16, vv=bounds.vMin+(bounds.vMax-bounds.vMin)*j/16
          const a=k.pointOnSurface(original,uu,vv),c=k.pointOnSurface(current,uu,vv)
          expect(Math.hypot(a.x-c.x,a.y-c.y,a.z-c.z)).toBeLessThan(1e-8)
          const na=k.surfaceNormal(original,uu,vv),nc=k.surfaceNormal(current,uu,vv)
          expect(na.x*nc.x+na.y*nc.y+na.z*nc.z).toBeGreaterThan(1-1e-10)
          expect(k.classifyPointOnFace(current,uu,vv)).toBe(k.classifyPointOnFace(original,uu,vv))
        }
        const a=k.getSubShapes(original,'wire'),c=k.getSubShapes(current,'wire');owned.push(...a,...c)
        expect(c.length).toBe(a.length)
      }
    }
  } finally { for(const handle of owned.reverse())k.release(handle); k[Symbol.dispose]() }
},60000)
