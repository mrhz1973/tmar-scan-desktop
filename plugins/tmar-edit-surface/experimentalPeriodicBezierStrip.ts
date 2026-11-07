// SPDX-License-Identifier: AGPL-3.0-only
import { proposeExperimentalPeriodicClampedStripDerivatives,
  type ExperimentalPeriodicClampedStripRequest } from './experimentalPeriodicClampedStripDerivatives'

export type ExperimentalPeriodicBezierStripRequest = ExperimentalPeriodicClampedStripRequest

/**
 * Propose two independent inward derivatives of a unit-weight cubic Bézier
 * strip. V0 uses +dS/dV and V1 uses -dS/dV. Only the adjacent interior rows
 * are editable. Each residual field shares the strip's U basis, so the
 * maximum L1 residual coefficient bounds its Euclidean norm on the entire
 * edge, including the periodic seam.
 *
 * Editable residuals measure rounding of the proposal relative to the
 * supplied coefficients. Locked residuals may also reflect a target that
 * differs from the fixed derivative. The calculation concerns the supplied
 * coefficient models. Matching these targets alone gives no G1, regularity
 * or CAD guarantee.
 */
export function proposeExperimentalPeriodicBezierStrip(request: ExperimentalPeriodicBezierStripRequest) {
  return proposeExperimentalPeriodicClampedStripDerivatives(request, 4)
}
