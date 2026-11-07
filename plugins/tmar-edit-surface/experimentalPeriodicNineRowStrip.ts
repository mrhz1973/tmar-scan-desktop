// SPDX-License-Identifier: AGPL-3.0-only
import { proposeExperimentalPeriodicClampedStripDerivatives,
  type ExperimentalPeriodicClampedStripRequest } from './experimentalPeriodicClampedStripDerivatives'

/**
 * Propose the inward V derivatives of a unit-weight periodic strip with nine
 * cubic V rows and a clamped knot vector. The two endpoint spans set their
 * own derivative scales. Only rows 1 and 7 (zero-based) are editable.
 *
 * The residual bounds cover both mathematical derivative fields against
 * their supplied targets in the strip's U basis. CAD, regularity and global
 * G1 require separate checks.
 */
export function proposeExperimentalPeriodicNineRowStrip(request: ExperimentalPeriodicClampedStripRequest) {
  return proposeExperimentalPeriodicClampedStripDerivatives(request, 9)
}
