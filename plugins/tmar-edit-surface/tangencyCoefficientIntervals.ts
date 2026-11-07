// SPDX-License-Identifier: AGPL-3.0-only
import type { Point } from './brep'

const failInterval = (reason: string): never => { throw new Error(`Tangenza curva compatibile rifiutata: ${reason}`) }

// Every elementary operation used for a certificate encloses the real result
// of the input binary coefficients. No sampled normals act as a proof oracle.
export type I = [number, number]
export type V = [I, I, I]
const raw = new BigUint64Array(1), number = new Float64Array(raw.buffer)
export const scalar = (x: number): I => [x, x]
export const vector = (p: Point): V => p.map(scalar) as V
function next(x: number, up: boolean): number {
  if (!Number.isFinite(x)) failInterval('overflow nella prova del bordo')
  if (x === 0) return up ? Number.MIN_VALUE : -Number.MIN_VALUE
  number[0] = x; raw[0] += (x > 0) === up ? 1n : -1n
  return number[0]
}
function enclosed(lo: number, hi: number): I {
  const out: I = [next(lo, false), next(hi, true)]
  if (!out.every(Number.isFinite)) failInterval('overflow nella prova del bordo')
  return out
}
export const add = (a: I, b: I): I => enclosed(a[0] + b[0], a[1] + b[1])
export const sub = (a: I, b: I): I => enclosed(a[0] - b[1], a[1] - b[0])
export function mul(a: I, b: I): I {
  const p = [a[0] * b[0], a[0] * b[1], a[1] * b[0], a[1] * b[1]]
  return enclosed(Math.min(...p), Math.max(...p))
}
export function divide(a: I, b: I): I {
  if (!(b[0] > 0)) failInterval('intervallo parametrico non comprovabilmente positivo')
  return mul(a, enclosed(1 / b[1], 1 / b[0]))
}
export const difference = (a: Point, b: Point): V => a.map((x, i) => sub(scalar(x), scalar(b[i]))) as V
export const times = (a: V, s: I): V => a.map(x => mul(x, s)) as V
export const cross = (a: V, b: V): V => [0, 1, 2].map(i => sub(mul(a[(i + 1) % 3], b[(i + 2) % 3]),
  mul(a[(i + 2) % 3], b[(i + 1) % 3]))) as V
export const dot = (a: V, b: Point): I => a.reduce((sum, x, i) => add(sum, mul(x, scalar(b[i]))), scalar(0))
const abs = (a: I) => Math.max(Math.abs(a[0]), Math.abs(a[1]))
export const l1 = (a: V): number => a.reduce((sum, x) => add(scalar(sum), scalar(abs(x)))[1], 0)

