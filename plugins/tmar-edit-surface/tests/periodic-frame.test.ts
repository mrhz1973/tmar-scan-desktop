// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { SurfaceEditorKernel } from '../editorKernel'
import { replaceSurface, surfaceTable } from '../brep'
import { moveSmoothCylinderPole, refineLinearPeriodicV } from '../periodic'
import { localFrame } from '../localFrame'

it.each([false,true])('matches OCCT local directions on a periodic cylinder (rotated: %s)',async rotated=>{
  const e=await SurfaceEditorKernel.load(),k=e.kernel,primitive=k.makeCylinder(10,20)
  const rotatedPrimitive=rotated?k.rotate(primitive,{point:{x:0,y:0,z:0},direction:{x:1,y:1,z:0}},0.73):null
  const source=k.importStep(k.exportStep(rotatedPrimitive??primitive)),converted=k.generalTransform(source,[1,0,0,0,0,1,0,0,0,0,1,0])
  const text=k.toBREP(converted),record=surfaceTable(text).find(r=>r.periodicNet)!,net=refineLinearPeriodicV(record.periodicNet!)
  const moved=moveSmoothCylinderPole(net,[.5,-.35,.25])
  const refined=k.fromBREP(replaceSurface(text,record,net)),edited=k.fromBREP(replaceSurface(text,record,moved))
  try {
    for(const [body,current] of [[refined,net],[edited,moved]] as const) {
      const faces=k.getSubShapes(body,'face')
      try {
        const face=faces[0],period=current.ku.at(-1)!-current.ku[0]
        for(let uIndex=0;uIndex<6;uIndex++) for(let vIndex=0;vIndex<5;vIndex++) {
          const u=current.ku[0]+period*uIndex/6,v=current.kv[0]+(current.kv.at(-1)!-current.kv[0])*[0,1/6,.5,5/6,1][vIndex]
          const frame=localFrame(current,uIndex*current.nv+vIndex),normal=k.surfaceNormal(face,u,v)
          expect(frame, `U ${uIndex}, V ${vIndex}`).not.toBeNull()
          expect(frame![2][0]*normal.x+frame![2][1]*normal.y+frame![2][2]*normal.z).toBeGreaterThan(1-1e-9)
          const a=k.pointOnSurface(face,u-1e-4,v),b=k.pointOnSurface(face,u+1e-4,v)
          const direction=[b.x-a.x,b.y-a.y,b.z-a.z],length=Math.hypot(...direction)
          expect(frame![0].reduce((sum,x,i)=>sum+x*direction[i]/length,0), `U ${uIndex}, V ${vIndex}`).toBeGreaterThan(1-1e-8)
        }
        for(const knot of current.ku.slice(1,-1)) for(let i=0;i<=8;i++) {
          const v=current.kv[0]+(current.kv.at(-1)!-current.kv[0])*i/8
          const l=k.surfaceNormal(face,knot-1e-7,v),r=k.surfaceNormal(face,knot+1e-7,v)
          expect(l.x*r.x+l.y*r.y+l.z*r.z).toBeGreaterThan(1-1e-9)
        }
      } finally {faces.forEach(f=>k.release(f))}
    }
    expect(localFrame({...net,periodic:[0,1]},0)).toBeNull()
    expect(localFrame({...net,mu:[1,1,1,1]},0)).toBeNull()
  } finally {
    k.release(edited);k.release(refined);k.release(converted);k.release(source)
    if(rotatedPrimitive)k.release(rotatedPrimitive);k.release(primitive);e.dispose()
  }
},60000)
