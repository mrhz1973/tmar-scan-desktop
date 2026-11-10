// SPDX-License-Identifier: AGPL-3.0-only
// The Revolve box: the profiles picked, the axis, the angle or a coil's
// pitch and turns, the body operation, with the preview and the live map.

import { WORLD_AXES } from '../../../src/core/section/frame'
import { useStore } from '../../../src/state/store'
import { Icon } from '../../../src/ui/icons'
import { InfoDot } from '../../../src/ui/InfoDot'
import { RefPicker } from '../../../src/ui/RefPicker'
import { NameField } from '../../../src/ui/RefSelect'
import type { AxisRef, SketchFeature } from '../core/features'
import { revolveAngle, revolveDraftReady, useReverse } from '../state/reStore'
import { AnalysisRow, BuildSays, Num, OpFields, PreviewLine, ProfilesField, useRegionCount } from './featureFields'
import { reverseText as tmarText, useLanguage as useTmarLanguage } from '../../../src/i18n'


export function RevolveEditor() {
  useTmarLanguage()

  const draft = useReverse((s) => s.revolveDraft)
  const features = useReverse((s) => s.features)
  const bodies = useReverse((s) => s.bodies)
  const preview = useReverse((s) => s.preview)
  const elements = useStore((s) => s.elements)
  const re = useReverse
  const sketches = features.filter((f): f is SketchFeature => f.kind === 'sketch')
  const sketch = sketches.find((s) => s.id === draft?.sketchId)
  const found = useRegionCount(sketch)
  if (!draft) return null
  const set = (patch: Partial<NonNullable<typeof draft>>) => re.getState().setRevolve(patch)
  const targets = bodies.filter((b) => b.id !== draft.featureId && !b.surface)
  const axisOptions: { key: string; label: string; ref: AxisRef }[] = [
    ...(sketch ? sketch.sketch.entities.filter((e) => e.kind === 'line').map((e) => ({ key: `sketch:${e.id}`, label: tmarText("{0} line {1}{2}", [sketch.name, e.id, e.construction ? tmarText(" (construction)") : ""]), ref: { kind: 'sketchLine', entity: e.id } as AxisRef })) : []),
    ...elements
      .filter((e) => e.fit && (e.fit.kind === 'line' || e.fit.kind === 'cylinder' || e.fit.kind === 'cone' || e.fit.kind === 'circle'))
      .map((e) => ({ key: `element:${e.id}`, label: e.name, ref: { kind: 'element', id: e.id } as AxisRef })),
    ...WORLD_AXES.map((axis) => ({ key: `world:${axis}`, label: tmarText("{0} axis", [axis.toUpperCase()]), ref: { kind: 'world', axis } as AxisRef })),
  ]
  const axisKey = draft.axis ? (draft.axis.kind === 'sketchLine' ? `sketch:${draft.axis.entity}` : draft.axis.kind === 'element' ? `element:${draft.axis.id}` : `world:${draft.axis.axis}`) : ''
  const ready = revolveDraftReady(draft)
  const coil = draft.pitch !== 0
  // The hovered axis shows on the part as a line across it; with nothing
  // hovered, the chosen one does.
  const hintAxis = (key: string | null) => {
    const o = (key ? axisOptions.find((x) => x.key === key) : undefined) ?? (axisKey ? axisOptions.find((x) => x.key === axisKey) : undefined)
    re.getState().setHint(o ? { kind: 'axis', ref: o.ref, sketchId: draft.sketchId, name: o.label } : null)
  }
  return (
    <div className="draftbox" data-test="revolve-editor">
      <div className="sec-head">{draft.featureId !== undefined ? tmarText("Edit {0}", [draft.name]) : coil ? tmarText("New coil") : tmarText("New revolve")}</div>
      {draft.featureId !== undefined && <NameField value={draft.name ?? ''} testId="revolve-name" onChange={(name) => set({ name })} />}
      <BuildSays featureId={draft.featureId} />
      <label className="field">
        <span>{tmarText("Sketch")}</span>
        <select data-test="revolve-sketch" value={draft.sketchId ?? ''} onChange={(e) => set({ sketchId: e.target.value === '' ? null : Number(e.target.value), axis: null })}>
          <option value="">{tmarText("Select…")}</option>
          {sketches.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <ProfilesField picked={draft.regions.length} found={found} testPrefix="revolve" />
      <label className="field">
        <span>{tmarText("Axis")}<InfoDot title={tmarText("Axis")}>
            <p>{tmarText("Click a line of the sketch on the part, or a line, cylinder, cone or circle element, or choose here. A construction line drawn down the middle of the profile is the usual axis.")}</p>
          </InfoDot>
        </span>
        <RefPicker
          value={axisKey || null}
          options={axisOptions.map((o) => ({ key: o.key, label: o.label, group: o.key.startsWith('sketch:') ? 'Sketch lines' : o.key.startsWith('element:') ? 'Elements' : 'Coordinate axes' }))}
          placeholder={tmarText("Click in the viewport, or choose…")}
          testId="revolve-axis"
          onChange={(key) => {
            const o = axisOptions.find((x) => x.key === key)
            set({ axis: o?.ref ?? null })
            if (o) re.getState().setHint({ kind: 'axis', ref: o.ref, sketchId: draft.sketchId, name: o.label })
          }}
          onHover={hintAxis}
        />
      </label>
      <PreviewLine preview={draft.axis === null ? { status: 'idle' } : preview} testPrefix="revolve" />
      <AnalysisRow testPrefix="revolve" />
      <label className="checkrow">
        <input type="checkbox" data-test="revolve-coil" checked={coil} onChange={(e) => re.getState().setRevolveCoil(e.target.checked)} />
        <span>{tmarText("Coil — climb along the axis")}<InfoDot title={tmarText("Coil")}>
            <p>{tmarText("The profile turns about the axis and climbs along it by the pitch every turn: a spring, a thread, a worm. The angle runs on past 360° — as many turns as you like; type them as turns or as a height, or wind the ring round and round.")}</p>
            <p>{tmarText("The profile has to reach less far along the axis than the pitch, or each turn would run into the next. For a thread, draw the groove's section on a plane through the bar's axis, reaching a little past the bar, and set Result to Cut.")}</p>
          </InfoDot>
        </span>
      </label>
      <Num
        label={tmarText("Angle")}
        unit="°"
        testId="revolve-angle" slot="angleDeg"
        value={draft.angleDeg}
        nominal="angle"
        onCommit={(v) => set({ angleDeg: revolveAngle(v, draft.pitch) })}
        hint={coil ? tmarText("Degrees turned — any number of turns: 1080° is three. The ring about the axis drags it, round and round.") : tmarText("360° for a whole body of revolution — a full turn at most; tick Coil to turn on past it. The ring about the axis drags it.")}
      />
      {coil && (
        <>
          <Num
            label={tmarText("Pitch")}
            testId="revolve-pitch" slot="pitch"
            value={draft.pitch}
            onCommit={(v) => {
              if (v !== 0) set({ pitch: v })
            }}
            hint={tmarText("How far the profile climbs along the axis each turn — a thread's pitch, a spring's from one coil to the next. Negative climbs the other way along the axis, which Reverse direction does too.")}
          />
          <Num label={tmarText("Turns")} unit="turns" testId="revolve-turns" slot="turns" value={Math.round((draft.angleDeg / 360) * 1e4) / 1e4} onCommit={(v) => set({ angleDeg: revolveAngle(v * 360, draft.pitch) })} hint={tmarText("How many times the profile goes round — the angle over 360°. A fraction is fine.")} />
          <Num label={tmarText("Height")} testId="revolve-height" slot="height" value={Math.round(Math.abs(draft.pitch) * (draft.angleDeg / 360) * 1e4) / 1e4} onCommit={(v) => set({ angleDeg: revolveAngle((Math.abs(v) / Math.abs(draft.pitch)) * 360, draft.pitch) })} hint={tmarText("How far the profile climbs along the axis from start to end — the turns times the pitch. Typed, it sets the turns.")} />
          <label className="checkrow">
            <input type="checkbox" data-test="revolve-left" checked={draft.leftHanded} onChange={(e) => set({ leftHanded: e.target.checked })} />
            <span>{tmarText("Left-handed")}</span>
          </label>
          <div className="toolrow">
            <button className="withicon" data-test="revolve-flip" title={tmarText("Climb the other way along the axis — the hand stays as it is")} onClick={() => set({ pitch: -draft.pitch })}>
              <Icon name="flip" size={16} />{tmarText("Reverse direction")}</button>
          </div>
        </>
      )}
      <OpFields op={draft.op} canCut={targets.length > 0} testPrefix="revolve" onOp={(op) => set({ op })} />
      <button className="primary block" data-test="revolve-create" disabled={!ready} title={tmarText("Enter or a middle click does the same")} onClick={() => { re.getState().setHint(null); re.getState().commitRevolve() }}>
        {draft.featureId !== undefined ? tmarText("Save changes") : coil ? tmarText("Create coil") : tmarText("Create revolve")}
      </button>
      <div className="toolrow">
        <button data-test="revolve-cancel" onClick={() => { re.getState().setHint(null); re.getState().cancelRevolve() }}>{tmarText("Cancel")}</button>
      </div>
    </div>
  )
}
