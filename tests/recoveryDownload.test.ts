// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest'
import type { ProjectManifest } from '../src/core/project/manifest'
import type { ArchiveMember } from '../src/core/project/archive'
import { recoveryDownloadName, exportRecoveryCheckpoint } from '../src/app/recoveryDownload'

const info = { id: 'previous-tab', name: 'Tubo: 6b / backup', savedAt: Date.UTC(2026, 10, 11, 0, 42, 0) }

describe('local recovery checkpoint download', () => {
  it('creates an OS-safe, timestamped project filename', () => {
    expect(recoveryDownloadName(info)).toBe('Tubo- 6b - backup-checkpoint-2026-11-11T00-42-00.000Z.scanruler')
    expect(recoveryDownloadName({ ...info, name: '///', savedAt: NaN }))
      .toBe('----checkpoint-unknown-date.scanruler')
  })

  it('downloads the exact packed project without changing or deleting the checkpoint', async () => {
    const manifest = { name: 'Tubo' } as ProjectManifest
    const members: ArchiveMember[] = [{ name: 'scan.stl', bytes: new Uint8Array([1, 2, 3]) }]
    const read = vi.fn(async (_id: string) => ({ manifest, members }))
    const payload = new Uint8Array([80, 75, 3, 4])
    const pack = vi.fn(async (_manifest: ProjectManifest, _members: ArchiveMember[]) => payload)
    const download = vi.fn((_name: string, _file: Blob) => {})
    await exportRecoveryCheckpoint(info, read, pack, download)

    expect(read).toHaveBeenCalledExactlyOnceWith(info.id)
    expect(pack).toHaveBeenCalledExactlyOnceWith(manifest, members)
    expect(download).toHaveBeenCalledTimes(1)
    const [name, blob] = download.mock.calls[0]
    expect(name).toBe(recoveryDownloadName(info))
    expect(blob.type).toBe('application/zip')
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual(Array.from(payload))
    expect(members[0].bytes).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('never triggers a download if packing fails', async () => {
    const download = vi.fn()
    await expect(exportRecoveryCheckpoint(info,
      async () => ({ manifest: {} as ProjectManifest, members: [] }),
      async () => { throw new Error('Packaging failed') }, download)).rejects.toThrow('Packaging failed')
    expect(download).not.toHaveBeenCalled()
  })
})
