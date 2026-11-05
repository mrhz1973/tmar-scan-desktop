// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { SurfaceEditorKernel } from '../editorKernel'
import type { Net, Point } from '../brep'
import { refineClampedNet, type KnotInsertion } from '../refineClampedNet'

const centre = (net: Net): Point => [0, 1, 2].map(axis => net.poles.reduce((sum, p) => sum + p[axis], 0) / net.poles.length) as Point
const midpoint = (net: Net, axis: 'U' | 'V'): KnotInsertion => {
  const knots = axis === 'U' ? net.ku : net.kv
  return { axis, value: (knots[0] + knots[1]) / 2, count: 1 }
}

it('retains UV note identity across refinement, undo/redo preparation and empty rollback while retaining preview and recipe fences', async () => {
  const editor = await SurfaceEditorKernel.load(), k = editor.kernel, box = k.makeBox(20, 30, 10)
  try {
    editor.open(k.exportStep(box))
    const base = editor.select(0), first = editor.evaluate(base, 'G1')
    const picked = editor.anchorFromPick(centre(base), first.previewRevision!)
    const anchor = structuredClone(picked.anchor)
    const operations = [midpoint(base, 'U'), midpoint(base, 'V')]
    const refined = refineClampedNet(base, operations)
    const compare = (net: Net) => {
      const preview = editor.evaluate(net, 'G1')
      const resolved = editor.resolveAnchor(anchor, preview.previewRevision!)
      resolved.at.forEach((value, i) => expect(value).toBeCloseTo(picked.at[i], 10))
      resolved.normal.forEach((value, i) => expect(value).toBeCloseTo(picked.normal[i], 10))
      expect(editor.finalFaceWitness(preview.previewRevision!).selectionRevision).toBe(anchor.selectionRevision)
      expect(() => editor.resolveAnchor(anchor, first.previewRevision!)).toThrow(/Anteprima/)
    }
    editor.selectRefined(0, operations)
    compare(refined)
    // Undo (empty refinement plan), then Redo and a repeated preparation.
    editor.selectRefined(0, []); compare(base)
    editor.selectRefined(0, operations); compare(refined)
    editor.selectRefined(0, operations); compare(refined)
    // A rejected preparation leaves both logical selection and valid preview intact.
    const witness = editor.finalFaceWitness(editor.evaluate(refined, 'G1').previewRevision!)
    const beforeFailure = editor.resolveAnchor(anchor, witness.previewRevision)
    expect(() => editor.selectRefined(0, [{ axis: 'U', value: NaN, count: 1 }])).toThrow()
    expect(editor.resolveAnchor(anchor, witness.previewRevision)).toEqual(beforeFailure)
    // Recipe hashing still detects an operational preparation change, even
    // though it intentionally preserves the logical anchor selection.
    const saving = editor.createRecipe(refined, 'G1', [], 'body')
    editor.selectRefined(0, operations)
    await expect(saving).rejects.toThrow(/Sorgente cambiata/)
    compare(refined)
    await expect(editor.createRecipe(refined, 'G1', [], 'body')).resolves.toMatchObject({ version: 4 })
    compare(refined)
    expect(picked.anchor).toEqual(anchor)
  } finally { k.release(box); editor.dispose() }
}, 60000)

it('invalidates note identity for explicit reselect, other faces and reopened source', async () => {
  const editor = await SurfaceEditorKernel.load(), k = editor.kernel, box = k.makeBox(20, 30, 10)
  try {
    const step = k.exportStep(box)
    editor.open(step)
    const pick = () => {
      const net = editor.select(0), preview = editor.evaluate(net, 'G1')
      return editor.anchorFromPick(centre(net), preview.previewRevision!).anchor
    }
    const explicit = pick()
    let net = editor.select(0), preview = editor.evaluate(net, 'G1')
    expect(() => editor.resolveAnchor(explicit, preview.previewRevision!)).toThrow(/estraneo/)
    const switched = pick()
    editor.selectRefined(1, [])
    net = editor.selectRefined(0, []); preview = editor.evaluate(net, 'G1')
    expect(() => editor.resolveAnchor(switched, preview.previewRevision!)).toThrow(/estraneo/)
    const reopened = pick()
    editor.open(step)
    net = editor.selectRefined(0, []); preview = editor.evaluate(net, 'G1')
    expect(() => editor.resolveAnchor(reopened, preview.previewRevision!)).toThrow(/estraneo/)
  } finally { k.release(box); editor.dispose() }
}, 60000)
