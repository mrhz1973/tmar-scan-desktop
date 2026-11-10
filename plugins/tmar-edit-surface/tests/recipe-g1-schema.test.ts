// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { decodeRecipePoint, encodeRecipePoint, readRecipe, type SurfaceEditRecipeV5 } from '../recipe'

const fixture = (): SurfaceEditRecipeV5 => ({
  schema: 'tmar.surface-edit', version: 5, engine: 'occt-wasm-5.7.1/brep-v3', units: 'mm', coordinateFrame: 'imported-step',
  source: { bodyId: 'g1-body', brepSha256: 'a'.repeat(64), faceCount: 2, solidCount: 0 },
  faceIndex: 0, preparation: 'native-nurbs', baseNetSha256: 'b'.repeat(64), continuity: 'G0',
  boundaryMode: 'locked', refinements: [], lockedPoles: [12], edits: [{ index: 12, point: [0.1, '-0', 2] }],
  planeTangency: { kind: 'plane', supportFaceIndex: 1, edgeIndex: 0, side: 'uMin', distanceTolerance: 1e-8,
    initialLockedPoles: [12], proposalBaseEdits: [{ index: 7, point: [1, 2, 0.25] }],
    acceptedReferenceEdits: [{ index: 7, point: [1, 2, '-0'] }] },
})
const rejected = (value: unknown) => expect(() => readRecipe(value)).toThrow(/Ricetta Edit Surface/)

describe('strict plane-G1 v5 recipe schema', () => {
  it('roundtrips sparse base, accepted reference and final coefficients without losing signed zero', () => {
    const source = fixture(), wire = JSON.parse(JSON.stringify(source)), parsed = readRecipe(wire)
    expect(parsed).toEqual(source)
    if (parsed.version !== 5) throw Error('Expected v5')
    expect(Object.is(decodeRecipePoint(parsed.edits[0].point)[1], -0)).toBe(true)
    expect(Object.is(decodeRecipePoint(parsed.planeTangency.acceptedReferenceEdits[0].point)[2], -0)).toBe(true)
    expect(encodeRecipePoint([-0, 0, Number.MIN_VALUE])).toEqual(['-0', 0, Number.MIN_VALUE])
    expect(decodeRecipePoint(JSON.parse(JSON.stringify(encodeRecipePoint([-0, 0, Number.MAX_VALUE])))))
      .toEqual([-0, 0, Number.MAX_VALUE])
    parsed.edits[0].point[0] = 99
    parsed.planeTangency.proposalBaseEdits[0].point[2] = 99
    parsed.planeTangency.acceptedReferenceEdits[0].point[2] = 99
    parsed.planeTangency.initialLockedPoles.push(1)
    expect(wire).toEqual(source)
  })

  it('accepts every natural side, empty edit sets, ordered refinements and either legacy display continuity', () => {
    for (const side of ['uMin', 'uMax', 'vMin', 'vMax'] as const) for (const continuity of ['G0', 'G1'] as const) {
      const r = fixture(); r.planeTangency.side = side; r.continuity = continuity
      r.edits = []; r.lockedPoles = []; r.planeTangency.initialLockedPoles = []
      r.planeTangency.proposalBaseEdits = []; r.planeTangency.acceptedReferenceEdits = []
      r.refinements = [{ axis: 'U', value: -10, count: 2 }, { axis: 'V', value: 0, count: 1 }]
      expect(readRecipe(r)).toEqual(r)
    }
    expect(readRecipe(fixture())).toMatchObject({ refinements: [] })
  })

  it('requires every v5 field and refuses extra fields and transient kernel identity', () => {
    const r = fixture()
    for (const key of Object.keys(r)) { const missing = { ...r }; delete (missing as Record<string, unknown>)[key]; rejected(missing) }
    for (const key of Object.keys(r.planeTangency)) {
      const c = { ...r.planeTangency }; delete (c as Record<string, unknown>)[key]
      rejected({ ...r, planeTangency: c })
    }
    for (const key of ['freeBoundary', 'constraintId', 'choice', 'sourceRevision', 'previewRevision', 'automatic']) {
      rejected({ ...r, [key]: 1 })
      rejected({ ...r, planeTangency: { ...r.planeTangency, [key]: 1 } })
    }
    rejected({ ...r, source: { ...r.source, selectionRevision: 1 } })
    rejected({ ...r, edits: [{ ...r.edits[0], trusted: true }] })
  })

  it('refuses invalid source, modes, support identity and topology indexes', () => {
    const r = fixture(), c = r.planeTangency
    for (const boundaryMode of ['free-natural', undefined, 'G1']) rejected({ ...r, boundaryMode })
    for (const field of ['schema', 'engine', 'units', 'coordinateFrame', 'baseNetSha256', 'preparation', 'continuity'])
      for (const value of ['', null, 1]) rejected({ ...r, [field]: value })
    for (const supportFaceIndex of [-0, 0, -1, 2, 0.5, NaN, '1']) rejected({ ...r, planeTangency: { ...c, supportFaceIndex } })
    for (const edgeIndex of [-0, -1, 4, 0.5, Infinity, '0']) rejected({ ...r, planeTangency: { ...c, edgeIndex } })
    for (const side of ['U0', '', null, 0]) rejected({ ...r, planeTangency: { ...c, side } })
    rejected({ ...r, planeTangency: { ...c, kind: 'cylinder' } })
    for (const faceIndex of [-0, -1, 2, 0.5]) rejected({ ...r, faceIndex })
    for (const patch of [{ faceCount: 1 }, { faceCount: 1000001 }, { solidCount: 2 }, { bodyId: ' ' }, { brepSha256: 'A'.repeat(64) }])
      rejected({ ...r, source: { ...r.source, ...patch } })
  })

  it('uses the solver tolerance range and refuses non-finite or nonnumeric tolerances', () => {
    const r = fixture()
    for (const distanceTolerance of [0, -0, -1e-8, 1.000001e-6, NaN, Infinity, '1e-8', null])
      rejected({ ...r, planeTangency: { ...r.planeTangency, distanceTolerance } })
    expect(readRecipe({ ...r, planeTangency: { ...r.planeTangency, distanceTolerance: 1e-6 } })).toMatchObject({ version: 5 })
  })

  it('rejects sparse, duplicate, oversized or invalid pole lists in all three nets and both lock sets', () => {
    const r = fixture()
    for (const edits of [new Array(1), [null], [r.edits[0], r.edits[0]], Array(1601).fill(r.edits[0]),
      ...[-0, -1, 1600, 0.5, NaN, '12'].map(index => [{ index, point: [0, 0, 0] }])]) {
      rejected({ ...r, edits })
      for (const key of ['proposalBaseEdits', 'acceptedReferenceEdits'])
        rejected({ ...r, planeTangency: { ...r.planeTangency, [key]: edits } })
    }
    for (const ids of [new Array(1), [12, 12], [-0], [-1], [1600], [0.5], [NaN], ['12'], Array(1601).fill(0)]) {
      rejected({ ...r, lockedPoles: ids })
      rejected({ ...r, planeTangency: { ...r.planeTangency, initialLockedPoles: ids } })
    }
  })

  it('requires canonical JSON-safe coordinates and validates encoding helpers', () => {
    const r = fixture()
    for (const point of [new Array(3), [0, 0], [0, 0, 0, 0], [null, 0, 0], ['0', 0, 0], ['-0.0', 0, 0],
      [NaN, 0, 0], [Infinity, 0, 0], [-Infinity, 0, 0], [-0, 0, 0]]) {
      rejected({ ...r, edits: [{ index: 12, point }] })
      expect(() => decodeRecipePoint(point as never)).toThrow(/Coordinate/)
    }
    for (const point of [new Array(3), [0, 0], [NaN, 0, 0], ['-0', 0, 0]])
      expect(() => encodeRecipePoint(point as never)).toThrow(/Coordinate/)
  })

  it('validates refinement plans while permitting an empty v5 plan', () => {
    const r = fixture()
    for (const refinements of [null, undefined, {}, new Array(1), [null], Array(129).fill({ axis: 'U', value: 0, count: 1 }),
      [{ axis: 'X', value: 0, count: 1 }], [{ axis: 'U', value: NaN, count: 1 }],
      [{ axis: 'U', value: -0, count: 1 }], [{ axis: 'U', value: 0, count: 26 }],
      [{ axis: 'U', value: 0, count: 1, automatic: true }]]) rejected({ ...r, refinements })
  })

  it('retains the existing v2/v3/v4 parser behavior and never accepts signed-zero strings there', () => {
    const v5 = fixture(), { planeTangency: _plane, boundaryMode: _mode, refinements: _refinements, ...base } = v5
    const common = { ...base, source: { ...base.source, faceCount: 1 }, edits: [{ index: 12, point: [-0, 0, 3] }] }
    for (const legacy of [{ ...common, version: 2 }, { ...common, version: 3, boundaryMode: 'free-natural' },
      { ...common, version: 4, boundaryMode: 'locked', refinements: [{ axis: 'U', value: 0.5, count: 1 }] }]) {
      expect(readRecipe(legacy)).toEqual(legacy)
      expect(Object.is(readRecipe(legacy).edits[0].point[0], -0)).toBe(true)
      expect(() => readRecipe({ ...legacy, edits: v5.edits })).toThrow(/Poli/)
    }
    expect(() => readRecipe({ ...common, version: 4, boundaryMode: 'locked', refinements: [] })).toThrow(/Raffinamenti/)
  })
})
