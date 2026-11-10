// SPDX-License-Identifier: AGPL-3.0-only
// The edited copy of the scan: the edits it carries, the copy put to use or
// discarded, and its deviation from the scan it was made from.

import { useStore } from '../../../src/state/store'
import { useUnits } from '../../../src/app/useUnits'
import { InfoDot } from '../../../src/ui/InfoDot'
import { ExportMeshButton } from '../../../src/ui/ExportMeshButton'
import type { MeshFormat } from '../../../src/core/exportMesh'
import { scanEditFigure, scanEditText, useMeshTools } from '../state/meshStore'
import { count } from './meshFormat'
import { pluginText as tmarText, useLanguage as useTmarLanguage } from '../../../src/i18n'


/** The copy of the scan the tools have edited, and what to do with it: the
 *  edits made on it, how large it is, and the buttons that take it into use
 *  or throw it away. */
export function EditedCopy({ busy, onUse, onDiscard, onExport }: { busy: boolean; onUse: () => void; onDiscard: () => void; onExport: (format: MeshFormat) => void }) {
  useTmarLanguage()

  const pending = useMeshTools((s) => s.pending)
  const triangles = useMeshTools((s) => s.copyTriangles)
  const scanTriangles = useStore((s) => s.triangleCount)
  const units = useUnits()
  if (triangles === null) return null

  return (
    <div className="group" data-test="edited-copy">
      <div className="sec-head">{tmarText("Edited copy")}<InfoDot title={tmarText("The edited copy")}>
          <p>{tmarText("The tools edit a copy of the scan, shown here in its place. Every other workspace — the elements, the deviation and thickness maps, Reverse engineer — goes on measuring the scan as it was, so nothing is fitted again until you say so.")}</p>
          <p>
            <b>{tmarText("Use for analysis")}</b>{tmarText(" makes the copy the scan every workspace measures: the elements are fitted again on it and the maps measured again. ")}<b>{tmarText("Discard")}</b>{tmarText(" throws the copy away. Both are one step of the undo history, and a saved project keeps the copy.")}{' '}
            <b>{tmarText("Export mesh")}</b>{tmarText(" saves the copy as it stands, as an STL or a 3MF, in the pose the scan is shown in.")}</p>
          <p>
            <b>{tmarText("Deviation")}</b>{tmarText(", in the view bar under the part, colours the copy by how far it is from the scan in use — what smoothing or an expansion moved, where a patch stands off the surface. Surface an edit made where the scan had none — a filled hole, a cut's cap, a hollow's inner wall — has nothing to measure against and is grey.")}</p>
        </InfoDot>
      </div>
      <div className="kv" data-test="edited-triangles">
        <span className="name">{tmarText("Triangles")}</span>
        <b>
          {count(triangles)}
          <span className="dim">{tmarText(" · scan in use ")}{count(scanTriangles)}</span>
        </b>
      </div>
      {pending.map((e, i) => (
        <div key={i} className="kv" data-test="pending-edit">
          <span className="name">{tmarText(scanEditText(e, units))}</span>
          <b>{scanEditFigure(e, units)}</b>
        </div>
      ))}
      <p className="hint">{tmarText("Not in use yet — every other workspace measures the scan as it was. ")}<b>{tmarText("Deviation")}</b>{tmarText(" in the view bar shows how far the copy is from it.")}</p>
      <div className="toolrow">
        <button data-test="discard-edited" disabled={busy} onClick={onDiscard} title={tmarText("Throw the copy and its edits away — Ctrl+Z brings them back")}>{tmarText("Discard")}</button>
        <ExportMeshButton
          testId="export-edited"
          disabled={busy}
          onExport={onExport}
          title={tmarText("Save the copy as an STL or a 3MF where it now stands — any alignment applied to the scan comes with it")}
        />
        <button
          className="primary"
          data-test="use-edited"
          disabled={busy}
          onClick={onUse}
          title={tmarText("Make the copy the scan every workspace measures — the elements are fitted again on it")}
        >{tmarText("Use for analysis")}</button>
      </div>
    </div>
  )
}
