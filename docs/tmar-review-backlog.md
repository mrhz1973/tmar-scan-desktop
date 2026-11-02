<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# TMAR review backlog

Updated November 2, 2026. This supplements the [main roadmap](../README.md#status-and-roadmap).
GitHub Issues was disabled when checked on this date, so these requests are
tracked here in version control. No issue numbers have been created and no
repository settings have been changed. Implementation and acceptance are
separate: publishing documentation does not complete the tasks below.

## ZEBRA-REVIEW-001

**Current result review - OPEN / user review in progress.**

Martino reports that the workflow is usable, but is still reviewing the result
and is not fully satisfied. The [Tubo Finale screenshot](tmar-zebra-examples.md)
is a work-in-progress example, not approval of the final visual or CAD result.

- [ ] Record the specific remaining observations and expected behavior as the user supplies them; do not invent defects or requirements.
- [ ] Reproduce relevant observations on a separate project copy, keeping target, camera, stripe settings and build identifiable.
- [ ] Keep rendering behavior, mesh/tessellation effects and geometric verification distinct when assessing an observation.
- [ ] Document any refinements and rerun the appropriate regressions.
- [ ] Obtain explicit user acceptance before describing the reviewed result as final or closing this item.

The existing test results remain valid only for their documented revisions and
scope. No new runtime change or real-part acceptance is implied by this entry.

## ZEBRA-SPLIT-002

**Split view with Zebra and local notes - PLANNED / not implemented.**

Goal: evaluate two 3D panes so a user can inspect Zebra and keep annotated
comparison context visible without leaving the review. A candidate is Zebra
beside normal shading or a deviation view. A docked note list can accompany the
panes but, on its own, is not the requested split-view feature.

- [ ] Define the supported workspace/pane combinations. Evaluate Reverse engineer/Zebra and Surface Deviation scan/reference separately.
- [ ] Choose vertical/horizontal layout and a resizable divider, including a usable narrow-screen fallback.
- [ ] Specify linked versus independent cameras and preserve model alignment; do not move geometry to synchronize views.
- [ ] Reuse existing local note records, IDs, text, anchors and provenance; no duplicate note store and no required or automatically enabled agent connection.
- [ ] Place a note on the supported scan or CAD surface in the correct pane while Zebra remains active; explain unsupported targets instead of silently misplacing an anchor.
- [ ] Define which pane(s) Go to note controls, show the corresponding focus/highlight, and preserve Return to previous view.
- [ ] Provide per-pane Labels and note-pin visibility, with temporary focus of one note without revealing all annotations.
- [ ] Preserve category-scoped feature visibility, clipping, source geometry/materials and the existing lower-bar controls.
- [ ] Save/reopen the same note records without duplication and explicitly decide which layout/camera preferences persist.
- [ ] Test placement, selection, focus, hidden/clipped targets, resizing, mode transitions, project round trips and renderer cleanup; qualify platforms separately.

Current boundary: the delivered Deviation note adapter is scan-side and
single-viewport. This task does not claim reference-side or split-view note
placement already works. It remains future work while current-result review
continues.

## ZEBRA-GALLERY-003

**Expand the real-part example gallery - PLANNED; first WIP image published.**

The initial gallery entry is available, but additional evidence remains open:

- [ ] Add further user-supplied or explicitly captured example views without disturbing a live CAD session.
- [ ] Record available build, target, camera and stripe settings, date, asset provenance and review status for each view.
- [ ] Where useful, publish comparable before/after pairs and distinguish mesh from CAD targets.
- [ ] Keep work-in-progress examples separate from explicitly accepted results; do not claim general QS parity or geometric certification.
- [ ] Reconsider the final documentation placement after review; current links point to the dedicated gallery and both READMEs.

No release, installer, hosted application update or restart of a running preview
is requested or performed by these documentation/backlog entries.

## CAD-EDGES-004

**Show CAD edges with Zebra — implemented in web source; user review OPEN.**

The lower-bar switch and settings expose editable-body edges and STEP-reference
face boundaries with color and pixel width. Fillet/tangent visibility reuses the
native body option. No internal triangle-wireframe fallback and no geometry edit.

- [x] Implement independent display switch and adjustable color/thickness.
- [x] Follow-up: preserve borders for STEP loaded as Scan, reproducing the reported path.
- [x] Add a separate visible TMAR build revision and detailed build provenance.
- [x] Retain selection, local notes and project round trips in documented scope.
- [x] Check the same authorized STEP in the native reference application and target.
- [ ] Obtain the owner's visual acceptance; do not infer it from automated tests.
- [ ] Extend/qualify other reference, platform and split-view cases separately.

[Usage](../plugins/tmar-cad-edges/README.md) | [Validation](tmar-cad-edges-validation.md).
This does not close ZEBRA-REVIEW-001 or implement ZEBRA-SPLIT-002.

## MESH-REVIEW-005

**Mesh Tools notes and Zebra — implemented; user review OPEN.** Shared local
notes and displayed-mesh analysis are available. No agent requirement or automatic
preview adoption. Uncommitted preview note targets and split view remain separate.

## SMOOTH-REPEAT-006

**Repeatable regional Smooth and intensity — implemented; user review OPEN.**
A successful application retains the marked region via vertex mapping. The
0–100% slider is independent from patch size, sharp-edge protection and the
per-application movement limit. Settings survive project reopening. Named
selection-set storage across sessions and large-mesh qualification remain open.

[Validation](tmar-mesh-review-validation.md). These items do not close overall
Zebra/result acceptance and do not publish a release.
