// SPDX-License-Identifier: AGPL-3.0-only
// One entry point, then format/scope selection. The historic module name is kept.
import { useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { saveFile } from '../../src/app/exports'
import { useUnits } from '../../src/app/useUnits'
import { fmtLen } from '../../src/core/units'
import { NumberField } from '../../src/ui/NumberField'
import { useDismiss } from '../../src/ui/useDismiss'
import { runCommand } from '../../src/commands/registry'
import { useCommandActivity } from '../../src/commands/activity'
import { useStore } from '../../src/state/store'
import { reEditorOpen, useReverse } from '../reverse/state/reStore'
import { bodyStlResult, bodyStepResult, DEFAULT_CHORD_MM, exportSelection, validChord, type ExportScope } from './bodyExport'
import { pluginText as tmarText, useLanguage as useTmarLanguage } from '../../src/i18n'


export function BodyStlExport() {
  useTmarLanguage()

  const [open, setOpen] = useState(false)
  const [format, setFormat] = useState<'step' | 'stl'>('step')
  const [scope, setScope] = useState<ExportScope>('visible')
  const [chord, setChord] = useState(DEFAULT_CHORD_MM)
  const [exporting, setExporting] = useState(false)
  const inFlight = useRef(false), button = useRef<HTMLButtonElement>(null)
  const units = useUnits(), busy = useStore((s) => s.busy)
  const commandRunning = useCommandActivity((s) => s.running !== null)
  const re = useReverse(useShallow((s) => ({ bodies: s.bodies, bodyFolders: s.bodyFolders,
    listSelection: s.listSelection, building: s.building, kernelStatus: s.kernelStatus,
    editing: reEditorOpen(s), playback: s.playback !== null })))
  const selected = exportSelection(re.bodies, re.bodyFolders, re.listSelection, scope, format)
  const working = busy || commandRunning || re.building || re.editing || re.playback
  const blocked = exporting ? 'Export is in progress.' : working ? 'Finish the current operation or edit first.'
    : re.kernelStatus !== 'ready' ? 'Wait for the CAD kernel to be ready.'
    : selected.error ?? (format === 'stl' && !validChord(chord) ? `Enter a chord from ${fmtLen(0.0001, units)} to ${fmtLen(1, units)}.` : null)
  const close = () => { if (!inFlight.current) { setOpen(false); button.current?.focus() } }
  useDismiss(open, close)
  const download = async () => {
    if (inFlight.current || blocked) return
    const before = useReverse.getState(), model = useStore.getState()
    const selection = exportSelection(before.bodies, before.bodyFolders, before.listSelection, scope, format)
    if (selection.error) { useStore.getState().setError(selection.error); return }
    inFlight.current = true; setExporting(true)
    try {
      const result = format === 'stl'
        ? bodyStlResult(await runCommand('reverse.export.stl', { bodies: selection.ids, chord, format: 'stl' }))
        : bodyStepResult(await runCommand('reverse.export.step', { bodies: selection.ids }))
      const after = useReverse.getState(), now = useStore.getState()
      if (after.buildVersion !== before.buildVersion || after.features !== before.features || now.fileName !== model.fileName || now.appliedAlignment !== model.appliedAlignment) throw new Error('The model changed during export. No file was downloaded; retry with the finished model.')
      saveFile(result.file.name, new Blob([result.file.bytes.slice().buffer], { type: result.file.mimeType }))
      useStore.getState().setStatus(`${result.status} The source scan is not included.`)
      setOpen(false); button.current?.focus()
    } catch (error) {
      useStore.getState().setError(`Body export failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally { inFlight.current = false; setExporting(false) }
  }
  return <div className="group" data-test="tmar-body-export">
    <button ref={button} className="block" data-test="export-body" disabled={working || !re.bodies.length} onClick={() => setOpen(true)} title={tmarText("Choose STEP or STL, then choose the CAD bodies to save")}>{tmarText("Export body…")}</button>
    {open && <div className="modalback" onClick={close}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="body-export-title" data-test="body-export-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modalhead"><h2 id="body-export-title">{tmarText("Export body")}</h2><button className="x" aria-label={tmarText("Close export")} disabled={exporting} onClick={close}>{tmarText("×")}</button></div>
        <label className="field"><span>{tmarText("File format")}</span><select autoFocus data-test="body-export-format" value={format} disabled={exporting} onChange={(e) => setFormat(e.target.value as 'step' | 'stl')}>
          <option value="step">{tmarText("STEP — CAD geometry")}</option><option value="stl">{tmarText("STL — triangle mesh")}</option>
        </select></label>
        <label className="field"><span>{tmarText("Bodies to export")}</span><select data-test="body-stl-scope" value={scope} disabled={exporting} onChange={(e) => setScope(e.target.value as ExportScope)}>
          <option value="visible">{format === 'stl' ? tmarText("Visible solid bodies") : tmarText("Visible bodies")}</option><option value="selected">{tmarText("Selected body-list items")}</option>
        </select></label>
        {format === 'stl' && <NumberField label={tmarText("Chord tolerance")} value={chord} kind="length" step={0.01} min={0.0001} testId="body-stl-chord" disabled={exporting} onCommit={setChord} hint={tmarText("Maximum {0}. Finer triangles produce larger files.", [fmtLen(1, units)])}/>}
        <p className="hint">{format === 'stl' ? tmarText("CAD solids only. STL has no unit metadata: import as millimetres. Multiple bodies share one file without a Boolean union.") : tmarText("Save CAD geometry, including selected sheets. Keep the project to preserve the feature history and notes.")}</p>
        {blocked && <p className="hint" data-test="body-stl-blocked">{tmarText(blocked)}</p>}
        <div className="toolrow"><button disabled={exporting} onClick={close}>{tmarText("Cancel")}</button>
          <button className="primary" data-test="export-body-save" disabled={!!blocked} onClick={() => void download()}>{exporting ? tmarText("Exporting…") : tmarText("Save {0} ({1})", [format.toUpperCase(), selected.ids.length])}</button>
        </div>
      </div>
    </div>}
  </div>
}
