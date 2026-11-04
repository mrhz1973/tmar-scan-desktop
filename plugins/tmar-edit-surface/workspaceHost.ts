// SPDX-License-Identifier: AGPL-3.0-only
// The workspace host is optional in older ScanRuler builds. A missing module
// is not treated as an enabled implementation or replaced with a fake one.
export interface OptionalWorkspaceHost {
  registerWorkspaceEditor(definition: unknown): () => void
  workspaceEditors: {
    open(id: string, input: { bodyId: number }): Promise<void>
    capabilities(): { enabled: boolean } | null
  }
}

const modules = import.meta.glob<OptionalWorkspaceHost>('../../src/plugins/workspaceEditors.ts', { eager: true })
export const workspaceHost: OptionalWorkspaceHost | undefined = Object.values(modules)[0]
