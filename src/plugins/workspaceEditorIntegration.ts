// SPDX-License-Identifier: AGPL-3.0-only
import { registerBusy } from '../commands/activity'
import { registerHistory } from '../state/historyStore'
import { useWorkspaceEditor, workspaceEditors } from './workspaceEditors'

/** Install once before toolbar hooks mount; no plugin-name dependency. */
export function installWorkspaceEditorIntegration(): () => void {
  const stopBusy = registerBusy('workspace-editor', workspaceEditors.busy, [useWorkspaceEditor])
  const stopHistory = registerHistory({
    blocked: () => {
      const s = useWorkspaceEditor.getState()
      return s.phase !== 'closed' && (s.phase !== 'editing' || s.snapshot?.gesture !== 'idle')
    },
    local: {
      workspace: 'reverse', label: 'Edit Surface', active: workspaceEditors.active,
      canUndo: () => !!useWorkspaceEditor.getState().snapshot?.canUndo,
      canRedo: () => !!useWorkspaceEditor.getState().snapshot?.canRedo,
      undo: workspaceEditors.undo, redo: workspaceEditors.redo,
    },
    useWatch: () => useWorkspaceEditor(),
  })
  return () => { stopHistory(); stopBusy() }
}
