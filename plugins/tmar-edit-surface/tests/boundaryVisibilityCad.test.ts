// SPDX-License-Identifier: AGPL-3.0-only
import {readFileSync,writeFileSync} from 'node:fs'
import {expect,it} from 'vitest'
import {SurfaceEditorKernel} from '../editorKernel'
import {replaceSurface,surfaceTable,type Net} from '../brep'
import {rebuildFreeBoundary} from '../freeBoundary'
import {queryBoundaryVisibilityCad} from '../boundaryVisibilityCad'
import {wholeBoundaryPath,wholeBoundaryIndices} from '../wholeBoundary'

it('checks the prequalified visible curved edge through native CAD section and front clearance',async()=>{
  const editor=await SurfaceEditorKernel.load(),k=editor.kernel
  const bytes=readFileSync(new URL('../evidence/free-boundary/compiled-20261103/moved.step',import.meta.url))
  const shape=k.importStep(bytes.toString('utf8')),faces=k.getSubShapes(shape,'face')
  try{
    const before=k.toBREP(faces[0]),opened=editor.open(bytes.toString('utf8')),net=editor.select(0)
    expect(opened.faces[0].freeBoundary).toBe(true)
    const path=wholeBoundaryPath(net,'U1'),segment=23,fraction=.37*64-segment
    const seed=path[segment].map((x,d)=>x+fraction*(path[segment+1][d]-x)) as [number,number,number]
    const result=queryBoundaryVisibilityCad(k,faces[0],'U1',seed,[40,-25,45],segment)
    console.log(JSON.stringify({case:'prequalified-curved',...result}))
    if(process.env.BOUNDARY_CAD_VISIBLE_EVIDENCE)writeFileSync(process.env.BOUNDARY_CAD_VISIBLE_EVIDENCE,JSON.stringify(result,null,2)+'\n')
    expect(k.toBREP(faces[0])).toBe(before)
    expect(result.visible).toBe(true)
  }finally{faces.forEach(f=>k.release(f));k.release(shape);editor.dispose()}
},60000)

it('distinguishes exact front and hidden rims separated by 0.02 mm on one folded native face',async()=>{
  const editor=await SurfaceEditorKernel.load(),k=editor.kernel,box=k.makeBox(20,30,10),faces=k.getSubShapes(box,'face')
  const owned:typeof box[]=[],own=(h:typeof box)=>{owned.push(h);return h}
  try{
    const top=faces.find(f=>{const b=k.uvBounds(f);return Math.abs(k.pointOnSurface(f,(b.uMin+b.uMax)/2,(b.vMin+b.vMax)/2).z-10)<1e-8})!
    const b=k.uvBounds(top),text=k.toBREP(top),record=surfaceTable(text).find(r=>r.kind===1)!
    const net:Net={nu:3,nv:2,du:2,dv:1,ku:[b.uMin,b.uMax],kv:[b.vMin,b.vMax],mu:[3,3],mv:[2,2],rational:[0,0],
      poles:[[-1,-1,0],[-1,1,0],[1,-1,.01],[1,1,.01],[-1,-1,.02],[-1,1,.02]],weights:[1,1,1,1,1,1]}
    const support=own(k.fromBREP(replaceSurface(text,record,net))),folded=own(rebuildFreeBoundary(k,support,net))
    expect(k.isValid(folded)).toBe(true)
    const before=k.toBREP(folded)
    const hidden=queryBoundaryVisibilityCad(k,folded,'U0',[-1,0,0],[-1,0,1],31)
    const front=queryBoundaryVisibilityCad(k,folded,'U1',[-1,0,.02],[-1,0,1],31)
    console.log(JSON.stringify({case:'folded-0.02-mm',hidden,front}))
    if(process.env.BOUNDARY_CAD_FOLDED_EVIDENCE)writeFileSync(process.env.BOUNDARY_CAD_FOLDED_EVIDENCE,JSON.stringify({hidden,front},null,2)+'\n')
    expect(k.toBREP(folded)).toBe(before)
    expect(hidden.visible).toBe(false);expect(hidden.reason).toBe('occluded')
    expect(front.visible).toBe(true)
  }finally{owned.reverse().forEach(h=>k.release(h));faces.forEach(f=>k.release(f));k.release(box);editor.dispose()}
},60000)

it('uses the surface UV isocurve when the imported topological edge parameter is 100..160 instead of 0..30',async()=>{
  const editor=await SurfaceEditorKernel.load(),k=editor.kernel
  const bytes=readFileSync(new URL('../evidence/free-boundary/compiled-20261103/moved.step',import.meta.url))
  const shape=k.importStep(bytes.toString('utf8')),faces=k.getSubShapes(shape,'face'),owned:typeof shape[]=[]
  const own=(h:typeof shape)=>{owned.push(h);return h}
  try{
    editor.open(bytes.toString('utf8'));const net=editor.select(0)
    const edges=(['U0','V1','U1','V0'] as const).map(side=>{
      const ids=wholeBoundaryIndices(net,side),varyV=side==='U0'||side==='U1',knots=varyV?net.kv:net.ku
      return own(k.makeBSplineEdge(ids.flatMap(i=>net.poles[i]),ids.map(i=>net.weights[i]),side==='U1'?knots.map(t=>100+2*t):knots,
        varyV?net.mv:net.mu,varyV?net.dv:net.du))
    })
    const wire=own(k.makeWire(edges)),changed=own(k.fixShape(own(k.makeFaceOnSurface(faces[0],wire))))
    expect(k.isValid(changed)).toBe(true)
    const actualEdges=k.getSubShapes(changed,'edge');owned.push(...actualEdges)
    const shifted=actualEdges.find(e=>k.curveParameters(e).first===100)!
    expect(shifted).toBeDefined();expect(k.curveParameters(shifted).last).toBe(160)
    const path=wholeBoundaryPath(net,'U1'),seed=path[23].map((x,d)=>x+(.37*64-23)*(path[24][d]-x)) as [number,number,number]
    const result=queryBoundaryVisibilityCad(k,changed,'U1',seed,[40,-25,45],23)
    console.log(JSON.stringify({case:'edge-parameter-100-160',...result}))
    if(process.env.BOUNDARY_CAD_REPARAM_EVIDENCE)writeFileSync(process.env.BOUNDARY_CAD_REPARAM_EVIDENCE,JSON.stringify(result,null,2)+'\n')
    expect(result.visible).toBe(true)
  }finally{owned.reverse().forEach(h=>k.release(h));faces.forEach(f=>k.release(f));k.release(shape);editor.dispose()}
},60000)

it('accepts a real 65-sample chord seed beyond 0.005 mm from the native curve and rejects false segment provenance',async()=>{
  const editor=await SurfaceEditorKernel.load(),k=editor.kernel
  const bytes=readFileSync(new URL('../evidence/free-boundary/compiled-20261103/moved.step',import.meta.url))
  const shape=k.importStep(bytes.toString('utf8')),faces=k.getSubShapes(shape,'face'),owned:typeof shape[]=[]
  const own=(h:typeof shape)=>{owned.push(h);return h}
  try{
    editor.open(bytes.toString('utf8'));const net=editor.select(0)
    net.poles=net.poles.map(p=>p.map(x=>x*20) as [number,number,number])
    const text=k.toBREP(faces[0]),record=surfaceTable(text).find(r=>r.net)!
    const support=own(k.fromBREP(replaceSurface(text,record,net))),scaled=own(rebuildFreeBoundary(k,support,net))
    expect(k.isValid(scaled)).toBe(true)
    const path=wholeBoundaryPath(net,'U1'),seed=path[23].map((x,d)=>x+(.37*64-23)*(path[24][d]-x)) as [number,number,number]
    const result=queryBoundaryVisibilityCad(k,scaled,'U1',seed,[800,-500,900],23)
    console.log(JSON.stringify({case:'real-polyline-seed-scaled-20',...result}))
    if(process.env.BOUNDARY_CAD_SEED_EVIDENCE)writeFileSync(process.env.BOUNDARY_CAD_SEED_EVIDENCE,JSON.stringify(result,null,2)+'\n')
    expect(result.projectionDistanceMm).toBeGreaterThan(.005);expect(result.visible).toBe(true)
    expect(()=>queryBoundaryVisibilityCad(k,scaled,'U1',seed,[800,-500,900],40)).toThrow(/Seed non appartenente/)
  }finally{owned.reverse().forEach(h=>k.release(h));faces.forEach(f=>k.release(f));k.release(shape);editor.dispose()}
},60000)
