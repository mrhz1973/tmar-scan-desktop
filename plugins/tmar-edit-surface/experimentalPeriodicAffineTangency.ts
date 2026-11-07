// SPDX-License-Identifier: AGPL-3.0-only
import type { OcctKernel } from 'occt-wasm'
import { mapPeriodicKnotsAffineExactly } from './experimentalPeriodicAffineCurveWitness'
import { refineExperimentalPeriodicSurfaceU, validateExperimentalPeriodicSurfaceU } from './experimentalPeriodicSurfaceRefinement'
import { proposeExperimentalPeriodicTangency, type ExperimentalPeriodicTangencyRequest } from './experimentalPeriodicTangency'

/**
 * Use the selected net's original U domain throughout, so the proposal
 * remains in the coordinate system of its original pcurves. The other net
 * is mapped only on a copy. The caller supplies full-period natural sides
 * with matching seam phase and direction. Refuse knots that would require
 * rounding. Refinement changes pole indices, so source pole locks cannot
 * be carried over.
 *
 * Only coefficient evidence is returned. The caller retains the two source
 * nets and any BREP. The proposal does not rewrite or validate pcurves, edge
 * curves or topology. OCCT knot-insertion error is not bounded by this API.
 */
export function proposeExperimentalPeriodicAffineTangency(kernel: OcctKernel, request: ExperimentalPeriodicTangencyRequest) {
  const { net, supportNet, edge, supportEdge, scale, lockIndices = [] } = request
  if (lockIndices.length !== 0) throw new Error('Tangenza affine periodica rifiutata: indici sorgente non trasferibili alla base comune')
  validateExperimentalPeriodicSurfaceU(supportNet)
  const ku = mapPeriodicKnotsAffineExactly(supportNet.ku, net.ku[0], net.ku.at(-1)!)
  const { left, right } = refineExperimentalPeriodicSurfaceU(kernel, net, { ...supportNet, ku })
  const proposal = proposeExperimentalPeriodicTangency({ net: left, supportNet: right, edge, supportEdge, scale })
  return { ...proposal, refinedNet: left }
}
