// SPDX-License-Identifier: AGPL-3.0-only
// Delete marked: the surface marked by hand taken off the scan.

import { useMark } from '../../../../src/state/markStore'
import { InfoDot } from '../../../../src/ui/InfoDot'
import { MarkTools } from '../../../../src/ui/MarkTools'
import { useMeshTools } from '../../state/meshStore'
import { count } from '../meshFormat'
import { pluginText as tmarText, useLanguage as useTmarLanguage } from '../../../../src/i18n'


export function DeleteTool({
  ready,
  busy,
  onDelete,
  onClear,
}: {
  ready: boolean
  busy: boolean
  onDelete: () => void
  onClear: () => void
}) {
  useTmarLanguage()

  const marked = useMark((s) => s.count)
  const editing = useMeshTools((s) => s.editing)
  const confirming = useMeshTools((s) => s.confirming)
  const setConfirming = useMeshTools((s) => s.setConfirming)

  return (
    <div className="group" data-test="delete-tool">
      <div className="sec-head">{tmarText("Delete marked")}<InfoDot title={tmarText("Deleting marked surface")}>
          <p>{tmarText("What the scanner saw that is not the part: the clamp that held it, the fixture it sat in, a patch of the table, a finger. Mark it on the part with a ")}<b>{tmarText("window")}</b>{tmarText(", a")}{' '}
            <b>{tmarText("brush")}</b>{tmarText(" or a ")}<b>{tmarText("lasso")}</b>{tmarText(" — marked surface turns orange — and delete it. A triangle goes when all three of its corners are marked, exactly the triangles shown in orange.")}</p>
          <p>{tmarText("It is deleted from the edited copy. The hole it leaves stays open — close it with")}{' '}
            <b>{tmarText("Fill holes")}</b>{tmarText(" if the part should be closed there. ")}<b>{tmarText("Ctrl+Z")}</b>{tmarText(" puts the surface back.")}</p>
        </InfoDot>
      </div>

      <MarkTools escapeNote="The marking stays until it is deleted or cleared." onClear={onClear} />

      {confirming && marked > 0 ? (
        <div className="confirmbox" data-test="delete-confirm" role="alertdialog" aria-label={tmarText("Delete the marked surface")}>
          <p>{tmarText("Delete the surface marked on the part — ")}<b>{count(marked)}{tmarText(" points")}</b>{tmarText(" — from the edited copy?")}</p>
          <p className="hint">{tmarText("Ctrl+Z puts it back.")}</p>
          <div className="toolrow">
            <button data-test="delete-keep" onClick={() => setConfirming(false)} title={tmarText("Leave the scan as it is (Esc)")}>{tmarText("Keep it")}</button>
            <button
              className="primary"
              data-test="delete-marked-confirm"
              data-confirm={1}
              disabled={busy}
              onClick={onDelete}
              title={tmarText("Take the marked surface off the scan (Enter)")}
            >{tmarText("Delete")}</button>
          </div>
        </div>
      ) : (
        <button
          className="primary block"
          data-test="delete-marked"
          disabled={!ready || busy || marked === 0}
          onClick={() => setConfirming(true)}
        >
          {editing ? (
            <>
              <span className="spinner" />{tmarText("Deleting…")}</>
          ) : (
            tmarText('Delete marked surface…')
          )}
        </button>
      )}
      {ready && marked === 0 && !editing && <p className="hint">{tmarText("Pick Window, Brush or Lasso and mark what is to go.")}</p>}
    </div>
  )
}
