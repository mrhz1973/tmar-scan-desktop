// SPDX-License-Identifier: AGPL-3.0-only
// The word Mesh Tools puts on the stage of the other workspaces while an
// edited copy waits apart from the scan they measure.

import { count } from './meshFormat'
import { pluginText as tmarText, useLanguage as useTmarLanguage } from '../../../src/i18n'

/** That the edited copy is not what this workspace measures, with the ways
 *  on: take it into use from here, go and look at it, or let it be — until
 *  the copy changes again. */
export function EditedCopyNote({ edits, busy, onUse, onShow, onDismiss }: { edits: number; busy: boolean; onUse: () => void; onShow: () => void; onDismiss: () => void }) {
  useTmarLanguage()
  return (
    <div className="stagenote" data-test="edited-copy-note" role="status">
      <span className="note-text">{tmarText(
        "Mesh Tools holds an edited copy of the scan ({0} {1}) that is not in use; this workspace measures the original scan.",
        [count(edits), edits === 1 ? tmarText("edit") : tmarText("edits")],
      )}</span>
      <span className="note-actions">
        <button data-test="edited-note-show" onClick={onShow} title={tmarText("Go to Mesh Tools to view the edited scan copy")}>
          {tmarText("Show")}
        </button>
        <button
          className="primary"
          data-test="edited-note-use"
          disabled={busy}
          onClick={onUse}
          title={tmarText("Use this edited copy for analysis in all workspaces; elements are refitted. Ctrl+Z restores the previous scan.")}
        >
          {tmarText("Use for analysis")}
        </button>
        <button className="x" data-test="edited-note-dismiss" onClick={onDismiss} title={tmarText("Hide this notice until the edited copy changes again")} aria-label={tmarText("Hide")}>
          ×
        </button>
      </span>
    </div>
  )
}
