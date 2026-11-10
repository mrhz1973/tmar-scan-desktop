// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { clippedPointCertainty, clippedRayInterval, type ClippedRayMargins } from '../clippedRayInterval'
import type { Point } from '../brep'

const identity = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]
const margins:ClippedRayMargins = {
  planeClearanceMm: .1,
  startGuardMm: .2,
  endpointExtensionMm: .05,
  minimumVisibleLengthMm: .5,
  minimumCrossingCosine: .01,
}

it('clips the section start in world space and returns all section points in part coordinates',()=>{
  const scaleAndTranslate = [2,0,0,0, 0,3,0,0, 0,0,4,0, 100,0,0,1]
  const result = clippedRayInterval({originPart:[0,0,-2],targetPart:[0,0,2],partToWorld:scaleAndTranslate,
    planes:[{normal:[0,0,1],constant:0}],margins})
  expect(result).not.toBeNull()
  expect(result!.visibleStartParameter).toBeCloseTo(.5,10)
  expect(result!.startParameter).toBeLessThan(.5)
  expect(result!.sectionStartPart[0]).toBe(0)
  expect(result!.sectionStartPart[1]).toBe(0)
  expect(result!.sectionStartPart[2]).toBeLessThan(0)
  expect(result!.sectionEndPart[2]).toBeCloseTo(2.0125,10)
  expect(result!.frontClearEndPart[2]).toBeCloseTo(1.9875,10)
  expect(result!.visibleLengthMm).toBeCloseTo(8,10)
})

it('uses the latest entry among multiple retained half-spaces',()=>{
  const result = clippedRayInterval({originPart:[0,0,0],targetPart:[10,10,10],partToWorld:identity,
    planes:[
      {normal:[1,0,0],constant:-4},
      {normal:[0,1,0],constant:-7},
      {normal:[0,0,1],constant:-8},
    ],margins})
  expect(result).not.toBeNull()
  expect(result!.visibleStartParameter).toBeCloseTo(.8,10)
  expect(result!.startParameter).toBeLessThan(.8)
  expect(result!.sectionStartPart[0]).toBeCloseTo(10 * result!.startParameter,10)
  expect(result!.sectionStartPart[1]).toBeCloseTo(10 * result!.startParameter,10)
  expect(result!.sectionStartPart[2]).toBeCloseTo(10 * result!.startParameter,10)
})

it('includes the band immediately after the last of distinct clipping entries',()=>{
  const result=clippedRayInterval({originPart:[0,0,0],targetPart:[10,10,10],partToWorld:identity,
    planes:[{normal:[1,0,0],constant:-1},{normal:[0,1,0],constant:-8}],margins})
  expect(result).not.toBeNull()
  const lastEntry=.8
  const visibleOccluder=.8001
  expect(result!.startParameter).toBeLessThan(lastEntry)
  expect(result!.startParameter).toBeLessThan(visibleOccluder)
  expect(result!.certainlyClippedUntilParameter).toBeLessThanOrEqual(lastEntry)
  expect(result!.visibleStartParameter).toBeGreaterThanOrEqual(lastEntry)
  expect(result!.certainlyClippedUntilParameter).toBeLessThanOrEqual(result!.visibleStartParameter)
})

it('uses the part-to-world rotation when evaluating world-space planes',()=>{
  const rotateAndTranslate = [0,1,0,0, -1,0,0,0, 0,0,1,0, 10,0,0,1]
  const result = clippedRayInterval({originPart:[0,0,0],targetPart:[0,10,0],partToWorld:rotateAndTranslate,
    planes:[{normal:[-1,0,0],constant:1}],margins})
  expect(result).not.toBeNull()
  expect(result!.visibleStartParameter).toBeCloseTo(.9,10)
  expect(result!.startParameter).toBeLessThan(.9)
  expect(result!.sectionStartPart[0]).toBe(0)
  expect(result!.sectionStartPart[1]).toBeLessThan(9)
})

it.each([
  ['target clipped', [0,0,0] as Point, [0,0,1] as Point, [{normal:[0,0,1] as Point,constant:-2}]],
  ['target too close to plane', [0,0,0] as Point, [0,0,1] as Point, [{normal:[0,0,1] as Point,constant:-.9}]],
] as const)('rejects a %s',(_name,originPart,targetPart,planes)=>{
  expect(clippedRayInterval({originPart,targetPart,partToWorld:identity,planes,margins})).toBeNull()
})

it('rejects a near-tangent crossing of a clipping plane',()=>{
  expect(clippedRayInterval({originPart:[0,0,0],targetPart:[1000,0,0],partToWorld:identity,
    planes:[{normal:[.001,1,0],constant:-.5}],margins})).toBeNull()
})

it('rejects a visible remainder too short for the CAD section margins',()=>{
  expect(clippedRayInterval({originPart:[0,0,0],targetPart:[1,0,0],partToWorld:identity,
    planes:[{normal:[1,0,0],constant:-.5}],margins:{...margins,startGuardMm:.02,endpointExtensionMm:.05}})).toBeNull()
})

it('keeps the visible band between the clipping plane and section guard in the native ray segment',()=>{
  const result=clippedRayInterval({originPart:[-1,0,0],targetPart:[1,0,0],partToWorld:identity,
    planes:[{normal:[1,0,0],constant:0}],margins:{...margins,startGuardMm:.3}})
  expect(result).not.toBeNull()
  const occluderX=.05
  expect(result!.sectionStartPart[0]).toBeLessThan(occluderX)
  expect(result!.visibleStartParameter).toBeCloseTo(.5,10)
})

it('rejects a target extension that crosses out of the retained half-space',()=>{
  expect(clippedRayInterval({originPart:[0,0,0],targetPart:[10,0,0],partToWorld:identity,
    planes:[{normal:[-1,0,0],constant:10.1}],margins:{...margins,planeClearanceMm:.05,endpointExtensionMm:.1}})).toBeNull()
})

it('rejects inconsistent half-spaces, invalid planes and projective transforms',()=>{
  expect(clippedRayInterval({originPart:[0,0,0],targetPart:[2,0,0],partToWorld:identity,
    planes:[{normal:[1,0,0],constant:-1},{normal:[-1,0,0],constant:1}],margins})).toBeNull()
  expect(clippedRayInterval({originPart:[0,0,0],targetPart:[2,0,0],partToWorld:identity,
    planes:[{normal:[0,0,0],constant:0}],margins})).toBeNull()
  const sparsePlanes=Array(1) as unknown as [{normal:Point;constant:number}]
  expect(clippedRayInterval({originPart:[0,0,0],targetPart:[2,0,0],partToWorld:identity,
    planes:sparsePlanes,margins})).toBeNull()
  expect(clippedRayInterval({originPart:[0,0,0],targetPart:[2,0,0],partToWorld:identity,
    planes:[null] as unknown as [{normal:Point;constant:number}],margins})).toBeNull()
  expect(clippedRayInterval({originPart:[0,0,0],targetPart:[2**53,0,0],partToWorld:identity,
    planes:[],margins})).toBeNull()
  const projective = [...identity]; projective[3] = .01
  expect(clippedRayInterval({originPart:[0,0,0],targetPart:[2,0,0],partToWorld:projective,
    planes:[],margins})).toBeNull()
})

it('accepts an unclipped ray while keeping its section margin explicit',()=>{
  const result = clippedRayInterval({originPart:[0,0,0],targetPart:[2,0,0],partToWorld:identity,planes:[],margins})
  expect(result).not.toBeNull()
  expect(result!.startParameter).toBe(0)
  expect(result!.sectionStartPart).toEqual([0,0,0])
  expect(result!.sectionEndPart[0]).toBeCloseTo(2.05,10)
  expect(result!.frontClearEndPart[0]).toBeCloseTo(1.95,10)
})

it('accepts the minimum ray length when the retained front segment still meets its margin',()=>{
  const result = clippedRayInterval({originPart:[0,0,0],targetPart:[.56,0,0],partToWorld:identity,planes:[],
    margins:{...margins,minimumVisibleLengthMm:.5,endpointExtensionMm:.05}})
  expect(result).not.toBeNull()
  expect(result!.visibleLengthMm - .05).toBeCloseTo(.51,10)
})

it('distinguishes a definitely clipped candidate from the uncertain boundary band',()=>{
  const plane=[{normal:[0,0,-1] as Point,constant:.01}]
  expect(clippedPointCertainty([0,0,.02],identity,plane,.001)).toBe('clipped')
  expect(clippedPointCertainty([0,0,0],identity,plane,.001)).toBe('retained')
  expect(clippedPointCertainty([0,0,.01],identity,plane,.001)).toBe('uncertain')
  expect(clippedPointCertainty([0,0,.02],identity,[...plane,null] as unknown as typeof plane,.001)).toBe('uncertain')
})
