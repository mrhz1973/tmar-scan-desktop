// SPDX-License-Identifier: AGPL-3.0-only
// Aligning the element being made to a reference plane — a coordinate plane,
// a plane element or a section: which plane, how it relates to it, and how
// far the measurement was from that relation — with a warning once it is
// further off than an aligned feature ought to be.

import { InfoDot } from './InfoDot'
import { RefSelect } from './RefSelect'
import { BASE_PLANES, basePlaneOf } from '../core/basePlanes'
import { blockedRefs, orientedDraft, useStore } from '../state/store'
import { dimensionRefsOf } from '../state/sectionModel'
import {
  ORIENT_TOLERANCE_DEG,
  relationLabel,
  type OrientRelation,
  type OrientableFit,
} from '../core/elements/orient'
import { coreText as tmarText, useLanguage as useTmarLanguage } from '../i18n'


export function OrientFields({ fit }: { fit: OrientableFit }) {
  useTmarLanguage()

  const draft = useStore((s) => s.draft)
  const elements = useStore((s) => s.elements)
  const sections = useStore((s) => s.sections)
  const aligned = useStore((s) => s.appliedAlignment !== null)
  const setDraftOrientRef = useStore((s) => s.setDraftOrientRef)
  const setDraftOrientRelation = useStore((s) => s.setDraftOrientRelation)
  if (!draft) return null

  // The coordinate planes, then any plane that does not build on the
  // element being edited, then the sections.
  const blocked = blockedRefs(draft.editId, elements)
  const pool = dimensionRefsOf(elements, sections)
  const planes = pool.filter((e) => e.kind === 'plane' && e.fit && !blocked.has(e.id))

  const orient = draft.orient
  const { deviationDeg, warning } = orientedDraft({ fit, orient }, pool)
  const planar = fit.kind === 'plane' || fit.kind === 'circle'
  const onBasePlane = orient !== undefined && basePlaneOf(orient.ref) !== undefined

  return (
    <div className="extend">
      <div className="g-label">
        <span>{tmarText("Align")}<InfoDot title={tmarText("Aligning to a reference plane")}>
            <p>{tmarText("Turn the element onto its ")}<b>{tmarText("designed")}</b>{tmarText(" relation with a reference plane instead of keeping the direction the fit found: a face parallel to the base, a bore perpendicular to it, an axis running along it. The element keeps its measured position and size and pivots about its own centre by the smallest rotation that gets it there.")}</p>
            <p>{tmarText("The reference is one of the ")}<b>{tmarText("coordinate planes")}</b>{tmarText(", a measured plane or a section, as the plane it was cut on. On a part that has been aligned — Auto-align or Align part, in the Alignment group — the coordinate planes are the part’s own, so a bore perpendicular to the XY plane stands square to the part’s base. Align the part again and the alignment goes along: to whichever coordinate plane its old one was turned onto — the XZ plane once the part is stood on its side — or, turned onto none, it comes off.")}</p>
            <p>{tmarText("Unlike an extension, this does change the element: its normal or axis, every dimension taken from it and what CAD receives. Sigma and form error stay the measurement's, and the unaligned fit is kept so the alignment follows the reference plane if that is ever edited or re-fitted. Deleting a reference plane drops the alignment and the element falls back to its measurement.")}</p>
            <p>{tmarText("The panel reports how far the measurement was from the aligned direction, and warns past ")}{ORIENT_TOLERANCE_DEG}{tmarText("°: a scanned feature that was made square comes out well under a degree off, so more than that usually means the wrong reference, the wrong relation — or a feature that was never designed square.")}</p>
          </InfoDot>
        </span>
        {orient && (
          <span data-test="orient-deviation">{tmarText("measured ")}{deviationDeg.toFixed(2)}{tmarText("° off")}</span>
        )}
      </div>
      <RefSelect
        label={tmarText("Reference")}
        options={[...BASE_PLANES, ...planes]}
        value={orient?.ref ?? null}
        testId="orient-ref"
        placeholder={tmarText("None — as measured")}
        onChange={(id) => setDraftOrientRef(id)}
      />
      {orient && (
        <label className="field">
          <span>{planar ? tmarText("Plane is") : tmarText("Axis is")}</span>
          <select
            data-test="orient-relation"
            value={orient.relation}
            onChange={(e) => setDraftOrientRelation(e.target.value as OrientRelation)}
          >
            {(['normal', 'inPlane'] as OrientRelation[]).map((r) => (
              <option key={r} value={r}>
                {tmarText(relationLabel(fit.kind, r))}
              </option>
            ))}
          </select>
        </label>
      )}
      {onBasePlane && !aligned && (
        <p className="hint" data-test="orient-unaligned">{tmarText("The part has not been aligned, so the coordinate planes are the scan’s own — right if it was exported square, arbitrary if it came straight off the scanner. Auto-align sets them from the part.")}</p>
      )}
      {orient && warning !== null && (
        <p className="warnnote" data-test="orient-warning">
          ⚠ {tmarText(warning)}
        </p>
      )}
    </div>
  )
}
