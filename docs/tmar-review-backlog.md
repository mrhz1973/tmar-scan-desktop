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

**PARTIAL - isolated source candidate, not yet deployed or accepted by the operator.**
Branch: `feat/web-zebra-split-20261113`, based on TMAR 7 / ScanRuler 0.11.2.

The first bounded increment reuses the existing Surface Deviation split:
Zebra appears on the **left scan** beside the **normally shaded right
reference**. The left scan retains its existing note store; clicking the
right reference never creates a false scan attachment. Zebra on the right
reference and reference-anchored notes are **not yet supported**.

- [x] Implement left-scan Zebra in the existing side-by-side Deviation view, without changing geometry or the right reference's material.
- [x] Reuse the existing two linked viewports, without remounting the right canvas when the split is hidden and reopened.
- [x] Keep reference-side Zebra selection unavailable while split; explain scope in Italian and English.
- [x] Permit local notes in the left scan pane, preserve their IDs/targets, and reject clicks in the right reference pane.
- [x] Verify on synthetic STEP/STL fixtures: visual isolation, stripe controls, split hide/show and note save/reopen.
- [ ] Qualify camera-linked note focus/return for hidden or clipped targets in split mode.
- [ ] Specify and implement resizable layouts, narrow screens and any horizontal alternative.
- [ ] Evaluate optional Zebra on the right reference, independent per-pane settings and reference-side note identity.
- [ ] Support Reverse engineer split and any new CAD-side composition without duplicating sources or notes.
- [ ] Complete per-pane labels, navigation, project persistence policy, multi-platform/large-model QA and owner visual acceptance.

This partial implementation is not a release or full completion of ZEBRA-SPLIT-002.
The existing general Zebra review remains open.

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

## SMOOTH-BRUSH-007

**Regional request safeguards, retained gesture and Shift navigation: implemented;
user/real-project verification OPEN.** Actual pointer tests cover Brush, Window
and Lasso, two consecutive Smooth applications, preserved IDs/counts and unchanged
unselected coordinates. Shift temporarily navigates with normal left/right mouse
functions, without painting or erasing. The baseline synthetic fixture did not
reproduce reported whole-piece movement/button disable; it did reproduce the
unwanted reset to Navigate. Do not mark the user's real-file report resolved
solely because these tests pass. No named selection storage is implied.

[Validation and reproduction limits](tmar-smooth-brush-validation.md).

## UI-DARK-008

**Dark default implemented; user review OPEN.** New sessions start Dark from
first paint rather than following the OS. Explicit saved Light/Dark/System
preferences remain honored; invalid/unavailable storage defaults to Dark.
No automatic changes to existing running previews.

## DOCS-GALLERY-009

**README hero and thumbnail gallery published; user review OPEN.** Original
owner-approved Zebra image unchanged at the top; twelve clickable thumbnails,
including eleven actual synthetic UI examples. Full captions and source hashes
are recorded in [the gallery](tmar-ui-gallery.md). Broader real-part validation,
existing unresolved Smooth reports and overall visual acceptance remain open.
