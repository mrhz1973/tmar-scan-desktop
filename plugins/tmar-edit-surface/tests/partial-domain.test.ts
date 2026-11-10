// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { SurfaceEditorKernel } from '../editorKernel'
import { boundaryLocked, replaceSurface, signature, surfaceTable, type Net, type Point } from '../brep'

it.each([[false,false],[true,false],[true,true]])('edits a STEP solid face inside a larger NURBS domain (curved: %s, hole: %s)', async (curved,hole) => {
  const editor = await SurfaceEditorKernel.load(), k = editor.kernel
  const box = k.makeBox(48,48,10)
  const tool=hole?k.makeCylinder(2,14):null, positioned=tool?k.translate(tool,8,8,-2):null
  const body=positioned?k.cut(box,positioned):box, boxFaces = k.getSubShapes(body,'face')
  try {
    const top = boxFaces.find(face=>{
      const b=k.uvBounds(face),p=k.pointOnSurface(face,(b.uMin+b.uMax)/2,(b.vMin+b.vMax)/2)
      return Math.abs(p.z-10)<1e-8
    })!
    const bounds=k.uvBounds(top), plane=surfaceTable(k.toBREP(top)).find(r=>r.kind===1)!
    const text=k.toBREP(body), record=surfaceTable(text).find(r=>signature(r)===signature(plane))!
    // A larger support represents the STEP case where the visible face is a
    // trimmed subset. The second fixture is a curved, rational CAD surface.
    const spans=24, degree=3, count=spans+degree
    const knots=(a:number,b:number)=>Array.from({length:spans+1},(_,i)=>a+(b-a)*i/spans)
    const ku=knots(bounds.uMin-12,bounds.uMax+12),kv=knots(bounds.vMin-12,bounds.vMax+12)
    const mu=ku.map((_,i)=>i===0||i===spans?4:1),mv=[...mu]
    const greville=(ks:number[],ms:number[])=>{
      const expanded=ks.flatMap((x,i)=>Array<number>(ms[i]).fill(x))
      return Array.from({length:count},(_,i)=>(expanded[i+1]+expanded[i+2]+expanded[i+3])/3)
    }
    const a=plane.values, poles=greville(ku,mu).flatMap(u=>greville(kv,mv).map(v=>
      [0,1,2].map(d=>a[1+d]+u*a[7+d]+v*a[10+d]) as Point))
    const weights=poles.map(()=>1)
    if(curved){
      const middle=poles.map((p,i)=>({i,d:Math.hypot(p[0]-24,p[1]-24)})).sort((x,y)=>x.d-y.d)[0].i
      poles[middle][2]+=0.5;weights[middle]=1.3
    }
    const net:Net={nu:count,nv:count,du:degree,dv:degree,poles,weights,rational:curved?[1,1]:[0,0],ku,kv,mu,mv}
    const raw=k.fromBREP(replaceSurface(text,record,net)), prepared=k.fixShape(raw)
    let step:string
    try {expect(k.isValid(prepared)).toBe(true);step=k.exportStep(prepared)}
    finally{k.release(prepared);k.release(raw)}
    if(curved && !hole && process.env.TMAR_PARTIAL_STEP_OUT)writeFileSync(process.env.TMAR_PARTIAL_STEP_OUT,step)
    const baseline=k.importStep(step), baseFaces=k.getSubShapes(baseline,'face')
    try {
      const faceIndex=baseFaces.findIndex(face=>k.surfaceType(face)==='bspline')
      expect(faceIndex).toBeGreaterThanOrEqual(0)
      const b=k.uvBounds(baseFaces[faceIndex]), own=surfaceTable(k.toBREP(baseFaces[faceIndex])).find(r=>r.net)!.net!
      expect(own.ku[0]).toBeLessThan(b.uMin-1)
      expect(own.ku.at(-1)!).toBeGreaterThan(b.uMax+1)
      expect(own.kv[0]).toBeLessThan(b.vMin-1)
      expect(own.kv.at(-1)!).toBeGreaterThan(b.vMax+1)
      const opened=editor.open(step), info=opened.faces[faceIndex]
      expect(info.reason).toBeNull()
      expect(info.freeBoundary).toBe(false)
      const original=editor.select(faceIndex), changed=structuredClone(original)
      const free=original.poles.map((p,i)=>({i,d:Math.hypot(p[0]-24,p[1]-24)}))
        .filter(({i})=>!boundaryLocked(original,i,'G1')&&!info.trimLocks.includes(i))
        .sort((x,y)=>x.d-y.d)[0]
      expect(free).toBeDefined()
      expect(info.trimLocks.length).toBeGreaterThan(0)
      expect(info.hiddenPoles.length).toBeGreaterThan(0)
      expect(info.hiddenPoles.every(i=>info.trimLocks.includes(i)||boundaryLocked(original,i,'G0'))).toBe(true)
      expect(info.hiddenPoles).not.toContain(free.i)
      const protectedInner=info.trimLocks.find(i=>!boundaryLocked(original,i,'G0'))
      expect(protectedInner).toBeDefined()
      const blocked=structuredClone(original);blocked.poles[protectedInner!][2]+=1
      expect(()=>editor.evaluate(blocked,'G0')).toThrow(/contorno ritagliato/)
      const unchanged=editor.evaluate(original,'G1'), u=(b.uMin+b.uMax)/2,v=(b.vMin+b.vMax)/2
      const originalCenter=k.pointOnSurface(baseFaces[faceIndex],u,v)
      changed.poles[free.i][2]+=1
      const edited=editor.evaluate(changed,'G1',true), reopened=k.importStep(edited.step!), newFaces=k.getSubShapes(reopened,'face')
      try {
        expect(k.isValid(reopened)).toBe(true);expect(newFaces).toHaveLength(baseFaces.length)
        expect(edited.volume).toBeGreaterThan(unchanged.volume+0.01)
        const movedCenter=k.pointOnSurface(newFaces[faceIndex],u,v)
        expect(movedCenter.z).toBeGreaterThan(originalCenter.z+0.01)
        const originalWire=k.outerWire(baseFaces[faceIndex]),newWire=k.outerWire(newFaces[faceIndex])
        const originalWires=k.getSubShapes(baseFaces[faceIndex],'wire'),newWires=k.getSubShapes(newFaces[faceIndex],'wire')
        expect(originalWires).toHaveLength(hole?2:1);expect(newWires).toHaveLength(originalWires.length)
        const edges=originalWires.flatMap(w=>k.getSubShapes(w,'edge'))
        try {
          for(const edge of edges){
            const t=k.curveParameters(edge)
            for(let j=0;j<=24;j++){
              const p=k.curvePointAtParam(edge,t.first+(t.last-t.first)*j/24),vertex=k.makeVertex(p.x,p.y,p.z)
              try{
                expect(Math.min(...newWires.map(w=>k.distanceBetween(vertex,w)))).toBeLessThan(1e-6)
                const uv=k.uvFromPoint(baseFaces[faceIndex],p)
                const q=k.pointOnSurface(newFaces[faceIndex],uv.u,uv.v)
                expect(Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z)).toBeLessThan(1e-6)
                const n=k.surfaceNormal(baseFaces[faceIndex],uv.u,uv.v),m=k.surfaceNormal(newFaces[faceIndex],uv.u,uv.v)
                expect(n.x*m.x+n.y*m.y+n.z*m.z).toBeGreaterThan(1-1e-8)
              }finally{k.release(vertex)}
            }
          }
        } finally {edges.forEach(e=>k.release(e));originalWires.forEach(w=>k.release(w));newWires.forEach(w=>k.release(w));k.release(originalWire);k.release(newWire)}
        for(let f=0;f<baseFaces.length;f++) if(f!==faceIndex){
          const q=k.uvBounds(baseFaces[f])
          for(let i=0;i<=4;i++)for(let j=0;j<=4;j++){
            const x=q.uMin+(q.uMax-q.uMin)*i/4,y=q.vMin+(q.vMax-q.vMin)*j/4
            const p=k.pointOnSurface(baseFaces[f],x,y),n=k.pointOnSurface(newFaces[f],x,y)
            expect(Math.hypot(p.x-n.x,p.y-n.y,p.z-n.z)).toBeLessThan(1e-7)
          }
        }
        expect(edited.maxBoundaryError).toBeLessThan(1e-6)
        const recipe=await editor.createRecipe(changed,'G1',[free.i],'partial-domain')
        expect(recipe.preparation).toBe('native-nurbs')
        const replay=await editor.replayRecipe(step,recipe,'partial-domain')
        expect(replay.valid).toBe(true);expect(replay.volume).toBeCloseTo(edited.volume,6)
      } finally {newFaces.forEach(f=>k.release(f));k.release(reopened)}
    } finally {baseFaces.forEach(f=>k.release(f));k.release(baseline)}
  } finally {boxFaces.forEach(f=>k.release(f));if(body!==box)k.release(body);if(positioned)k.release(positioned);if(tool)k.release(tool);k.release(box);editor.dispose()}
},60000)
