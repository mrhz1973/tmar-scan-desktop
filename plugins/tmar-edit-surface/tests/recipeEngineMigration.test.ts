// SPDX-License-Identifier: AGPL-3.0-only
// Real saved 5.7.1 coefficients/STEP, consumed by 5.15.0 without regeneration.
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { SurfaceEditorKernel } from '../editorKernel'
import type { Net, Point } from '../brep'
import { decodeRecipePoint, readCurvedRecipe, readRecipe, sha256, LEGACY_SURFACE_RECIPE_ENGINE,
  SURFACE_RECIPE_ENGINE, type SerializedPoint, type SurfaceEditRecipe, type SurfaceEditRecipeV6 } from '../recipe'
import { canonicalHistoryJson, canonicalReplayStep, readStoredSurfaceHistory, reopenSurfaceHistory,
  type StoredSurfaceEditHistoryV1, type SurfaceHistoryReplay } from '../../reverse/app/surfaceEditHistory'
import { stepFileKey, type ImportFeature } from '../../reverse/core/features'

type Recipe = SurfaceEditRecipe | SurfaceEditRecipeV6
interface SavedGeometry {
  valid: boolean; faceCount: number; solidCount: number
  faces: { kind: string; samples: { u: number; v: number; point: Point; normal: Point }[] }[]
}
interface SavedCase {
  name: string; sourceStep: string; resultStep: string; recipe: Recipe
  expectedNet: Omit<Net, 'poles'> & { poles: SerializedPoint[] }
  sourceGeometry: SavedGeometry; resultGeometry: SavedGeometry
}
const fixture = JSON.parse(readFileSync(new URL('./fixtures/occt571-recipes.json', import.meta.url), 'utf8')) as {
  schema: string; provenance: { version: string; sourceCommit: string }; cases: SavedCase[]
}

function checkGeometry(editor: SurfaceEditorKernel, step: string, saved: SavedGeometry) {
  const k = editor.kernel, shape = k.importStep(step), faces = k.getSubShapes(shape, 'face'), solids = k.getSubShapes(shape, 'solid')
  try {
    expect(saved.valid).toBe(true); expect(k.isValid(shape)).toBe(true)
    expect(faces).toHaveLength(saved.faceCount); expect(solids).toHaveLength(saved.solidCount)
    for (let i = 0; i < faces.length; i++) {
      expect(k.surfaceType(faces[i])).toBe(saved.faces[i].kind)
      for (const sample of saved.faces[i].samples) {
        const p = k.pointOnSurface(faces[i], sample.u, sample.v), n = k.surfaceNormal(faces[i], sample.u, sample.v)
        expect(Math.hypot(p.x-sample.point[0],p.y-sample.point[1],p.z-sample.point[2])).toBeLessThan(1e-8)
        expect(Math.hypot(n.x-sample.normal[0],n.y-sample.normal[1],n.z-sample.normal[2])).toBeLessThan(1e-8)
      }
    }
    // The old facade's integrated volume is informative only: 5.15.0 improves
    // that integration. Exact nets, STEP fingerprints and native samples above
    // qualify this migration without pretending the old volume was exact.
  } finally { [...faces, ...solids, shape].forEach(h => k.release(h)) }
}

async function hostArchive(saved: SavedCase) {
  const sourceKey = stepFileKey(saved.sourceStep), resultKey = stepFileKey(saved.resultStep)
  const record: StoredSurfaceEditHistoryV1 = {
    schema:'tmar.host.surface-edit-history',version:1,
    source:{bodyId:1,bodyKey:saved.recipe.source.bodyId,
      file:{key:sourceKey,name:'legacy-source.step',size:saved.sourceStep.length},
      stepSha256:await sha256(saved.sourceStep),sourceReplaySha256:await sha256(canonicalReplayStep(saved.sourceStep))},
    recipe:structuredClone(saved.recipe),recipeSha256:await sha256(canonicalHistoryJson(saved.recipe)),
    resultStepSha256:await sha256(saved.resultStep),replayStepSha256:await sha256(canonicalReplayStep(saved.resultStep)),notePolicy:'none',
  }
  const feature: ImportFeature = {id:2,kind:'import',name:saved.name,visible:true,
    file:{key:resultKey,name:'legacy-result.step',size:saved.resultStep.length},surfaceEditHistory:record}
  return {record,feature,files:{[sourceKey]:saved.sourceStep,[resultKey]:saved.resultStep}}
}
const independentReplay: SurfaceHistoryReplay = async (step, recipe, bodyKey) => {
  const editor = await SurfaceEditorKernel.load()
  try {
    const result = (recipe as Recipe).version === 6
      ? await editor.replayCurvedRecipe(step, recipe, bodyKey)
      : await editor.replayRecipe(step, recipe, bodyKey)
    if (!result.valid || typeof result.step !== 'string') throw new Error('Invalid independent migration result.')
    return result.step
  } finally { editor.dispose() }
}

describe('occt-wasm 5.7.1 saved history on the 5.15.0 runtime', () => {
  it('identifies the producing/current runtimes and refuses unknown engines', () => {
    expect(fixture.schema).toBe('tmar.synthetic-legacy-recipes-v1')
    expect(fixture.provenance).toMatchObject({version:'5.7.1',sourceCommit:'099fe5493af3305ef8cae8fd385051b1b7a00277'})
    const installed=JSON.parse(readFileSync(new URL('../../../node_modules/occt-wasm/package.json',import.meta.url),'utf8'))
    expect(SURFACE_RECIPE_ENGINE).toBe(`occt-wasm-${installed.version}/brep-v3`)
    expect(installed.version).toBe('5.15.0')
    expect(fixture.cases.map(c=>c.recipe.version)).toEqual([2,3,4,4,5,6])
    for (const saved of fixture.cases) {
      expect(saved.recipe.engine).toBe(LEGACY_SURFACE_RECIPE_ENGINE)
      const read = saved.recipe.version === 6 ? readCurvedRecipe : readRecipe
      expect(read(saved.recipe)).toEqual(saved.recipe)
      expect(()=>read({...saved.recipe,engine:'occt-wasm-5.14.0/brep-v3'})).toThrow()
    }
  })

  for (const saved of fixture.cases) it(`independently reopens and restores ${saved.name} with unchanged exact guards`, async () => {
    const before=JSON.stringify(saved),archive=await hostArchive(saved)
    expect(readStoredSurfaceHistory(archive.record).recipe).toEqual(saved.recipe)
    const reopened=await reopenSurfaceHistory(archive.feature,archive.files,independentReplay,new AbortController().signal)
    expect(reopened.status, reopened.status === 'copy-only' ? reopened.reason : '').toBe('verified')
    if (reopened.status !== 'verified') throw new Error(reopened.reason)
    expect(reopened.record.recipe).toEqual(saved.recipe)
    expect(await sha256(canonicalReplayStep(reopened.replayedStep))).toBe(archive.record.replayStepSha256)
    const editor=await SurfaceEditorKernel.load()
    try {
      checkGeometry(editor,saved.sourceStep,saved.sourceGeometry)
      checkGeometry(editor,reopened.replayedStep,saved.resultGeometry)
      const restored=saved.recipe.version===6
        ? await editor.restoreCurvedRecipe(saved.sourceStep,saved.recipe,saved.recipe.source.bodyId)
        : await editor.restoreRecipe(saved.sourceStep,saved.recipe,saved.recipe.source.bodyId)
      const expectedNet={...saved.expectedNet,poles:saved.expectedNet.poles.map(decodeRecipePoint)}
      expect(restored.net).toEqual(expectedNet)
      expect(restored.lockedPoles).toEqual(saved.recipe.lockedPoles)
      const bad={...saved.recipe,source:{...saved.recipe.source,brepSha256:'0'.repeat(64)}}
      const restore=saved.recipe.version===6 ? editor.restoreCurvedRecipe.bind(editor) : editor.restoreRecipe.bind(editor)
      const witness=editor.finalFaceWitness(restored.preview.previewRevision!)
      await expect(restore(saved.sourceStep,bad,saved.recipe.source.bodyId)).rejects.toThrow(/occt-wasm 5.7.1/)
      expect(editor.finalFaceWitness(restored.preview.previewRevision!)).toEqual(witness)
      const current=saved.recipe.version===6
        ? await editor.createCurvedRecipe(restored.net,restored.continuity,restored.lockedPoles,saved.recipe.source.bodyId,restored.curvedTangency!.constraintId)
        : await editor.createRecipe(restored.net,restored.continuity,restored.lockedPoles,saved.recipe.source.bodyId,restored.freeBoundary,restored.planeTangency?.constraintId)
      expect(current.engine).toBe(SURFACE_RECIPE_ENGINE)
      expect(current.version).toBe(saved.recipe.version)
      expect(current.edits).toEqual(saved.recipe.edits)
      expect(readStoredSurfaceHistory({...archive.record,recipe:current}).recipe).toEqual(current)
      expect(JSON.stringify(saved)).toBe(before)
    } finally { editor.dispose() }
  },60000)

  it('retains the saved CAD as copy-only when source, recipe or engine is altered', async () => {
    const saved=fixture.cases[0],archive=await hostArchive(saved),before=JSON.stringify(archive)
    for (const changed of [
      {...archive.record,recipe:{...saved.recipe,engine:'occt-wasm-5.14.0/brep-v3'}},
      {...archive.record,recipe:{...saved.recipe,baseNetSha256:'0'.repeat(64)}},
      {...archive.record,source:{...archive.record.source,stepSha256:'0'.repeat(64)}},
    ]) {
      const replay=vi.fn(independentReplay)
      const result=await reopenSurfaceHistory({...archive.feature,surfaceEditHistory:changed},archive.files,replay,new AbortController().signal)
      expect(result.status).toBe('copy-only');expect(replay).not.toHaveBeenCalled()
    }
    expect(JSON.stringify(archive)).toBe(before)
  })

  it('keeps unqualified old adaptive v7/v8 replay closed before touching CAD', async () => {
    const saved=fixture.cases.find(c=>c.recipe.version===4&&c.recipe.boundaryMode==='locked')!
    const v7={...saved.recipe,version:7,preparation:'plane-to-bicubic',boundaryMode:'locked',trimPolicy:'circular-fine-v1',lockedPoles:[]}
    const v8={...v7,version:8,lockedValues:[]}
    const editor=await SurfaceEditorKernel.load(),read=vi.spyOn(editor.kernel,'importStep')
    try {
      await expect(editor.replayAdaptiveRecipe(saved.sourceStep,v7,saved.recipe.source.bodyId)).rejects.toThrow(/migrazione non qualificata/)
      await expect(editor.replayAdaptiveLockedRecipe(saved.sourceStep,v8,saved.recipe.source.bodyId)).rejects.toThrow(/migrazione non qualificata/)
      expect(read).not.toHaveBeenCalled()
    } finally { read.mockRestore();editor.dispose() }
  })
})
