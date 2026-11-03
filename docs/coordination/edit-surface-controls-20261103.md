<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Edit Surface controls checkpoint and recipe/replay coordination

Verified November 3, 2026 (Europe/Rome), Windows/Chrome, in the coordinator's isolated review.
**PR #14 remains a draft. No main merge, full QS parity, in-place feature implementation or desktop release is claimed.**

## Exact revisions and scope

- Base main: `935f07f23a2311e8d90684590b8aac3d78ca0b5a`.
- Author checkpoint: `3857f2ca1aa90fb6e421cfd26fa230748d6ae1be`, parent `3b36a3626c2cf22be8e640a97c882594dcad4ea2`.
- Coordinator cherry-pick and clean tested runtime: `02bf4c66b0258d7b761928d2c196abeebd00a701`.
- All 13 incremental files are inside `plugins/tmar-edit-surface/`.
- Author and review plugin trees are identical: `88dc1e6054e235960fcff0a323d11c31d5c5c02e`.

The checkpoint adds drag intensity, smoothing intensity, connecting-net visibility and surface transparency.
Numeric displacements remain unscaled. Hiding the connecting net retains editable pole markers.
Apply still creates a new CAD body; it does not update the source's parametric history in place.
No executable host/shared source, Italian localization files, author branch or QA server 17531 was modified.
Only coordinator evidence documents are added after the clean runtime above.

## Independent checks on this checkpoint

| Check | Actual result |
| --- | --- |
| Targeted unit tests, nine files including Edit Surface kernel tests | 45 passed |
| Whole-app TypeScript | PASS |
| Complete production build, worker and WASM included | PASS; warnings retained |
| Original editor browser flow | PASS |
| New controls in compiled app, actual pointer drags and independent STEP reimport | PASS |
| New controls in development app | Initial exact-render comparison failed; two unchanged reruns passed |
| Compiled curved-rational STEP edit, Apply, project save/reopen and STEP export | PASS |
| Zebra | 32 browser checks passed |
| Categories, fixture and compiled scenarios | 35 + 22 passed |
| CAD edges, fixture and compiled scenarios | 25 + 9 passed |
| Compiled note focus/highlight and panels | 31 passed |
| Compiled Mesh Tools | 18 passed |
| Compiled regional Smooth and held-Shift navigation | 49 passed |
| Repository plugin-boundary checker | FAIL: inherited gallery import described below |

The regression scenarios above total **221 logged checks**; the separate controls and STEP workflows
use their own assertions and are not inflated into that count. These are local checks, not hosted CI,
the full upstream suite, native macOS or a qualified desktop package.

Compiled controls measured a center displacement of `0.2945899173967508 mm` at full drag strength and
`0.14729495869850062 mm` at half strength: ratio `0.5000000000004251`.
Independent STEP reimport verified the 25% and 75% smoothing outcomes.
Restoring net visibility and transparency reproduced the initial viewport image exactly in the compiled run.
Application console/page errors were absent. Compiled control screenshots were visually inspected.
These figures concern the generated CAD fixture, not a scanner-accuracy or general performance claim.

The compiled curved rational fixture preserved its edited volume `6192.107966783208 mm3` through
project reopening and STEP export, from `6075.247994550057 mm3` originally; the six faces' 9x9 position
samples matched with maximum measured difference zero. This is sampled round-trip evidence only.

### Initial render failure is retained

The first development run stopped at `Restoring display controls preserves the exact camera/render`.
Its failure report and screenshot were retained. The compiled run and two subsequent development reruns
passed the same assertion without changes to the application or assertion. The cause of that initial
mismatch was not established; do not erase it or call the entire delivery unconditionally green.

## Newly reproduced host-toolbar integration defect

A separate coordinator scenario creates a parametric sketch/extrude source, a downstream Move body copy,
and two notes placed by actual UI clicks on their faces. Apply from the existing source adds exactly one
body and one host-history entry. Original features, identities, note records, independent OCCT volumes
and sampled surfaces remain unchanged.

**The top-bar Undo button remains disabled after the editor has closed.** Diagnostic observation:

```json
{"disabled":true,"blocked":false,"editorOpen":false,"activeElement":"BODY"}
```

Clicking that disabled button performs no undo. The first scenario therefore failed its post-Undo state
assertion; a settled retry timed out, and a diagnostic run identified the stale disabled toolbar state.
This is not counted as a passing mouse-driven host-history gate.

In a **separate keyboard diagnostic**, Ctrl+Z successfully removed only the new copy. Host Redo then
restored it. Source/dependent geometry and both note anchors remained intact through Undo/Redo and a
project save/reopen in another page; both reopened notes could be focused/highlighted. Twenty diagnostic
checks passed and no application errors were logged. This narrows the issue to toolbar availability;
it does not waive the defect or qualify every host scenario.

The likely integration seam is the dynamic history participant registered by the modal and the toolbar's
reactive update after its removal. A source fix was not made in this review and its exact cause still
requires confirmation. The coordinator owns the host-side resolution; no parallel recipe implementation
or unilateral plugin rewrite is requested. Fixture preparation and state assertions in this scenario use
development APIs; this is not represented as an all-public-UI production test.

## Other remaining gate

`node scripts/check-plugin-boundary.mjs` still rejects the pre-existing import from
`scripts/capture-tmar-gallery.mjs:11` to `../plugins/tmar-mesh-review/scripts/fixture.mjs`.
It predates Edit Surface. No checker exception or bypass was introduced. The source remains unchanged.
Together with the stale Undo toolbar state, it prevents describing PR #14 as ready for a clean main merge.

## Recipe/replay ownership ACK

No equivalent implemented surface-edit recipe/replay adapter was found in the inspected shared host,
review tree or Italian-localization tree. Existing panel and feature-list registries are UI extensions,
not a NURBS recipe evaluator. `surfaceEdit` remains a proposed future host feature, not a published API.

The author owns the single geometry recipe/evaluator implementation under `plugins/tmar-edit-surface/`.
The coordinator owns its future typed worker bridge, logical feature/body resolution, dependency rebuild,
atomic host history and project persistence, and note correspondence. Keep current copy-mode Apply unchanged.

For the plugin API, provide a React/DOM/store-independent module with an explicit kernel context and
resource-release contract. The persistent recipe should use finite plain JSON data and an explicit schema
version, units/frame, source face and basis signature, exact refinement, final pole edits and locks.
Reject unknown versions and incompatible source geometry/basis; do not silently rematch another face,
refit approximately or accumulate the same edit again when rebuilding. A raw worker handle, face-array
index or resulting STEP alone is not a replayable recipe. Presentation controls are not geometry edits.

Return a validated candidate and structured diagnostics; include verified correspondence only where
supported. The host decides whether to commit and how to preserve or mark stale dependencies/notes.
Test JSON serialization, repeated replay on the same upstream source, mismatch/version rejection,
locked-pole protection, zero-edit exact refinement, invalid-result rejection and resource cleanup.
No unpublished host/language helper needs to be imported to deliver this standalone plugin API.

## Evidence and isolation

Local evidence and test adapters: `e2e-out/edit-controls-integration/`.
Entry runner: `e2e-out/edit-integration/review-controls.mjs`.
The author controls test was copied into ignored output with only URL, profile, output and import-path
adjustments; its assertions were retained. The repeated controls runs use that same test.
The host mouse scenario, its initial failure, the instrumented diagnosis and the separate keyboard path
are retained separately. [Machine-readable summary](edit-surface-controls-20261103.json).

No user model, frozen preview, native QuickSurface document, SurfaceLab session, server 17531,
author worktree or Italian-localization worktree was opened or changed by these checks.
The earlier [bounded integration review](edit-surface-integration-20261103.md) remains historical evidence.
