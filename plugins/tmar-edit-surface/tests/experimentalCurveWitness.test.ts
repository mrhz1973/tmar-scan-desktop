// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { SurfaceEditorKernel } from '../editorKernel'
import { compareCurveCoefficients, curve3dTable, type Curve3dRecord } from '../experimentalCurveWitness'

const brep = (records: string, count = 1) => `CASCADE Topology V3\nLocations 0\nCurves ${count}\n${records}\nCurve2ds 0\n`
const record: Curve3dRecord = { kind: 7, rational: false, periodic: false, degree: 3,
  poles: [[0,0,0],[1,1,0],[2,1,0],[3,0,0]], weights: [1,1,1,1], knots: [0,1], multiplicities: [4,4], source: 'curve-table' }

it('reads the actual OCCT Curves table emitted for a B-spline edge', async () => {
  const editor = await SurfaceEditorKernel.load(), k = editor.kernel
  const edge = k.makeBSplineEdge([0,0,0, 1,1,0, 2,1,0, 3,0,0], [], [0,1], [4,4], 3)
  try {
    const text = k.toBREP(edge)
    expect(text).toMatch(/^Curves 1$/m)
    expect(text).toMatch(/^Curve2ds /m)
    const got = curve3dTable(text)
    expect(got).toHaveLength(1)
    expect(got[0]).toMatchObject({ kind: 7, rational: false, periodic: false, degree: 3, poles: record.poles, knots: record.knots, multiplicities: record.multiplicities })
    expect(compareCurveCoefficients(record, got[0]).exact).toBe(true)
  } finally { k.release(edge); editor.dispose() }
}, 60000)

it('fails closed for unsupported curve records and malformed counts', () => {
  expect(() => curve3dTable(brep('1 0 0 0 0 0', 1))).toThrow()
  expect(() => curve3dTable('CASCADE Topology V3\nLocations 0\nCurves 1\n7 0 0 3 4 2 0 0 0 1 1 0 2 1 0 3 0 0 0 4 1 4')).toThrow()
})

it('keeps exact independent from a positive coefficient tolerance', () => {
  const rationalRecord = { ...record, rational: true }
  const near = { ...rationalRecord, weights: [1, 1 + 1e-8, 1, 1] }
  const compared = compareCurveCoefficients(rationalRecord, near, 1e-6)
  expect(compared.sameWeights).toBe(true)
  expect(compared.exact).toBe(false)
})

it('rejects arbitrary non-finite and empty comparison inputs', () => {
  expect(() => compareCurveCoefficients({ ...record, poles: [] }, record)).toThrow()
  expect(() => compareCurveCoefficients({ ...record, poles: [[NaN, 0, 0], ...record.poles.slice(1)] }, record)).toThrow()
  expect(() => compareCurveCoefficients({ ...record, weights: [] }, record)).toThrow()
  const sparsePoles = record.poles.slice(); delete sparsePoles[1]
  const sparseWeights = record.weights.slice(); delete sparseWeights[1]
  expect(() => compareCurveCoefficients({ ...record, poles: sparsePoles }, record)).toThrow()
  expect(() => compareCurveCoefficients({ ...record, weights: sparseWeights }, record)).toThrow()
  expect(() => compareCurveCoefficients({ ...record, knots: [0, 0] }, record)).toThrow()
  expect(() => compareCurveCoefficients({ ...record, multiplicities: [3, 4] }, record)).toThrow()
  expect(() => compareCurveCoefficients({ ...record, periodic: true }, record)).toThrow(/periodiche/)
  expect(() => compareCurveCoefficients({ ...record, weights: [1, 1.1, 1, 1] }, record)).toThrow(/pesi non unitari/)
})

it('rejects parser records with repeated knots or invalid nonperiodic pole counts', () => {
  const repeated = '7 0 0 3 4 3 0 0 0 1 1 0 2 1 0 3 0 0 0 4 1 4 1 1'
  const badCount = '7 0 0 3 3 2 0 0 0 1 1 0 2 1 0 3 0 0 0 4 0 4 1 4'
  expect(() => curve3dTable(brep(repeated))).toThrow(/strettamente crescenti/)
  expect(() => curve3dTable(brep(badCount))).toThrow(/incoerenti|molteplicità|fuori limite/)
})





