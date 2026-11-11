// SPDX-License-Identifier: AGPL-3.0-only
// Export a browser-local recovery checkpoint without taking ownership of it,
// opening it in the current session or deleting its IndexedDB records.
import { fileSafe, type ProjectManifest } from '../core/project/manifest'
import type { ArchiveMember } from '../core/project/archive'
import type { CheckpointInfo } from './recoveryStorage'

export function recoveryDownloadName(info: CheckpointInfo): string {
  const name = fileSafe(info.name).slice(0, 80) || 'ScanRuler'
  const date = new Date(info.savedAt)
  const stamp = Number.isFinite(date.getTime())
    ? date.toISOString().replace(/:/g, '-')
    : 'unknown-date'
  return `${name}-checkpoint-${stamp}.scanruler`
}

export async function exportRecoveryCheckpoint(
  info: CheckpointInfo,
  read: (id: string) => Promise<{ manifest: ProjectManifest; members: ArchiveMember[] }>,
  pack: (manifest: ProjectManifest, members: ArchiveMember[]) => Promise<Uint8Array>,
  download: (name: string, file: Blob) => void,
): Promise<void> {
  const { manifest, members } = await read(info.id)
  const bytes = await pack(manifest, members)
  download(recoveryDownloadName(info), new Blob([bytes as BlobPart], { type: 'application/zip' }))
}
