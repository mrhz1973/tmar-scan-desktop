// SPDX-License-Identifier: AGPL-3.0-only
// Isolated CAD fixture; no workspace, scan, or host project is changed.
import { expect, it, vi } from 'vitest'
import type { ShapeHandle } from 'occt-wasm'
import * as THREE from 'three'
import { SurfaceEditorKernel } from '../editorKernel'
import { ExperimentalSharedPlane, verifyOtherFacesSampled } from '../experimentalSharedPlane'
import type { Net } from '../brep'
import type { SurfaceWorkerPayload } from '../workerClient'
import type { ExperimentalSharedPlaneIdentity } from '../editor.worker'
import type { SurfaceWorkerClient } from '../workerClient'
import { ExperimentalSharedPlaneSession } from '../experimentalSharedPlaneSession'

it('characterizes a STEP solid whose top is split into coplanar faces', async () => {
  const editor=await SurfaceEditorKernel.load(), k=editor.kernel, owned:ShapeHandle[]=[]
  const own=(shape:ShapeHandle)=>{owned.push(shape);return shape}
  try {
    const box=own(k.makeBox(20,20,10)), faces=k.getSubShapes(box,'face');owned.push(...faces)
    const top=faces.find(face=>{
      const b=k.uvBounds(face),p=k.pointOnSurface(face,(b.uMin+b.uMax)/2,(b.vMin+b.vMax)/2)
      return Math.abs(p.z-10)<1e-8
    })!
    expect(top).toBeDefined()
    const line=own(k.makeLineEdge({x:10,y:0,z:10},{x:10,y:20,z:10}))
    const divided=own(k.split(top,[line])), parts=k.getSubShapes(divided,'face');owned.push(...parts)
    expect(parts).toHaveLength(2)
    const solid=own(k.sewAndSolidify([...faces.filter(face=>face!==top),...parts],1e-7))
    expect(k.isValid(solid)).toBe(true)
    const imported=own(k.importStep(k.exportStep(solid))), importedFaces=k.getSubShapes(imported,'face');owned.push(...importedFaces)
    expect(k.isValid(imported)).toBe(true)
    expect(importedFaces).toHaveLength(7)
    const step=k.exportStep(imported), before=k.toBREP(imported)
    const result=editor.open(step)
    const topIndices=importedFaces.flatMap((face,index)=>{
      const b=k.uvBounds(face),p=k.pointOnSurface(face,(b.uMin+b.uMax)/2,(b.vMin+b.vMax)/2)
      return Math.abs(p.z-10)<1e-8?[index]:[]
    })
    expect(topIndices).toHaveLength(2)
    expect(topIndices.some(index=>/ambigua|condivisa/i.test(result.faces[index].reason??''))).toBe(true)
    const target=topIndices.find(index=>/ambigua|condivisa/i.test(result.faces[index].reason??''))!
    expect(()=>editor.select(target)).toThrow(/ambigua|condivisa/i)
    expect(k.toBREP(imported)).toBe(before)
    // Research only: edit an isolated STEP face, then attempt to sew a copy.
    // The production path still refuses this case until all topology checks exist.
    const isolated=new ExperimentalSharedPlane(k)
    try {
      const net=isolated.open(step,target), changed=structuredClone(net)
      const pole=Math.floor(net.nu/2)*net.nv+Math.floor(net.nv/2)
      changed.poles[pole][2]+=.02
      const bad=structuredClone(net);bad.poles[0][2]+=.1
      expect(()=>isolated.evaluate(bad)).toThrow()
      const through=structuredClone(net);through.poles[pole][2]-=100
      expect(()=>isolated.evaluate(through)).toThrow(/interse[cz]/i)
      const output=isolated.evaluate(changed)
      const round=own(k.importStep(output.step)), roundFaces=k.getSubShapes(round,'face');owned.push(...roundFaces)
      expect(()=>verifyOtherFacesSampled(k,importedFaces,roundFaces,target)).not.toThrow()
      const neighbor=importedFaces.findIndex((_,index)=>index!==target)
      const shifted=own(k.translate(importedFaces[neighbor],0,0,1))
      const alteredFaces=[...importedFaces];alteredFaces[neighbor]=shifted
      expect(()=>verifyOtherFacesSampled(k,importedFaces,alteredFaces,target)).toThrow(/alterata|ambigua/)
      const reversed=own(k.reverseShape(importedFaces[neighbor])), reversedFaces=[...importedFaces]
      reversedFaces[neighbor]=reversed
      expect(()=>verifyOtherFacesSampled(k,importedFaces,reversedFaces,target)).toThrow(/alterata|ambigua/)
      const invalidDistance=vi.spyOn(k,'distanceBetween').mockReturnValue(NaN)
      try {expect(()=>verifyOtherFacesSampled(k,importedFaces,roundFaces,target)).toThrow(/alterata|ambigua/)}
      finally {invalidDistance.mockRestore()}
      const bounds=k.uvBounds(importedFaces[target]), center=k.pointOnSurface(importedFaces[target],(bounds.uMin+bounds.uMax)/2,(bounds.vMin+bounds.vMax)/2)
      const centerVertex=own(k.makeVertex(center.x,center.y,center.z))
      expect(Math.min(...roundFaces.map(face=>k.distanceBetween(centerVertex,face)))).toBeGreaterThan(1e-4)
      expect(k.isValid(round)).toBe(true)
      expect(roundFaces).toHaveLength(7)
      const solids=k.getSubShapes(round,'solid');owned.push(...solids)
      expect(solids).toHaveLength(1)
      for(const face of importedFaces.filter((_,index)=>index!==target)) {
        const b=k.uvBounds(face), p=k.pointOnSurface(face,(b.uMin+b.uMax)/2,(b.vMin+b.vMax)/2)
        const witness=own(k.makeVertex(p.x,p.y,p.z))
        expect(Math.min(...roundFaces.map(candidate=>k.distanceBetween(witness,candidate)))).toBeLessThan(1e-6)
      }
      expect(k.toBREP(imported)).toBe(before)
      const readBREP=k.toBREP.bind(k), altered=vi.spyOn(k,'toBREP').mockImplementation(h=>readBREP(h)+'\n')
      try {expect(()=>isolated.evaluate(changed)).toThrow(/sorgente CAD/i)}
      finally {altered.mockRestore()}
      expect(()=>isolated.evaluate(changed)).toThrow(/apri prima/i)
    } finally {isolated.dispose()}
    // Real dispatcher and OCCT; transport is simulated and no browser is used.
    const load=vi.spyOn(SurfaceEditorKernel,'load').mockResolvedValue(editor)
    const pending=new Map<number,{resolve:(v:unknown)=>void;reject:(e:Error)=>void}>()
    const host:{onmessage:((e:MessageEvent)=>void)|null;postMessage:(r:{id:number;result?:unknown;error?:string})=>void}={
      onmessage:null,postMessage(reply){const waiter=pending.get(reply.id)!;pending.delete(reply.id)
        if(reply.error)waiter.reject(new Error(reply.error));else waiter.resolve(reply.result)} }
    let id=0
    const ask=<T>(request:SurfaceWorkerPayload)=>new Promise<T>((resolve,reject)=>{
      const next=++id;pending.set(next,{resolve:resolve as (v:unknown)=>void,reject});host.onmessage!({data:{...request,id:next}} as MessageEvent)
    })
    vi.stubGlobal('self',host)
    try {
      await import('../editor.worker')
      const active=await ask<{faces:{reason:string|null}[]}>({action:'open',step})
      const activeFace=active.faces.findIndex((face,index)=>index!==target&&!face.reason)
      expect(activeFace).toBeGreaterThanOrEqual(0)
      const activeNet=await ask<Net>({action:'select',face:activeFace})
      const selection={face:activeFace,refinements:[]}
      const beforePreview=await ask<{previewRevision:number}>({action:'evaluate',net:activeNet,continuity:'G1',selection})
      const witness=await ask({action:'finalFaceWitness',previewRevision:beforePreview.previewRevision})
      const prepared=await ask<{net:Net;identity:ExperimentalSharedPlaneIdentity}>({action:'prepareSharedPlaneExperimental',step,face:target})
      const changed=structuredClone(prepared.net),pole=Math.floor(changed.nu/2)*changed.nv+Math.floor(changed.nv/2)
      changed.poles[pole][2]+=.02
      const request={action:'evaluateSharedPlaneExperimental' as const,step,face:target,net:changed,identity:prepared.identity}
      const exported=await ask<{step:string}>(request)
      const workerResult=own(k.importStep(exported.step))
      expect(k.isValid(workerResult)).toBe(true)
      const invalid=structuredClone(changed);invalid.poles[0][2]+=.1
      await expect(ask({...request,net:invalid})).rejects.toThrow()
      await expect(ask({...request,identity:{...prepared.identity,baseHash:'0'.repeat(64)}})).rejects.toThrow(/scaduta/)
      await expect(ask({...request,step:step+'\n'})).rejects.toThrow(/scaduta/)
      expect(await ask({action:'finalFaceWitness',previewRevision:beforePreview.previewRevision})).toEqual(witness)
      const session=new ExperimentalSharedPlaneSession({ask} as unknown as SurfaceWorkerClient)
      try {
        const sessionNet=await session.prepare(step,target)
        sessionNet.poles[pole][2]+=.02
        const sessionOutput=await session.evaluate(sessionNet,true)
        expect(sessionOutput.mesh!.triangleCount).toBeGreaterThan(0)
        expect(sessionOutput.faceMeshes).toHaveLength(7)
        expect(sessionOutput.previewFace).toBeGreaterThanOrEqual(0)
        expect(sessionOutput.faceMeshes![sessionOutput.previewFace!].triangleCount).toBeGreaterThan(0)
        const faceMesh=sessionOutput.faceMeshes![sessionOutput.previewFace!],geometry=new THREE.BufferGeometry()
        geometry.setAttribute('position',new THREE.BufferAttribute(faceMesh.positions,3))
        geometry.setIndex(new THREE.BufferAttribute(faceMesh.indices,1))
        const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),mesh3d=new THREE.Mesh(geometry,material)
        try {
          mesh3d.updateMatrixWorld(true)
          const b=k.uvBounds(importedFaces[target]),center=k.pointOnSurface(importedFaces[target],(b.uMin+b.uMax)/2,(b.vMin+b.vMax)/2)
          const ray=new THREE.Raycaster(new THREE.Vector3(center.x,center.y,center.z+1),new THREE.Vector3(0,0,-1))
          const hits=ray.intersectObject(mesh3d)
          expect(hits.length).toBeGreaterThan(0)
          expect(Math.abs(hits[0].point.z-center.z)).toBeGreaterThan(1e-4)
        } finally {geometry.dispose();material.dispose()}
        const sessionSolid=own(k.importStep(sessionOutput.step))
        expect(k.isValid(sessionSolid)).toBe(true)
        expect(await ask({action:'finalFaceWitness',previewRevision:beforePreview.previewRevision})).toEqual(witness)
      } finally {session.dispose()}
      expect(()=>editor.select(target)).toThrow(/ambigua|condivisa/i)
    } finally {vi.unstubAllGlobals();load.mockRestore()}
  } finally {owned.reverse().forEach(shape=>k.release(shape));editor.dispose()}
},60000)
