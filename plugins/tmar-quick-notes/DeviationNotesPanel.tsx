// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useDeviation } from '../../src/state/deviationStore'
import { useShell } from '../../src/state/shellStore'
import { useStore } from '../../src/state/store'
import { useNotesOn } from '../reverse/app/useNotePins'
import { useNotes } from '../reverse/state/noteStore'
import { reEditorOpen, useReverse } from '../reverse/state/reStore'
import { NoteList } from '../reverse/ui/NoteList'
import { deviationNoteBlock } from './notePlacement'

export function DeviationNotes() {
  const enabled = useNotesOn()
  const hasScan = useStore((s) => s.fileName !== null)
  const busy = useStore((s) => s.busy)
  const cadBusy = useReverse((s) => s.building || reEditorOpen(s))
  const placing = useNotes((s) => s.placing)
  const d = useDeviation(useShallow((s) => ({
    nominalBusy: s.nominalBusy, alignStatus: s.alignStatus, mapStatus: s.mapStatus,
    referenceStatus: s.referenceStatus, picking: s.picking, split: s.split, marking: s.marking,
    animate: s.animate, showScan: s.showScan, mapOn: s.mapOn,
  })))
  const blocked = deviationNoteBlock(d, hasScan, busy || cadBusy)

  useEffect(() => {
    if (placing && blocked) {
      useNotes.getState().setPlacing(false)
      useStore.getState().setStatus(blocked)
    }
  }, [placing, blocked])

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || useShell.getState().workspace !== 'deviation' || !useNotes.getState().placing) return
      useNotes.getState().setPlacing(false)
      event.preventDefault()
      // The same key must not also cancel the host's comparison interaction.
      event.stopImmediatePropagation()
    }
    window.addEventListener('keydown', escape, true)
    return () => {
      window.removeEventListener('keydown', escape, true)
      useNotes.getState().setPlacing(false)
    }
  }, [])

  if (!enabled) return <div className="group" data-test="tmar-deviation-notes-off">
    <p className="hint">Notes appear here after opening local notes in Zebra, or when enabled in Settings → Agents. No agent connection is enabled automatically.</p>
  </div>
  return <section data-test="tmar-deviation-notes" aria-label="Notes in Deviation">
    <NoteList placementBlocked={blocked} />
    <p className="hint" data-test="tmar-deviation-note-help">{blocked ?? 'Pin observations directly on the scan-side map. The same notes appear in Reverse engineer and are saved with the project.'}</p>
  </section>
}
