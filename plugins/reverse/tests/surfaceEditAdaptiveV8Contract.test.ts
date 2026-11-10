// SPDX-License-Identifier: AGPL-3.0-only
// Host-only opt-in gate. This unit test cannot by itself qualify CAD: OCCT replay is mandatory.
import {describe, expect, it} from 'vitest'
import {readStoredSurfaceHistory} from '../app/surfaceEditHistory'

const H = (c: string) => c.repeat(64)
function record() {
  const recipe = {
    schema:'tmar.surface-edit',version:8,engine:'occt-wasm-5.7.1/brep-v3',
    units:'mm',coordinateFrame:'imported-step',
    source:{bodyId:'host-source',brepSha256:H('a'),faceCount:10,solidCount:1},
    faceIndex:7,preparation:'plane-to-bicubic',baseNetSha256:H('b'),
    continuity:'G1',edits:[{index:12,point:[1,2,3.02]}],
    lockedPoles:[12],boundaryMode:'locked',
    refinements:[{axis:'U',value:0.25,count:1}],
    trimPolicy:'circular-fine-v1',
    lockedValues:[{index:12,point:[1,2,3.02]}],
  }
  return {
    schema:'tmar.host.surface-edit-history',version:1,
    source:{bodyId:1,bodyKey:'host-source',
      file:{key:'a-b',name:'source.step',size:100},
      stepSha256:H('c'),sourceReplaySha256:H('d')},
    recipe,recipeSha256:H('e'),resultStepSha256:H('f'),
    replayStepSha256:H('0'),notePolicy:'none',
  }
}
const optin={experimentalAdaptiveV8:true} as const

describe('host adaptive v8 opt-in and strict input boundary',()=>{
  it('keeps v8 disabled by default, despite a structurally valid recipe',()=>{
    expect(()=>readStoredSurfaceHistory(record())).toThrow(/incompatibile/)
    expect(readStoredSurfaceHistory(record(),optin).recipe).toMatchObject({version:8,trimPolicy:'circular-fine-v1'})
  })
  it('refuses malformed protection and altered structural fields',()=>{
    const corrupt = (change:(r:ReturnType<typeof record>)=>void) => {
      const r=record();change(r);expect(()=>readStoredSurfaceHistory(r,optin)).toThrow()
    }
    corrupt(r=>{r.recipe.lockedValues=[]})
    corrupt(r=>{r.recipe.lockedValues[0].index=13})
    corrupt(r=>{r.recipe.lockedPoles=[12,12]})
    corrupt(r=>{r.recipe.edits=[{index:12,point:[1,2,3]},{index:12,point:[1,2,3]}]})
    corrupt(r=>{r.recipe.lockedValues[0].point=[1,2,Number.POSITIVE_INFINITY]})
    corrupt(r=>{r.recipe.refinements=[{axis:'U',value:0.25,count:0}]})
    corrupt(r=>{r.recipe.faceIndex=10})
    corrupt(r=>{r.recipe.trimPolicy='legacy'})
    corrupt(r=>{r.recipe.source.brepSha256='no-hash'})
    corrupt(r=>{r.recipe.source.bodyId='not-this-source'})
    corrupt(r=>{(r.recipe as Record<string,unknown>).unexpected=true})
  })
  it('does not confuse the experimental v8 gate with legacy history versions',()=>{
    const r=record()
    r.recipe.version=9
    expect(()=>readStoredSurfaceHistory(r,optin)).toThrow()
    r.recipe.version=8
    expect(()=>readStoredSurfaceHistory(r,{experimentalAdaptiveV8:undefined})).toThrow()
  })
})
