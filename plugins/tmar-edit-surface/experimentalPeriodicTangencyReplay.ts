// SPDX-License-Identifier: AGPL-3.0-only
import type { OcctKernel, ShapeHandle, Vec3 } from 'occt-wasm'
import { replaceSurface, surfaceTable, type Net } from './brep'
import { validateExperimentalPeriodicTangency, type ExperimentalPeriodicTangencyRequest } from './experimentalPeriodicTangency'

const fail = (reason: string): never => { throw new Error(`Rilettura tangenza periodica rifiutata: ${reason}`) }
const equal = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((value, i) => Object.is(value, b[i]))

function faceSupport(brep: string) {
  const headers = [...brep.matchAll(/^Fa\s*\n[ \t]*[01][ \t]+\S+[ \t]+(\d+)[ \t]+0[ \t]*\r?$/gm)]
  if (headers.length !== 1) return fail('supporto proprio della faccia assente, ambiguo o trasformato')
  return surfaceTable(brep)[Number(headers[0][1]) - 1] ?? fail('indice del supporto della faccia non valido')
}

function exactKnotAdd(a: number, b: number) {
  const sum = a + b, virtualB = sum - a
  // TwoSum recovers the rounding error of an IEEE 754 addition.
  if (!Number.isFinite(sum) || (a - (sum - virtualB)) + (b - virtualB) !== 0)
    fail('periodo o nodi U traslati non rappresentabili esattamente')
  return sum
}

function checkPeriodicKnotWrap(net: Net) {
  const first = net.ku[0], last = net.ku.at(-1)!
  const period = exactKnotAdd(last, -first)
  // OCCT needs these degree-dependent knot repetitions on either side of
  // the period. Exact translations retain the cyclic basis and its C1 join.
  const pad = net.du + 1 - net.mu[0]
  const central = net.ku.flatMap((knot, i) => Array<number>(net.mu[i]).fill(knot))
  for (const knot of central.slice(net.nu - pad, net.nu)) exactKnotAdd(knot, -period)
  for (const knot of central.slice(net.mu[0], net.mu[0] + pad)) exactKnotAdd(knot, period)

  // Compare points strictly inside both neighboring spans with their
  // translated partners. An endpoint-only check can alias the kernel seam.
  const left = last - (last - net.ku.at(-2)!) / 2
  const right = first + (net.ku[1] - first) / 2
  const beforeFirst = exactKnotAdd(left, -period), afterLast = exactKnotAdd(right, period)
  if (!(net.ku.at(-2)! < left && left < last && beforeFirst < first &&
        first < right && right < net.ku[1] && last < afterLast))
    fail('sonde U distinte non rappresentabili attorno alla cucitura')
  return [[first, last], [beforeFirst, left], [right, afterLast]] as const
}

function checkReadback(expected: Net, actual: Net | undefined, label: string) {
  if (!actual || !equal(expected.periodic!, actual.periodic!) ||
      expected.nu !== actual.nu || expected.nv !== actual.nv || expected.du !== actual.du || expected.dv !== actual.dv ||
      !equal(expected.ku, actual.ku) || !equal(expected.kv, actual.kv) ||
      !equal(expected.mu, actual.mu) || !equal(expected.mv, actual.mv))
    return fail(`${label}: periodicità, dimensioni, gradi o nodi modificati da OCCT`)
  if (!equal(expected.rational, actual.rational) || !equal(expected.weights, actual.weights))
    fail(`${label}: razionalità o pesi modificati da OCCT`)
  if (expected.poles.length !== actual.poles.length || expected.poles.some((pole, i) => !equal(pole, actual.poles[i])))
    fail(`${label}: coordinate dei poli modificate da OCCT`)
  return actual
}

const gap = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

/**
 * Rebuild and read back three OCCT supports in a disposable face wrapper.
 * Its trims and topology provide no evidence. This validates exact BREP
 * coefficient retention, a C1 cyclic knot basis, and sampled kernel closure.
 */
export function verifyExperimentalPeriodicTangencyReplay(k: OcctKernel, faceTemplate: ShapeHandle,
  request: ExperimentalPeriodicTangencyRequest, finalNet: Net) {
  const validation = validateExperimentalPeriodicTangency(request, finalNet)
  const pairs = checkPeriodicKnotWrap(finalNet)
  const brep = k.toBREP(faceTemplate), record = faceSupport(brep)
  let maxSampledPositionGap = 0, closureSamples = 0
  for (const [label, expected] of [['selezionato iniziale', request.net], ['adiacente', request.supportNet],
    ['selezionato modificato', finalNet]] as const) {
    const face = k.fromBREP(replaceSurface(brep, record, expected))
    try {
      const actual = checkReadback(expected, faceSupport(k.toBREP(face)).periodicNet, label)
      const vs = actual.kv.flatMap((v, i) => i + 1 === actual.kv.length ? [v] : [v, v + (actual.kv[i + 1] - v) / 2])
      for (const v of vs) for (const [a, b] of pairs) {
        const residual = gap(k.pointOnSurface(face, a, v), k.pointOnSurface(face, b, v))
        if (!(residual <= 1e-8)) fail(`${label}: chiusura periodica U fuori tolleranza`)
        maxSampledPositionGap = Math.max(maxSampledPositionGap, residual)
        closureSamples++
      }
    } finally {
      k.release(face)
    }
  }
  return { ...validation, evidenceScope: 'occt-brep-supports' as const, cadRoundTripVerified: true as const,
    periodicClosure: 'exact-cyclic-knot-wrap-and-occt-point-samples' as const, closureSamples, maxSampledPositionGap }
}
