// SPDX-License-Identifier: AGPL-3.0-only
import { beforeAll, describe, expect, it } from 'vitest'
import { smoothMesh } from '../../mesh-tools/core/smooth'
import { useMeshTools, MESH_SETTINGS } from '../../mesh-tools/state/meshStore'
import { remapVertices } from '../../../src/core/geometry/remap'
import { buildBinaryPly } from '../../mesh-tools/core/plyWriter'
import { parsePLY } from '../../../src/core/parsers/ply'
import { buildMeshGraph } from '../../../src/core/geometry/buildGraph'
function grid() {
 const p:number[]=[],tri:number[]=[],n=24
 for(let j=0;j<=n;j++)for(let i=0;i<=n;i++)p.push(i*.4,j*.4,.04*Math.sin(i*1.7)*Math.cos(j*1.9))
 for(let j=0;j<n;j++)for(let i=0;i<n;i++){const a=j*(n+1)+i;tri.push(a,a+1,a+n+2,a,a+n+2,a+n+1)}
 return {p:Float32Array.from(p),tri:Uint32Array.from(tri),n:(n+1)**2}
}
const input=grid(),settings={size:1.2,limit:.03,keepEdges:false}
let full:ReturnType<typeof smoothMesh>
beforeAll(()=>{full=smoothMesh(input.p,input.tri,input.n,settings)})
describe('bounded Smooth intensity',()=>{
 it('100% is exactly the existing full algorithm',()=>{
   expect(smoothMesh(input.p,input.tri,input.n,{...settings,strength:1}).positions).toEqual(full.positions)
 })
 it('0% leaves used vertices unchanged',()=>{
   expect(smoothMesh(input.p,input.tri,input.n,{...settings,strength:0}).positions).toEqual(input.p)
 })
 it.each([.25,.5,.75])('intensity %s scales full displacement without changing topology',strength=>{
   const out=smoothMesh(input.p,input.tri,input.n,{...settings,strength})
   expect(out.indices).toEqual(full.indices);expect(out.vertexMap).toEqual(full.vertexMap)
   for(let i=0;i<out.positions.length;i++)expect(out.positions[i]).toBeCloseTo(input.p[i]+strength*(full.positions[i]-input.p[i]),5)
   expect(out.report.maxMove).toBeLessThanOrEqual(settings.limit*strength+1e-6)
 })
 it('keeps all outside-region points unchanged and maps a repeated region through PLY',()=>{
   const region=Uint32Array.from(Array.from({length:input.n},(_,i)=>i).filter(i=>i%25<12))
   const out=smoothMesh(input.p,input.tri,input.n,{...settings,region,strength:.5})
   const selected=new Set(region)
   for(let v=0;v<input.n;v++)if(!selected.has(v))for(let k=0;k<3;k++)expect(out.positions[out.vertexMap[v]*3+k]).toBe(input.p[v*3+k])
   const kept=remapVertices(region,out.vertexMap)
   const reloaded=buildMeshGraph(parsePLY(buildBinaryPly(out.positions,out.indices).buffer as ArrayBuffer))
   expect(reloaded.positions).toEqual(out.positions)
   const second=smoothMesh(reloaded.positions,reloaded.indices,reloaded.vertexCount,{...settings,region:kept,strength:.5})
   expect(remapVertices(kept,second.vertexMap)).toEqual(kept)
   expect(second.report.region).toBe(region.length)
 })
 it.each([-1,1.1,Infinity,NaN])('rejects invalid intensity %s',strength=>{
   expect(()=>smoothMesh(input.p,input.tri,input.n,{...settings,strength})).toThrow('intensity')
 })
 it('remaps removed vertices without fabricating a replacement',()=>{
   expect(remapVertices(new Uint32Array([0,1,3,99]),new Int32Array([0,-1,1,2]))).toEqual(new Uint32Array([0,2]))
 })
 it('bounds UI input and includes intensity in history settings',()=>{
   const old=useMeshTools.getState().smoothStrength
   try{useMeshTools.getState().setSmoothStrength(.35);expect(useMeshTools.getState().smoothStrength).toBe(.35)
     useMeshTools.getState().setSmoothStrength(NaN);expect(useMeshTools.getState().smoothStrength).toBe(.35)
     useMeshTools.getState().setSmoothStrength(3);expect(useMeshTools.getState().smoothStrength).toBe(1)
     expect(MESH_SETTINGS).toContain('smoothStrength')
   }finally{useMeshTools.setState({smoothStrength:old})}
 })
})
