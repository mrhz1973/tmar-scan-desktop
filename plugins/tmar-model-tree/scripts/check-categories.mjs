// SPDX-License-Identifier: AGPL-3.0-only
// Dependency-free safety checks: node --experimental-strip-types --test <this file>.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FEATURE_CATEGORIES, featureCategory, categoryFeatureIds, resolveFeatureTargets } from '../featureCategories.ts'
const freeze = (value) => { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze) } return value }
const state = freeze({
  features: [
    { id: 1, kind: 'sketch', plane: { kind: 'world' } },
    { id: 2, kind: 'extrude' },
    { id: 3, kind: 'sketch', plane: { kind: 'section' } },
    { id: 4, kind: 'surface' },
    { id: 5, kind: 'fillet' },
    { id: 6, kind: 'sketch', suppressed: true },
    { id: 7, kind: 'futureUnknown' },
    { id: 8, kind: 'surface' },
    { id: 9, kind: 'split' },
    { id: 10, kind: 'sketch', plane: { kind: 'fitted' } },
    { id: 11, kind: 'network' },
  ],
  bodies: [{ id: 2 }, { id: 4, surface: true }, { id: 8 }, { id: 9.0009765625, surface: true }, { id: 11, surface: false }],
  results: { 1: { bodies: [2] }, 2: { bodies: [2] }, 3: { bodies: [2] }, 4: { bodies: [4, 2] },
    5: { bodies: [2] }, 7: { bodies: [2] }, 8: { bodies: [8] }, 9: { bodies: [2, 9.0009765625] }, 11: { bodies: [11] } },
})
const targets = (ids, scope) => resolveFeatureTargets(state, ids, scope)
test('category definitions have unique IDs', () => assert.equal(new Set(FEATURE_CATEGORIES.map(c=>c.id)).size, FEATURE_CATEGORIES.length))
test('plain sketches have their own category', () => assert.equal(featureCategory(state.features[0]), 'sketches'))
test('section-based sketches are separate from ordinary profiles', () => assert.equal(featureCategory(state.features[2]), 'sections'))
test('fitted scan planes remain sketches, not solid bodies', () => assert.equal(featureCategory(state.features[9]), 'sketches'))
test('surface, sheet and network operations are explicitly classified', () => ['surface','sheet','network'].forEach(kind=>assert.equal(featureCategory({id:1,kind}), 'surfaces')))
test('solid operations are explicitly classified', () => ['extrude','revolve','fillet','chamfer','shell','hole','thread','draft','mirror','boolean','split','loft','sweep','pattern','moveBody','offsetBody','extract','import','trim','thicken'].forEach(kind=>assert.equal(featureCategory({id:1,kind}), 'bodies')))
test('unknown feature types fail closed', () => assert.equal(featureCategory({id:7,kind:'futureUnknown'}), 'other'))
test('classification ignores an AI-assigned misleading name', () => assert.equal(featureCategory({id:1,kind:'sketch',name:'Finished solid body'}), 'sketches'))
test('category Select All includes only ordinary sketches in original order', () => assert.deepEqual(categoryFeatureIds(state.features,'sketches'), [1,6,10]))
test('category Select All includes only section sketches', () => assert.deepEqual(categoryFeatureIds(state.features,'sections'), [3]))
test('newly generated body features never join the sketch category', () => assert.deepEqual(categoryFeatureIds([...state.features,{id:12,kind:'extrude'}],'sketches'), [1,6,10]))
test('sketch output resolution never follows its body dependencies', () => assert.deepEqual(targets([1],'sketches'), {sketches:[1],bodies:[],skipped:[]}))
test('mixed selection cannot hide solids from Sketches', () => assert.deepEqual(targets([1,2,4,5],'sketches'), {sketches:[1],bodies:[],skipped:[2,4,5]}))
test('section sketches cannot hide their bodies or ordinary sketches', () => assert.deepEqual(targets([1,2,3],'sections'), {sketches:[3],bodies:[],skipped:[1,2]}))
test('ordinary sketches cannot act on section sketches', () => assert.deepEqual(targets([1,3],'sketches'), {sketches:[1],bodies:[],skipped:[3]}))
test('surface actions do not hide a solid reported in the same result', () => assert.deepEqual(targets([4],'surfaces'), {sketches:[],bodies:[4],skipped:[]}))
test('surface features that became a solid do not get solid visibility permission', () => assert.deepEqual(targets([8,11],'surfaces'), {sketches:[],bodies:[],skipped:[8,11]}))
test('solid actions leave surface results unchanged, including island IDs', () => assert.deepEqual(targets([9],'bodies'), {sketches:[],bodies:[2],skipped:[]}))
test('solid scope filters sketches and surface feature IDs', () => assert.deepEqual(targets([1,2,4],'bodies'), {sketches:[],bodies:[2],skipped:[1,4]}))
test('shared current body outputs are deduplicated', () => assert.deepEqual(targets([2,5,2,9],'bodies').bodies, [2]))
test('missing, suppressed and rolled-back rows do not change geometry visibility', () => assert.deepEqual(targets([6,999],'sketches'), {sketches:[],bodies:[],skipped:[6,999]}))
test('Other never gets Show/Hide permissions from a result body ID', () => assert.deepEqual(targets([7],'other'), {sketches:[],bodies:[],skipped:[7]}))
test('empty category selection changes nothing', () => assert.deepEqual(targets([],'bodies'), {sketches:[],bodies:[],skipped:[]}))
test('removed bodies are not targeted by stale result IDs', () => assert.deepEqual(resolveFeatureTargets({...state,bodies:[]},[2],'bodies'), {sketches:[],bodies:[],skipped:[2]}))
test('diagnostic legacy resolution remains backward compatible', () => assert.deepEqual(resolveFeatureTargets(state,[1,2,5]), {sketches:[1],bodies:[2],skipped:[]}))
test('classification and resolution never mutate features, results, bodies or order', () => {
  const before = JSON.stringify(state)
  for(const scope of FEATURE_CATEGORIES.map(c=>c.id)) { categoryFeatureIds(state.features,scope); targets(state.features.map(f=>f.id),scope) }
  assert.equal(JSON.stringify(state),before)
})
