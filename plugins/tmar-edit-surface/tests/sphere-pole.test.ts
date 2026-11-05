// SPDX-License-Identifier: AGPL-3.0-only
import { beforeAll, expect, it, vi } from 'vitest'
import { OcctKernel, type ShapeHandle } from 'occt-wasm'
import { auditSpherePoles } from '../spherePole'

let k: OcctKernel
beforeAll(async()=>{ k=await OcctKernel.init() },60000)
const identity = [1,0,0,0,0,1,0,0,0,0,1,0]
function withSphere(run: (sphere: ShapeHandle, converted: ShapeHandle, a: ShapeHandle, b: ShapeHandle)=>void) {
  const sphere = k.makeSphere(10), converted = k.generalTransform(sphere,identity)
  const a = k.getSubShapes(sphere,'face'), b = k.getSubShapes(converted,'face')
  try { run(sphere,converted,a[0],b[0]) }
  finally { [...a,...b,converted,sphere].forEach(h=>k.release(h)) }
}

it('checks real OCCT identity conversion at both collapsed poles without taking a singular normal',()=>{
  withSphere((sphere,converted,a,b)=>{
    expect(k.surfaceType(a)).toBe('sphere'); expect(k.surfaceType(b)).toBe('bspline')
    const original = k.toBREP(sphere), candidate = k.toBREP(converted)
    const normal = vi.spyOn(k,'surfaceNormal')
    let report: ReturnType<typeof auditSpherePoles>
    try {
      report = auditSpherePoles(k,a,b)
      expect(normal.mock.calls.length).toBe(288)
      for (const [face,,v] of normal.mock.calls) {
        const bounds = k.uvBounds(face)
        expect(v).toBeGreaterThan(bounds.vMin+1e-6)
        expect(v).toBeLessThan(bounds.vMax-1e-6)
      }
    } finally { normal.mockRestore() }
    expect(report.scope).toBe('sampled-full-sphere-poles')
    expect(report.regularWitnesses).toBe(144)
    expect(report.maxFaceDistance).toBeLessThan(1e-6)
    expect(report.minimumMatchedNormalDot).toBeGreaterThan(1-1e-7)
    expect(report.minimumLimitNormalDot).toBeGreaterThan(1-2e-5)
    expect(report.poles[0].z).toBeCloseTo(-10,10)
    expect(report.poles[1].z).toBeCloseTo(10,10)
    expect(k.toBREP(sphere)).toBe(original); expect(k.toBREP(converted)).toBe(candidate)
  })
})

it('refuses an actual trimmed hemisphere instead of treating its UV rectangle as a full sphere',()=>{
  const sphere = k.makeSphere(10)
  const cutter = k.makeBoxFromCorners({x:-20,y:-20,z:0},{x:20,y:20,z:20})
  const trimmed = k.cut(sphere,cutter), faces = k.getSubShapes(trimmed,'face')
  const analytic = faces.find(f=>k.surfaceType(f)==='sphere')!
  const converted = k.generalTransform(analytic,identity), candidates = k.getSubShapes(converted,'face')
  try {
    expect(analytic).toBeDefined()
    expect(k.isValid(trimmed)).toBe(true)
    expect(()=>auditSpherePoles(k,analytic,candidates[0])).toThrow(/parziale|topologia|trim/)
  } finally { [...faces,...candidates,converted,trimmed,cutter,sphere].forEach(h=>k.release(h)) }
})

function withQuarter(run: (source: ShapeHandle, converted: ShapeHandle, sphere: ShapeHandle)=>void) {
  const sphere = k.makeSphere(10)
  const box = k.makeBoxFromCorners({x:0,y:-20,z:-20},{x:20,y:0,z:0})
  const portion = k.common(sphere,box), faces = k.getSubShapes(portion,'face')
  const source = faces.find(f=>k.surfaceType(f)==='sphere')!
  const converted = k.generalTransform(source,identity), targets = k.getSubShapes(converted,'face')
  try { run(source,targets[0],sphere) }
  finally { [...faces,...targets,converted,portion,box,sphere].forEach(h=>k.release(h)) }
}

it('supports the real-case quarter hemisphere footprint with one collapsed pole and preserved trim',()=>{
  withQuarter((source,target)=>{
    const bounds = k.uvBounds(source)
    expect(bounds.uMin).toBeCloseTo(3*Math.PI/2,10)
    expect(bounds.uMax).toBeCloseTo(2*Math.PI,10)
    expect(bounds.vMin).toBeCloseTo(-Math.PI/2,10)
    expect(bounds.vMax).toBeCloseTo(0,10)
    for (const [kind,count] of [['wire',1],['edge',4],['vertex',3]] as const) {
      const parts = k.getSubShapes(source,kind)
      try { expect(parts.length).toBe(count) } finally { parts.forEach(h=>k.release(h)) }
    }
    const before = k.toBREP(source), convertedBefore = k.toBREP(target)
    const normal = vi.spyOn(k,'surfaceNormal')
    try {
      const report = auditSpherePoles(k,source,target)
      expect(report.scope).toBe('sampled-quarter-hemisphere-pole')
      expect(report.poles.length).toBe(1)
      expect(report.poles[0].z).toBeCloseTo(-10,10)
      expect(report.regularWitnesses).toBe(72)
      expect(report.maxFaceDistance).toBeLessThan(1e-6)
      expect(report.minimumMatchedNormalDot).toBeGreaterThan(1-1e-7)
      expect(report.minimumLimitNormalDot).toBeGreaterThan(1-2e-5)
      expect(normal.mock.calls.length).toBe(144)
      for (const [face,,v] of normal.mock.calls) expect(v).toBeGreaterThan(k.uvBounds(face).vMin+1e-6)
    } finally { normal.mockRestore() }
    expect(k.toBREP(source)).toBe(before)
    expect(k.toBREP(target)).toBe(convertedBefore)
  })
})

it('refuses a different quarter with the same pole and topology instead of accepting common support',()=>{
  withQuarter((source,_target,sphere)=>{
    const box = k.makeBoxFromCorners({x:-20,y:-20,z:-20},{x:0,y:0,z:0})
    const other = k.common(sphere,box), faces = k.getSubShapes(other,'face')
    const analytic = faces.find(f=>k.surfaceType(f)==='sphere')!
    const converted = k.generalTransform(analytic,identity), targets = k.getSubShapes(converted,'face')
    try { expect(()=>auditSpherePoles(k,source,targets[0])).toThrow(/bordi|rifilata|trim/) }
    finally { [...faces,...targets,converted,other,box].forEach(h=>k.release(h)) }
  })
})

it('refuses a real interior cut in the quarter patch',()=>{
  withQuarter((source)=>{
    const box = k.makeBoxFromCorners({x:5,y:-9,z:-7},{x:9,y:-4,z:-3})
    const cut = k.cut(source,box), faces = k.getSubShapes(cut,'face')
    const analytic = faces.find(f=>k.surfaceType(f)==='sphere')!
    const converted = k.generalTransform(analytic,identity), targets = k.getSubShapes(converted,'face')
    try { expect(()=>auditSpherePoles(k,analytic,targets[0])).toThrow(/topologia|trim/) }
    finally { [...faces,...targets,converted,cut,box].forEach(h=>k.release(h)) }
  })
})

it('refuses a real translated or anisotropically scaled BSpline even when topology matches',()=>{
  withSphere((_sphere,_converted,a,b)=>{
    for (const transform of [[1,0,0,.01,0,1,0,0,0,0,1,0],[1.01,0,0,0,0,1,0,0,0,0,1,0]]) {
      const changed = k.generalTransform(b,transform), faces = k.getSubShapes(changed,'face')
      try { expect(()=>auditSpherePoles(k,a,faces[0])).toThrow(/Sfera:/) }
      finally { faces.forEach(h=>k.release(h));k.release(changed) }
    }
  })
})

it('refuses solid handles and a nonspherical analytic source',()=>{
  withSphere((sphere,_converted,a,b)=>{
    expect(()=>auditSpherePoles(k,sphere,b)).toThrow()
    expect(()=>auditSpherePoles(k,a,a)).toThrow(/attese facce/)
    const cylinder = k.makeCylinder(10,20), faces = k.getSubShapes(cylinder,'face')
    try { expect(()=>auditSpherePoles(k,faces[0],b)).toThrow(/attese facce/) }
    finally { faces.forEach(h=>k.release(h));k.release(cylinder) }
  })
})
