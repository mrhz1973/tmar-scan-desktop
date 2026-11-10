// SPDX-License-Identifier: AGPL-3.0-only
// The fields the Reverse engineer panel's boxes are built from: a number
// that takes an expression, a point as three numbers, the profiles picked,
// the body operation, the preview's line and the live map's row, and the
// key that brings a STEP file in.

import { useLength } from '../../../src/app/useUnits'
import type { Vec3 } from '../../../src/core/types'
import { useStore } from '../../../src/state/store'
import { InfoDot } from '../../../src/ui/InfoDot'
import { NumberField } from '../../../src/ui/NumberField'
import { relationWords } from '../core/autoConstrain'
import type { FeatureResult } from '../core/buildTypes'
import type { ParameterKind } from '../core/expression'
import type { SketchFeature, StepFileRef } from '../core/features'
import { LIVE_MAP_MIN_RANGE_MM } from '../core/liveMap'
import { type NominalKind, nominalOf, nominalText } from '../core/nominal'
import { MOVE_AXIS_COLORS } from '../core/preview'
import { findRegions } from '../core/regions'
import { HAIR_MM } from '../core/stepsBetween'
import { stepLines } from '../core/stepWords'
import { useRePrefs } from '../state/rePrefs'
import { type PreviewInfo, useReverse } from '../state/reStore'
import { ExprInput } from './ExprInput'
import { lenBare, lenShort } from './reLength'
import { type ReactNode, useMemo, useRef } from 'react'
import { reverseText as tmarText, useLanguage as useTmarLanguage } from '../../../src/i18n'


/** The key beside a picker's count that lets every pick go, to pick
 *  again from nothing — a click on a picked face or edge lets that one go. */
/** A key that opens a STEP file: read as text — a STEP file is one —
 *  kept in the store once, and handed on as the reference an Import holds
 *  it by. A file that does not begin as a STEP file is refused by name. */
export function StepFileKey({ testId, title, disabled, onFile, children }: { testId: string; title: string; disabled?: boolean; onFile: (file: StepFileRef) => void; children: ReactNode }) {
  useTmarLanguage()

  const input = useRef<HTMLInputElement | null>(null)
  const take = async (file: File | undefined) => {
    if (!file) return
    const text = await file.text()
    if (!/^\s*ISO-10303-21\s*;/.test(text.slice(0, 256))) {
      useStore.getState().setError(`${file.name} is not a STEP file — it does not begin as one (ISO-10303-21).`)
      return
    }
    onFile(useReverse.getState().addStepFile(file.name, text))
  }
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".step,.stp"
        hidden
        data-test={`${testId}-file`}
        onChange={(e) => {
          void take(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <button data-test={testId} disabled={disabled} title={tmarText(title)} onClick={() => input.current?.click()}>
        {children}
      </button>
    </>
  )
}

/** Three numbers along X, Y and Z in one row — a Move's distances or its
 *  angles — each an expression over the parameters kept under its own slot
 *  (`translate.x`), its field edged in its axis's colour as the gizmo's
 *  arrow and ring are. */
export function XyzField({ label, unit, kind, slot, value, testId, hint, onCommit }: { label: string; unit?: string; kind: ParameterKind; slot: string; value: Vec3; testId: string; hint: string; onCommit: (axis: number, v: number) => void }) {
  useTmarLanguage()

  const exprs = useReverse((s) => s.featureDraft?.exprs)
  const len = useLength()
  // A length's label carries the display unit's word; its fields take it.
  const word = kind === 'length' ? len.word() : (unit ?? '')
  return (
    <div className="field">
      <span>
        {tmarText(label)}, {tmarText(word)}
        <InfoDot title={tmarText(label)}>
          <p>{tmarText(hint)}</p>
        </InfoDot>
      </span>
      <span className="re-xyz re-axes">
        {[0, 1, 2].map((i) => {
          const path = `${slot}.${'xyz'[i]}`
          return (
            <span key={i} className="re-axis" style={{ borderColor: MOVE_AXIS_COLORS[i] }} title={tmarText('XYZ'[i])}>
              <ExprInput
                value={value[i]}
                expr={exprs?.[path]}
                kind={kind}
                unit=""
                places={kind === 'angle' ? 2 : 3}
                testId={`${testId}-${'xyz'[i]}`}
                onCommit={(v, e) => {
                  onCommit(i, v)
                  useReverse.getState().setDraftExpr(path, e)
                }}
              />
            </span>
          )
        })}
      </span>
    </div>
  )
}

export function ClearPicks({ kind }: { kind: string }) {
  useTmarLanguage()

  return (
    <button className="clearpicks" data-test={`${kind}-clear-picks`} title={tmarText("Let every picked one go and pick again")} onClick={() => useReverse.getState().clearDraftPicks()}>{tmarText("Clear")}</button>
  )
}

/** The regions of a sketch, found once per sketch object. */
export function useRegionCount(sketch: SketchFeature | undefined): number {
  return useMemo(() => (sketch ? findRegions(sketch.sketch).length : 0), [sketch])
}

/** The profiles row of an extrude or a revolve: how many of the sketch's
 *  regions are picked, the key that takes them all, and the reminder that
 *  the pick is made in the viewport. */
export function ProfilesField({ picked, found, testPrefix }: { picked: number; found: number; testPrefix: string }) {
  useTmarLanguage()

  const re = useReverse
  const all = found > 0 && picked === found
  return (
    <>
      <div className="field">
        <span>{tmarText("Profiles")}<InfoDot title={tmarText("Profiles")}>
            <p>{tmarText("The sketch's closed regions are drawn on the part while this box is open: click one to use it, click it again to let it go. An inner loop left unpicked becomes a hole of the region around it. A sketch with one region has it picked already.")}</p>
          </InfoDot>
        </span>
        <span className="unitfield">
          <b data-test={`${testPrefix}-profiles`} style={{ fontSize: 12 }}>
            {picked}{tmarText(" of ")}{found}{tmarText(" picked")}</b>
          <button data-test={`${testPrefix}-all-regions`} disabled={found === 0} title={all ? tmarText("Let every region go") : tmarText("Use every closed region of the sketch")} onClick={() => re.getState().pickAllDraftRegions()}>
            {all ? tmarText("None") : tmarText("All")}
          </button>
        </span>
      </div>
      {picked === 0 && <p className="hint">{found === 0 ? tmarText("The sketch has no closed region — edit it and close the profile.") : tmarText("Click the sketch's regions in the viewport.")}</p>}
    </>
  )
}

/** What the ghost in the viewport says about the feature so far. */
export function PreviewLine({ preview, testPrefix }: { preview: PreviewInfo; testPrefix: string }) {
  useTmarLanguage()

  const len = useLength()
  const vol = preview.status === 'ok' ? len.vol(preview.volume, 1) : ''
  return (
    <p className={'hint' + (preview.status === 'failed' ? ' warn' : '')} data-test={`${testPrefix}-preview`}>
      {preview.status === 'idle' && ((testPrefix === 'surface' ? tmarText("Click the scan to gather the region; the surface follows.") : testPrefix === 'network' ? tmarText("Click the corners of a patch on the scan; the first again closes it.") : testPrefix === 'move-body' ? tmarText("Drag an arrow or a ring of the gizmo on the part, or type the distances and angles.") : testPrefix === 'import' ? tmarText("Choose the STEP file to bring in.") : tmarText("Pick a profile to see the body.")))}
      {preview.status === 'building' && (
        <>
          <span className="spinner" /> {testPrefix === 'import' ? tmarText("Reading the file…") : tmarText("Building the preview…")}
        </>
      )}
      {preview.status === 'ok' && preview.trim && ((preview.trim.closed ? tmarText("Closed: {0} of the {1} faces the surfaces cut lie on the scan and sew into a solid of {2}.", [preview.trim.kept, preview.trim.faces, vol]) : tmarText("⚠ Not closed: {0} of {1} faces lie on the scan, and they leave {2} open edge{3} — drawn red on the part. Fit the surface that is missing there, or widen the tolerance; Create keeps the faces as a surface body meanwhile.", [preview.trim.kept, preview.trim.faces, preview.trim.openEdges.length, preview.trim.openEdges.length === 1 ? '' : tmarText("s")])))}
      {preview.status === 'ok' && preview.surface?.shape && (
        <span data-test="surface-held">
          {preview.surface.shape === 'plane' ? tmarText("A plane") : tmarText("A cylinder of R {0}", [len.fmt(preview.surface.radius ?? NaN, 3)])}: σ {len.fmt(preview.surface.rms, 3)}{tmarText(" over ")}{preview.surface.points.toLocaleString('en-US')}{tmarText(" points")}{preview.surface.relations && preview.surface.relations.length > 0 ? tmarText(" ({0} before it was held). {1}.", [len.fmt(preview.surface.rmsFree ?? 0, 3), preview.surface.relations.map((r) => `${relationWords(preview.surface!.shape!, r.relation, r.refKind)} ${r.name} — the fit was ${r.relation === 'on' && r.shiftMm !== undefined ? `${len.fmt(r.shiftMm, 2)} and ` : ''}${r.tiltDeg.toFixed(2)}° off`).join('; ')]) : tmarText(". Held to nothing.")}
        </span>
      )}
      {preview.status === 'ok' && preview.surface && !preview.surface.shape && (tmarText("Fitted: σ {0}, the worst point {1} off, a {2} × {3} net over {4} points.", [len.fmt(preview.surface.rms, 3), len.fmt(preview.surface.max, 3), preview.surface.net.u, preview.surface.net.v, preview.surface.points.toLocaleString('en-US')]))}
      {preview.status === 'ok' && preview.sheetFaces !== undefined && (tmarText("A sheet of {0} face{1} — a cutter to split a body with, or a skin to thicken.", [preview.sheetFaces, preview.sheetFaces === 1 ? '' : tmarText("s")]))}
      {preview.status === 'ok' && preview.network && ((preview.failure ? tmarText("⚠ {0}", [tmarText(preview.failure.message)]) : preview.network.closed ? tmarText("A solid of {0}: the network closes.", [vol]) : tmarText("A sheet: the network is open — Trim, Thicken or Split take it as they take a fitted surface.")))}
      {preview.status === 'ok' && !preview.surface && !preview.trim && !preview.network && preview.sheetFaces === undefined && ((testPrefix === 'import' ? tmarText("The file holds {0} of solid{1}.", [vol, preview.closed ? '' : tmarText(", and faces without an inside — a surface body")]) : tmarText("Preview: {0}{1} — drag the grips in the viewport, or type below.", [vol, preview.closed ? '' : tmarText(" · ⚠ not a closed solid{0}", [preview.failure ? tmarText(". {0}", [tmarText(preview.failure.message)]) : ''])])))}
      {preview.status === 'failed' && (tmarText("⚠ {0}", [tmarText(preview.message)]))}
    </p>
  )
}

/** What the last build said was wrong with the feature in the box — why it
 *  failed, or what it built with a warning, the steps a join left a short
 *  line each (their full sentence on hover). Its row only marks it. Held
 *  from when the box opened: the part is built without the feature while
 *  it is open, and its result goes with that build. */
export function BuildSays({ featureId }: { featureId: number | undefined }) {
  useTmarLanguage()

  const live = useReverse((s) => (featureId !== undefined ? s.results[featureId] : undefined))
  const features = useReverse((s) => s.features)
  const len = useLength()
  const held = useRef<{ id: number | undefined; result: FeatureResult | undefined }>({ id: undefined, result: undefined })
  if (held.current.id !== featureId) held.current = { id: featureId, result: live }
  else if (live) held.current.result = live
  const r = held.current.result
  const steps = useMemo(
    () => (r?.status === 'ok' && r.stepsBetween?.length ? stepLines(r.stepsBetween, features, { len: (mm, places) => lenShort(mm, len.units, places), bare: (mm, places) => lenBare(mm, len.units, places) }) : null),
    [r, features, len.units],
  )
  if (!r) return null
  if (r.status === 'failed')
    return (
      <p className="hint warn says" data-test="feature-error">
        ⚠ {tmarText(r.message ?? "Failed to build.")}
      </p>
    )
  const own = steps ? r.ownWarning : r.warning
  if (!own && !steps) return null
  return (
    <div className="says" data-test="feature-says">
      {own && (
        <p className="hint warn" data-test="feature-warning">
          ⚠ {tmarText(own)}
        </p>
      )}
      {steps && (
        <div className="hint warn" data-test="feature-steps">{tmarText("⚠ Steps between features:")}<ul>
            {steps.lines.map((l) => (
              <li key={l.text} title={tmarText(l.full)}>
                {tmarText(l.text)}
              </li>
            ))}
          </ul>
          {steps.more > 0 && <span>{tmarText("And ")}{steps.more}{tmarText(" more")}{steps.hairs > 0 ? tmarText(", {0} under {1}", [steps.hairs === steps.more ? tmarText("all") : steps.hairs, lenShort(HAIR_MM, len.units, 3)]) : ''}.</span>}
        </div>
      )}
    </div>
  )
}

/** The live map's switch and range, in every editor box: the ghost colours
 *  the scan near it by its signed distance on the Deviation ramp, ± the
 *  range, and the row reads how much of that scan lies within it. The
 *  setting is the operator's, kept between sessions. */
export function AnalysisRow({ testPrefix }: { testPrefix: string }) {
  useTmarLanguage()

  const on = useRePrefs((s) => s.liveMap)
  const range = useRePrefs((s) => s.liveMapRange)
  const setOn = useRePrefs((s) => s.setLiveMap)
  const setRange = useRePrefs((s) => s.setLiveMapRange)
  const report = useReverse((s) => s.mapReport)
  const ghost = useReverse((s) => s.preview.status === 'ok')
  const reading = on && ghost && report?.source === 'ghost' ? report : null
  const len = useLength()
  return (
    <div className="analysis" data-test={`${testPrefix}-analysis`}>
      <label className="checkrow">
        <input type="checkbox" data-test="re-analysis-on" checked={on} onChange={(e) => setOn(e.target.checked)} />
        <span>{tmarText("Deviation map")}<InfoDot title={tmarText("Deviation map")}>
            <p>{tmarText("Colours the scan near the ghost by how far it lies from the ghost's surface — green on it, red outside the body, blue inside — on the Deviation ramp at ± this range, and darker past it. The rest of the scan keeps its colour. Drag the grips and watch the feature settle onto the scan.")}</p>
          </InfoDot>
        </span>
      </label>
      {on && <NumberField label={tmarText("Range ±")} value={range} step="any" min={LIVE_MAP_MIN_RANGE_MM} kind="length" onCommit={setRange} testId="re-analysis" />}
      {on && (
        <p className="hint" data-test={`${testPrefix}-map`}>
          {!ghost && (tmarText("The map appears with the ghost."))}
          {ghost && !reading && (tmarText("Reading the scan against the ghost…"))}
          {reading && ((reading.points === 0 ? tmarText("No scan near the ghost.") : tmarText("{0} of {1} scan points near the ghost lie within ±{2} of it.", [reading.within.toLocaleString(), reading.points.toLocaleString(), lenShort(reading.range, len.units, 3)])))}
        </p>
      )}
    </div>
  )
}

/** What a solid feature does with what it makes: joined to every body it
 *  meets — a body of its own where it meets none — cut out of every body it
 *  goes into, or kept a body of its own. No body is chosen: the part says. */
export function OpFields({ op, canCut, testPrefix, onOp }: { op: 'new' | 'join' | 'cut'; canCut: boolean; testPrefix: string; onOp: (op: 'new' | 'join' | 'cut') => void }) {
  useTmarLanguage()

  return (
    <label className="field">
      <span>{tmarText("Result")}</span>
      <select data-test={`${testPrefix}-op`} value={op} onChange={(e) => onOp(e.target.value as 'new' | 'join' | 'cut')}>
        <option value="join" title={tmarText("Made one with every body it touches; a body of its own where it touches none, one body of all where it bridges several")}>{tmarText("Join")}</option>
        <option value="cut" disabled={!canCut} title={tmarText("Taken out of every body it goes into; a body it parts is a body a piece")}>{tmarText("Cut")}</option>
        <option value="new" title={tmarText("A body of its own, whatever it overlaps — a tool to cut the scan with in Mesh Tools")}>{tmarText("New body")}</option>
      </select>
    </label>
  )
}

/** A number committed on blur or Enter, in the panel's unit style — or an
 *  expression over the parameters (ExprInput), kept beside the number
 *  under `slot` (core/parameters.ts slotsOf) and shown in the field with
 *  the value it comes to. Keyed on its value, so a grip dragging the number
 *  in the viewport shows in the box as it goes. With `nominal` the field
 *  offers the round number a dragged value was probably meant as, one
 *  click to take — not while an expression drives it. `kind` is what the
 *  field wants, read off the unit when not given: no unit is a length,
 *  held in millimetres and shown in the display units. */
export function Num({ label, value, unit, testId, nominal, slot, kind, passKeys, onCommit, hint }: { label: string; value: number; unit?: string; testId: string; nominal?: NominalKind; slot?: string; kind?: ParameterKind; passKeys?: { enter: () => void }; onCommit: (v: number) => void; hint?: string }) {
  useTmarLanguage()

  const expr = useReverse((s) => (slot ? (s.extrudeDraft ?? s.revolveDraft ?? s.featureDraft)?.exprs?.[slot] : undefined))
  const units = useLength().units
  const round = nominal && !expr ? nominalOf(value, nominal) : null
  const fieldKind: ParameterKind = kind ?? (nominal === 'angle' || unit === '°' ? 'angle' : unit === undefined ? 'length' : 'number')
  return (
    <label className="field">
      <span>
        {tmarText(label)}
        {hint && (
          <InfoDot title={tmarText(label)}>
            <p>{tmarText(hint)}</p>
          </InfoDot>
        )}
      </span>
      {round !== null && nominal && (
        <button className="chip nominal" data-test={`${testId}-nominal`} tabIndex={-1} title={tmarText("The round number this was probably meant as — click to take it")} onClick={() => onCommit(round)}>
          → {tmarText(nominalText(round, nominal, units))}
        </button>
      )}
      <ExprInput
        value={value}
        expr={expr}
        kind={fieldKind}
        unit={unit}
        testId={testId}
        passKeys={passKeys}
        onCommit={(v, e) => {
          onCommit(v)
          if (slot) useReverse.getState().setDraftExpr(slot, e)
        }}
      />
    </label>
  )
}
