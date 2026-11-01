// SPDX-License-Identifier: AGPL-3.0-only
// Optional note-placement adapters for other workspaces. Installed once before
// React mounts. Reverse engineer keeps its original behavior without adapters.
import type { SceneManager } from '../../../src/viewer/SceneManager'

export interface NoteWorkspace {
  workspace: string
  place(scene: SceneManager, x: number, y: number): void
}
const adapters = new Map<string, NoteWorkspace>()

export function registerNoteWorkspace(adapter: NoteWorkspace): () => void {
  if (!adapter.workspace || adapter.workspace === 'reverse' || adapters.has(adapter.workspace)) {
    throw new Error(`A note adapter cannot replace workspace "${adapter.workspace}".`)
  }
  adapters.set(adapter.workspace, adapter)
  return () => { if (adapters.get(adapter.workspace) === adapter) adapters.delete(adapter.workspace) }
}

export const noteWorkspace = (workspace: string): NoteWorkspace | undefined => adapters.get(workspace)
