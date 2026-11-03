// SPDX-License-Identifier: AGPL-3.0-only
// Explicit CAD input for editors. General deliverable STEP policy stays unchanged.
import { int, num, obj, str } from '../../../src/commands/schema'
import type { FileOut } from '../../../src/commands/types'
import { type Command, CommandError } from '../../../src/plugins/api'
import { useStore } from '../../../src/state/store'
import { useReverse } from '../state/reStore'
import { ready } from './reCommandCore'
import { reverseSession } from './reSession'

export interface BodyEditSourceResult {
  version: 1
  file: FileOut
  source: {
    bodyId: number; bodyKey: string; buildVersion: number
    kind: 'surface' | 'solid'; faces: number; closed: boolean
    units: 'mm'; coordinateFrame: 'part'
  }
  status: string
}

export const bodyEditSource: Command<{ body: number; expectedKey?: string; expectedBuildVersion?: number }> = {
  name: 'edit_source',
  title: 'Read current CAD body for an editor',
  description: 'Read exactly one current body by numeric ID as STEP, including ordinary open sheets and hidden bodies explicitly named. Reads the built CAD, not the original import file or a mesh. No alias fallback, solidification, export-gap repair or new history entry. Returns file bytes and a session-local source key/build version. Refuses a changed source. Does not change reverse.export.step policy. The key is not a persistent face ID or an Apply transaction token.',
  input: obj({
    body: num('Exact current CAD body ID.', { exclusiveMinimum: 0 }),
    expectedKey: str('Optional key from an earlier editor-source read.', { minLength: 1 }),
    expectedBuildVersion: int('Optional required host build version.', { minimum: 0 }),
  }, ['body']),
  readOnly: true,
  returnsFile: true,
  long: true,
  timeoutMs: 300_000,
  run: async ({ body, expectedKey, expectedBuildVersion }, context): Promise<BodyEditSourceResult> => {
    const session = await ready(), client = session.client()
    const before = useReverse.getState(), model = useStore.getState()
    const selected = before.bodies.find(b => b.id === body)
    if (!selected) throw new CommandError('not_found', `There is no current CAD body ${body}.`)
    if (!client || before.building || session.buildState() !== 'built')
      throw new CommandError('invalid_state', 'The current CAD build has not settled.')
    if (expectedBuildVersion !== undefined && expectedBuildVersion !== before.buildVersion)
      throw new CommandError('invalid_state', 'The CAD document changed before its editor source was read.')
    const source = await client.bodyEditSource(body, expectedKey).catch(error => {
      throw new CommandError('invalid_state', `Current CAD source unavailable: ${error instanceof Error ? error.message : String(error)}`)
    })
    const after = useReverse.getState(), now = useStore.getState()
    if (context.signal?.aborted) throw new CommandError('timeout', 'The editor source read was cancelled.')
    if (reverseSession() !== session || session.client() !== client || after.building ||
        after.buildVersion !== before.buildVersion || after.features !== before.features ||
        after.rolledBack !== before.rolledBack || after.stepFiles !== before.stepFiles ||
        after.parameters !== before.parameters || now.fileName !== model.fileName ||
        now.appliedAlignment !== model.appliedAlignment || !after.bodies.some(b => b.id === body))
      throw new CommandError('invalid_state', 'The CAD document changed while its editor source was being read.')
    const stem = selected.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || `body-${body}`
    return {
      version: 1,
      file: { name: `${stem}-edit-source.step`, mimeType: 'model/step', bytes: new TextEncoder().encode(source.text) },
      source: {
        bodyId: source.bodyId, bodyKey: source.bodyKey, buildVersion: before.buildVersion,
        kind: source.surface ? 'surface' : 'solid', faces: source.faces, closed: source.closed,
        units: 'mm', coordinateFrame: 'part',
      },
      status: 'Current CAD editor source; general STEP export policy unchanged.',
    }
  },
}
