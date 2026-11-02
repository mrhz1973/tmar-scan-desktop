<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Mesh Tools review and repeatable Smooth validation

Verified November 2, 2026. Base `19d9e42984857ed06e4f0225e0970a02dd6862fa`.
Tested clean source `e48fba412984bdc878fe457c075338aa67bba2a0`. **User acceptance remains OPEN.**

## Delivered behavior

Two optional plugins extend Mesh Tools with local notes/Zebra and Smooth
intensity. Note records, shortcut, selection, focus/highlight and save/reopen
reuse the existing system. Zebra follows the actual scan/edited/reduced display,
not a hidden source. It leaves numerical deviation values and display settings
unchanged. Active destructive/marking tools guard inspection interactions.
Reduced-mesh normals, when needed, live only in disposable render buffers.

Successful regional Smooth carries the exact marked vertices through the returned
vertex map into the reloaded copy. Two successive UI applications retain the
same IDs, actually change the selected surface, and leave outside-region vertices
and the original scan in use untouched. 0..100% intensity is a blend of the full
bounded result with that invocation's input; 100% matches legacy behavior.
The limit is **per application**. Repeated applications can accumulate movement.
Slider changes alone do not edit geometry. Each operation remains undoable.
Intensity is stored as an optional project setting; missing legacy values mean 1.

## Actual local checks

Windows / Chrome, isolated worktree and owned browser profiles. The source passed
**208 targeted unit tests**, plus the independent category and build-identity
checks. TypeScript, production build, plugin boundary, units policy and Zebra
reflection checks passed. **466 browser assertions** passed in the final gate:

| Scenario | Result |
| --- | --- |
| mesh-review | 22 checks; exit 0 |
| repeat-smooth | 19 checks; exit 0 |
| mesh-edits-original | 76 checks; exit 0 |
| step-scan | 22 checks; exit 0 |
| cad-edges | 25 checks; exit 0 |
| categories | 35 checks; exit 0 |
| zebra | 32 checks; exit 0 |
| usability | 40 checks; exit 0 |
| tmar-web | 15 checks; exit 0 |
| reverse-notes | 54 checks; exit 0 |
| note-provenance | 22 checks; exit 0 |
| mesh-review-production | 18 checks; exit 0 |
| step-scan-production | 15 checks; exit 0 |
| cad-edges-production | 9 checks; exit 0 |
| category-production | 22 checks; exit 0 |
| focus-production | 31 checks; exit 0 |
| production | 9 checks; exit 0 |

All final scenario exit codes are 0, with no application console errors. Counts
are local runs, not a claim of GitHub-hosted CI success or full upstream coverage.
The original mesh-edit E2E was retained alongside category, export, note/MCP,
imported-note provenance, STEP borders and compiled focus/build checks.

The new production test uses public UI only: a Window drag creates the region,
the Smooth button is pressed twice, the retained count is verified, and a
downloaded project is inspected for intensity and unchanged original source bytes.
The development test additionally checks exact vertex IDs and coordinates,
unchanged outside-region points, two distinct results and exact Undo/Redo output.
Unit tests establish the intensity/displacement relationship independently.

## Intermediate failures and correction

Initial checks caught boolean typing in adapter guards and missing normals on a
reduced mesh; these were corrected before the final gate. The reduced case now
has ownership/disposal tests for generated flat display normals. The original
mesh-edit test expected the marking to disappear after Smooth; its assertion was
updated to the requested retained-region behavior, and it now uses an owned
browser profile. One headless unit suite initially hit Vite's filesystem boundary
because node_modules was a junction to another worktree: the owned worktree now
has its own copy of the same dependencies. No filesystem/security allowlist or
package version was changed. First-attempt evidence was retained locally.
Earlier failed or interrupted runs are not counted as successful. Existing
build/WASM/Node warnings, when present, are recorded separately from application
console errors.

## Limits

New notes attach to the scan in use, not uncommitted edited/reduced previews.
Existing preview markers represent saved scan coordinates, with an explicit
warning. Transient smoothing marking is retained across successful applications,
not promised across mesh replacements, Undo/Redo, workspace/tool changes or
project reopen; named persistent selection sets are not implemented.

The fixtures are synthetic. No smoothing was applied to a live user project,
no private model/screenshot is included, and no QuickSurface window or existing
preview/session was opened, replaced, reloaded or saved. macOS, Safari, very large
mesh performance, split view and general QuickSurface parity are not qualified.
No desktop installer, hosted deployment or release is implied.

## Reproduce

```sh
npx vitest run plugins/tmar-mesh-review/tests plugins/tmar-smooth-controls/tests
npm run build
node plugins/tmar-mesh-review/scripts/e2e-mesh-review.mjs
node plugins/tmar-smooth-controls/scripts/e2e-repeat-smooth.mjs
node plugins/tmar-mesh-review/scripts/e2e-mesh-review-production.mjs
```

The scripts launch isolated test instances unless APP_URL is supplied. Use only
a dedicated test server, never a user tab. The build badge identifies the exact
compiled source, independently of later documentation/merge commits.
