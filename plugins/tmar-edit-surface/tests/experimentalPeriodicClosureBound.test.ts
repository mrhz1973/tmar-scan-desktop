// SPDX-License-Identifier: AGPL-3.0-only
import { OcctKernel, type ShapeHandle } from 'occt-wasm'
import { expect, it } from 'vitest'
import { replaceSurface, surfaceTable, type Net, type Point } from '../brep'
import { boundExperimentalPeriodicClosure } from '../experimentalPeriodicClosureBound'
import { proposeExperimentalPeriodicTangency, type ExperimentalPeriodicTangencyRequest } from '../experimentalPeriodicTangency'
import { verifyExperimentalPeriodicTangencyReplay } from '../experimentalPeriodicTangencyReplay'
import { refineLinearPeriodicV } from '../periodic'

const tolerance = 1e-8

function seamGap(k: OcctKernel, face: ShapeHandle, net: Net, v: number) {
  const a = k.pointOnSurface(face, net.ku[0], v), b = k.pointOnSurface(face, net.ku.at(-1)!, v)
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

async function withCylinder(check: (k: OcctKernel, cylinder: ShapeHandle, own: (shape: ShapeHandle) => ShapeHandle) => void) {
  const k = await OcctKernel.init(), handles: ShapeHandle[] = []
  const own = (shape: ShapeHandle) => { handles.push(shape); return shape }
  try { check(k, own(k.makeCylinder(10, 20)), own) }
  finally {
    handles.reverse().forEach(shape => k.release(shape))
    k[Symbol.dispose]()
  }
}

it('bounds the read-back coefficient model of a converted STEP cylinder over multiple V spans', async () => {
  await withCylinder((k, cylinder, own) => {
    const source = own(k.importStep(k.exportStep(cylinder)))
    const converted = own(k.generalTransform(source, [1,0,0,0, 0,1,0,0, 0,0,1,0]))
    const faces = k.getSubShapes(converted, 'face').map(own)
    const face = faces.find(h => surfaceTable(k.toBREP(h)).some(r => r.periodicNet))!
    const brep = k.toBREP(face), record = surfaceTable(brep).find(r => r.periodicNet)!
    const original = own(k.fromBREP(brep))
    const refined = own(k.fromBREP(replaceSurface(brep, record, refineLinearPeriodicV(record.periodicNet!, 9))))
    for (const handle of [original, refined]) {
      const actual = surfaceTable(k.toBREP(handle)).find(r => r.periodicNet)!.periodicNet!
      const evidence = boundExperimentalPeriodicClosure(k, handle)
      expect(evidence).toMatchObject({ evidenceScope: 'occt-brep-rounded-u-knot-coefficient-model',
        globalOcctClosureCertified: false, checkedVSpans: handle === original ? 1 : 6 })
      expect(evidence.maxCoefficientModelPositionGap).toBeLessThan(tolerance)
      for (let i = 0; i <= 64; i++)
        expect(seamGap(k, handle, actual, 20 * i / 64)).toBeLessThan(tolerance)
    }
    expect(() => boundExperimentalPeriodicClosure(k, converted)).toThrow(/sola faccia/)
  })
}, 30000)

// The large pole is on a protected row, so the periodic tangency proposal
// and the three-V replay probes both accept it.
function counterexample(): ExperimentalPeriodicTangencyRequest {
  const nu = 16, nv = 4
  const make = (selected: boolean): Net => {
    const poles: Point[] = [], weights: number[] = []
    for (let u = 0; u < nu; u++) {
      const angle = u / nu * 2 * Math.PI, x = Math.cos(angle), y = Math.sin(angle)
      for (let v = 0; v < nv; v++) {
        const distance = selected ? 3 - v : v
        const radial = selected ? 10 : 10 + distance * (0.25 + 0.125 * x)
        poles.push([radial * x, radial * y, (selected ? -1 : 1) * distance * (1 + y / 8)])
        weights.push(1 + 0.125 * x)
      }
    }
    return { nu, nv, du: 2, dv: 3, ku: Array.from({ length: nu + 1 }, (_, i) => i + (i % 2) / 4),
      mu: Array(nu + 1).fill(1), kv: selected ? [0, 4] : [7, 9], mv: [4, 4], poles, weights,
      periodic: [1, 0], rational: [0, 1] }
  }
  const net = make(true), supportNet = make(false)
  for (let u = 0; u < nu; u++) net.poles[u * nv + nv - 1] = [...supportNet.poles[u * nv]]
  net.poles[5][0] = 116520000.00000001
  return { net, supportNet, edge: 'V1', supportEdge: 'V0', scale: 0.5 }
}

it('reproduces the unsampled OCCT gap and refuses to infer global kernel closure', async () => {
  await withCylinder((k, cylinder, own) => {
    const request = counterexample(), { net } = proposeExperimentalPeriodicTangency(request)
    const template = k.getSubShapes(cylinder, 'face').map(own).find(h => k.surfaceType(h) === 'cylinder')!
    const receipt = verifyExperimentalPeriodicTangencyReplay(k, template, request, net)
    expect(receipt.maxSampledPositionGap).toBeLessThan(tolerance)
    const brep = k.toBREP(template), face = own(k.fromBREP(replaceSurface(brep, surfaceTable(brep)[0], net)))
    const actual = surfaceTable(k.toBREP(face))[0].periodicNet!
    expect(actual).toEqual(net)
    expect(seamGap(k, face, actual, 0.625)).toBeGreaterThan(tolerance)
    const evidence = boundExperimentalPeriodicClosure(k, face)
    expect(evidence.globalOcctClosureCertified).toBe(false)
  })
}, 30000)

it('encloses an independent quadratic endpoint calculation with unequal rounded padding', async () => {
  await withCylinder((k, cylinder, own) => {
    const end = 2 ** 30, step = 2 ** -22
    const ku = [0, 1.5 * step, end - 2 * step, end]
    const net: Net = { ku, mu: [1, 1, 1, 1], kv: [0, 4], mv: [2, 2], du: 2, dv: 1, nu: 3, nv: 2,
      poles: [[1,0,0], [1,0,4], [0,0,0], [0,0,4], [0,1,0], [0,1,4]],
      weights: Array(6).fill(1), periodic: [1, 0], rational: [0, 0] }
    const template = k.getSubShapes(cylinder, 'face').map(own).find(h => k.surfaceType(h) === 'cylinder')!
    const brep = k.toBREP(template), face = own(k.fromBREP(replaceSurface(brep, surfaceTable(brep)[0], net)))
    expect(surfaceTable(k.toBREP(face))[0].periodicNet).toEqual(net)
    // The right translation rounds from end + 1.5*step to end + 2*step.
    // The surviving X=1 pole therefore contributes 3/7 at Umin and 1/2
    // at Umax, for a gap of 1/14 at every V in the coefficient model.
    expect(ku[1] + end).toBe(end + 2 * step)
    const { maxCoefficientModelPositionGap } = boundExperimentalPeriodicClosure(k, face)
    expect(maxCoefficientModelPositionGap).toBeGreaterThanOrEqual(1 / 14)
    expect(maxCoefficientModelPositionGap).toBeLessThan(1 / 14 + 1e-12)
  })
}, 30000)

it('refuses an OCCT read-back whose rounded U padding collapses at the cut', async () => {
  await withCylinder((k, cylinder, own) => {
    const { net } = counterexample()
    net.ku = Array.from({ length: net.nu + 1 }, (_, i) => i === net.nu ? 2 ** 54 : i / 2)
    const template = k.getSubShapes(cylinder, 'face').map(own).find(h => k.surfaceType(h) === 'cylinder')!
    const brep = k.toBREP(template), face = own(k.fromBREP(replaceSurface(brep, surfaceTable(brep)[0], net)))
    expect(surfaceTable(k.toBREP(face))[0].periodicNet).toEqual(net)
    expect(() => boundExperimentalPeriodicClosure(k, face)).toThrow(/estensione periodica/)
  })
}, 30000)
