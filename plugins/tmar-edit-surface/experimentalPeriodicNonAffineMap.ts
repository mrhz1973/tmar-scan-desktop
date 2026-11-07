// SPDX-License-Identifier: AGPL-3.0-only
import type { NurbsCurveData, OcctKernel, ShapeHandle } from 'occt-wasm'
import { readFullPeriod } from './experimentalPeriodicCurveWitness'

interface Span {
  fromB: readonly [number, number]
  toA: readonly [number, number]
  /** For normalized t on fromB, the fraction along toA is (m*t + (d-m)*t²)/d. */
  m: bigint
  d: bigint
}

interface Correspondence {
  direction: 1 | -1
  /** Knot index on A matched to the first knot on B, modulo the period. */
  phase: number
  nonAffine: boolean
  spans: Span[]
}

const fail = (reason: string): never => {
  throw new Error(`Corrispondenza periodica non affine sperimentale rifiutata: ${reason}`)
}

const bits = new DataView(new ArrayBuffer(8))

// Represent every finite binary64 coordinate and knot in the same exact unit.
function binary64Units(value: number): bigint {
  bits.setFloat64(0, value)
  const word = bits.getBigUint64(0)
  const exponent = (word >> 52n) & 0x7ffn
  const fraction = word & ((1n << 52n) - 1n)
  const units = exponent === 0n ? fraction : ((1n << 52n) | fraction) << (exponent - 1n)
  return word >> 63n ? -units : units
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b]
  return a
}

function bezierSpans(data: NurbsCurveData, degree: number): bigint[][][] {
  if (data.degree !== degree || data.rational || data.multiplicities.some(m => m !== degree))
    fail(`richiesta una base periodica polinomiale di grado ${degree} con molteplicità pari al grado`)
  const poles = data.poles.map(binary64Units)
  return data.knots.slice(0, -1).map((_, span) =>
    [0, 1, 2].map(axis => Array.from({ length: degree + 1 }, (_, i) =>
      poles[(3 * (span * degree + i) + axis) % poles.length])))
}

function recoverQuadraticMap(a: bigint[][], b: bigint[][], direction: 1 | -1) {
  const orientedA = direction === 1 ? a : a.map(axis => axis.slice().reverse())
  if (orientedA.some(([p, , r], axis) => p !== b[axis][0] || r !== b[axis][4])) return

  // Recover the first slope from a component of the chain rule. At least
  // one endpoint of a nonconstant quadratic has a nonzero derivative.
  const startAxis = orientedA.findIndex(([p, q]) => q !== p)
  const fromEnd = startAxis === -1
  const axis = fromEnd ? orientedA.findIndex(([, q, r]) => r !== q) : startAxis
  const [p, q, r] = orientedA[axis]
  const [v, w, , y, z] = b[axis]
  let d = fromEnd ? r - q : q - p
  let m = fromEnd ? 2n * d - 2n * (z - y) : 2n * (w - v)
  if (d < 0n) [m, d] = [-m, -d]
  if (m <= 0n || m >= 2n * d) return
  const divisor = gcd(m, d)
  m /= divisor
  d /= divisor

  // Check all power coefficients of B = A ∘ phi after clearing the
  // denominator. Endpoint matching and the derivative only give a candidate.
  const n = d - m
  const denominatorSquared = d * d
  const identical = orientedA.every(([p, q, r], axis) => {
    const a1 = 2n * (q - p), a2 = p - 2n * q + r
    const composition = [
      p * denominatorSquared,
      a1 * m * d,
      a1 * n * d + a2 * m * m,
      2n * a2 * m * n,
      a2 * n * n,
    ]
    const [v, w, x, y, z] = b[axis]
    const quartic = [
      v, 4n * (w - v), 6n * (x - 2n * w + v),
      4n * (y - 3n * x + 3n * w - v), z - 4n * y + 6n * x - 4n * w + v,
    ]
    return quartic.every((coefficient, i) => coefficient * denominatorSquared === composition[i])
  })
  if (identical) return { m, d }
}

/**
 * Search all knot-to-knot phases and directions from a full-period quartic
 * edge B to a full-period quadratic edge A. Each span map fixes its normalized
 * endpoints and has positive slope there, hence throughout the span. A's
 * endpoints wrap at its seam, so the span maps join as a circle map.
 *
 * Exact coefficient identity proves coincidence for the extracted polynomial
 * model in this class. Uniqueness is limited to this search space. Edge
 * topology, pcurves, general periodic bases, and kernel evaluation error are
 * outside the witness. The kernel is used only to read the input edges.
 */
export function recoverPeriodicNonAffineMap(
  kernel: OcctKernel, edgeA: ShapeHandle, edgeB: ShapeHandle,
): Correspondence {
  const a = readFullPeriod(kernel, edgeA), b = readFullPeriod(kernel, edgeB)
  const aSpans = bezierSpans(a, 2), bSpans = bezierSpans(b, 4)
  const count = aSpans.length
  if (count !== bSpans.length) fail('numero di segmenti diverso')
  if (aSpans.some(span => span.every(([p, q, r]) => p === q && q === r)))
    fail('segmento quadratico costante')

  const wrap = (index: number) => (index + count) % count
  let result: Correspondence | undefined
  for (const direction of [1, -1] as const) {
    for (let phase = 0; phase < count; phase++) {
      const spans: Span[] = []
      for (const [i, bSpan] of bSpans.entries()) {
        const aIndex = wrap(phase + direction * i - (direction === 1 ? 0 : 1))
        const map = recoverQuadraticMap(aSpans[aIndex], bSpan, direction)
        if (!map) break
        const lowA = a.knots[aIndex], highA = a.knots[aIndex + 1]
        spans.push({
          fromB: [b.knots[i], b.knots[i + 1]],
          toA: direction === 1 ? [lowA, highA] : [highA, lowA],
          ...map,
        })
      }
      if (spans.length !== count) continue
      if (result) fail('fase o verso ambiguo')
      const width = ([start, end]: Span['fromB']) => binary64Units(end) - binary64Units(start)
      const firstA = width(spans[0].toA), firstB = width(spans[0].fromB)
      const nonAffine = spans.some(span => span.m !== span.d ||
        width(span.toA) * firstB !== width(span.fromB) * firstA)
      result = { direction, phase, nonAffine, spans }
    }
  }
  return result ?? fail('nessuna identità di composizione')
}
