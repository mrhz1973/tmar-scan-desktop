// SPDX-License-Identifier: AGPL-3.0-only
// The 2D Measure faceplate: the scanned image, the scale everything else
// rests on, then elements and dimensions in the exact shape of the 3D panel —
// kind buttons, the draft box, the element list with its edit / hide / delete
// keys, the dimension editor and its DRO rows — so an operator who knows one
// workspace is at home in the other. One group per concern, top to bottom in
// the order the work happens.

import { useState } from 'react'
import { toDpi } from '../core/flat/calibration'
import { flatDefaultMethod } from '../core/flat/construct'
import { datumFrame, describeShown, fitInFrame } from '../core/flat/datum'
import { FLAT_KIND_LABELS } from '../core/flat/elements'
import { formatFlatDetail, formatFlatPrimary } from '../core/flat/summary'
import type { FlatElementKind } from '../core/flat/types'
import { IMAGE_ACCEPT, IMAGE_FORMATS } from '../core/formats'
import { describeCut, sectionRefName, tiltOf } from '../core/section/frame'
import {
  flatCountColor,
  flatEditorOpen,
  sheetKeyOf,
  subjectFromKey,
  toolOf,
  useFlat,
} from '../state/flatStore'
import { useStore } from '../state/store'
import { CombControls } from './CombControls'
import { CopyButton } from './CopyButton'
import { ElementRow } from './ElementRow'
import { ShowAllButton } from './ShowAllButton'
import { FlatDimensionSection } from './FlatDimensionSection'
import { FlatDraftEditor } from './FlatDraftEditor'
import { Icon, type IconName } from './icons'
import { InfoDot } from './InfoDot'
import { ModelSlot } from './ModelSlot'
import { NumberField } from './NumberField'
import { useLength } from '../app/useUnits'
import { tintStyle } from './tint'
import { coreText as tmarText, useLanguage as useTmarLanguage } from '../i18n'


const FLAT_KINDS: FlatElementKind[] = ['point', 'line', 'circle', 'arc', 'spline']

/** The picture on each kind's key — line, circle and arc are the sketch's. */
const FLAT_KIND_ICON: Record<FlatElementKind, IconName> = { point: 'elPoint', line: 'line', circle: 'circle', arc: 'arc', spline: 'spline' }

export function FlatPanel({
  onOpenImage,
  onCopy,
  onExportCsv,
  onExportSvg,
  onExportDxf,
}: {
  onOpenImage: (file: File) => void
  onCopy: () => void
  onExportCsv: () => void
  onExportSvg: () => void
  onExportDxf: () => void
}) {
  useTmarLanguage()

  const imageName = useFlat((s) => s.imageName)
  const imageWidth = useFlat((s) => s.imageWidth)
  const imageHeight = useFlat((s) => s.imageHeight)
  const imageBusy = useFlat((s) => s.imageBusy)
  const meta = useFlat((s) => s.metaPxPerMm)
  const pxPerMm = useFlat((s) => s.pxPerMm)
  const calSource = useFlat((s) => s.calSource)
  const splitAxes = useFlat((s) => s.splitAxes)
  const tool = useFlat((s) => s.tool)
  const calibrating = toolOf({ tool }, 'calibrate')
  const profiles = useFlat((s) => s.profiles)
  const edgeStatus = useFlat((s) => s.edgeStatus)
  const edgeCount = useFlat((s) => s.edgeCount)
  const edgeSensitivity = useFlat((s) => s.edgeSensitivity)
  const showEdges = useFlat((s) => s.showEdges)
  const elements = useFlat((s) => s.elements)
  const draft = useFlat((s) => s.draft)
  const unit = useFlat((s) => (s.pxPerMm ? 'mm' : 'px')) // units-ok: the sheet's document unit, an id
  // A sheet in millimetres is read in the units shown.
  const len = useLength()
  const inches = len.units === 'in'
  const datum = useFlat((s) => s.datum)
  const datumPicking = toolOf({ tool }, 'datum')
  const showGrid = useFlat((s) => s.showGrid)
  const turns = useFlat((s) => s.turns)
  const mirror = useFlat((s) => s.mirror)
  const dimensions = useFlat((s) => s.dimensions)
  const dimDraft = useFlat((s) => s.dimDraft)
  const counts = useFlat((s) => s.counts)
  const counting = toolOf({ tool }, 'count')
  const snapToEdge = useFlat((s) => s.snapToEdge)
  const nextCountId = useFlat((s) => s.nextCountId)
  const notes = useFlat((s) => s.notes)
  const noteTool = toolOf({ tool }, 'note')
  const placingNote = noteTool !== null && noteTool.editId === null
  const editingNoteId = noteTool?.editId ?? null
  const editedNote = editingNoteId === null ? undefined : notes.find((n) => n.id === editingNoteId)
  const flat = useFlat
  const frame = datum ? datumFrame(datum, pxPerMm, mirror) : null
  // What is on the sheet: the image, or one of the sections cut in the 3D
  // workspace — which live in that workspace's store, named after the
  // elements they were cut along.
  const subject = useFlat((s) => s.subject)
  const sections = useStore((s) => s.sections)
  const scanElements = useStore((s) => s.elements)
  const scanName = useStore((s) => s.fileName)
  const onSection = subject.kind === 'section'
  const activeSection = onSection ? sections.find((x) => x.id === subject.id) : undefined
  const cutOf = (sec: (typeof sections)[number]) =>
    describeCut(sectionRefName(sec.ref, scanElements), sec.offset, tiltOf(sec.refDir, sec.frame.normal), sec.kind, len.units)
  const hasSheet = onSection || imageName !== null
  // Anything the report and the CSV would have to say.
  const hasMeasurements =
    elements.length > 0 || dimensions.length > 0 || counts.length > 0 || notes.length > 0
  // Anything a drawing of the sheet would show: the edges while they are
  // shown, or an element that is.
  const drawable = (showEdges && edgeStatus === 'ready') || elements.some((e) => e.visible && e.fit !== null)

  // While anything is being assembled the row keys stand down: re-opening a
  // second element or dimension would throw away what is already in the box.
  const editorOpen = flatEditorOpen({ tool, draft, dimDraft })
  const editedCount =
    counting?.editId === undefined ? undefined : counts.find((c) => c.id === counting.editId)
  const countColor = flatCountColor(counting?.editId ?? nextCountId)
  // Elements referenced by the construction or dimension being built —
  // marked in the list the way the 3D panel marks them.
  const selectedIds = new Set(
    [...(dimDraft?.refs ?? []), ...(draft?.refs ?? [])].filter((r): r is number => r !== null),
  )

  // The reference's true size, and what applying against it last said. Local:
  // they belong to the tool being open, not to the workspace.
  const [trueSize, setTrueSize] = useState(100)
  const [calError, setCalError] = useState<string | null>(null)
  const [profileName, setProfileName] = useState('')
  const [chosenProfile, setChosenProfile] = useState('')

  const picks = calibrating?.picks.length ?? 0
  const enough = calibrating
    ? calibrating.mode === 'distance'
      ? picks === 2
      : picks >= 3
    : false

  const apply = () => {
    const error = flat.getState().applyCalibration(trueSize)
    setCalError(error)
  }

  return (
    <aside className="panel">
      <div className="group">
        <div className="sec-head">
          {sections.length > 0 ? tmarText("Source") : tmarText("Image")}
          <InfoDot title={tmarText("What is measured")}>
            <p>{tmarText("A flatbed scan of the part — a ")}<b>{tmarText("PNG")}</b>{tmarText(" or ")}<b>{tmarText("JPEG")}</b>{tmarText(" straight from the scanner. Scan at the highest optical resolution you have; the pixels are the measurement.")}</p>
            <p>{tmarText("Drop it anywhere in the window. Nothing is uploaded.")}</p>
            <p>{tmarText("Or a ")}<b>{tmarText("section")}</b>{tmarText(": the 3D scan cut with a plane in the 3D Measure workspace. Its edges lie on the sheet at true size already, so there is nothing to calibrate, and they are snapped to, fitted and measured exactly like an image's. One source is on the sheet at a time; each keeps its own elements, dimensions and alignment, and finds them again when it comes back.")}</p>
          </InfoDot>
        </div>
        {sections.length > 0 && (
          <label className="field">
            <span>{tmarText("Measure")}</span>
            <select
              data-test="flat-source"
              value={sheetKeyOf(subject)}
              onChange={(e) => flat.getState().setSubject(subjectFromKey(e.target.value))}
            >
              <option value="image">{imageName ? tmarText("Image — {0}", [imageName]) : tmarText("Flatbed image")}</option>
              {sections.map((sec) => (
                <option key={sec.id} value={`section:${sec.id}`}>
                  {sec.name} — {tmarText(cutOf(sec))}
                </option>
              ))}
            </select>
          </label>
        )}
        {!onSection && (
          <ModelSlot
            role="Image"
            name={imageName}
            detail={`${imageWidth.toLocaleString('en-US')} × ${imageHeight.toLocaleString('en-US')} px`}
            dotColor="#8b9099"
            busy={imageBusy}
            accept={IMAGE_ACCEPT}
            formats={IMAGE_FORMATS}
            onOpen={onOpenImage}
          />
        )}
        {!onSection && !imageName && <p className="hint">{tmarText("Drop it anywhere in the window.")}</p>}
        {activeSection && (
          <p className="hint" data-test="flat-section-status">
            <b>{activeSection.name}</b>: {scanName ?? (tmarText("the scan"))}{tmarText(" cut ")}{tmarText(cutOf(activeSection))}{tmarText(". The sheet is at the scan's true size, origin at the cutting plane's centre — set an alignment to read coordinates off a feature.")}</p>
        )}
      </div>

      {imageName && !onSection && (
        <div className="group">
          <div className="sec-head">{tmarText("Calibration")}<InfoDot title={tmarText("Calibration")}>
              <p>{tmarText("Every length this workspace reports is pixels divided by this scale. The file's own dpi is only ")}<b>{tmarText("nominal")}</b>{tmarText(" — scanner transports are off by real fractions of a percent — so measure the scale off something true: scan a gauge block, calliper-measured part or gauge pin along with the part.")}</p>
              <p>
                <b>{tmarText("Known distance")}</b>{tmarText(" takes two picks across the reference and its true length.")}<b>{tmarText(" Known diameter")}</b>{tmarText(" takes three or more picks around a circle's edge and its true diameter.")}</p>
              <p>{tmarText("Scanners err differently along the two axes. Calibrating X and Y separately needs a reference laid along each axis in turn.")}</p>
            </InfoDot>
          </div>

          <p className="hint" data-test="flat-cal-status">
            {calSource === 'measured' && pxPerMm ? pxPerMm.x === pxPerMm.y ? inches ? tmarText("Calibrated: {0} px/in.", [toDpi(pxPerMm.x).toFixed(2)]) : tmarText("Calibrated: {0} px/{1} (≈{2} dpi).", [pxPerMm.x.toFixed(4), len.word(), toDpi(pxPerMm.x).toFixed(1)]) : inches ? tmarText("Calibrated: X {0} · Y {1} px/in.", [toDpi(pxPerMm.x).toFixed(2), toDpi(pxPerMm.y).toFixed(2)]) : tmarText("Calibrated: X {0} · Y {1} px/{2}.", [pxPerMm.x.toFixed(4), pxPerMm.y.toFixed(4), len.word()]) : calSource === 'metadata' && meta ? tmarText("Nominal, from the file: {0} dpi — {1} × {2}.", [(meta.x * 25.4).toFixed(0), len.fmt(imageWidth / meta.x, 1, { bare: true }), len.fmt(imageHeight / meta.y, 1)]) : tmarText("The file declares no physical resolution — sizes are pixels until calibrated.")}
          </p>

          {!calibrating && (
            <>
              <button
                className="block"
                data-test="flat-cal-distance"
                onClick={() => {
                  setCalError(null)
                  flat.getState().startCalibration('distance')
                }}
              >{tmarText("Calibrate on a known distance")}</button>
              <button
                className="block"
                data-test="flat-cal-diameter"
                onClick={() => {
                  setCalError(null)
                  flat.getState().startCalibration('diameter')
                }}
              >{tmarText("Calibrate on a known diameter")}</button>
              <label className="checkrow">
                <input
                  type="checkbox"
                  data-test="flat-cal-split"
                  checked={splitAxes}
                  onChange={(e) => flat.getState().setSplitAxes(e.target.checked)}
                />
                <span>{tmarText("Calibrate X and Y separately")}</span>
              </label>
            </>
          )}

          {calibrating && (
            <>
              <p className="hint" data-test="flat-cal-collecting">
                {calibrating.mode === 'distance' ? picks < 2 ? tmarText("Click the two ends of the reference on the image ({0}/2). Zoom in first — the picks are the measurement.", [picks]) : tmarText("Both ends picked — enter the true distance and apply.") : picks < 3 ? tmarText("Click points around the reference circle's edge ({0}, need 3+).", [picks]) : tmarText("{0} points around the edge — more spread the error. Enter the true diameter and apply.", [picks])}
              </p>
              <NumberField
                label={calibrating.mode === 'distance' ? tmarText("True distance") : tmarText("True diameter")}
                testId="flat-cal-true"
                value={trueSize}
                step={1}
                min={0.001}
                kind="length"
                onCommit={setTrueSize}
              />
              <button
                className="primary block"
                data-test="flat-cal-apply"
                data-confirm={1}
                disabled={!enough}
                onClick={apply}
              >{tmarText("Apply calibration")}</button>
              <div className="toolrow">
                <button
                  data-test="flat-cal-undo"
                  disabled={picks === 0}
                  onClick={() => flat.getState().undoCalPick()}
                >{tmarText("Undo pick")}</button>
                <button data-test="flat-cal-cancel" onClick={() => flat.getState().cancelCalibration()}>{tmarText("Cancel")}</button>
              </div>
            </>
          )}
          {calError && <p className="alarmtext">{tmarText(calError)}</p>}

          <div className="sec-head">{tmarText("Scanner profiles")}</div>
          <p className="hint">{tmarText("A measured calibration describes the scanner at one resolution, not the image — save it once, apply it to every scan from that scanner.")}</p>
          {profiles.length > 0 && (
            <div className="toolrow">
              <select
                data-test="flat-profile-select"
                value={chosenProfile}
                onChange={(e) => setChosenProfile(e.target.value)}
              >
                <option value="">{tmarText("Choose profile…")}</option>
                {profiles.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                data-test="flat-profile-apply"
                disabled={!chosenProfile}
                onClick={() => flat.getState().applyProfile(chosenProfile)}
              >{tmarText("Apply")}</button>
              <button
                data-test="flat-profile-delete"
                disabled={!chosenProfile}
                onClick={() => {
                  flat.getState().deleteProfile(chosenProfile)
                  setChosenProfile('')
                }}
              >{tmarText("Delete")}</button>
            </div>
          )}
          {calSource === 'measured' && (
            <div className="toolrow">
              <input
                type="text"
                data-test="flat-profile-name"
                placeholder={tmarText("e.g. V600 @ 600 dpi")}
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
              />
              <button
                data-test="flat-profile-save"
                disabled={!profileName.trim()}
                onClick={() => {
                  flat.getState().saveProfile(profileName)
                  setProfileName('')
                }}
              >{tmarText("Save")}</button>
            </div>
          )}
        </div>
      )}

      {hasSheet && counting === null && !placingNote && !editedNote && (
        <div className="group">
          <div className="sec-head">{tmarText("Create element")}<InfoDot title={tmarText("Elements")}>
              <p>{tmarText("Every measurement here starts with an element — a point, a line, a circle, an arc or a spline. Dimensions are then measured between them, never between raw pixels.")}</p>
              <p>{tmarText("An element is ")}<b>{tmarText("picked")}</b>{tmarText(", by clicking the points it runs through — with")}{' '}
                <b>{tmarText("Snap to edge")}</b>{tmarText(" on, every click and drag lands on the nearest detected edge at subpixel — or on the center of a circle, an arc or a point when one is within reach — and ")}<b>{tmarText("Alt")}</b>{tmarText(" inverts that for one pick; any pin can be dragged afterwards; ")}<b>{tmarText("fitted to an edge")}</b>{tmarText(" from one click on it, the way a fit from a click works on the scan — the line or circle grows along the detected edge from the point you clicked and stops where the edge bends away, at a corner or into a fillet, so a click on one side of a part takes that side and a click on a hole's rim takes the hole; ")}<b>{tmarText("fitted to an edge region")}</b>{tmarText(", by clicking a detected edge to take all of it or dragging a box over it and letting every edge point inside feed the fit; or ")}<b>{tmarText("constructed")}</b>{tmarText(" from elements you already have — a midpoint, a circle's center, the intersection of two lines, the circle through the centers of a bolt pattern. A construction's sources are clicked on the sheet or chosen in the box.")}</p>
              <p>{tmarText("Which of those a kind offers appears as ")}<i>{tmarText("Created")}</i>{tmarText(" once you choose it.")}</p>
              <p>{tmarText("The kind stays in hand after ")}<b>{tmarText("Create")}</b>{tmarText(", ready for the next one, as a sketch tool does — ")}<b>{tmarText("Cancel")}</b>{tmarText(" or ")}<b>{tmarText("Esc")}</b>{tmarText(" puts it down; on a box with picks in it,")}<b>{tmarText(" Esc")}</b>{tmarText(" first empties the box.")}</p>
              <p><b>{tmarText("A spline")}</b>{tmarText(" is the free curve a CAD sketch draws through fit points — a cam profile, an outline no arc fits. Click its points in order along the edge (they snap like any pick), click on the curve to insert a point there, and drag the")}<b>{tmarText(" tangent handle")}</b>{tmarText(" at any point to bend the curve through it the way you would in CAD; click a handle to let it go automatic again. Click the first point again to close the curve on itself, and it leaves the tool as a real spline in the SVG and the STEP file.")}</p>
              <p>
                <b>{tmarText("Count")}</b>{tmarText(" is a tally rather than a fit: click the features one after another — the teeth of a gear, the holes in a flange — and each click wears the next number, pinned where you clicked.")}</p>
              <p>
                <b>{tmarText("Text")}</b>{tmarText(" pins a free note to the sheet — a remark, a part number — wherever you click; drag it to move it, click it to change what it says.")}</p>
              <p>
                <b>{tmarText("Enter")}</b>{tmarText(" or a ")}<b>{tmarText("middle click")}</b>{tmarText(" creates whatever is pending; ")}<b>{tmarText("Esc")}</b>{' '}{tmarText("discards it.")}</p>
            </InfoDot>
          </div>
          <div className="kindrow featurekeys">
            {FLAT_KINDS.map((k) => (
              // The kind in hand is shown pressed, as the sketch's tools are,
              // and pressed again starts its box over; while an element is
              // being edited the row stands down.
              <button
                key={k}
                data-test={`flat-fit-${k}`}
                className={draft?.kind === k && draft.editId === undefined ? 'on' : undefined}
                aria-pressed={draft?.kind === k && draft.editId === undefined}
                disabled={calibrating !== null || draft?.editId !== undefined}
                onClick={() => flat.getState().startDraft(k, flatDefaultMethod(k, onSection))}
              >
                <Icon name={FLAT_KIND_ICON[k]} />
                <span>{tmarText(FLAT_KIND_LABELS[k])}</span>
              </button>
            ))}
            {/* A tally or a text takes the stage from the kind in hand: the
                kind is put down first, so a click has one taker. */}
            <button
              data-test="flat-fit-count"
              disabled={calibrating !== null || draft?.editId !== undefined}
              onClick={() => {
                if (draft) flat.getState().cancelDraft()
                flat.getState().startCount()
              }}
            >
              <Icon name="count" />
              <span>{tmarText("Count")}</span>
            </button>
            <button
              data-test="flat-fit-text"
              disabled={calibrating !== null || draft?.editId !== undefined}
              onClick={() => {
                if (draft) flat.getState().cancelDraft()
                flat.getState().startNote()
              }}
            >
              <Icon name="note" />
              <span>{tmarText("Text")}</span>
            </button>
          </div>
        </div>
      )}

      {placingNote && (
        <div className="draftbox" data-test="flat-note-placing">
          <div className="sec-head">{tmarText("New text")}</div>
          <p className="hint">{tmarText("Click the image where the text should sit.")}</p>
          <div className="toolrow">
            <button data-test="flat-note-cancel" onClick={() => flat.getState().cancelNote()}>{tmarText("Cancel")}</button>
          </div>
        </div>
      )}

      {editedNote && (
        <div className="draftbox" data-test="flat-note-editor">
          <div className="sec-head">{tmarText("Text")}</div>
          <label className="field">
            <span>{tmarText("Says")}</span>
            <input
              type="text"
              autoFocus
              data-test="flat-note-text"
              value={editedNote.text}
              placeholder={tmarText("Type here…")}
              onChange={(e) => flat.getState().setNoteText(editedNote.id, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') flat.getState().finishNote()
                if (e.key === 'Escape') {
                  // The note's own: it finishes the note and goes no further.
                  e.preventDefault()
                  flat.getState().finishNote()
                }
              }}
            />
          </label>
          <p className="hint">{tmarText("Drag the label on the image to move it.")}</p>
          <button
            className="primary block"
            data-test="flat-note-done"
            onClick={() => flat.getState().finishNote()}
          >{tmarText("Done")}</button>
          <div className="toolrow">
            <button data-test="flat-note-delete" onClick={() => flat.getState().deleteNote(editedNote.id)}>{tmarText("Delete")}</button>
          </div>
        </div>
      )}

      <FlatDraftEditor />

      {counting && (
        <div className="draftbox" style={{ borderLeftColor: countColor }}>
          <div className="sec-head">
            <span className="dot" style={{ background: countColor }} />
            {editedCount ? tmarText("Edit {0}", [editedCount.name]) : tmarText("New count")}
          </div>
          <p className="hint" data-test="flat-count-status">
            {counting.picks.length === 0 ? tmarText("Click the first feature on the image.") : tmarText("{0} counted — click the next feature, or {1} it.", [counting.picks.length, editedCount ? tmarText("save") : tmarText("create")])}
          </p>
          <label className="checkrow">
            <input
              type="checkbox"
              data-test="flat-count-snap"
              checked={snapToEdge}
              onChange={(e) => flat.getState().setSnapToEdge(e.target.checked)}
            />
            <span>{tmarText("Snap to edge")}</span>
          </label>
          <div className="dro">
            <div className="dro-label">
              <span>{tmarText("Tally")}</span>
            </div>
            <div
              className={'dro-window ' + (counting.picks.length > 0 ? 'ready' : 'empty')}
              data-test="flat-count-tally"
            >
              <b className="tinted" style={tintStyle(countColor, { fontSize: 13 })}>
                {counting.picks.length}
              </b>
            </div>
          </div>
          <button
            className="primary block"
            data-test="flat-count-finish"
            disabled={counting.picks.length === 0}
            onClick={() => flat.getState().finishCount()}
          >
            {editedCount ? tmarText("Save changes") : tmarText("Create count")}
          </button>
          <div className="toolrow">
            <button
              data-test="flat-count-undo"
              disabled={counting.picks.length === 0}
              onClick={() => flat.getState().undoCountPick()}
            >{tmarText("Undo point")}</button>
            <button data-test="flat-count-cancel" onClick={() => flat.getState().cancelCount()}>{tmarText("Cancel")}</button>
          </div>
        </div>
      )}

      {elements.length + counts.length + notes.length > 0 && (
        <div className="group">
          <div className="g-label">
            <span>{tmarText("Elements")}</span>
            <ShowAllButton
              anyVisible={
                elements.some((e) => e.visible) ||
                counts.some((c) => c.visible) ||
                notes.some((n) => n.visible)
              }
              what={tmarText("elements")}
              testId="flat-elements-show-all"
              onSet={(v) => flat.getState().setAllElementsVisible(v)}
            />
            <b>{elements.length + counts.length + notes.length}</b>
          </div>
          {elements.map((el) => (
            <ElementRow
              key={el.id}
              name={el.name}
              color={el.color}
              visible={el.visible}
              reading={
                el.fit ? (
                  <b title={formatFlatDetail(el.fit, unit, len.units).split(' · ').map((part) => tmarText(part)).join(' · ')}>
                    {tmarText(formatFlatPrimary(fitInFrame(el.fit, frame), unit, len.units))}
                  </b>
                ) : (
                  <b className="warn" title={tmarText(el.error ?? undefined)}>
                    ⚠
                  </b>
                )
              }
              selected={selectedIds.has(el.id) || draft?.editId === el.id}
              editorOpen={editorOpen}
              onEdit={() => flat.getState().editElement(el.id)}
              onToggleVisible={() => flat.getState().toggleElementVisible(el.id)}
              onDelete={() => flat.getState().deleteElement(el.id)}
            />
          ))}
          {counts.map((c) => (
            <ElementRow
              key={`count-${c.id}`}
              name={c.name}
              color={c.color}
              visible={c.visible}
              reading={<b data-test={`flat-count-value-${c.id}`}>{c.picks.length}</b>}
              selected={counting?.editId === c.id}
              editorOpen={editorOpen}
              onEdit={() => flat.getState().editCount(c.id)}
              onToggleVisible={() => flat.getState().toggleCountVisible(c.id)}
              onDelete={() => flat.getState().deleteCount(c.id)}
            />
          ))}
          {notes.map((n) => (
            <ElementRow
              key={`note-${n.id}`}
              name={n.text.trim() === '' ? tmarText('Text') : n.text}
              color="var(--dim)"
              visible={n.visible}
              reading={<span className="note-row-kind">{tmarText("text")}</span>}
              selected={editingNoteId === n.id}
              editorOpen={editorOpen && editingNoteId !== n.id}
              onEdit={() => flat.getState().editNote(n.id)}
              onToggleVisible={() => flat.getState().toggleNoteVisible(n.id)}
              onDelete={() => flat.getState().deleteNote(n.id)}
            />
          ))}
        </div>
      )}

      {hasSheet && <FlatDimensionSection editorOpen={editorOpen} />}

      {hasSheet && (hasMeasurements || edgeStatus === 'ready') && (
        <>
          <div className="divider" />
          <div className="toolrow">
            <CopyButton label={tmarText("Copy report")} disabled={!hasMeasurements} onCopy={onCopy} />
            <button data-test="flat-export-csv" disabled={!hasMeasurements} onClick={onExportCsv}>{tmarText("Export CSV")}</button>
          </div>
          <div className="toolrow">
            <button
              data-test="flat-export-svg"
              disabled={!drawable}
              onClick={onExportSvg}
              title={tmarText("Save the sheet as an SVG at true scale — the edges while they are shown and the visible elements, aligned and turned as shown — for a vector editor, a laser or a print at 1:1")}
            >{tmarText("Export SVG")}</button>
            <button
              data-test="flat-export-dxf"
              disabled={!drawable}
              onClick={onExportDxf}
              title={tmarText("Save the sheet as a DXF for CAD — {0} on a sheet with a scale, y up, the origin on the alignment; every fit as its own entity, the edges while they are shown as polylines thinned to a sketch's worth", [inches ? tmarText("inches") : tmarText("millimetres")])}
            >{tmarText("Export DXF")}</button>
          </div>
          <p className="hint">{tmarText("The sheet as a drawing at true scale, aligned and turned as shown. SVG for a vector editor or a print at 1:1; DXF for CAD, the origin on the alignment and the edges thinned to a sketch's worth.")}</p>
        </>
      )}

      {hasSheet && (
        <div className="group">
          <div className="sec-head">{tmarText("Alignment")}<InfoDot title={tmarText("Alignment")}>
              <p>{tmarText("Aligns the sheet to the part instead of to the scanner glass: the first pick is the ")}<b>{tmarText("origin")}</b>{tmarText(", the second sets ")}<b>{tmarText("+X")}</b>{tmarText(". The sheet turns so that +X runs to the right of the screen, and coordinates and line angles read from the origin along it from then on. Distances and angles between elements never change under an alignment.")}</p>
              <p>{tmarText("Both picks snap to detected edges like any other pick — put the origin on a corner or a circle center, run X along a reference edge. The grid shows where the axes lie.")}</p>
              <p>
                <b>{tmarText("Rotate 90°")}</b>{tmarText(" turns the sheet on the stage a quarter turn at a time on top of that — the image or the section as it is looked at, not the frame. Coordinates, the grid and every measurement stay where they are on the part.")}</p>
              <p>
                <b>{tmarText("Mirror")}</b>{tmarText(" flips the sheet on the stage left-to-right or top-to-bottom, as it is shown. A flatbed scan is the part seen through the glass; mirrored, it is the part seen from above, the way a drawing shows it. Nothing measured moves — distances, diameters and angles between elements are what they were — and an alignment reads right-handed as shown, +X to the right and +Y up the screen, so coordinates and line angles compare with a drawing. The drawing exports come out mirrored the same way.")}</p>
            </InfoDot>
          </div>
          <p className="hint" data-test="flat-datum-status">
            {datumPicking ? datumPicking.picks.length === 0 ? tmarText("Click the origin on the sheet.") : tmarText("Now click a point along +X — the grid follows the cursor.") : datum ? tmarText("Aligned to the part — +X runs right, coordinates read from the origin.") : onSection ? tmarText("Section frame — origin at the centre of the cut.") : tmarText("Image frame — origin at the image's bottom-left corner.")}
          </p>
          {!datumPicking ? (
            <div className="toolrow">
              <button
                data-test="flat-datum-set"
                disabled={calibrating !== null}
                onClick={() => flat.getState().startDatum()}
              >
                {datum ? tmarText("Re-set alignment") : tmarText("Set alignment")}
              </button>
              <button
                data-test="flat-datum-clear"
                disabled={!datum}
                onClick={() => flat.getState().clearDatum()}
              >{tmarText("Clear")}</button>
            </div>
          ) : (
            <button className="block" data-test="flat-datum-cancel" onClick={() => flat.getState().cancelDatum()}>{tmarText("Cancel")}</button>
          )}
          {datum && (
            <label className="checkrow">
              <input
                type="checkbox"
                data-test="flat-datum-grid"
                checked={showGrid}
                onChange={(e) => flat.getState().setShowGrid(e.target.checked)}
              />
              <span>{tmarText("Show grid")}</span>
            </label>
          )}
          <div className="toolrow">
            <button
              className="withicon"
              data-test="flat-turn-ccw"
              title={tmarText("Turn the sheet a quarter turn counter-clockwise")}
              onClick={() => flat.getState().turnSheet(1)}
            >
              <Icon name="rotateCcw" size={18} />{tmarText("Rotate 90°")}</button>
            <button
              className="withicon"
              data-test="flat-turn-cw"
              title={tmarText("Turn the sheet a quarter turn clockwise")}
              onClick={() => flat.getState().turnSheet(-1)}
            >
              <Icon name="rotateCw" size={18} />{tmarText("Rotate 90°")}</button>
          </div>
          <div className="toolrow">
            <button
              className="withicon"
              data-test="flat-mirror-lr"
              title={tmarText("Mirror the sheet left-to-right (horizontally), as it is shown — a scan seen through the glass, shown as from above")}
              onClick={() => flat.getState().mirrorSheet('left-right')}
            >
              <Icon name="mirror" size={18} />{tmarText("Mirror")}</button>
            <button
              className="withicon"
              data-test="flat-mirror-tb"
              title={tmarText("Mirror the sheet top-to-bottom (vertically), as it is shown")}
              onClick={() => flat.getState().mirrorSheet('top-bottom')}
            >
              <Icon name="mirrorTB" size={18} />{tmarText("Mirror")}</button>
          </div>
          {(turns !== 0 || mirror) && (
            <p className="hint" data-test="flat-turn-status">
              {tmarText("Shown {0} — {1}", [tmarText(describeShown(turns, mirror)), mirror ? tmarText("nothing measured moves; an alignment reads +Y up as shown.") : tmarText("measurements are unchanged.")])}
            </p>
          )}
        </div>
      )}

      {onSection && (
        <div className="group">
          <div className="sec-head">{tmarText("Section edges")}<InfoDot title={tmarText("Section edges")}>
              <p>{tmarText("The polylines the cutting plane produced through the scan, drawn in teal over the sheet. They are what picks snap to and what an edge-region fit consumes — no detector runs, the cut is the edge.")}</p>
              <p>{tmarText("The chains are as fine as the scan's triangles: coarse on a decimated mesh, subpixel-dense on a fine one. Chains shorter than")}{' '}
                {inches ? tmarText("0.04 in") : tmarText("a millimetre")}{tmarText(" are dropped.")}</p>
            </InfoDot>
          </div>
          <p className="hint" data-test="flat-edge-status">
            {edgeStatus === 'ready' ? tmarText("{0} edge chains from the cut.", [edgeCount.toLocaleString('en-US')]) : tmarText("Cutting the scan…")}
          </p>
          <label className="checkrow">
            <input
              type="checkbox"
              data-test="flat-edge-show"
              checked={showEdges}
              onChange={(e) => flat.getState().setShowEdges(e.target.checked)}
            />
            <span>{tmarText("Show section edges")}</span>
          </label>
          <CombControls where="sheet" />
        </div>
      )}

      {imageName && !onSection && (
        <div className="group">
          <div className="sec-head">{tmarText("Edge detection")}<InfoDot title={tmarText("Edge detection")}>
              <p>{tmarText("The image is swept once for edges — where brightness turns over — and each edge comes out as a chain of subpixel points, drawn in teal over the scan. Fits will consume these chains; the overlay shows what they would have to work with.")}</p>
              <p>{tmarText("Sensitivity decides how faint an edge still counts. Push it up if a real edge is missing, down if noise and paper texture come up as edges.")}</p>
            </InfoDot>
          </div>
          <p className="hint" data-test="flat-edge-status">
            {edgeStatus === 'running' ? tmarText("Detecting edges…") : edgeStatus === 'ready' ? tmarText("{0} edge chains found.", [edgeCount.toLocaleString('en-US')]) : tmarText("No edges detected yet.")}
          </p>
          <label className="field">
            <span>{tmarText("Sensitivity")}</span>
            <input
              type="range"
              data-test="flat-edge-sensitivity"
              min={0}
              max={1}
              step={0.05}
              value={edgeSensitivity}
              disabled={edgeStatus === 'running'}
              onChange={(e) => flat.getState().setEdgeSensitivity(Number(e.target.value))}
            />
          </label>
          <label className="checkrow">
            <input
              type="checkbox"
              data-test="flat-edge-show"
              checked={showEdges}
              onChange={(e) => flat.getState().setShowEdges(e.target.checked)}
            />
            <span>{tmarText("Show detected edges")}</span>
          </label>
          <CombControls where="sheet" />
        </div>
      )}
    </aside>
  )
}
