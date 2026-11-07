// SPDX-License-Identifier: AGPL-3.0-only
import type { Net, Point } from './brep'
import { refineClampedNet } from './refineClampedNet'

export interface TangentSpanReview {
  readonly u: readonly [number, number]
  readonly v: readonly [number, number]
  readonly supportCount: number
  readonly movedCount: number
  readonly maxPoleDistanceMm: number
}

function interval(knots: number[], multiplicities: number[], degree: number, parameter: number) {
  const expanded = knots.flatMap((knot, index) => Array<number>(multiplicities[index]).fill(knot))
  const span = expanded.findIndex((knot, index) => knot < parameter && parameter < expanded[index + 1])
  if (span < degree || span >= expanded.length - degree - 1)
    throw new Error('Scegli un punto interno a uno span UV, lontano dalle linee dei nodi.')
  return { first: span - degree, bounds: Object.freeze([expanded[span], expanded[span + 1]] as const) }
}

/** Positive rational weights make the surface on this span a convex
 * combination of exactly the active poles. A trim can only restrict that set. */
export function planTangentSpan(net: Net, u: number, v: number, origin: Point, normal: Point, editable: readonly number[]) {
  refineClampedNet(net, []) // Reject unsupported knot layouts or weights.
  if (![...origin, ...normal].every(Number.isFinite) || Math.abs(Math.hypot(...normal) - 1) > 1e-12)
    throw new Error('Piano tangente non verificabile.')
  const alongU = interval(net.ku, net.mu, net.du, u)
  const alongV = interval(net.kv, net.mv, net.dv, v)
  const tolerance = 1e-8
  const permitted = new Set(editable)
  const projections = new Map<number, Point>()
  const signedDistance = (pole: Point) => pole.reduce((sum, value, axis) => sum + (value - origin[axis]) * normal[axis], 0)
  const distanceBound = (pole: Point) => Math.abs(signedDistance(pole)) +
    64 * Number.EPSILON * Math.max(1, ...pole.map(Math.abs), ...origin.map(Math.abs))
  let maxPoleDistanceMm = 0
  for (let i = 0; i <= net.du; i++) {
    for (let j = 0; j <= net.dv; j++) {
      const id = (alongU.first + i) * net.nv + alongV.first + j
      const pole = net.poles[id]
      let bound = distanceBound(pole)
      if (bound > tolerance) {
        if (!permitted.has(id)) throw new Error('Uno dei poli di supporto è fuori piano ed è bloccato o non selezionato.')
        const distance = signedDistance(pole)
        const projected = pole.map((value, axis) => value - distance * normal[axis]) as Point
        bound = distanceBound(projected)
        projections.set(id, projected)
      }
      if (!Number.isFinite(bound) || bound > tolerance)
        throw new Error('Non è possibile verificare la planarità dello span alla precisione richiesta.')
      maxPoleDistanceMm = Math.max(maxPoleDistanceMm, bound)
    }
  }
  const review: TangentSpanReview = Object.freeze({
    u: alongU.bounds, v: alongV.bounds, supportCount: (net.du + 1) * (net.dv + 1),
    movedCount: projections.size, maxPoleDistanceMm,
  })
  return { review, projections }
}
