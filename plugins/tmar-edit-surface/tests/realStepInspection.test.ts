// SPDX-License-Identifier: AGPL-3.0-only
// Opt-in read-only inspection of an owner's STEP. No file is written.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { SurfaceEditorKernel } from '../editorKernel'
import { boundaryLocked } from '../brep'

const path=process.env.SURFACE_QA_STEP
it.skipIf(!path)('inspects a supplied STEP without changing it',async()=>{
  const raw=readFileSync(path!), hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex')
  const before=hash(raw), editor=await SurfaceEditorKernel.load(), k=editor.kernel
  const model=k.importStep(raw.toString('utf8')), solids=k.getSubShapes(model,'solid')
  try {
    expect(solids.length).toBeGreaterThan(0)
    const results=solids.map((solid,index)=>{
      const opened=editor.open(k.exportStep(solid)),eligible=opened.faces.filter(f=>!f.reason)
      return {index,faces:opened.faces.length,eligible:eligible.length,
        kinds:Object.fromEntries([...new Set(opened.faces.map(f=>f.kind))].map(kind=>[kind,opened.faces.filter(f=>f.kind===kind).length])),
        reasons:[...new Set(opened.faces.flatMap(f=>f.reason?[f.reason]:[]))]}
    })
    console.log(JSON.stringify({solidCount:solids.length,results}))
    let edit:{solid:number;face:number;axis:number;before:number;after:number}|null=null
    const refusals:string[]=[]
    for(const item of results) {
      if(edit)break
      const step=k.exportStep(solids[item.index]),opened=editor.open(step),base=k.getVolume(solids[item.index])
      for(const face of opened.faces.filter(f=>!f.reason)) {
        if(edit)break
        for(const axis of [0,1,2]) {
          try {
            const net=editor.select(face.index)
            const pole=net.poles.findIndex((_,i)=>!boundaryLocked(net,i,'G1')&&!face.trimLocks.includes(i)&&!face.hiddenPoles.includes(i))
            if(pole<0)break
            net.poles[pole][axis]+=.05
            const preview=editor.evaluate(net,'G1',true)
            if(!preview.valid || !preview.step || Math.abs(preview.volume-base)<1e-8)continue
            const result=k.importStep(preview.step)
            try {
              if(!k.isValid(result))throw Error('Risultato STEP non valido')
              edit={solid:item.index,face:face.index,axis,before:base,after:k.getVolume(result)}
            } finally {k.release(result)}
            break
          } catch(error) {refusals.push(String((error as Error).message))}
        }
      }
    }
    console.log(JSON.stringify({edit,refusals:[...new Set(refusals)].slice(0,6)}))
    expect(edit).not.toBeNull()
    expect(hash(readFileSync(path!))).toBe(before)
  } finally {solids.forEach(solid=>k.release(solid));k.release(model);editor.dispose()}
},120000)
