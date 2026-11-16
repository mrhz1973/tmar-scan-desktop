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
- [x] Qualify Go to note and Return to previous view for an ordinary visible scan note in split, including both linked cameras and unchanged Zebra state (synthetic Chrome).
- [x] Qualify hidden and section-clipped scan-note focus/return in linked split, retaining scan visibility, section settings, every saved note field and byte-identical archived model payloads (synthetic Chrome).
- [ ] Extend hidden/clipped split qualification to large models and real operator sessions.
- [x] Implement a resizable vertical scan/reference divider without remounting either canvas; keyboard control, reset, gesture cancellation, readable-pane limits and equal-pane fallback when desktop space is limited.
- [x] Persist the preferred split ratio only in this browser; do not serialize it as CAD geometry, camera pose or project data.
- [ ] Evaluate alternative stacked layouts and other workspace combinations separately; no mobile or desktop-shell release is implied.
- [x] Expose independent transparency, triangle wireframe and backface-tint shortcuts in labelled scan/reference pane bars, reusing existing stores and keeping the older menus synchronized.
- [x] Qualify these shortcuts with and without optional plugins, including model-pixel isolation, keyboard access, constrained panes and Italian labels.
- [ ] Evaluate optional Zebra on the right reference, independent per-pane Zebra settings and reference-side note identity.
- [ ] Support Reverse engineer split and any new CAD-side composition without duplicating sources or notes.
- [ ] Complete per-pane labels, navigation, project persistence policy, multi-platform/large-model QA and owner visual acceptance.

This partial implementation is not a release or full completion of ZEBRA-SPLIT-002.
The existing general Zebra review remains open.

### 16 November 2026 - pane display checkpoint

Bounded successor of `344087e87e8cdac6d530f786387fbaf33f3a1262`, on the same
Web branch. `SplitViewTools` adds shortcuts, not independent copies of state:
scan `translucent/wireframe/showBackfaces` and reference
`nominalSeeThrough/nominalMesh/nominalBackfaces` retain their existing setters.
The general view row is lifted only for this resizable built-in split so it
cannot cover the two pane bars. No geometry, camera-link, kernel, dependency,
project-format or display-preference persistence policy was changed.

Local Windows / isolated Chrome checks, synthetic fixtures:

| Check | Observed result |
| --- | --- |
| Unit: new display tools, existing divider layout and camera link | 15/15 PASS, three files |
| New public-UI scenario, development | 89/89 PASS |
| Same new public-UI scenario, compiled HTML | 89/89 PASS |
| Extended Zebra / notes / divider / save-reopen scenario, compiled HTML | 65/65 PASS |
| TypeScript and Vite production build | PASS |
| Plugin boundary, display units, worker CSP, JavaScript syntax and diff checks | PASS |

Both display scenarios include all optional plugins and `?plugins=none`.
They check actual model-pixel changes, absence of changes in the other model,
legacy-menu synchronization, Space/Enter, split hide/show, the same two WebGL
canvases, divider Home/End/reset, a 900-pixel desktop window and Italian labels.
All three browser sessions in the compiled qualification reported zero console
or page errors. The Zebra scenario exercises all six new shortcuts after its
saved baseline; every saved note field remains equal and archived model payloads
remain byte-identical. Its 65 checks include the previous 59 plus six shortcut
checks; these are not independent whole-project acceptance campaigns.

The first diagnostic used an inverted closed STL that the existing importer
correctly reorients outward, so its backface pixel assertions failed. The test
fixture now uses the existing PLY keep-winding marker; neither the renderer nor
acceptance thresholds were relaxed. The failed diagnostic log is retained.

Evidence is in the worktree's ignored `e2e-out/`: `pane-tools-unit-20261116.log`,
`pane-tools-dev-20261116.log` (failed diagnostic),
`pane-tools-dev-ply-20261116.log`, `pane-tools-build-20261116.log`, and
`pane-tools-compiled-20261116.log`. The two `split-view-tools-*-it.png` images
show the synthetic UI, not the owner's part. Existing large-bundle,
WASM-module externalization and Node localStorage warnings remain visible.

The full unit suite, MCP suite and entire `e2e:ci` collection were not rerun
locally for this increment. The new scenario is registered in both development
and production CI phases. Full exact-head GitHub CI remains a separate gate;
a previous commit's green result is not inherited. Real-part, large-model,
long-session, cross-platform and owner visual acceptance remain open.
No merge, VPS publication, version-number change or A09 execution is included.

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
