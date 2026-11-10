<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Consolidated Edit Surface host — 10 November 2026

## Purpose and source composition

This integration connects the separately developed host changes to the current
Edit Surface plugin, including the user-facing saved-history workflow. Work is
isolated on `codex/host-integration-20261110`.

| Component | Source retained in this integration |
| --- | --- |
| Cumulative host through PR #41 | `80405c355b2d0c949d53504f88da138dbd406925` |
| Native sewing lineage contract, PR #40 | `018f7cb`, `19d76f4`, `7bea8a4` |
| CAD face duplication host qualification, PR #42 | `07cc951` |
| Feature categories, complete PR #24 | `0b2a2c5`, `5b8a161`, `a599568`, `2fc21df` |
| Ordinary Edit Surface plugin snapshot | `0fb2565d38f84f0967fcf6019d5f6a7332b74ce9`, only `plugins/tmar-edit-surface/` |

The plugin snapshot was committed as `946bcc2` before the integration-specific
changes. The ordinary plugin and host use the existing `occt-wasm` **5.7.1**.
The inherited ScanRuler package version remains **0.9.4**. This work does not
represent migration to upstream ScanRuler 0.11.1 or OCCT facade 5.15.0.

The T2 periodic/Tubo research branch, its candidates, STOP receipts and consumed
markers are outside this integration. These synthetic workflow checks do not
qualify the complete Tubo.

## User workflow

1. Open an eligible CAD body in **Edit Surface**, make and validate the change.
2. For a supported parametric mode, leave **Mantieni la modifica riapribile**
   enabled and choose **Applica**. The original remains available according to
   the existing source-visibility choice.
3. Save the project as `.scanruler`. The project contains the source STEP,
   verified recipe, result and any supported surface notes.
4. After opening the project again, use **Riprendi modifica**. If several saved
   modifications exist, select one from the list.
5. Edit and apply again. The new result is a separate project action with
   Undo/Redo; the upstream source of the saved recipe remains authentic.

The new `tmar-surface-history` plugin composes existing editor APIs. Supported
recipes are versions **2–6**. Adaptive v8 histories remain excluded through an
explicit capability from the actual editor mode. **Duplica faccia CAD** remains
an ordinary CAD copy: it does not acquire a fictitious parametric history.

## Implementation details that protect the project

- Apply prepares the recipe before obtaining the ordinary export lock. Legacy
  recipe preparation refreshes the preview; Apply waits for the plugin's
  provenance guard and valid refreshed preview before binding its ticket.
- The export lock hands over to the existing history lock. Annotated export
  can refresh native note witnesses; the host waits for the corresponding
  resolution and rechecks the authentic net/text/UV provenance before locking.
  Re-entrant draft or note changes are rejected before any publication.
- An independent OCCT replay must match the saved result. A qualified, single-use
  history token accompanies the atomic body, note and history publication.
- Reopening uses the **archived source STEP and source body key** for geometry.
  The currently displayed result provides the viewport/document lease. These
  roles are separate and checked; the displayed result is not substituted as a
  new upstream source.
- A private authenticated capability permits a subsequent Apply from that
  recovered source. The current result, archive hashes, document state and note
  state remain guarded through preparation and publication.
- Supported display lengths, budgets, areas, volumes and residuals respect the
  selected mm/in preference. Changing display units preserves physical input
  values. The displacement upper bound is rounded outward for display; CAD
  coordinates and criteria remain in their original internal units.

## Verification record

This record captures the completed local gates at publication. The complete
regression run and browser workflow retain their own CI reports; a prepared
test is not a PASS. Targeted groups below overlap and are not added together
to inflate a unique test count.

| Gate | Recorded result |
| --- | --- |
| Plugin import boundary | PASS; no core import from a plugin |
| Display-units checker | PASS; fixed display conversion and narrowly documented intrinsic CAD metadata |
| MCP package | 127 tests PASS |
| Native lineage/commands/noisy-sheet CI group | 27 tests PASS |
| Display input and editor session group | 140 tests PASS, including 8 new display regressions |
| Navigation, gizmo, reticle, duplicate, annotated thin-face group | 34 unique tests PASS, including 4 new native tests |
| Final native history integration, including archived-source hardening | 7 tests PASS: plain/annotated ZIP recovery, original removed, re-Apply and atomic rejection cases |
| Complete TypeScript | PASS on the final production-source delta |
| Complete app regression suite | Running at publication; consult the attached run result |
| Integrated production build | PASS; the downloadable preview manifest identifies its exact final source revision |
| New browser workflows | Prepared; local browser launch blocked before app checks |

### Thin-face evidence

The annotation fixture is a real OCCT annular solid, radii **10 mm** and
**9.9 mm**, exported and reread through STEP. Its upper annulus supplies **zero**
strictly interior points on 9×9, 17×17 and 33×33 grids, and **56** on the 65×65
grid. The adaptive matcher therefore reaches the finer grid for a real reason.
The minimum of 12 interior samples, `1e-5 mm` distance criterion and normal
criterion are unchanged.

Native tests cover matching, negative matches, atomic annotated Apply,
original preservation, Undo/Redo, ZIP reopening and native solid checks. These
checks are distinct from a rendered browser gesture or qualification on the
user's installed Windows build.

### Browser execution

`scripts/e2e-host-integration.mjs` owns a local Vite server and runs the two new
synthetic browser workflows with private test profiles. CI retains reports,
screenshots and synthetic archives without copying browser profiles. The first
workflow exercises navigation, XYZ gizmo, reticle frame, CAD duplication and
project round trip. The second exercises the visible saved-history workflow.

The local Chromium launch was rejected before opening the app with
`socket() failed: Operation not permitted`. Automatic approval review also
rejected a requested sandbox escalation because that category is disabled.
No restriction was changed. The permitted cloud browser opened, but could not
reach the exec-isolated local server. No browser PASS is inferred from the
native checks. The normal repository CI runner is the next execution surface.

## Scope of delivery

This is a consolidated **web preview** with source and build provenance. It is
not an installer or automatic update of an existing user session. The exact
installed Windows host/plugin pair still needs its own browser qualification.
The current Windows connector returned `Session terminated`; no user CAD was
opened or modified during this integration.

The compiled preview can be served without installing dependencies with
`node scripts/serve-preview.mjs dist`. The packaged preview includes this
small Node server and a Windows launcher; it listens only on `127.0.0.1`.
Its HTML and WebAssembly content type were checked with actual HTTP requests.

All geometry used for new tests is synthetic. Existing owner worktrees and WIP
were not reset, staged or overwritten. Main/stable and installed host, kernel
and MCP services were not changed.
