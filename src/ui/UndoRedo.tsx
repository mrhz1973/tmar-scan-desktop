// SPDX-License-Identifier: AGPL-3.0-only
// The undo and redo keys in the top bar, each naming in its tooltip the step
// it would take — the editor's own, while an editor with a history of its
// own is active. The store subscriptions are not read: they are there so the
// keys are drawn again when a computation or an editor starts or finishes,
// the things that block a step.

import { useRef } from 'react'
import { activeLocalHistory, historyBlocked, historyWatchers, redo, undo, useHistory } from '../state/historyStore'
import { useStore } from '../state/store'
import { useFlat } from '../state/flatStore'
import { useDeviation } from '../state/deviationStore'
import { useThickness } from '../state/thicknessStore'
import { Icon } from './icons'
import { modLabel } from './platform'
import { coreText as tmarText, useLanguage as useTmarLanguage } from '../i18n'


export function UndoRedo() {
  useTmarLanguage()

  const history = useHistory()
  // Re-evaluate availability as computations and editors start or finish.
  useStore((s) => !!(s.busy || s.draft || s.dimDraft || s.alignDraft || s.sectionDraft))
  useFlat((s) => !!(s.imageBusy || s.draft || s.dimDraft || s.tool.kind !== 'none'))
  useDeviation((s) => s.alignStatus === 'running' || s.mapStatus === 'running' || s.nominalBusy)
  useThickness((s) => s.status === 'running')
  // What the plugins' histories hang on — the same hooks on every render,
  // those registered before the keys were first drawn.
  const watchers = useRef(historyWatchers()).current
  for (const watch of watchers) watch()
  const local = activeLocalHistory()
  const blocked = historyBlocked()
  const canUndo = !blocked && (local ? local.canUndo() : history.past.length > 0)
  const canRedo = !blocked && (local ? local.canRedo() : history.future.length > 0)
  const hint = blocked ? 'Finish the active operation or close its editor first' : null
  return <div className="undokeys" data-test="undo-keys">
    <button className="ghost" data-test="undo" aria-label={tmarText("Undo")} disabled={!canUndo}
      title={hint ?? (tmarText("Undo{0} — {1}+Z", [local ? tmarText(" {0}", [tmarText(local.label)]) : history.past.at(-1) ? tmarText(": {0}", [tmarText(history.past.at(-1)!.label)]) : '', modLabel]))}
      onClick={() => void undo()}><Icon name="undo" size={16} /></button>
    <button className="ghost" data-test="redo" aria-label={tmarText("Redo")} disabled={!canRedo}
      title={hint ?? (tmarText("Redo{0} — {1}+Y / {2}+Shift+Z", [local ? tmarText(" {0}", [tmarText(local.label)]) : history.future.at(-1) ? tmarText(": {0}", [tmarText(history.future.at(-1)!.label)]) : '', modLabel, modLabel]))}
      onClick={() => void redo()}><Icon name="redo" size={16} /></button>
  </div>
}
