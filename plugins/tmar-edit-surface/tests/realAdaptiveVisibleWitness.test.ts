// SPDX-License-Identifier: AGPL-3.0-only
// Opt-in diagnostic on the supplied STEP. Reads the file, never writes it.
// The current π/12 outer-edge boxes may refuse these plans; this is a failure,
// not evidence that the candidate is integrated or safe for arbitrary trims.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { findSpan, calcBasisFunctions } from 'three/examples/jsm/curves/NURBSUtils.js'
import { boundaryLocked } from '../brep'
import { adaptiveTrimPlan } from '../adaptiveTrimPlan'
import { SurfaceEditorKernel } from '../editorKernel'
import { createServer } from 'vite'
import { readAdaptiveTrimRecipe } from '../adaptiveTrimRecipe'
import { readRecipe } from '../recipe'

const path=process.env.SURFACE_QA_STEP
// Explicit opt-in: the production π/12 case is a known failing experiment.
it.skipIf(!path || process.env.SURFACE_QA_ADAPTIVE_PROBE!=='1').each([3,7])('measures a visible adaptive-pole deformation on imported LEGO face %i',async faceIndex=>{
  const input=readFileSync(path!), sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex')
  // Optional experimental probe: replace only the angular subdivision in an
  // isolated in-memory module. The production module and repository stay intact.
  // Set SURFACE_QA_TRANSIENT_ARC48=1 in addition to SURFACE_QA_STEP to repeat.
  const transient=process.env.SURFACE_QA_TRANSIENT_ARC48==='1'
  const server=transient?await createServer({configFile:false,logLevel:'error',server:{middlewareMode:true},optimizeDeps:{noDiscovery:true},plugins:[{
    name:'surface-qa-transient-arc48',enforce:'pre',transform(code,id){
      if(!id.replaceAll('\\','/').endsWith('/plugins/tmar-edit-surface/editorKernel.ts'))return
      const needle='Math.PI/12'
      if(code.split(needle).length!==2)throw new Error('Expected exactly one production arc subdivision')
      return code.replace(needle,'Math.PI/48')
    }
  }]}):undefined
  const Kernel=server?(await server.ssrLoadModule('/plugins/tmar-edit-surface/editorKernel.ts')).SurfaceEditorKernel as typeof SurfaceEditorKernel:SurfaceEditorKernel
  const editor=await Kernel.load(),k=editor.kernel,imported=k.importStep(input.toString('utf8'))
  const solids=k.getSubShapes(imported,'solid')
  try {
    expect(solids.length).toBeGreaterThan(0)
    const step=k.exportStep(solids[0]),opened=editor.open(step)
    const original=k.importStep(step),beforeFaces=k.getSubShapes(original,'face')
    try {
      const source=beforeFaces[faceIndex],b=k.uvBounds(source),wires=k.getSubShapes(source,'wire'),outer=k.outerWire(source)
      let innerBox:[number,number,number,number]
      try {
        const inner=wires.filter(w=>!k.isSame(w,outer));expect(inner).toHaveLength(1)
        const box=k.getBoundingBox(inner[0],{useTriangulation:false})
        const uv=[box.xmin,box.xmax].flatMap(x=>[box.ymin,box.ymax].flatMap(y=>[box.zmin,box.zmax].map(z=>k.uvFromPoint(source,{x,y,z}))))
        innerBox=[Math.min(...uv.map(q=>q.u)),Math.max(...uv.map(q=>q.u)),Math.min(...uv.map(q=>q.v)),Math.max(...uv.map(q=>q.v))]
      } finally {wires.forEach(w=>k.release(w));k.release(outer)}
      const plan=adaptiveTrimPlan([b.uMin,b.uMax,b.vMin,b.vMax],innerBox)
      expect(plan).toHaveLength(48)
      const net=editor.select(faceIndex,plan),info=editor.infos[faceIndex],locked=new Set([...info.trimLocks,...info.hiddenPoles])
      expect(net.nu*net.nv).toBeLessThanOrEqual(1600)
      const knots=(xs:number[],ms:number[])=>xs.flatMap((x,i)=>Array<number>(ms[i]).fill(x))
      const ku=knots(net.ku,net.mu),kv=knots(net.kv,net.mv), maxima=new Map<number,{weight:number;u:number;v:number}>()
      const us=plan.filter(p=>p.axis==='U').map(p=>p.value),vs=plan.filter(p=>p.axis==='V').map(p=>p.value)
      const u0=Math.min(...us),u1=Math.max(...us),v0=Math.min(...vs),v1=Math.max(...vs)
      let inside=0
      for(let i=0;i<=160;i++)for(let j=0;j<=160;j++) {
        const u=u0+(u1-u0)*i/160,v=v0+(v1-v0)*j/160
        if(k.classifyPointOnFace(source,u,v)!=='in') continue
        inside++
        const su=findSpan(net.du,u,ku),sv=findSpan(net.dv,v,kv)
        const bu=calcBasisFunctions(su,u,net.du,ku),bv=calcBasisFunctions(sv,v,net.dv,kv)
        for(let x=0;x<=net.du;x++)for(let y=0;y<=net.dv;y++) {
          const id=(su-net.du+x)*net.nv+sv-net.dv+y
          if(locked.has(id)||boundaryLocked(net,id,'G1'))continue
          const weight=bu[x]*bv[y],previous=maxima.get(id)
          if(!previous||weight>previous.weight) maxima.set(id,{weight,u,v})
        }
      }
      expect(inside).toBeGreaterThan(0)
      expect(net.weights.every(w=>Math.abs(w-1)<1e-12)).toBe(true)
      const best=[...maxima.entries()].sort((a,c)=>c[1].weight-a[1].weight)[0]
      expect(best).toBeDefined()
      const [pole,witness]=best, before=k.pointOnSurface(source,witness.u,witness.v),normal=k.surfaceNormal(source,witness.u,witness.v)
      net.poles[pole]=[net.poles[pole][0]+normal.x*.02,net.poles[pole][1]+normal.y*.02,net.poles[pole][2]+normal.z*.02]
      const edited=editor.evaluate(net,'G1',true);expect(edited.valid).toBe(true);expect(edited.step).toBeTruthy()
      // Research-only adapter: persist an explicit v7 policy, then replay via
      // the transitorily transformed kernel. This is NOT a product v7 replay.
      const legacy=await editor.createRecipe(net,'G1',[],'adaptive-research')
      expect(legacy.version).toBe(4)
      const versioned=readAdaptiveTrimRecipe({...legacy,version:7,trimPolicy:'circular-fine-v1'})
      expect(()=>readRecipe(versioned)).toThrow()
      const roundTrip=readAdaptiveTrimRecipe(JSON.parse(JSON.stringify(versioned)))
      expect(()=>readAdaptiveTrimRecipe({...roundTrip,trimPolicy:'legacy'})).toThrow()
      const {trimPolicy: _policy,...common}=roundTrip
      await expect(editor.replayRecipe(step,{...common,version:4},'wrong-source')).rejects.toThrow()
      const replay=await editor.replayRecipe(step,{...common,version:4},'adaptive-research')
      expect(replay.valid).toBe(true);expect(replay.step).toBeTruthy()
      // The real unmodified kernel accepts v7 only through its isolated API.
      const production=await SurfaceEditorKernel.load()
      let nativeReplay: Awaited<ReturnType<SurfaceEditorKernel['replayAdaptiveRecipe']>>
      try {
        await expect(production.replayRecipe(step,roundTrip,'adaptive-research')).rejects.toThrow()
        nativeReplay=await production.replayAdaptiveRecipe(step,roundTrip,'adaptive-research')
        expect(nativeReplay.valid).toBe(true);expect(nativeReplay.step).toBeTruthy()
        await expect(production.replayAdaptiveRecipe(step,{...roundTrip,trimPolicy:'legacy'},'adaptive-research')).rejects.toThrow()
        await expect(production.replayAdaptiveRecipe(step,roundTrip,'wrong-source')).rejects.toThrow()
        await expect(production.replayAdaptiveRecipe(step,{...roundTrip,baseNetSha256:'0'.repeat(64)},'adaptive-research')).rejects.toThrow()
        const nonPlane=opened.faces.find(f=>f.kind!=='plane')
        expect(nonPlane).toBeDefined()
        await expect(production.replayAdaptiveRecipe(step,{...roundTrip,faceIndex:nonPlane!.index},'adaptive-research')).rejects.toThrow()
      } finally {production.dispose()}
      const output=k.importStep(edited.step!),afterFaces=k.getSubShapes(output,'face')
      const restored=k.importStep(replay.step!),restoredFaces=k.getSubShapes(restored,'face')
      const native=k.importStep(nativeReplay.step!),nativeFaces=k.getSubShapes(native,'face')
      try {
        expect(k.isValid(output)).toBe(true);expect(k.isValid(restored)).toBe(true);expect(k.isValid(native)).toBe(true)
        expect(afterFaces).toHaveLength(beforeFaces.length);expect(restoredFaces).toHaveLength(beforeFaces.length);expect(nativeFaces).toHaveLength(beforeFaces.length)
        const after=k.pointOnSurface(afterFaces[faceIndex],witness.u,witness.v)
        const restoredPoint=k.pointOnSurface(restoredFaces[faceIndex],witness.u,witness.v)
        const nativePoint=k.pointOnSurface(nativeFaces[faceIndex],witness.u,witness.v)
        expect(Math.hypot(after.x-restoredPoint.x,after.y-restoredPoint.y,after.z-restoredPoint.z)).toBeLessThan(1e-7)
        expect(Math.hypot(after.x-nativePoint.x,after.y-nativePoint.y,after.z-nativePoint.z)).toBeLessThan(1e-7)
        expect(k.getVolume(restored)).toBeCloseTo(k.getVolume(output),6)
        expect(k.getVolume(native)).toBeCloseTo(k.getVolume(output),6)
        const measured=Math.hypot(before.x-after.x,before.y-after.y,before.z-after.z)
        expect(measured).toBeGreaterThan(1e-4)
        expect(measured).toBeCloseTo(.02*witness.weight,7)
        // Finite samples are witnesses only, not a proof of continuous G1.
        let otherMax=0,otherSamples=0,boundaryMax=0,normalMin=1,boundarySamples=0
        for(let f=0;f<beforeFaces.length;f++)if(f!==faceIndex){
          const q=k.uvBounds(beforeFaces[f])
          for(let i=0;i<=4;i++)for(let j=0;j<=4;j++){
            const u=q.uMin+(q.uMax-q.uMin)*i/4,v=q.vMin+(q.vMax-q.vMin)*j/4
            if(k.classifyPointOnFace(beforeFaces[f],u,v)!=='in')continue
            const a=k.pointOnSurface(beforeFaces[f],u,v),z=k.pointOnSurface(afterFaces[f],u,v),r=k.pointOnSurface(nativeFaces[f],u,v)
            otherMax=Math.max(otherMax,Math.hypot(a.x-z.x,a.y-z.y,a.z-z.z),Math.hypot(a.x-r.x,a.y-r.y,a.z-r.z));otherSamples++
          }
        }
        expect(otherSamples).toBeGreaterThan(0);expect(otherMax).toBeLessThan(1e-6)
        const wa=k.getSubShapes(source,'wire'),wb=k.getSubShapes(afterFaces[faceIndex],'wire'),wc=k.getSubShapes(nativeFaces[faceIndex],'wire')
        const oa=k.outerWire(source),ob=k.outerWire(afterFaces[faceIndex]),oc=k.outerWire(nativeFaces[faceIndex])
        try{
          expect(wa).toHaveLength(2);expect(wb).toHaveLength(2);expect(wc).toHaveLength(2)
          for(const wire of wa){
            const counterpart=wb.find(w=>k.isSame(w,ob)===k.isSame(wire,oa))
            const nativeCounterpart=wc.find(w=>k.isSame(w,oc)===k.isSame(wire,oa))
            expect(counterpart).toBeDefined();expect(nativeCounterpart).toBeDefined()
            const edges=k.getSubShapes(wire,'edge')
            try{for(const edge of edges){
              const t=k.curveParameters(edge)
              for(let j=0;j<=24;j++){
                const p=k.curvePointAtParam(edge,t.first+(t.last-t.first)*j/24),vertex=k.makeVertex(p.x,p.y,p.z)
                try{
                  boundaryMax=Math.max(boundaryMax,k.distanceBetween(vertex,counterpart!))
                  boundaryMax=Math.max(boundaryMax,k.distanceBetween(vertex,nativeCounterpart!))
                  const uv=k.uvFromPoint(source,p),z=k.pointOnSurface(afterFaces[faceIndex],uv.u,uv.v)
                  boundaryMax=Math.max(boundaryMax,Math.hypot(p.x-z.x,p.y-z.y,p.z-z.z))
                  const np=k.pointOnSurface(nativeFaces[faceIndex],uv.u,uv.v)
                  boundaryMax=Math.max(boundaryMax,Math.hypot(p.x-np.x,p.y-np.y,p.z-np.z))
                  const n=k.surfaceNormal(source,uv.u,uv.v),m=k.surfaceNormal(afterFaces[faceIndex],uv.u,uv.v)
                  const nm=k.surfaceNormal(nativeFaces[faceIndex],uv.u,uv.v)
                  normalMin=Math.min(normalMin,n.x*m.x+n.y*m.y+n.z*m.z,n.x*nm.x+n.y*nm.y+n.z*nm.z);boundarySamples++
                }finally{k.release(vertex)}
              }
            }}finally{edges.forEach(e=>k.release(e))}
          }
        }finally{wa.forEach(w=>k.release(w));wb.forEach(w=>k.release(w));wc.forEach(w=>k.release(w));k.release(oa);k.release(ob);k.release(oc)}
        expect(boundarySamples).toBeGreaterThan(0);expect(boundaryMax).toBeLessThan(1e-6);expect(normalMin).toBeGreaterThan(1-1e-8)
        console.log(JSON.stringify({face:faceIndex,insideSamples:inside,freeInfluentialPoles:maxima.size,pole,measuredMm:measured,uv:[witness.u,witness.v],otherSamples,otherMax,boundarySamples,boundaryMax,normalMin}))
      } finally {nativeFaces.forEach(f=>k.release(f));k.release(native);restoredFaces.forEach(f=>k.release(f));k.release(restored);afterFaces.forEach(f=>k.release(f));k.release(output)}
    } finally {beforeFaces.forEach(f=>k.release(f));k.release(original)}
  } finally {
    expect(sha(readFileSync(path!))).toBe(sha(input))
    solids.forEach(s=>k.release(s));k.release(imported);editor.dispose()
    await server?.close()
  }
},120000)
