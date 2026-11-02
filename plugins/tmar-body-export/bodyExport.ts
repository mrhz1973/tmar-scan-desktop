// SPDX-License-Identifier: AGPL-3.0-only
import type { FileOut } from '../../src/commands/types'
import { bodiesOfPick, type BodyFolder, type ListPick } from '../reverse/core/bodyFolders'

export type ExportScope = 'visible' | 'selected'
export interface ExportBody { id: number; name: string; visible: boolean; surface?: boolean }
export interface ExportSelection { ids: number[]; error: string | null }
export const DEFAULT_CHORD_MM = 0.02
export const validChord = (chord: number): boolean => Number.isFinite(chord) && chord >= 0.0001 && chord <= 1

/** Resolve only CAD bodies, never the scan or the comparison reference. An
 * empty/invalid explicit selection must not fall back to exporting everything. */
export function exportSelection(bodies: readonly ExportBody[], folders: readonly BodyFolder[], pick: ListPick, scope: ExportScope, format: 'stl' | 'step' = 'stl'): ExportSelection {
  const selected = bodiesOfPick(folders, pick)
  if (scope === 'selected') {
    if (!selected.size) return { ids: [], error: 'Select one or more solid bodies in the body list first.' }
    const missing = [...selected].filter((id) => !bodies.some((body) => body.id === id))
    if (missing.length) return { ids: [], error: 'Some selected bodies no longer exist. Select the current bodies again.' }
    if (format === 'stl' && bodies.some((body) => selected.has(body.id) && body.surface)) return { ids: [], error: 'The selection contains a sheet or surface. STL body export requires solid bodies.' }
  }
  const ids = bodies.filter((body) => scope === 'selected' ? selected.has(body.id) : body.visible && (format === 'step' || !body.surface)).map((body) => body.id)
  return { ids, error: ids.length ? null : 'No visible solid body to export. Build or show a solid body first.' }
}

export interface BodyStlResult { file: FileOut; triangles: number; status: string }

/** Check the command's output before offering it as a printable body file. */
export function bodyStlResult(value: unknown): BodyStlResult {
  const result = value as Partial<BodyStlResult> | null
  const file = result?.file
  if (!file || !(file.bytes instanceof Uint8Array) || !file.name?.toLowerCase().endsWith('.stl') || file.mimeType !== 'model/stl') {
    throw new Error('The body exporter did not return an STL file.')
  }
  if (file.bytes.byteLength < 84) throw new Error('The body STL is incomplete.')
  const triangles = new DataView(file.bytes.buffer, file.bytes.byteOffset, file.bytes.byteLength).getUint32(80, true)
  if (!triangles || file.bytes.byteLength !== 84 + 50 * triangles || result.triangles !== triangles) {
    throw new Error('The body STL has an invalid triangle count or length.')
  }
  return { file, triangles, status: typeof result.status === 'string' ? result.status : `${triangles} body triangles exported.` }
}

/** STEP stays a CAD export; reject missing or wrongly typed output. */
export function bodyStepResult(value: unknown): { file: FileOut; status: string } {
  const result = value as { file?: FileOut; status?: string } | null
  const file = result?.file
  if (!file || !(file.bytes instanceof Uint8Array) || !/\.st(?:ep|p)$/i.test(file.name) || file.mimeType !== 'model/step') throw new Error('The body exporter did not return a STEP file.')
  if (!new TextDecoder().decode(file.bytes.subarray(0, 80)).trimStart().startsWith('ISO-10303-21;')) throw new Error('The body STEP header is invalid.')
  return { file, status: result?.status ?? 'CAD bodies exported as STEP.' }
}
