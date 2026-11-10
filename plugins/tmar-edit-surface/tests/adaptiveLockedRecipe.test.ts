// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { readAdaptiveTrimRecipe } from '../adaptiveTrimRecipe'
import { readAdaptiveLockedRecipe } from '../adaptiveLockedRecipe'

const fixture=()=>({schema:'tmar.surface-edit',version:8,engine:'occt-wasm-5.7.1/brep-v3',units:'mm',coordinateFrame:'imported-step',
  source:{bodyId:'part',brepSha256:'a'.repeat(64),faceCount:1,solidCount:0},faceIndex:0,preparation:'plane-to-bicubic',
  baseNetSha256:'b'.repeat(64),continuity:'G1',edits:[{index:4,point:[1,2,3]}],lockedPoles:[4],
  boundaryMode:'locked',refinements:[{axis:'U',value:.5,count:1}],trimPolicy:'circular-fine-v1',lockedValues:[{index:4,point:[1,2,3]}]})

it('clones v8 and preserves the independent v7 contract',()=>{
  const input=fixture(),result=readAdaptiveLockedRecipe(input)
  expect(()=>readAdaptiveTrimRecipe(input)).toThrow()
  input.lockedValues[0].point[0]=99
  expect(result.lockedValues[0].point[0]).toBe(1)
  const {lockedValues:_values,...v7}=fixture()
  expect(readAdaptiveTrimRecipe({...v7,version:7}).version).toBe(7)
})
it('rejects missing, duplicate, malformed or mismatched lock snapshots',()=>{
  const f=fixture()
  for(const bad of [{...f,lockedValues:[]},{...f,lockedValues:[{index:5,point:[1,2,3]}]},
    {...f,lockedValues:[{index:4,point:[1,2,NaN]}]}, {...f,lockedValues:[{index:4,point:[1,,3]}]},
    {...f,lockedValues:[{index:4,point:[1,2,3],extra:true}]}, {...f,lockedPoles:[4,5],lockedValues:[{index:4,point:[1,2,3]},{index:4,point:[1,2,3]}]},
    {...f,lockedValues:Array(1)}, {...f,extra:true}]) expect(()=>readAdaptiveLockedRecipe(bad)).toThrow()
})
