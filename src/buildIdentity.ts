// SPDX-License-Identifier: AGPL-3.0-only
// Separate build provenance from the inherited application/project version.
export interface BuildIdentity { revision: string; dirty: boolean; builtAt: string }
export const BUILD_IDENTITY: Readonly<BuildIdentity> = typeof __BUILD_IDENTITY__ === 'undefined'
  ? { revision: 'unknown', dirty: false, builtAt: 'unknown' }
  : __BUILD_IDENTITY__
export const shortBuildRevision = (identity: BuildIdentity): string =>
  /^[0-9a-f]{40,64}$/.test(identity.revision) ? identity.revision.slice(0, 7) : 'unknown'
