// SPDX-License-Identifier: AGPL-3.0-only
// The Extrude box: the profiles picked, the extent from and to the sketch's
// plane or a face, the taper, the direction and the body operation, with
// the preview and the live map.

import { useLength } from '../../../src/app/useUnits'
import { Icon } from '../../../src/ui/icons'
import { InfoDot } from '../../../src/ui/InfoDot'
import { NameField } from '../../../src/ui/RefSelect'
import type { FaceRef, PlaneRef, SketchFeature } from '../core/features'
import { MAX_TAPER_DEG } from '../core/preview'
import { describeFaceIn } from '../core/topo'
import { extrudeDraftReady, useReverse } from '../state/reStore'
import { DirectionField } from './DirectionField'
import { AnalysisRow, BuildSays, Num, OpFields, PreviewLine, ProfilesField, useRegionCount } from './featureFields'
import { PlaneSelect } from './PlaneSelect'
import { useEffect, useRef } from 'react'
import { reverseText as tmarText, useLanguage as useTmarLanguage } from '../../../src/i18n'


export function ExtrudeEditor() {
  useTmarLanguage()

  const draft = useReverse((s) => s.extrudeDraft)
  const features = useReverse((s) => s.features)
  const bodies = useReverse((s) => s.bodies)
  const preview = useReverse((s) => s.preview)
  const len = useLength()
  const describeFace = describeFaceIn(len.units)
  const re = useReverse
  const sketches = features.filter((f): f is SketchFeature => f.kind === 'sketch')
  const sketch = sketches.find((s) => s.id === draft?.sketchId)
  const found = useRegionCount(sketch)
  const box = useRef<HTMLDivElement | null>(null)
  const open = draft !== null
  const picked = draft?.regions.length ?? 0
  // To takes the keys as the box opens, its number selected to be typed
  // over, and again once a profile is picked on the part — never from
  // another field the operator is in.
  useEffect(() => {
    if (!open) return
    const active = document.activeElement
    if (active instanceof HTMLElement && (active.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(active.tagName))) return
    const to = box.current?.querySelector<HTMLInputElement>('input[data-test="extrude-to"]')
    to?.focus()
    to?.select()
  }, [open, draft?.featureId, picked])
  if (!draft) return null
  const set = (patch: Partial<NonNullable<typeof draft>>) => re.getState().setExtrude(patch)
  const create = () => {
    re.getState().setHint(null)
    re.getState().commitExtrude()
  }
  const extent = draft.extent
  // The distance an extent switched to starts at: 10 mm, or half an inch.
  const start = len.fromDisplay(len.step(10))
  // A join or a cut needs a body made before this feature — a solid one: a
  // sheet or a fitted surface has no inside to add to or take from.
  const targets = bodies.filter((b) => b.id !== draft.featureId && !b.surface)
  const ready = extrudeDraftReady(draft)
  return (
    <div className="draftbox" data-test="extrude-editor" ref={box}>
      <div className="sec-head">{draft.featureId !== undefined ? tmarText("Edit {0}", [draft.name]) : tmarText("New extrude")}</div>
      {draft.featureId !== undefined && <NameField value={draft.name ?? ''} testId="extrude-name" onChange={(name) => set({ name })} />}
      <BuildSays featureId={draft.featureId} />
      {draft.face ? (
        <div className="field">
          <span>{tmarText("Profile")}<InfoDot title={tmarText("A face pulled")}>
              <p>{tmarText("The face itself is the profile: it is found again on the body whenever this extrude is built, and pulled as it stands then — an earlier feature that reshapes the face reshapes what is pulled from it. Nothing is copied into a sketch.")}</p>
            </InfoDot>
          </span>
          <span className="picked" data-test="extrude-face-profile">
            {tmarText(describeFace(draft.face.face))}{tmarText(" of ")}{bodies.find((b) => b.id === draft.face!.body)?.name ?? features.find((f) => f.id === draft.face!.body)?.name ?? (tmarText("the body"))}
          </span>
        </div>
      ) : (
        <>
          <label className="field">
            <span>{tmarText("Sketch")}</span>
            <select data-test="extrude-sketch" value={draft.sketchId ?? ''} onChange={(e) => set({ sketchId: e.target.value === '' ? null : Number(e.target.value) })}>
              <option value="">{tmarText("Select…")}</option>
              {sketches.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <ProfilesField picked={draft.regions.length} found={found} testPrefix="extrude" />
        </>
      )}
      <PreviewLine preview={preview} testPrefix="extrude" />
      <AnalysisRow testPrefix="extrude" />
      <label className="field">
        <span>{tmarText("Extent")}</span>
        <select
          data-test="extrude-extent"
          value={extent.kind}
          onChange={(e) => {
            const kind = e.target.value as typeof extent.kind
            set({
              extent:
                kind === 'distance'
                  ? { kind, from: 0, to: start }
                  : kind === 'symmetric'
                    ? { kind, total: start }
                    : kind === 'toPlane'
                      ? { kind, from: 0, plane: null as unknown as PlaneRef }
                      : kind === 'toFace'
                        ? { kind, from: 0, body: -1, face: null as unknown as FaceRef }
                        : kind === 'toBody'
                          ? { kind, from: 0, body: -1 }
                          : kind === 'toNext' || kind === 'toLast'
                          ? { kind, from: 0 }
                          : { kind: 'betweenPlanes', a: null as unknown as PlaneRef, b: null as unknown as PlaneRef },
            })
          }}
        >
          <option value="distance">{tmarText("Distance")}</option>
          <option value="toPlane">{tmarText("To a plane")}</option>
          <option value="toFace">{tmarText("To a face of a body")}</option>
          <option value="toBody">{tmarText("To a body")}</option>
          <option value="toNext">{tmarText("To next")}</option>
          <option value="toLast">{tmarText("To last / through all")}</option>
          <option value="betweenPlanes">{tmarText("Between two planes")}</option>
          <option value="symmetric">{tmarText("Symmetric")}</option>
        </select>
      </label>
      <div className="toolrow">
        <button
          className="withicon"
          data-test="extrude-flip"
          disabled={extent.kind !== 'distance' && extent.kind !== 'toNext' && extent.kind !== 'toLast' && extent.kind !== 'toBody'}
          title={
            extent.kind === 'distance' ? tmarText("Extrude the other way along the sketch plane’s normal — From and To change sign, and the ghost turns over") : extent.kind === 'toNext' || extent.kind === 'toLast' || extent.kind === 'toBody' ? tmarText("Look for the body the other way along the sketch plane’s normal") : extent.kind === 'symmetric' ? tmarText("A symmetric extrude has no direction to reverse") : tmarText("An extrude limited by a plane reaches the way the plane lies")
          }
          onClick={() => re.getState().flipExtrude()}
        >
          <Icon name="flip" size={16} />{tmarText("Reverse direction")}</button>
      </div>
      {extent.kind === 'distance' && (
        <>
          <Num label={tmarText("To")} testId="extrude-to" slot="extent.to" value={extent.to} nominal="length" passKeys={{ enter: create }} onCommit={(v) => set({ extent: { ...extent, to: v } })} hint={tmarText("How far along the sketch plane's normal the body ends — in front of the plane. The arrow on that face drags it; a click on the part in front of the plane sets it.")} />
          <Num label={tmarText("From")} testId="extrude-from" slot="extent.from" value={extent.from} nominal="length" onCommit={(v) => set({ extent: { ...extent, from: v } })} hint={tmarText("How far along the normal the body starts — 0 is the plane itself, negative is behind it. The arrow on that face drags it; a click on the part behind the plane sets it.")} />
          <p className="hint" data-test="extrude-pick-hint">{tmarText("Or click the part: in front of the plane sets To, behind it From.")}<InfoDot title={tmarText("Up to a point on the part")}>
              <p>{tmarText("Click the scan, a body or a body's corner in the viewport: a point in front of the sketch plane puts ")}<b>{tmarText("To")}</b>{tmarText(" at its height over the plane, a point behind it puts ")}<b>{tmarText("From")}</b>{tmarText(" there. A click on the part's top and one on its bottom make the body that spans them, in either order. For a part lying wholly behind the plane, put To at 0 by hand — a click behind the plane never moves it.")}</p>
              <p>{tmarText("The height is read off the point once and kept as a number, which the field and the arrow go on changing. A sketch region under the cursor still takes the click as a profile — turn the part so the point is clear of it.")}</p>
            </InfoDot>
          </p>
        </>
      )}
      {extent.kind === 'symmetric' && (
        <>
          <Num label={tmarText("Total")} testId="extrude-total" slot="extent.total" value={extent.total} nominal="length" onCommit={(v) => set({ extent: { ...extent, total: v } })} hint={tmarText("The whole thickness, half on each side of the sketch plane; either arrow drags it")} />
          <p className="hint" data-test="extrude-pick-hint">{tmarText("Or click a point on the part: each half reaches it.")}</p>
        </>
      )}
      {extent.kind === 'toPlane' && (
        <>
          <Num label={tmarText("From")} testId="extrude-from" slot="extent.from" value={extent.from} nominal="length" onCommit={(v) => set({ extent: { ...extent, from: v } })} hint={tmarText("How far along the normal the body starts")} />
          <label className="field">
            <span>{tmarText("Up to")}</span>
            <PlaneSelect value={extent.plane} testId="extrude-plane" placeholder={tmarText("Choose the plane…")} onChange={(plane) => set({ extent: { ...extent, plane } })} />
          </label>
        </>
      )}
      {extent.kind === 'toFace' && (
        <>
          <Num label={tmarText("From")} testId="extrude-from" slot="extent.from" value={extent.from} nominal="length" onCommit={(v) => set({ extent: { ...extent, from: v } })} hint={tmarText("How far along the normal the body starts")} />
          <div className="field">
            <span>{tmarText("Up to")}</span>
            <span className="picked" data-test="extrude-to-face">
              {extent.face ? describeFace(extent.face) : tmarText("Click a face of a body")}
            </span>
          </div>
        </>
      )}
      {extent.kind === 'toBody' && (
        <>
          <Num label={tmarText("From")} testId="extrude-from" slot="extent.from" value={extent.from} nominal="length" onCommit={(v) => set({ extent: { ...extent, from: v } })} hint={tmarText("How far along the normal the body starts")} />
          <label className="field">
            <span>{tmarText("Up to")}</span>
            <select data-test="extrude-to-body" value={extent.body >= 0 ? extent.body : ''} onChange={(e) => set({ extent: { ...extent, body: e.target.value === '' ? -1 : Number(e.target.value) } })}>
              <option value="">{tmarText("Choose the body…")}</option>
              {bodies
                .filter((b) => b.id !== draft.featureId)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </select>
          </label>
          <p className="hint" data-test="extrude-until">{tmarText("Runs until the profile meets the body’s surface — a solid’s skin or a sheet — the way the body lies; the body has to lie under the whole profile.")}</p>
        </>
      )}
      {(extent.kind === 'toNext' || extent.kind === 'toLast') && (
        <>
          <Num label={tmarText("From")} testId="extrude-from" slot="extent.from" value={extent.from} nominal="length" onCommit={(v) => set({ extent: { ...extent, from: v } })} hint={tmarText("How far along the normal the body starts")} />
          <p className="hint" data-test="extrude-until">
            {extent.kind === 'toNext' ? draft.op === 'cut' ? tmarText("Cuts through the first wall of the body the profile meets, and stops where it comes out.") : tmarText("Runs until the profile meets the body — the whole profile has to land on it. Reverse direction looks the other way.") : draft.op === 'cut' ? tmarText("Cuts through all of the body that way.") : tmarText("Runs to the far end of the body that way.")}
            {draft.op === 'new' && (tmarText(" Measured against every body there is."))}
          </p>
        </>
      )}
      {extent.kind === 'betweenPlanes' && (
        <>
          <label className="field">
            <span>{tmarText("From plane")}</span>
            <PlaneSelect value={extent.a} testId="extrude-plane-a" placeholder={tmarText("Choose the plane…")} onChange={(a) => set({ extent: { ...extent, a } })} />
          </label>
          <label className="field">
            <span>{tmarText("To plane")}</span>
            <PlaneSelect value={extent.b} testId="extrude-plane-b" placeholder={tmarText("Choose the plane…")} onChange={(b) => set({ extent: { ...extent, b } })} />
          </label>
        </>
      )}
      {/* Fusion's taper: positive leans the sides out. The feature keeps a
          mould's draft, positive leaning in — the same number turned over. */}
      <Num
        label={tmarText("Taper")}
        unit="°"
        testId="extrude-taper" slot="taper"
        value={draft.draftDeg === 0 ? 0 : -draft.draftDeg}
        nominal="angle"
        onCommit={(v) => set({ draftDeg: v === 0 ? 0 : -Math.max(-MAX_TAPER_DEG, Math.min(MAX_TAPER_DEG, v)) })}
        hint={tmarText("Degrees the sides lean as the extrude goes away from the sketch, as Fusion's taper angle: positive leans them out, negative leans them in — a moulded boss's draft. 0 for straight sides. The sketch's outline stays the section at the sketch plane, or at the end of the extent nearest it, and an extrude reaching both ways leans both ways from there. The arrow on the far edge drags it. A taper that would close the profile before the end is refused, saying where it closes.")}
      />
      <DirectionField direction={draft.direction} normal={draft.face ? draft.face.face.dir : (sketch?.frame.normal ?? null)} onChange={(direction) => set({ direction })} />
      <OpFields op={draft.op} canCut={targets.length > 0} testPrefix="extrude" onOp={(op) => re.getState().setExtrudeOp(op)} />
      <button className="primary block" data-test="extrude-create" disabled={!ready} title={tmarText("Enter or a middle click does the same")} onClick={create}>
        {draft.featureId !== undefined ? tmarText("Save changes") : tmarText("Create extrude")}
      </button>
      <div className="toolrow">
        <button data-test="extrude-cancel" onClick={() => { re.getState().setHint(null); re.getState().cancelExtrude() }}>{tmarText("Cancel")}</button>
      </div>
    </div>
  )
}
