// SPDX-License-Identifier: AGPL-3.0-only
// Trim to scan: a solid trimmed where the scan breaks off, the piece kept
// and handed on.

import { useShallow } from 'zustand/react/shallow'
import { useSolids } from '../../../../src/app/solids'
import { useLength } from '../../../../src/app/useUnits'
import { useMark } from '../../../../src/state/markStore'
import { useStore } from '../../../../src/state/store'
import { InfoDot } from '../../../../src/ui/InfoDot'
import { MarkTools } from '../../../../src/ui/MarkTools'
import { NumberField } from '../../../../src/ui/NumberField'
import { ExportMeshButton } from '../../../../src/ui/ExportMeshButton'
import type { MeshFormat } from '../../../../src/core/exportMesh'
import { booleanSolids, elementSolidsKey } from '../../app/booleanSolids'
import { DEFAULT_BREAK_DEPTH } from '../../core/breakSurface'
import { trimStale, useMeshTools } from '../../state/meshStore'
import { count, typedLen } from '../meshFormat'
import { useState } from 'react'
import { pluginText as tmarText, useLanguage as useTmarLanguage } from '../../../../src/i18n'


export function TrimTool({
  ready,
  busy,
  onTrim,
  onExport,
  onClear,
}: {
  ready: boolean
  busy: boolean
  onTrim: () => void
  onExport: (format: MeshFormat) => void
  onClear: () => void
}) {
  useTmarLanguage()

  // Only what the panel reads: the whole store would render it again on
  // every write to it, the cut preview's while its offset is dragged.
  const m = useMeshTools(
    useShallow((s) => ({
      findTrimBreakAgain: s.findTrimBreakAgain,
      setTrimDepth: s.setTrimDepth,
      setTrimFlip: s.setTrimFlip,
      setTrimOffset: s.setTrimOffset,
      setTrimSolid: s.setTrimSolid,
      trimBreak: s.trimBreak,
      trimBreakError: s.trimBreakError,
      trimDepth: s.trimDepth,
      trimFlip: s.trimFlip,
      trimMade: s.trimMade,
      trimMessage: s.trimMessage,
      trimOffset: s.trimOffset,
      trimSolid: s.trimSolid,
      trimStatus: s.trimStatus,
      trimView: s.trimView,
    })),
  )
  const stale = useMeshTools(trimStale)
  const marked = useMark((s) => s.count)
  const bySource = useSolids((s) => s.bySource)
  // Followed so the list is redrawn when a measured solid comes, goes or
  // changes; read whole below.
  useStore((s) => elementSolidsKey(s.elements))
  // Open from the start when the depth is not what it starts at.
  const [advanced, setAdvanced] = useState(m.trimDepth !== DEFAULT_BREAK_DEPTH)
  const solids = booleanSolids(bySource)
  const solid = solids.find((x) => x.key === m.trimSolid) ?? null
  const made = m.trimMade
  const onPiece = made !== null && m.trimView !== 'break'
  const found = m.trimBreak
  const running = m.trimStatus === 'running'
  const len = useLength()
  const inch = len.units === 'in'
  // What leaves room for glue, in the unit shown.
  const glue = tmarText(inch ? 'a few thousandths' : 'a tenth or two')
  const tooLong = tmarText(inch ? 'an eighth of an inch or so' : 'a few millimetres')

  return (
    <>
      <div className="group" data-test="trim-tool">
        <div className="sec-head">{tmarText("Trim to scan")}<InfoDot title={tmarText("Trimming a body to the scanned break")}>
            <p>{tmarText("For a part with a piece broken off: scan what is left, model the missing piece as a body in the Reverse engineer workspace — to the part's nominal shape, and ")}{tooLong}{tmarText(" too long at the break, so it reaches into the material that is still there — and cut it here with the scanned fracture. What comes back is the piece that fits, to print and glue in. The fracture is far too rough to model; it does not have to be.")}</p>
            <p>{tmarText("Click the body on the part. The ")}<b>{tmarText("break")}</b>{tmarText(" is found where the scan lies deeper inside the body than the ")}<b>{tmarText("depth")}</b>{tmarText(" — the fracture does, the part's own skins only dip into a body modelled a little larger than the part — and marked on the part in teal. Put it right with the marking tools if it caught something else, or mark it by hand; ")}<b>{tmarText("Find again")}</b>{' '}{tmarText("marks it as found.")}</p>
            <p>{tmarText("The break is carried on past the body at its edges, thickened into a thin sheet, and the body cut with it: the side the missing piece is on is kept (")}<b>{tmarText("Keep the other side")}</b>{' '}{tmarText("turns that round). The body's own faces are never cut by anything but the break, so where the model and the part differ a little, a small step at the joint is all it shows.")}</p>
            <p>
              <b>{tmarText("Offset from break")}</b>{tmarText(" sets the piece's mating face back from the fracture: 0 cuts on it,")}{glue}{tmarText(" of ")}{inch ? tmarText("an inch") : tmarText("a millimetre")}{tmarText(" leaves room for glue. The piece is shown over the scan ghosted, its mating face in teal, and is not saved with the project — it is made again with a click.")}</p>
          </InfoDot>
        </div>

        {solids.length > 0 && (
          <div className="boolean-solids" role="radiogroup" aria-label={tmarText("Body to trim")} data-test="trim-solids">
            {solids.map((x) => (
              <label key={x.key} className="checkrow" data-test="trim-solid" data-key={x.key}>
                <input type="radio" name="trim-solid" checked={m.trimSolid === x.key} disabled={busy} onChange={() => m.setTrimSolid(x.key)} />
                <span>
                  {x.name} <i>· {x.source}</i>
                </span>
              </label>
            ))}
          </div>
        )}
        {solids.length === 0 && (
          <p className="hint" data-test="trim-no-solid">{tmarText("Model the missing piece as a body in the Reverse engineer workspace, ")}{tooLong}{tmarText(" longer at the break so it reaches into the part.")}</p>
        )}
        {solids.length > 0 && !solid && (
          <p className="hint" data-test="trim-pick-hint">{tmarText("Click the body on the part — the one modelled to fill what is missing.")}</p>
        )}

        {solid && !onPiece && (
          <>
            {found === null && m.trimBreakError === null && (
              <p className="hint" data-test="trim-finding">
                <span className="spinner" />{tmarText(" Finding the break…")}</p>
            )}
            {found && (
              <p className="hint" data-test="trim-break">{tmarText("The break is marked on the part in teal — ")}{len.area(found.area, 1)}
                {found.pieces > 1 ? tmarText(" in {0} pieces", [count(found.pieces)]) : ''}{tmarText(". Put it right with the marking tools if it caught anything but the fracture.")}</p>
            )}
            {m.trimBreakError && (
              <p className="warnnote" data-test="trim-break-error">
                ⚠ {tmarText(m.trimBreakError)}
              </p>
            )}
            <MarkTools escapeNote="The marking stays until the tool is put away." onClear={onClear} />
            <button
              className="block"
              data-test="trim-find-again"
              disabled={busy}
              onClick={m.findTrimBreakAgain}
              title={tmarText("Mark the break afresh, where the scan lies deeper in the body than the depth — any change made by hand goes")}
            >{tmarText("Find again")}</button>
          </>
        )}

        <NumberField
          label={tmarText("Offset from break")}
          testId="trim-offset"
          value={m.trimOffset}
          step={0.05}
          min={0}
          kind="length"
          disabled={busy}
          onCommit={m.setTrimOffset}
          hint={tmarText("How far the piece's mating face sits back from the fracture. 0 cuts on it; {0} leaves room for glue.", [glue])}
        />

        <label className="checkrow" data-test="trim-flip">
          <input type="checkbox" checked={m.trimFlip} disabled={busy} onChange={(e) => m.setTrimFlip(e.target.checked)} />
          <span>{tmarText("Keep the other side")}</span>
        </label>

        <button
          className="chip"
          data-test="trim-advanced"
          aria-expanded={advanced}
          onClick={() => setAdvanced((on) => !on)}
          title={tmarText("The depth the break is found at")}
        >{tmarText("Advanced")}</button>
        {advanced && (
          <NumberField
            label={tmarText("Depth")}
            testId="trim-depth"
            value={m.trimDepth}
            step={0.05}
            min={0.001}
            kind="length"
            disabled={busy}
            onCommit={m.setTrimDepth}
            hint={tmarText("How much deeper in the body than its surface the scan must lie to be break. More than the part's skins dip into the body — a body modelled {0} larger than the part, and the scanner's scatter on top — and less than the fracture lies anywhere.", [len.fmt(0.2, 1)])}
          />
        )}

        <button
          className="primary block"
          data-test="trim-run"
          data-confirm={1}
          disabled={!ready || busy || !solid || marked === 0}
          onClick={onTrim}
        >
          {running ? (
            <>
              <span className="spinner" />{tmarText("Trimming…")}</>
          ) : solid ? (
            tmarText('Trim {0} to the break', [solid.name])
          ) : (
            tmarText('Trim to the break')
          )}
        </button>
        {m.trimMessage && (
          <p className="alarmtext" data-test="trim-error">
            {tmarText(m.trimMessage)}
          </p>
        )}
      </div>

      {made && (
        <div className="group" data-test="trim-result">
          <div className="dro hero">
            <div className="dro-label">
              <span>{made.name}{tmarText(", trimmed")}</span>
              <span>{made.report.offset > 0 ? tmarText("{0} off the break", [typedLen(made.report.offset, len.units)]) : tmarText("on the break")}</span>
            </div>
            <div className="dro-window" data-test="trim-volume">
              <b>{len.vol(made.report.volume, 1, { bare: true })}</b>
              <span>{len.word(3).toUpperCase()}</span>
            </div>
            <div className="dro-note">{tmarText("of ")}{len.vol(made.report.bodyVolume, 1)}{tmarText(" in the body")}{made.flip ? tmarText(" · the other side") : ''}
            </div>
          </div>
          <div className="kv" data-test="trim-mating">
            <span className="name">{tmarText("Mating face")}</span>
            <b>{len.area(made.report.matingArea, 1)}</b>
          </div>
          {made.report.fit && (
            <div className="kv" data-test="trim-gap">
              <span className="name">{tmarText("Off the part")}<InfoDot title={tmarText("The gap, measured")}>
                  <p>{tmarText("How far the mating face is from the scan, where it lies over the break: at the median, and the range 90 % of it lies in. It is the offset, as near as the scan lets it be — ")}{made.report.slab / 2 === made.report.offset ? '' : tmarText("{0} at an offset of 0, the thinnest the cut can be, and ", [inch ? len.fmt(made.report.slab / 2, 2) : tmarText("a hundredth")])}{tmarText("further off in a groove narrower than twice the offset, which the face bridges, and along the joint's edges, where the break was carried out past the part.")}</p>
                  <p>
                    <b>{tmarText("Gap")}</b>{tmarText(" in the view bar colours the face by it. Least:")}{' '}
                    {len.fmt(made.report.slab / 2 + made.report.fit.min, 3)}{tmarText(", most:")}{' '}
                    {len.fmt(made.report.slab / 2 + made.report.fit.max, 3)}.
                  </p>
                </InfoDot>
              </span>
              <b>
                {len.fmt(made.report.slab / 2 + made.report.fit.median, 3)}
                <span className="dim">
                  {' '}
                  · 90 % {len.fmt(made.report.slab / 2 + made.report.fit.p05, 3, { bare: true })}–{len.fmt(made.report.slab / 2 + made.report.fit.p95, 3, { bare: true })}
                </span>
              </b>
            </div>
          )}
          <div className="kv">
            <span className="name">{tmarText("Break")}</span>
            <b>{len.area(made.report.break.area, 1)}</b>
          </div>
          {made.report.pieces > 1 && (
            <div className="kv">
              <span className="name">{tmarText("Pieces")}</span>
              <b>{count(made.report.pieces)}</b>
            </div>
          )}
          {stale && (
            <p className="hint" data-test="trim-stale">{tmarText("The settings have changed since this was trimmed — trim again to apply them. The export writes the piece on screen.")}</p>
          )}
          <div className="divider" />
          <ExportMeshButton
            block
            testId="export-trimmed-mesh"
            disabled={busy}
            onExport={onExport}
            title={tmarText("Save the piece as an STL or a 3MF where the part now stands — any alignment or move you applied comes with it")}
          />
        </div>
      )}
    </>
  )
}
