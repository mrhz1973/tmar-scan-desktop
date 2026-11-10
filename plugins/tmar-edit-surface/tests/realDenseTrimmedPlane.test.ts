// SPDX-License-Identifier: AGPL-3.0-only
// Opt-in kernel qualification; reads the supplied STEP, never writes it.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import { boundaryLocked } from '../brep'
import type { Net } from '../brep'
import { SurfaceEditorKernel } from '../editorKernel'
import { SurfaceRuntime } from '../surfaceRuntime'
import type { Request } from '../editor.worker'
import type { KnotInsertion } from '../refineClampedNet'

const path=process.env.SURFACE_QA_STEP
it.skipIf(!path)('prepares a protected trimmed plane of the supplied first solid and replays the CAD edit',async()=>{
  const input=readFileSync(path!), sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex')
  const editor=await SurfaceEditorKernel.load(), k=editor.kernel, imported=k.importStep(input.toString('utf8'))
  const solids=k.getSubShapes(imported,'solid')
  try {
    expect(solids.length).toBeGreaterThan(0)
    const step=k.exportStep(solids[0]), opened=editor.open(step)
    const candidates=opened.faces.filter(f=>f.kind==='plane' && f.reason==='Tutti i poli influenzano un contorno ritagliato.')
    expect(candidates.length).toBeGreaterThan(0)
    let picked:ReturnType<typeof editor.selectDenseTrimmedPlane>|undefined, face=-1
    for(const item of candidates)try {picked=editor.selectDenseTrimmedPlane(item.index);face=item.index;break} catch { /* Other contours can remain fully protected. */ }
    expect(picked).toBeDefined()
    const locks=new Set([...picked!.trimLocks,...picked!.hiddenPoles]), net=picked!.net
    const pole=net.poles.findIndex((_,i)=>!locks.has(i)&&!boundaryLocked(net,i,'G1'))
    expect(pole).toBeGreaterThanOrEqual(0)
    const original=k.importStep(step), faces=k.getSubShapes(original,'face')
    try {
      const b=k.uvBounds(faces[face]), normal=k.surfaceNormal(faces[face],(b.uMin+b.uMax)/2,(b.vMin+b.vMax)/2)
      net.poles[pole]=[net.poles[pole][0]+normal.x*.02,net.poles[pole][1]+normal.y*.02,net.poles[pole][2]+normal.z*.02]
      const edited=editor.evaluate(net,'G1',true)
      expect(edited.valid).toBe(true);expect(edited.step).toBeTruthy()
      const recipe=await editor.createRecipe(net,'G1',[pole],'dense-plane')
      expect(recipe.version).toBe(4)
      const replay=await editor.replayRecipe(step,JSON.parse(JSON.stringify(recipe)),'dense-plane')
      expect(replay.valid).toBe(true)
      const result=k.importStep(edited.step!), restored=k.importStep(replay.step!)
      try {
        expect(k.isValid(result)).toBe(true);expect(k.isValid(restored)).toBe(true);expect(k.getVolume(restored)).toBeCloseTo(k.getVolume(result),6)
        const changed=k.getSubShapes(result,'face')
        try {
          expect(changed).toHaveLength(faces.length)
          for(let i=0;i<faces.length;i++) if(i!==face) {
            const uv=k.uvBounds(faces[i])
            for(const u of [.25,.5,.75])for(const v of [.25,.5,.75]) {
              const x=uv.uMin+(uv.uMax-uv.uMin)*u,y=uv.vMin+(uv.vMax-uv.vMin)*v
              const a=k.pointOnSurface(faces[i],x,y),b=k.pointOnSurface(changed[i],x,y)
              expect(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)).toBeLessThan(1e-6)
            }
          }
        } finally {changed.forEach(f=>k.release(f))}
      }
      finally {k.release(result);k.release(restored)}
    } finally {faces.forEach(f=>k.release(f));k.release(original)}
    expect(sha(readFileSync(path!))).toBe(sha(input))
  } finally {solids.forEach(s=>k.release(s));k.release(imported);editor.dispose()}
},120000)

it.skipIf(!path)('carries protected dense-plane selection and its refined identity through the real worker dispatcher',async()=>{
  const editor=await SurfaceEditorKernel.load(),k=editor.kernel,input=readFileSync(path!)
  const imported=k.importStep(input.toString('utf8')),solids=k.getSubShapes(imported,'solid')
  const load=vi.spyOn(SurfaceEditorKernel,'load').mockResolvedValue(editor)
  const client={onmessage:null as ((e:MessageEvent)=>void)|null,onerror:null,onmessageerror:null,
    postMessage(message:Request){host.onmessage!({data:structuredClone(message)} as MessageEvent<Request>)},terminate(){}}
  const host={onmessage:null as ((e:MessageEvent<Request>)=>void)|null,
    postMessage(value:unknown){client.onmessage?.({data:structuredClone(value)} as MessageEvent)}}
  let runtime:SurfaceRuntime|undefined
  try {
    const step=k.exportStep(solids[0]);vi.stubGlobal('self',host);await import('../editor.worker')
    runtime=new SurfaceRuntime(()=>client as unknown as Worker)
    const opened=await runtime.worker.ask<{faces:{index:number;kind:string;reason:string|null}[]}>({action:'open',step})
    const face=opened.faces.find(f=>f.kind==='plane'&&f.reason==='Tutti i poli influenzano un contorno ritagliato.')!
    expect(face).toBeDefined()
    const prepared=await runtime.worker.ask<{net:Net;refinements:KnotInsertion[];trimLocks:number[];hiddenPoles:number[]}>({action:'selectDenseTrimmedPlane',face:face.index})
    expect(prepared.refinements).toHaveLength(48)
    const locks=new Set([...prepared.trimLocks,...prepared.hiddenPoles])
    const pole=prepared.net.poles.findIndex((_,i)=>!locks.has(i)&&!boundaryLocked(prepared.net,i,'G1'))
    expect(pole).toBeGreaterThanOrEqual(0)
    const result=await runtime.worker.ask<{valid:boolean}>({action:'evaluate',net:prepared.net,continuity:'G1',selection:{face:face.index,refinements:prepared.refinements}})
    expect(result.valid).toBe(true)
    await expect(runtime.worker.ask({action:'evaluate',net:prepared.net,continuity:'G1',selection:{face:face.index,refinements:[]}})).rejects.toThrow()
  } finally {runtime?.dispose();vi.unstubAllGlobals();load.mockRestore();solids.forEach(s=>k.release(s));k.release(imported);editor.dispose()}
},120000)
