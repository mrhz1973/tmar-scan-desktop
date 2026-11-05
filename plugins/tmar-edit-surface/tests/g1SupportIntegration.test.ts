// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi } from 'vitest'
import type { ShapeHandle } from 'occt-wasm'
import { SurfaceEditorKernel } from '../editorKernel'

async function fixture() {
  const editor = await SurfaceEditorKernel.load(), k = editor.kernel
  const box = k.makeBox(10, 20, 30)
  try { return { editor, step: k.exportStep(box) } }
  finally { k.release(box) }
}

describe('G1 support listing — kernel-owned identity, real OCCT', () => {
  it('returns cloneable original-source choices and releases all temporary handles without modifying CAD', async () => {
    const {editor, step} = await fixture(), k = editor.kernel
    try {
      const imported = vi.spyOn(k, 'importStep')
      editor.open(step); editor.select(0)
      const source = imported.mock.results[0].value as ShapeHandle, before = k.toBREP(source)
      const acquired: ShapeHandle[] = [], released: ShapeHandle[] = []
      const sub = k.getSubShapes.bind(k), shared = k.sharedEdges.bind(k), release = k.release.bind(k)
      const subSpy = vi.spyOn(k, 'getSubShapes').mockImplementation((...args) => { const hs = sub(...args); acquired.push(...hs); return hs })
      const sharedSpy = vi.spyOn(k, 'sharedEdges').mockImplementation((...args) => { const hs = shared(...args); acquired.push(...hs); return hs })
      const releaseSpy = vi.spyOn(k, 'release').mockImplementation(h => { released.push(h); release(h) })
      try {
        const result = await editor.g1SupportCandidates()
        expect(result.stamp.sourceId).toMatch(/^brep-sha256:[a-f0-9]{64}$/)
        expect(result.stamp.faceIndex).toBe(0)
        expect(result.candidates).toHaveLength(4)
        expect(result.candidates.every(c => JSON.stringify(c.stamp) === JSON.stringify(result.stamp))).toBe(true)
        expect(structuredClone(result)).toEqual(result)
        expect(JSON.stringify(JSON.parse(JSON.stringify(result)))).toBe(JSON.stringify(result))
        expect(released).toEqual(acquired)
        expect(k.toBREP(source)).toBe(before)
        const choice = result.candidates[0]
        expect(await editor.resolveG1SupportCandidate(choice)).toEqual(choice)
        const forged = structuredClone(choice); forged.plane.origin = [999,999,999]
        expect((await editor.resolveG1SupportCandidate(forged)).plane).toEqual(choice.plane)
        await expect(editor.resolveG1SupportCandidate({...choice, stamp: {...choice.stamp, sourceId:'client-claimed'}})).rejects.toThrow('scaduta')
      } finally { subSpy.mockRestore(); sharedSpy.mockRestore(); releaseSpy.mockRestore(); imported.mockRestore() }
    } finally { editor.dispose() }
  }, 60000)

  it('rejects prior choices after changing face, refinement, reopening the same bytes, and clear', async () => {
    const {editor, step} = await fixture()
    try {
      await expect(editor.g1SupportCandidates()).rejects.toThrow('Seleziona')
      editor.open(step)
      await expect(editor.g1SupportCandidates()).rejects.toThrow('Seleziona')
      editor.select(0)
      const first = await editor.g1SupportCandidates(), choice = first.candidates[0]
      editor.select(1)
      await expect(editor.resolveG1SupportCandidate(choice)).rejects.toThrow('scaduta')
      editor.select(0)
      await expect(editor.resolveG1SupportCandidate(choice)).rejects.toThrow('scaduta')
      const selected = await editor.g1SupportCandidates()
      editor.selectRefined(0, [])
      await expect(editor.resolveG1SupportCandidate(selected.candidates[0])).rejects.toThrow('scaduta')
      editor.open(step); editor.select(0)
      const reopened = await editor.g1SupportCandidates()
      expect(reopened.stamp.sourceId).toBe(first.stamp.sourceId)
      expect(reopened.stamp.sourceRevision).toBeGreaterThan(first.stamp.sourceRevision)
      await expect(editor.resolveG1SupportCandidate(choice)).rejects.toThrow('scaduta')
      editor.clear()
      await expect(editor.g1SupportCandidates()).rejects.toThrow('Seleziona')
    } finally { editor.dispose() }
  }, 60000)

  it('fences pending digest responses and invalidates failed selection/preparation attempts', async () => {
    const {editor, step} = await fixture()
    try {
      editor.open(step); editor.select(0)
      const pending = editor.g1SupportCandidates()
      editor.select(1)
      await expect(pending).rejects.toThrow('scaduto')
      const pendingReopen = editor.g1SupportCandidates()
      editor.open(step); editor.select(0)
      await expect(pendingReopen).rejects.toThrow('scaduto')
      expect(() => editor.select(999)).toThrow()
      await expect(editor.g1SupportCandidates()).rejects.toThrow('Seleziona')
      editor.select(0)
      expect(() => editor.prepareCylinderForPreview(0)).toThrow()
      await expect(editor.g1SupportCandidates()).rejects.toThrow('Seleziona')
      expect(() => editor.open('invalid STEP')).toThrow()
      await expect(editor.g1SupportCandidates()).rejects.toThrow('Seleziona')
    } finally { editor.dispose() }
  }, 60000)

  it.each([2, 4] as const)('restores v%i recipes into a new support generation and preserves state on failed restore/replay', async version => {
    const {editor, step} = await fixture()
    try {
      editor.open(step)
      const base = editor.select(0)
      const net = version === 4
        ? editor.selectRefined(0, [{axis:'U', value:(base.ku[0]+base.ku.at(-1)!)/2, count:1}])
        : base
      const recipe = await editor.createRecipe(net, 'G0', [], 'fixture-body')
      expect(recipe.version).toBe(version)
      const before = await editor.g1SupportCandidates()
      const restored = await editor.restoreRecipe(step, recipe, 'fixture-body')
      expect(restored.net).toEqual(net)
      const after = await editor.g1SupportCandidates()
      expect(after.candidates).toHaveLength(4)
      expect(after.stamp.sourceId).toBe(before.stamp.sourceId)
      expect(after.stamp.sourceRevision).toBeGreaterThan(before.stamp.sourceRevision)
      expect(after.stamp.selectionRevision).toBeGreaterThan(before.stamp.selectionRevision)
      await expect(editor.resolveG1SupportCandidate(before.candidates[0])).rejects.toThrow('scaduta')
      expect(await editor.resolveG1SupportCandidate(after.candidates[0])).toEqual(after.candidates[0])
      await expect(editor.restoreRecipe(step, recipe, 'wrong-body')).rejects.toThrow('Corpo sorgente')
      expect(await editor.g1SupportCandidates()).toEqual(after)
      const replay = await editor.replayRecipe(step, recipe, 'fixture-body')
      expect(replay.valid).toBe(true)
      expect(await editor.g1SupportCandidates()).toEqual(after)
      expect(await editor.resolveG1SupportCandidate(after.candidates[0])).toEqual(after.candidates[0])
    } finally { editor.dispose() }
  }, 60000)

  it('dispatches a read-only worker request and ignores client-supplied identities', async () => {
    const {editor, step} = await fixture()
    const response = vi.fn(), surface = { onmessage: null as unknown, postMessage: response }
    const load = vi.spyOn(SurfaceEditorKernel, 'load').mockResolvedValue(editor)
    vi.stubGlobal('self', surface)
    try {
      await import('../editor.worker')
      const dispatch = surface.onmessage as (event: {data: unknown}) => void
      dispatch({data: {id:1, action:'open', step}})
      await vi.waitFor(() => expect(response).toHaveBeenCalledWith(expect.objectContaining({id:1, result:expect.anything()})), {timeout:10000})
      dispatch({data: {id:2, action:'select', face:0}})
      await vi.waitFor(() => expect(response).toHaveBeenCalledWith(expect.objectContaining({id:2, result:expect.anything()})), {timeout:10000})
      dispatch({data: {id:3, action:'g1SupportCandidates', sourceId:'forged', sourceRevision:999, selectionRevision:999, face:5}})
      await vi.waitFor(() => expect(response).toHaveBeenCalledWith(expect.objectContaining({id:3, result:expect.anything()})), {timeout:10000})
      const value = response.mock.calls.find(([r]) => r.id === 3)![0].result
      expect(value.stamp.faceIndex).toBe(0)
      expect(value.stamp.sourceId).toMatch(/^brep-sha256:/)
      expect(value.stamp.sourceRevision).not.toBe(999)
      expect(value.stamp.selectionRevision).not.toBe(999)
      expect(value.candidates).toHaveLength(4)
      expect(structuredClone(value)).toEqual(value)
    } finally { load.mockRestore(); vi.unstubAllGlobals(); editor.dispose() }
  }, 60000)
})

