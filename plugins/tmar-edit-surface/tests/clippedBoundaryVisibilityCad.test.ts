// SPDX-License-Identifier: AGPL-3.0-only
import { OcctKernel, type ShapeHandle } from 'occt-wasm'
import { expect, it } from 'vitest'
import type { Point } from '../brep'
import { proveClippedBoundaryVisibility } from '../clippedBoundaryVisibilityCad'

it('distinguishes a clipped occluder from a visible occluder on a real folded CAD shell',async()=>{
  const k=await OcctKernel.init(),owned:ShapeHandle[]=[]
  const own=(shape:ShapeHandle)=>{owned.push(shape);return shape}
  const vec=([x,y,z]:Point)=>({x,y,z})
  const face=(points:Point[])=>own(k.makeFace(own(k.makeWire(points.map((p,i)=>own(k.makeLineEdge(vec(p),vec(points[(i+1)%points.length]))))))))
  try{
    const front=face([[-2,-2,.02],[2,-2,.02],[2,2,.02],[-2,2,.02]])
    const rear=face([[-2,-2,0],[-2,2,0],[2,2,0],[2,-2,0]])
    const seam=face([[2,-2,0],[2,2,0],[2,2,.02],[2,-2,.02]])
    const shell=own(k.sew([front,seam,rear],1e-7))
    expect(k.isValid(shell)).toBe(true)
    const original=k.toBREP(shell)
    const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]
    const margins={planeClearanceMm:.001,startGuardMm:.001,endpointExtensionMm:.0001,minimumVisibleLengthMm:.003,minimumCrossingCosine:.01}
    const proof=(cut:number)=>proveClippedBoundaryVisibility(k,shell,[-2,0,0],[0,0,1],[-2,0,1],matrix,
      [{normal:[0,0,-1],constant:cut}],margins)
    expect(proof(.01)).toEqual({visible:true,reason:'clipped-native-section-and-clear-front'})
    expect(proof(.03)).toEqual({visible:false,reason:'occluded'})
    expect(proof(.0199)).toEqual({visible:false,reason:'front-not-clear'})
    const translated=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,100,1]
    expect(proveClippedBoundaryVisibility(k,shell,[-2,0,0],[0,0,1],[-2,0,1],translated,
      [{normal:[0,0,-1],constant:100.01}],margins)).toEqual({visible:true,reason:'clipped-native-section-and-clear-front'})
    expect(proveClippedBoundaryVisibility(k,shell,[-2,0,0],[0,0,1],[-2,0,1],matrix,
      [{normal:[0,0,1],constant:-.01}],margins)).toEqual({visible:false,reason:'invalid-clipping'})
    const singular=[1,0,0,0,0,1,0,0,0,0,0,0,0,0,0,1]
    expect(proveClippedBoundaryVisibility(k,shell,[-2,0,0],[0,0,1],[-2,0,1],singular,[],margins))
      .toEqual({visible:false,reason:'invalid-transform'})
    expect(proveClippedBoundaryVisibility(k,shell,[-2,0,0],[1000,0,1],[-2,0,1],matrix,[],margins))
      .toEqual({visible:false,reason:'grazing'})
    expect(proveClippedBoundaryVisibility(k,shell,[-2,0,0],[0,0,1,1] as unknown as Point,[-2,0,1],matrix,[],margins))
      .toEqual({visible:false,reason:'invalid-input'})
    expect(k.toBREP(shell)).toBe(original)
  }finally{owned.reverse().forEach(shape=>k.release(shape));k[Symbol.dispose]()}
},30000)
