// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { bodyStlResult, bodyStepResult, DEFAULT_CHORD_MM, exportSelection, validChord } from '../bodyExport'

const bodies = [
  { id: 2, name: 'Visible solid', visible: true, surface: false },
  { id: 4, name: 'Hidden solid', visible: false, surface: false },
  { id: 6, name: 'Sheet', visible: true, surface: true },
]
const empty = { bodies: [], folders: [] }

describe('explicit CAD body export selection', () => {
  it('exports visible solids only by default', () => {
    expect(exportSelection(bodies, [], empty, 'visible')).toEqual({ ids: [2], error: null })
  })
  it('can export a specifically selected hidden solid without changing visibility', () => {
    expect(exportSelection(bodies, [], { bodies: [4], folders: [] }, 'selected')).toEqual({ ids: [4], error: null })
    expect(bodies[1].visible).toBe(false)
  })
  it('expands selected components and deduplicates bodies', () => {
    const folders = [{ id: 1, name: 'Parent', parent: null, bodies: [2] }, { id: 3, name: 'Child', parent: 1, bodies: [4] }]
    expect(exportSelection(bodies, folders, { bodies: [2], folders: [1] }, 'selected')).toEqual({ ids: [2, 4], error: null })
  })
  it('never turns an empty or stale selection into all bodies', () => {
    expect(exportSelection(bodies, [], empty, 'selected').ids).toEqual([])
    expect(exportSelection(bodies, [], { bodies: [99], folders: [] }, 'selected').error).toMatch(/no longer exist/)
    expect(exportSelection([], [], empty, 'visible').error).toMatch(/No visible/)
  })
  it('rejects selected sheets instead of silently omitting them', () => {
    expect(exportSelection(bodies, [], { bodies: [2, 6], folders: [] }, 'selected').error).toMatch(/sheet or surface/)
  })
  it('validates a finite chord explicitly in millimetres', () => {
    expect(validChord(DEFAULT_CHORD_MM)).toBe(true)
    for (const chord of [0, -1, NaN, Infinity, 1.01, 0.00001]) expect(validChord(chord)).toBe(false)
    expect(validChord(0.0001)).toBe(true)
    expect(validChord(1)).toBe(true)
  })
})

describe('binary body STL output checks', () => {
  const result = () => {
    const bytes = new Uint8Array(134)
    new DataView(bytes.buffer).setUint32(80, 1, true)
    return { file: { name: 'test-body.stl', mimeType: 'model/stl', bytes }, triangles: 1, status: 'Exported' }
  }
  it('accepts a complete binary STL and returns the actual count', () => {
    expect(bodyStlResult(result()).triangles).toBe(1)
  })
  it('rejects missing, malformed and mismatched output', () => {
    expect(() => bodyStlResult(null)).toThrow(/did not return/)
    const a = result(); a.file.mimeType = 'model/step'
    expect(() => bodyStlResult(a)).toThrow(/did not return/)
    const b = result(); b.file.bytes = b.file.bytes.slice(0, 100)
    expect(() => bodyStlResult(b)).toThrow(/triangle count or length/)
    const c = result(); c.triangles = 2
    expect(() => bodyStlResult(c)).toThrow(/triangle count or length/)
    const d = result(); new DataView(d.file.bytes.buffer).setUint32(80, 0, true)
    expect(() => bodyStlResult(d)).toThrow(/triangle count or length/)
  })
})

describe('the same export UI can write STEP', () => {
  it('includes sheets for STEP only', () => {
    expect(exportSelection(bodies, [], empty, 'visible', 'step').ids).toEqual([2, 6])
    expect(exportSelection(bodies, [], { bodies: [6], folders: [] }, 'selected', 'step').error).toBeNull()
  })
  it('validates STEP file output', () => {
    const file = { name: 'model.step', mimeType: 'model/step', bytes: new TextEncoder().encode('ISO-10303-21;\nHEADER;') }
    expect(bodyStepResult({ file }).file).toBe(file)
    expect(() => bodyStepResult(null)).toThrow()
    expect(() => bodyStepResult({ file: { ...file, bytes: new TextEncoder().encode('wrong') } })).toThrow()
    expect(() => bodyStepResult({ file: { ...file, name: 'model.stl' } })).toThrow()
  })
})
