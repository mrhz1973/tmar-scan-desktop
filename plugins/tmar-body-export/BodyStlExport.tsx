// SPDX-License-Identifier: AGPL-3.0-only
import { useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { saveFile } from '../../src/app/exports'
import { useUnits } from '../../src/app/useUnits'
import { fmtLen } from '../../src/core/units'
import { NumberField } from '../../src/ui/NumberField'
import { runCommand } from '../../src/commands/registry'
import { useCommandActivity } from '../../src/commands/activity'
import { useStore } from '../../src/state/store'
import { reEditorOpen, useReverse } from '../reverse/state/reStore'
import { bodyStlResult, DEFAULT_CHORD_MM, exportSelection, validChord, type ExportScope } from './bodyExport'

export function BodyStlExport() {
  const [scope, setScope] = useState<ExportScope>('visible')
  const [chord, setChord] = useState(DEFAULT_CHORD_MM)
  const units = useUnits()
  const [exporting, setExporting] = useState(false)
  const inFlight = useRef(false)
  const busy = useStore((s) => s.busy)
  const commandRunning = useCommandActivity((s) => s.running !== null)
  const re = useReverse(useShallow((s) => ({
    bodies: s.bodies, bodyFolders: s.bodyFolders, listSelection: s.listSelection,
    building: s.building, kernelStatus: s.kernelStatus,
    editing: reEditorOpen(s), playback: s.playback !== null,
  })))
  const selected = exportSelection(re.bodies, re.bodyFolders, re.listSelection, scope)
  const blocked = exporting ? 'Export is in progress.'
    : busy || commandRunning || re.building || re.editing || re.playback ? 'Finish the current operation or edit first.'
    : re.kernelStatus !== 'ready' ? 'Wait for the CAD kernel to be ready.'
    : selected.error ?? (!validChord(chord) ? `Enter a chord tolerance from ${fmtLen(0.0001, units)} to ${fmtLen(1, units)}.` : null)

  const download = async () => {
    if (inFlight.current || blocked) return
    const before = useReverse.getState()
    const model = useStore.getState()
    const selection = exportSelection(before.bodies, before.bodyFolders, before.listSelection, scope)
    if (selection.error) { useStore.getState().setError(selection.error); return }
    inFlight.current = true
    setExporting(true)
    useStore.getState().setStatus('Tessellating the selected CAD bodies for STL export...')
    try {
      // Use the same kernel exporter as the MCP command, including its schema
      // validation and settled build. Never serialize the viewport or scan.
      const result = bodyStlResult(await runCommand('reverse.export.stl', { bodies: selection.ids, chord, format: 'stl' }))
      const after = useReverse.getState()
      const now = useStore.getState()
      if (after.buildVersion !== before.buildVersion || after.features !== before.features || now.fileName !== model.fileName || now.appliedAlignment !== model.appliedAlignment) {
        throw new Error('The model changed during export. No file was downloaded; retry with the finished model.')
      }
      saveFile(result.file.name, new Blob([result.file.bytes.slice().buffer], { type: result.file.mimeType }))
      useStore.getState().setStatus(`${result.status} Coordinates are millimetres; the source scan is not included.`)
    } catch (error) {
      useStore.getState().setError(`Body STL export failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      inFlight.current = false
      setExporting(false)
    }
  }

  return <div className="group" data-test="tmar-body-export">
    <div className="sec-head">CAD body STL</div>
    <label className="field"><span>Bodies to export</span>
      <select data-test="body-stl-scope" value={scope} disabled={exporting} onChange={(e) => setScope(e.target.value as ExportScope)}>
        <option value="visible">Visible solid bodies</option>
        <option value="selected">Selected body-list items</option>
      </select>
    </label>
    <NumberField label="Chord tolerance" value={chord} kind="length" step={0.01} min={0.0001}
      testId="body-stl-chord" disabled={exporting} onCommit={setChord}
      hint={`Maximum ${fmtLen(1, units)}. The displayed value follows Settings units; the exporter receives millimetres.`} />
    <button className="block" data-test="export-body-stl" disabled={Boolean(blocked)} title={blocked ?? 'Export only these CAD solids as a binary STL, not the source scan'} onClick={() => void download()}>
      {exporting ? 'Exporting body STL...' : `Export body STL (${selected.ids.length})`}
    </button>
    {blocked && !exporting && <p className="hint" data-test="body-stl-blocked">{blocked}</p>}
    <p className="hint">CAD bodies only. Smaller chord values produce finer, larger files. STL has no unit metadata: import it as millimetres. Multiple bodies share one file, without a Boolean union. Keep STEP or the project for editable CAD.</p>
  </div>
}
