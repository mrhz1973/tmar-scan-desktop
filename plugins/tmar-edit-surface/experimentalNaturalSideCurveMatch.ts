// SPDX-License-Identifier: AGPL-3.0-only
// Experimental coefficient witness only. It does not associate an OCCT Edge
// with a curve record or prove that a topological edge owns this natural side.
import type { Net, Point } from './brep'
import type { NaturalSide } from './g1SupportTopology'
import { refineClampedNet } from './refineClampedNet'
import { compareCurveCoefficients, type CoefficientComparison, type Curve3dRecord } from './experimentalCurveWitness'

export interface NaturalSideCurveMatch {
  side: NaturalSide
  along: 'U' | 'V'
  curve: Curve3dRecord
  comparison: CoefficientComparison
}

const fail = (reason: string): never => { throw new Error(`Confronto lato naturale sperimentale rifiutato: ${reason}`) }

/**
 * Compares one native, increasing-parameter natural side of a clamped surface
 * net with one nonperiodic Curve3dRecord. The side poles and basis are copied
 * directly from the appropriate net axis; no fit, projection, or reversal is
 * applied. Edge traversal direction and topological ownership are outside this
 * witness. `direction=-1` is deliberately rejected until an exact reverse-basis
 * transformation is implemented and independently qualified.
 */
export function matchNaturalSideCurve(net: Net, side: NaturalSide, curve: Curve3dRecord,
  direction: 1 | -1 = 1): NaturalSideCurveMatch {
  if (direction !== 1) fail('verso inverso non supportato: trasformazione esatta della base non implementata')
  if (!['uMin', 'uMax', 'vMin', 'vMax'].includes(side)) fail('lato naturale sconosciuto')
  const n = refineClampedNet(net, [])
  const along: 'U' | 'V' = side[0] === 'u' ? 'V' : 'U'
  const fixedIndex = side === 'uMin' || side === 'vMin' ? 0 : (along === 'V' ? n.nu - 1 : n.nv - 1)
  const count = along === 'U' ? n.nu : n.nv
  const poles: Point[] = []
  const weights: number[] = []
  for (let i = 0; i < count; i++) {
    const index = along === 'U' ? i * n.nv + fixedIndex : fixedIndex * n.nv + i
    poles.push([...n.poles[index]])
    weights.push(n.weights[index])
  }
  const record: Curve3dRecord = {
    kind: 7, rational: n.rational[along === 'U' ? 0 : 1] === 1,
    periodic: false, degree: along === 'U' ? n.du : n.dv,
    poles, weights,
    knots: [...(along === 'U' ? n.ku : n.kv)],
    multiplicities: [...(along === 'U' ? n.mu : n.mv)],
    source: 'inline-surface-generator'
  }
  const comparison = compareCurveCoefficients(record, curve)
  return { side, along, curve: record, comparison }
}
