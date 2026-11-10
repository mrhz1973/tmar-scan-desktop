// SPDX-License-Identifier: AGPL-3.0-only
// The surface marking controls — gesture row, brush width, back faces, erase,
// invert and clear — as one block, so both places that mark scan surface by
// hand offer the same tools and the same escape route: an element fitted to
// exactly the triangles the user chose, and the local fine fit in the
// deviation workspace.
//
// The reason this is shared rather than written twice: a marking gesture takes
// both plain mouse drags away from the camera while it is live, and a tool that
// quietly holds the mouse hostage in one workspace but not the other is worse
// than either behaviour on its own.

import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { brushRange, useMark, type MarkGesture } from '../state/markStore'
import { useStore } from '../state/store'
import { Icon, type IconName } from './icons'
import { InfoDot } from './InfoDot'
import { modLabel } from './platform'
import { useLength } from '../app/useUnits'
import { coreText as tmarText, useLanguage as useTmarLanguage } from '../i18n'


/** The marking modes, with plain navigation as one of them. A gesture takes
 *  both plain mouse drags away from the camera for as long as it is on, so
 *  which of the four is live has to be as visible as any other mode switch —
 *  and getting the camera back has to be one click, not an escape hatch. */
const GESTURES: { id: MarkGesture | null; icon: IconName; label: string; title: string }[] = [
  {
    id: null,
    icon: 'navigate',
    label: 'Navigate',
    title: 'Marking off — orbit, pan and zoom as usual. What is marked stays marked.',
  },
  {
    id: 'window',
    icon: 'markWindow',
    label: 'Window',
    title: 'Drag a rectangle: every triangle inside it is marked',
  },
  { id: 'brush', icon: 'markBrush', label: 'Brush', title: 'Drag over the surface with a round brush' },
  { id: 'lasso', icon: 'markLasso', label: 'Lasso', title: 'Draw a free outline: everything inside it is marked' },
]

interface BrushDiameter {
  diameter: number
  setDiameter: (mm: number) => void
}

/** The brush's diameter to type: held in millimetres, typed in the units
 *  shown. */
export function BrushNumber({ diameter, setDiameter, testId }: BrushDiameter & { testId: string }) {
  const len = useLength()
  return (
    <input
      type="number"
      step="any"
      min={0}
      data-test={testId}
      value={Number(len.toDisplay(diameter).toFixed(len.decimals(3)))}
      onChange={(e) => e.target.value !== '' && setDiameter(len.fromDisplay(Number(e.target.value)))}
    />
  )
}

/** The brush's diameter to drag, over the range the part's size gives. */
export function BrushSlider({ diameter, setDiameter, brush }: BrushDiameter & { brush: { min: number; max: number } }) {
  useTmarLanguage()

  return (
    <input
      className="slider"
      type="range"
      min={brush.min}
      max={brush.max}
      step={(brush.max - brush.min) / 200}
      value={Math.min(Math.max(diameter, brush.min), brush.max)}
      aria-label={tmarText("Brush diameter")}
      onChange={(e) => setDiameter(Number(e.target.value))}
    />
  )
}

export function MarkTools({
  escapeNote,
  showCount = true,
  onClear,
}: {
  /** What a second Escape does from here — the two sessions back out of
   *  different things, and that is the only part of the story that differs. */
  escapeNote: string
  /** Show the running tally. Off where the panel already prints it elsewhere. */
  showCount?: boolean
  /** Rub out the whole marking. */
  onClear: () => void
}) {
  useTmarLanguage()

  // Everything the controls draw, and not `inverts`: that is a request counter for the
  // viewport that holds the marking, bumped on every Invert and drawn by nobody here.
  const m = useMark(
    useShallow((s) => ({
      backfaces: s.backfaces,
      count: s.count,
      diameter: s.diameter,
      erase: s.erase,
      gesture: s.gesture,
      invert: s.invert,
      setBackfaces: s.setBackfaces,
      setDiameter: s.setDiameter,
      setErase: s.setErase,
      setGesture: s.setGesture,
      setStraight: s.setStraight,
      straight: s.straight,
    })),
  )
  const [shiftHeld, setShiftHeld] = useState(false)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Shift') return
      if (e.type === 'keyup') { setShiftHeld(false); return }
      if ((e.target as HTMLElement | null)?.closest?.('input,textarea,select,[contenteditable="true"],[role="dialog"]')) return
      if (useMark.getState().gesture !== null) setShiftHeld(true)
    }
    const clear = () => setShiftHeld(false)
    window.addEventListener('keydown', key); window.addEventListener('keyup', key); window.addEventListener('blur', clear)
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('keyup', key); window.removeEventListener('blur', clear) }
  }, [])
  const navigating = shiftHeld && m.gesture !== null
  const activeGesture = navigating ? null : m.gesture
  const modelSize = useStore((s) => s.modelSize)
  const brush = brushRange(modelSize)
  const len = useLength()

  return (
    <>
      <div className="moderow" data-test="mark-gestures">
        {GESTURES.map((g) => (
          <button
            key={g.id ?? 'navigate'}
            className={activeGesture === g.id ? 'withicon on' : 'withicon'}
            data-test={`mark-${g.id ?? 'navigate'}`}
            aria-pressed={activeGesture === g.id}
            title={tmarText(g.title)}
            // Clicking the live gesture again hands the camera back — the same
            // key that armed it disarms it.
            onClick={() => m.setGesture(m.gesture === g.id ? null : g.id)}
          >
            <Icon name={g.icon} size={16} />
            {tmarText(g.label)}
          </button>
        ))}
      </div>
      <p className="hint" data-test="mark-navigation-hint" data-shift-held={navigating}>
        {navigating ? tmarText("Shift: temporary Navigate. Release Shift to return to {0}. ", [m.gesture]) : m.gesture === null ? tmarText("Marking is off — the camera has both drags back.") : tmarText("Left-drag marks, right-drag rubs out. Hold Shift for normal left/right mouse navigation; release to resume this marking tool.")}
        <InfoDot title={tmarText("Marking tools")} testId="mark-help">
          <p>
            <b>{tmarText("Window")}</b>{tmarText(" marks every triangle inside a dragged rectangle. ")}<b>{tmarText("Brush")}</b>{tmarText(" paints with a round tip, for working along an edge. ")}<b>{tmarText("Lasso")}</b>{tmarText(" takes everything inside a free outline.")}</p>
          <p>{tmarText("While a tool is live it takes both plain drags: left marks, right rubs out, and Alt inverts either way. With the brush, ")}{modLabel}{tmarText("-drag draws a straight line. Shift-drag still orbits and the middle button is untouched.")}</p>
          <p>
            <b>{tmarText("Navigate")}</b>{tmarText(", Esc, or clicking the live tool again hands the drags back to the camera; what is marked stays marked. ")}{tmarText(escapeNote)}
          </p>
        </InfoDot>
      </p>

      {m.gesture === 'brush' && (
        <>
          <label className="field">
            <span>{tmarText("Brush Ø (")}{len.word()})</span>
            <BrushNumber diameter={m.diameter} setDiameter={m.setDiameter} testId="mark-brush-diameter" />
          </label>
          <BrushSlider diameter={m.diameter} setDiameter={m.setDiameter} brush={brush} />
          <label className="checkrow">
            <input
              type="checkbox"
              data-test="mark-straight"
              checked={m.straight}
              onChange={(e) => m.setStraight(e.target.checked)}
            />
            <span>{tmarText("Straight lines")}</span>
            <InfoDot title={tmarText("Straight lines")}>
              <p>{tmarText("Each drag marks one straight line from where you press to where you let go. An outline shows what it will take, and nothing is marked until you let go.")}</p>
              <p>
                {modLabel}{tmarText("-drag does the same without this switch, and with the switch on it draws freehand. The line is straight on the screen and lies on whatever surface is under it.")}</p>
            </InfoDot>
          </label>
        </>
      )}

      <label className="checkrow">
        <input
          type="checkbox"
          data-test="mark-backfaces"
          checked={m.backfaces}
          onChange={(e) => m.setBackfaces(e.target.checked)}
        />
        <span>{tmarText("Mark through the part")}</span>
        <InfoDot title={tmarText("Mark through the part")}>
          <p>{tmarText("Off, only surface you can see is taken: it has to face you, and a window or lasso takes only the surface in front, not what a nearer wall or rib hides behind it. A window dragged over a closed part cannot quietly mark the far wall as well.")}</p>
          <p>{tmarText("On, the gesture goes straight through — useful for taking a whole rib or boss in one sweep, and for a scan whose normals came out inverted.")}</p>
        </InfoDot>
      </label>

      <div className="toolrow">
        <button
          className={m.erase ? 'withicon on' : 'withicon'}
          data-test="mark-erase"
          aria-pressed={m.erase}
          onClick={() => m.setErase(!m.erase)}
          title={tmarText("The gesture takes marking away instead of laying it down — the right button always does, and Alt inverts either way")}
        >
          <Icon name="erase" size={16} />
          {m.erase ? tmarText("Erasing") : tmarText("Erase")}
        </button>
        <button
          className="withicon"
          data-test="mark-invert"
          disabled={m.count === 0}
          onClick={m.invert}
          title={tmarText("Mark everything that is not marked and rub out what is — to take all but a small piece, mark the piece and invert")}
        >
          <Icon name="markInvert" size={16} />{tmarText("Invert")}</button>
        <button data-test="mark-clear" disabled={m.count === 0} onClick={onClear}>{tmarText("Clear marking")}</button>
      </div>

      {showCount && (
        <div className="kv">
          <span className="name">{tmarText("Marked")}</span>
          <b data-test="mark-count">{m.count.toLocaleString('en-US')}{tmarText(" points")}</b>
        </div>
      )}
    </>
  )
}

/**
 * The viewport line for a live marking session: which gesture is live, what the
 * buttons do while it is, and the way back to the camera. Shared for the same
 * reason the controls are — the answer to "why is my drag not orbiting" has to
 * read the same in both workspaces.
 */
export function markChipText(
  gesture: MarkGesture | null,
  count: number,
  /** What the gesture is being asked to take, e.g. "the surface to fit on". */
  target: string,
  /** Where Escape leads from here, idle and with a gesture live. */
  escape: { idle: string; live: string },
  /** The brush's straight-line switch. */
  straight = false,
): string {
  const tally = count === 0 ? '' : tmarText(' · {0} points marked', [count.toLocaleString('en-US')])
  if (gesture === null) {
    return tmarText('Marking off — orbit and pan as usual · pick a tool in the panel to mark{0} · {1}', [tally, tmarText(escape.idle)])
  }
  const verb =
    gesture === 'window'
      ? tmarText('Drag a window over {0}', [tmarText(target)])
      : gesture === 'lasso'
        ? tmarText('Draw a lasso around {0}', [tmarText(target)])
        : straight
          ? tmarText('Drag a straight line over {0} · {1}-drag draws freehand', [tmarText(target), modLabel])
          : tmarText('Drag the brush over {0} · {1}-drag draws a straight line', [tmarText(target), modLabel])
  return tmarText('{0}{1} · right-drag rubs out · Shift-drag orbits · {2}', [verb, tally, tmarText(escape.live)])
}
