// SPDX-License-Identifier: AGPL-3.0-only
// The curvature comb's switch and its two settings — the same row in the 2D
// Measure panel, under the sheet's edges, and in the 3D Measure panel, under
// the sections: one comb, drawn on both. Off when the app opens.

import { COMB_WINDOW_MAX, COMB_WINDOW_MIN } from '../core/flat/curvature'
import { COMB_SCALE_MAX, COMB_SCALE_MIN, useComb } from '../state/combStore'
import { useLength } from '../app/useUnits'
import { InfoDot } from './InfoDot'
import { NumberField } from './NumberField'
import { coreText as tmarText, useLanguage as useTmarLanguage } from '../i18n'

export function CombControls({ where }: { where: 'sheet' | 'part' }) {
  useTmarLanguage()
  const on = useComb((s) => s.on)
  const smoothing = useComb((s) => s.window)
  const scale = useComb((s) => s.scale)
  const { setOn, setWindow, setScale } = useComb.getState()
  const len = useLength()
  return (
    <>
      <label className="checkrow">
        <input type="checkbox" data-test="comb-show" checked={on} onChange={(e) => setOn(e.target.checked)} />
        <span>{tmarText("Curvature comb")}</span>
        <InfoDot title={tmarText("Curvature comb")}>
          <p>{tmarText("Shows how sharply every edge bends: teeth perpendicular to the edge, a line along their tips and a faintly filled area.")}{' '}
            {where === 'sheet'
              ? tmarText("The comb follows sheet edges (sections, detected image edges and shadows), plus every fitted arc, circle and spline, in their own colours.")
              : tmarText("The comb follows sections on the 3D part and the curves fitted on their sheets; 2D Measure shows the same comb with a cursor reading.")}
          </p>
          <p>{tmarText("Straight edges have no teeth. True arcs show equal-height teeth; a non-circular blend grows and shrinks. Teeth begin where flat turns into round and switch sides when curvature changes sign.")}</p>
          <p>{tmarText("Scanned and detected edges are smoothed over the Smoothing length; larger values suppress noise and smaller values reveal smaller rounds. The true radius is preserved for sufficiently long arcs. Fitted curves and shadows are exact.")}</p>
          <p>{tmarText("Length scales the teeth. Teeth too long to draw at sharp corners are shortened and faded.")}</p>
        </InfoDot>
      </label>
      {on && (
        <>
          <input
            className="slider"
            type="range"
            data-test="comb-window-slider"
            aria-label={tmarText("Smoothing")}
            min={Math.log10(COMB_WINDOW_MIN)}
            max={Math.log10(COMB_WINDOW_MAX)}
            step={0.01}
            // Logarithmic: a fine scan's 0.3 mm and a rough one's 10 mm both
            // want room on it.
            value={Math.log10(smoothing)}
            onChange={(e) => setWindow(len.fromDisplay(Number(len.toDisplay(10 ** Number(e.target.value)).toPrecision(2))))}
          />
          <NumberField
            label={tmarText("Smoothing")}
            testId="comb-window"
            value={smoothing}
            step={0.1}
            min={COMB_WINDOW_MIN}
            kind="length"
            onCommit={setWindow}
            hint={tmarText("How long a scanned or detected edge is smoothed for each reading. Fitted curves are exact and are not smoothed.")}
          />
          <label className="field">
            <span>{tmarText("Length")}</span>
            <input
              type="range"
              data-test="comb-scale"
              min={Math.log2(COMB_SCALE_MIN)}
              max={Math.log2(COMB_SCALE_MAX)}
              step={0.05}
              value={Math.log2(scale)}
              onChange={(e) => setScale(Number((2 ** Number(e.target.value)).toPrecision(2)))}
              title={tmarText("Teeth are {0} times their natural drawn length", [scale.toPrecision(2)])}
            />
          </label>
        </>
      )}
    </>
  )
}
