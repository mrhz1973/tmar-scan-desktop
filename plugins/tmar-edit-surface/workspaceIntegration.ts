// SPDX-License-Identifier: AGPL-3.0-only
// This type exists in the optional v1 host, and is checked in the host build.
// @ts-ignore -- absent from the older ScanRuler baseline.
import type { WorkspaceEditorDefinition, WorkspaceEditorContext } from '../../src/plugins/workspaceEditorTypes'
import { WorkspaceEntry } from './WorkspaceEntry'
import { WorkspaceSurfaceParameters } from './WorkspaceSurfaceParameters'
import { createWorkspaceLayer } from './workspaceLayer'
import { createWorkspaceSurfaceSession, type WorkspaceSurfaceSession } from './workspaceSession'
import { workspaceHost } from './workspaceHost'

/** Returns no entry when the real shared-view service is absent. */
export function installWorkspaceIntegration(): typeof WorkspaceEntry | null {
  if (!workspaceHost) return null
  const definition = {
    id: 'tmar-edit-surface', apiVersion: 1, workspace: 'reverse',
    createSession: (context: WorkspaceEditorContext) => createWorkspaceSurfaceSession(context, createWorkspaceLayer),
    Parameters: WorkspaceSurfaceParameters,
  } satisfies WorkspaceEditorDefinition<WorkspaceSurfaceSession>
  workspaceHost.registerWorkspaceEditor(definition)
  return WorkspaceEntry
}
