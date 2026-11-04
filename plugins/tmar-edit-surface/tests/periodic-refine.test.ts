// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { SurfaceEditorKernel } from '../editorKernel'
import { replaceSurface, surfaceTable } from '../brep'
import { moveSmoothCylinderPole, refineLinearPeriodicV } from '../periodic'
import { localFrame } from '../localFrame'

it('refines a periodic STEP cylinder in V without changing its support or protected boundaries', async () => {
  const e = await SurfaceEditorKernel.load(), k = e.kernel, cylinder = k.makeCylinder(10,20)
  const source = k.importStep(k.exportStep(cylinder)), converted = k.generalTransform(source,[1,0,0,0,0,1,0,0,0,0,1,0])
  let refined: ReturnType<typeof k.fromBREP> | undefined, edited: ReturnType<typeof k.fromBREP> | undefined, round: ReturnType<typeof k.importStep> | undefined
  try {
    const text = k.toBREP(converted), rec = surfaceTable(text).find(r => r.periodicNet)!, net = rec.periodicNet!
    const snapshot = structuredClone(net), next = refineLinearPeriodicV(net)
    expect(net).toEqual(snapshot)
    expect(next.periodic).toEqual([1,0]); expect(next.nv).toBe(5); expect(next.dv).toBe(3)
    expect(() => refineLinearPeriodicV({ ...net, periodic: [0,1] })).toThrow()
    expect(() => refineLinearPeriodicV({ ...net, weights: net.weights.map(() => 0) })).toThrow()
    expect(() => refineLinearPeriodicV({ ...net, mu: [] })).toThrow()
    expect(() => refineLinearPeriodicV({ ...net, ku: [1,0] })).toThrow()
    expect(() => moveSmoothCylinderPole({ ...next, ku: [0,Number.NaN,4,6] },[1,0,0])).toThrow()
    expect(() => moveSmoothCylinderPole({ ...next, weights: next.weights.map(()=>1e308) },[1,0,0])).toThrow()
    const nonseparable=structuredClone(next);nonseparable.weights[nonseparable.nv+1]*=1.5
    expect(() => moveSmoothCylinderPole(nonseparable,[.5,0,0])).toThrow(/variabili lungo V/)
    refined = k.fromBREP(replaceSurface(text,rec,next))
    const candidate = structuredClone(next); candidate.poles[3*next.nv+2][0] += 0.5
    edited = k.fromBREP(replaceSurface(text,rec,candidate)); round = k.importStep(k.exportStep(edited))
    expect(k.isValid(refined)).toBe(true); expect(k.isValid(edited)).toBe(true); expect(k.isValid(round)).toBe(true)
    const before = k.getSubShapes(converted,'face'), after = k.getSubShapes(refined,'face'), changed = k.getSubShapes(edited,'face')
    const solids = k.getSubShapes(round,'solid')
    try {
      expect(before.length).toBe(3); expect(after.length).toBe(3); expect(solids.length).toBe(1)
      const b = k.uvBounds(before[0]); let interiorGap = 0
      for (let i=0;i<=32;i++) for (let j=0;j<=16;j++) {
        const u=b.uMin+(b.uMax-b.uMin)*i/32, v=b.vMin+(b.vMax-b.vMin)*j/16
        const a=k.pointOnSurface(before[0],u,v), r=k.pointOnSurface(after[0],u,v), d=k.pointOnSurface(changed[0],u,v)
        expect(Math.hypot(a.x-r.x,a.y-r.y,a.z-r.z)).toBeLessThan(1e-8)
        const delta=Math.hypot(a.x-d.x,a.y-d.y,a.z-d.z)
        if(i===0 || i===32 || j===0 || j===16) expect(delta).toBeLessThan(1e-8)
        else interiorGap=Math.max(interiorGap,delta)
        if(j===0 || j===16) {
          const x=k.surfaceNormal(before[0],u,v), y=k.surfaceNormal(changed[0],u,v)
          expect(x.x*y.x+x.y*y.y+x.z*y.z).toBeGreaterThan(1-1e-8)
        }
      }
      expect(interiorGap).toBeGreaterThan(0.01)
      // An isolated pole displacement can kink a quadratic double knot,
      // even though the seam, caps and BREP validity checks all pass.
      const u=next.ku[1],v=(next.kv[0]+next.kv.at(-1)!)/2
      const left=k.surfaceNormal(changed[0],u-1e-7,v),right=k.surfaceNormal(changed[0],u+1e-7,v)
      expect(left.x*right.x+left.y*right.y+left.z*right.z).toBeLessThan(1-1e-9)
      expect(localFrame(candidate,2*next.nv+2)).toBeNull()
      for(const delta of [[.5,0,0],[0,.5,0],[0,0,.5]] as [number,number,number][]) {
        const smooth=k.fromBREP(replaceSurface(text,rec,moveSmoothCylinderPole(next,delta)))
        const smoothFaces=k.getSubShapes(smooth,'face')
        try {
          expect(k.isValid(smooth)).toBe(true)
          for(const knot of next.ku.slice(1,-1)) for(let i=0;i<=8;i++) {
            const vv=next.kv[0]+(next.kv.at(-1)!-next.kv[0])*i/8
            const a=k.surfaceNormal(smoothFaces[0],knot-1e-7,vv),b=k.surfaceNormal(smoothFaces[0],knot+1e-7,vv)
            expect(a.x*b.x+a.y*b.y+a.z*b.z).toBeGreaterThan(1-1e-9)
            for(const h of [1e-5,5e-6]) {
              const sides=(face:typeof smoothFaces[number])=>{
                const l=k.pointOnSurface(face,knot-h,vv),m=k.pointOnSurface(face,knot,vv),r=k.pointOnSurface(face,knot+h,vv)
                return {left:[(m.x-l.x)/h,(m.y-l.y)/h,(m.z-l.z)/h],right:[(r.x-m.x)/h,(r.y-m.y)/h,(r.z-m.z)/h]}
              }
              const before=sides(after[0]),afterMove=sides(smoothFaces[0])
              const leftChange=before.left.map((x,d)=>afterMove.left[d]-x),rightChange=before.right.map((x,d)=>afterMove.right[d]-x)
              expect(Math.hypot(...leftChange.map((x,d)=>x-rightChange[d]))).toBeLessThan(1e-4)
            }
          }
        } finally {smoothFaces.forEach(f=>k.release(f));k.release(smooth)}
      }
      const tolerances=(shape:typeof converted,kind:string)=>Array.from(k.toBREP(shape).matchAll(new RegExp(`^${kind}\\s*\\n\\s*([\\deE+.-]+)`,'gm')),m=>Number(m[1]))
      for(const kind of ['Ed','Ve']) {
        expect(tolerances(refined,kind)).toEqual(tolerances(converted,kind))
        expect(tolerances(edited,kind)).toEqual(tolerances(converted,kind))
      }
      // This artificial support has different rational weights at the two V
      // poles; only the support is tested, not its original trim/topology.
      const rational=structuredClone(net)
      rational.weights=rational.weights.map((w,i)=>i%2 ? w*1.25 : w)
      const rationalBody=k.fromBREP(replaceSurface(text,rec,rational))
      const rationalRefined=k.fromBREP(replaceSurface(text,rec,refineLinearPeriodicV(rational)))
      const rf=k.getSubShapes(rationalBody,'face'), rr=k.getSubShapes(rationalRefined,'face')
      try {
        for(let i=0;i<=16;i++) for(let j=0;j<=8;j++) {
          const u=b.uMin+(b.uMax-b.uMin)*i/16, v=b.vMin+(b.vMax-b.vMin)*j/8
          const p=k.pointOnSurface(rf[0],u,v),q=k.pointOnSurface(rr[0],u,v)
          expect(Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z)).toBeLessThan(1e-8)
        }
      } finally { [...rf,...rr].forEach(h=>k.release(h));k.release(rationalBody);k.release(rationalRefined) }
      const opened=e.open(k.exportStep(refined))
      expect(opened.faces.some(f=>f.reason?.includes('non periodiche'))).toBe(true)
    } finally { [...before,...after,...changed,...solids].forEach(h=>k.release(h)) }
  } finally {
    if(round) k.release(round); if(edited) k.release(edited); if(refined) k.release(refined)
    k.release(converted); k.release(source); k.release(cylinder); e.dispose()
  }
},60000)
