// SPDX-License-Identifier: AGPL-3.0-only
import type { Net, Point } from './brep'
import { mapPeriodicKnotsAffineRounded } from './experimentalPeriodicAffineKnotMap'
import { validateExperimentalPeriodicSurfaceU } from './experimentalPeriodicSurfaceRefinement'
import { prepareExperimentalPeriodicUBasis } from './experimentalPeriodicUBasis'

interface Side {
  net: Net
  edge: 'V0' | 'V1'
  /** The U images of the shared edge's start and end, in traversal order. */
  uAtEdgeEnds: readonly [number, number]
}

interface ExperimentalPeriodicTransverseSamplesRequest {
  strip: Side
  support: Side
  edgePeriod: readonly [number, number]
  /** Increasing parameters including both endpoints and at least one interior point. */
  edgeParameters: readonly number[]
  lambda: number
  positionTolerance: number
}

const fail = (reason: string): never => { throw new Error(`Campioni trasversali periodici rifiutati: ${reason}`) }

function prepareSide(side: Side, edgeParameters: readonly number[]) {
  if (!side || !side.net || !Array.isArray(side.uAtEdgeEnds) || side.uAtEdgeEnds.length !== 2)
    fail('lato o estremi U non validi')
  const { net, edge, uAtEdgeEnds } = side
  validateExperimentalPeriodicSurfaceU(net)
  if ((edge !== 'V0' && edge !== 'V1') || net.weights.some(w => w !== 1))
    fail('serve un bordo V naturale a pesi unitari')
  const [start, end] = uAtEdgeEnds
  const first = net.ku[0], last = net.ku.at(-1)!
  if (!((start === first && end === last) || (start === last && end === first)))
    fail('la mappa U affine deve coprire esattamente un periodo del reticolo')
  const direction = start < end ? 1 : -1
  const mapping = mapPeriodicKnotsAffineRounded(edgeParameters, direction * start, direction * end)
  const parameters = mapping.knots.map(u => direction * u)
  const basis = prepareExperimentalPeriodicUBasis(net.du, net.ku, net.mu)
  const outer = edge === 'V0' ? 0 : net.nv - 1
  const inner = edge === 'V0' ? 1 : net.nv - 2
  const boundary = Array.from({ length: net.nu }, (_, u) => net.poles[u * net.nv + outer])
  return { parameters, maxParameterError: mapping.maxParameterError, basis, boundary, inner }
}

function evaluateCoefficients(active: { indices: number[]; values: number[] }, poles: readonly Point[],
  origin: Point = [0, 0, 0]): Point {
  return origin.map((x, axis) => active.indices.reduce((sum, i, j) =>
    sum + active.values[j] * (poles[i][axis] - x), 0)) as Point
}

/**
 * Sample the inward derivative target -lambda*D_support at a common edge
 * parameter, using each surface's own affine full-period U correspondence.
 * Side maps and poles must describe corresponding borders in the same
 * coordinate system. A reversed U map reverses traversal along the border,
 * while the sign of the inward derivative is determined only by its V side.
 *
 * Each sample's parameter is the strip's U and value is the derivative
 * target in coordinate units per strip V unit. Lambda sets the magnitude
 * conversion from the support's inward derivative. The two endpoint rows
 * name the same periodic seam and a fit may omit the duplicate observation.
 * Positions and derivatives are floating-point samples. The U mapping errors
 * bound only the rounding of the affine sample parameters.
 */
export function sampleExperimentalPeriodicTransverseDerivatives(request: ExperimentalPeriodicTransverseSamplesRequest) {
  const { strip, support, edgePeriod, edgeParameters, lambda, positionTolerance } = request
  if (!Array.isArray(edgePeriod) || !Array.isArray(edgeParameters))
    fail('campioni e intervallo del bordo non validi')
  const [first, last] = edgePeriod
  if (edgePeriod.length !== 2 || !Number.isFinite(first) || !Number.isFinite(last) || first >= last ||
      edgeParameters.length < 3 || edgeParameters.length > 4096 ||
      edgeParameters[0] !== first || edgeParameters.at(-1) !== last)
    fail('campioni e intervallo del bordo non validi')
  if (!Number.isFinite(lambda) || lambda <= 0 || !Number.isFinite(positionTolerance) || positionTolerance < 0)
    fail('scala positiva e tolleranza di posizione finita richieste')

  const a = prepareSide(strip, edgeParameters), b = prepareSide(support, edgeParameters)
  const net = support.net
  const span = support.edge === 'V0' ? 0 : net.kv.length - 2
  const factor = net.dv / (net.kv[span + 1] - net.kv[span])
  if (!Number.isFinite(factor)) fail('fattore parametrico V del supporto non rappresentabile')
  const inward = b.boundary.map((point, u) => point.map((x, axis) =>
    factor * (net.poles[u * net.nv + b.inner][axis] - x)) as Point)
  if (inward.some(point => !point.every(Number.isFinite))) fail('derivate del supporto non rappresentabili')

  let maxSampledGap = 0
  const samples = edgeParameters.map((edgeParameter, i) => {
    const parameter = a.parameters[i], supportParameter = b.parameters[i]
    const stripActive = a.basis.evaluate(parameter), supportActive = b.basis.evaluate(supportParameter)
    const origin = a.boundary[stripActive.indices[0]]
    const p = evaluateCoefficients(stripActive, a.boundary, origin)
    const q = evaluateCoefficients(supportActive, b.boundary, origin)
    const sampledGap = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
    if (!Number.isFinite(sampledGap) || sampledGap > positionTolerance)
      fail(`distanza campionata dei bordi oltre tolleranza al parametro ${edgeParameter}`)
    maxSampledGap = Math.max(maxSampledGap, sampledGap)
    const value = evaluateCoefficients(supportActive, inward).map(x => -lambda * x) as Point
    if (!value.every(Number.isFinite)) fail(`derivata obiettivo non rappresentabile al parametro ${edgeParameter}`)
    return { parameter, value, edgeParameter, supportParameter, sampledGap }
  })
  return { samples, maxSampledGap, maxStripParameterError: a.maxParameterError,
    maxSupportParameterError: b.maxParameterError, evidenceScope: 'floating-point-edge-samples' as const }
}
