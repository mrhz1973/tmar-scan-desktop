<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Note focus, panel width and Zebra access — validation

Verified November 2, 2026. Baseline: `cc6ea7e733ef840f01791a2d822ef72bf0a5029f`.
Branch: `fix/notes-panel-navigation-20261102`. This record accompanies the
follow-up code; it is not a desktop release or a claim of full-project qualification.

## Defects and changes

The previous navigation rejected valid saved annotation coordinates when their
CAD body was missing/hidden, a surface fingerprint changed, the anchor did not
match the current surface, or a legacy note had no target record. The explanation
was confined to the status strip. Navigation now distinguishes an invalid point
from an unavailable target: it centers the saved point, warns clearly beside the
notes, and does not reveal geometry, remap anchors or authorize imported notes.
Unsafe editing/operation states and invalid coordinates remain guarded.

Another reproduction exposed row movement between mouse clicks: first-click
selection introduced bulk-action controls, and clearing a prior focus removed
feedback above the row. These layout changes could prevent a real double-click
from reaching the same element. Bulk controls now retain their space (disabled
without selection), and ordinary selection does not tear down the existing focus.
A double-click can therefore go directly from one focused note to another.

Focus has a 54-pixel high-contrast viewport target and highlighted label. The
stored surface normal supplies an inspection direction when available. Return
restores the previous camera. No CAD or scan geometry is changed.

Features/Notes use shared full-width, 40-pixel disclosure headers. An optional
`workspace.divider` slot hosts the display plugin's pointer/keyboard resizer and
Settings width control. Width persists per browser; the viewport is not remounted.
Phone layouts remain stacked. Zebra gains a lower-bar entry, shared toggle state
and scan-only target selection; its shader and geometry algorithms are unchanged.

## Actual verification

Windows, Node 26.8.1, Chrome 156.0.8078.74. Synthetic boxes/spheres and isolated
browser profiles only; no private scan or active user tab was opened.

| Check | Final result |
| --- | --- |
| Targeted Vitest files, including note focus and panel bounds | 63 tests passed |
| New production-only focus/layout scenario | 31 assertions, exit 0 |
| usability | 37 assertions, exit 0 |
| tmar-web | 15 assertions, exit 0 |
| zebra | 27 assertions, exit 0 |
| reverse-notes | 54 assertions, exit 0 |
| note-provenance | 22 assertions, exit 0 |
| production | 9 assertions, exit 0 |
| TypeScript/Vite production build | PASS |
| Plugin-boundary, display-unit, whitespace checks | PASS |

Total: **195 browser assertions** in seven scenarios. No browser console errors.
The new scenario uses only public UI and a generated `.scanruler` archive: no
`/src` imports, development globals, MCP pairing or agent activation. It checks
40 imported notes, non-origin coordinates, actual on-screen target location,
first-click row stability, double-click between targets, hidden scan geometry,
removed/legacy targets, hidden labels/pins, visible feedback and provenance.
It also drags/resizes the panel, checks keyboard and reload persistence, phone
layout, Zebra's rendered pixel change and operation with plugins omitted.

The existing regressions retain the selection/history, actual STEP/STL download,
scan/body notes, save/reopen, Zebra lifecycle and imported-note security checks.
The hidden-body expectation was intentionally updated: locate the saved point
with a warning while keeping the body hidden, rather than refusing navigation.
The MCP regressions use their own local test server, not an external AI provider.

## Reproduce

```sh
npm ci
npm --prefix mcp ci
npx vitest run tests/listSelection.test.ts tests/panelExtensions.test.ts plugins/tmar-quick-notes/tests plugins/tmar-display-controls/tests plugins/tmar-model-tree/tests plugins/tmar-body-export/tests plugins/tmar-zebra/tests plugins/reverse/tests/reNotes.test.ts plugins/reverse/tests/reNoteCommands.test.ts --maxWorkers=2 --minWorkers=1
npm run build
node plugins/tmar-quick-notes/scripts/e2e-focus-production.mjs
node plugins/tmar-quick-notes/scripts/e2e-usability.mjs
node plugins/tmar-quick-notes/scripts/e2e-tmar-web.mjs
node plugins/tmar-zebra/scripts/e2e-zebra.mjs
node scripts/check-plugin-boundary.mjs
node scripts/check-units.mjs
```

The new production script starts a preview of `dist/` unless APP_URL is supplied;
APP_URL must reference a compiled preview for that script. Remaining regression
setup is documented in [the earlier validation](tmar-usability-validation.md).
Never point destructive fixture tests at a live user tab. Owned temporary test
profiles are retained under ignored diagnostics where needed to avoid Windows
profile-deletion races; they are not personal browser profiles.

## Limits and failed intermediate attempts

The first production hidden-scan fixture attempted to use Reverse's intentionally
disabled Scan toggle before a CAD body existed. The fixture now uses Deviation's
supported toggle and asserts that the scan is actually hidden before testing
focus. A subsequent direct double-click reproduced the moving-row defect, which
was fixed in application code and rerun. Initial TypeScript errors were corrected
before the passing build. The Zebra regression also caught the shared target
choice surviving a workspace/editor transition; cleanup now restores the original
visible-body default together with the disabled state. It was rerun. These
intermediate attempts were not counted as PASS.

This is not validation on the reported real project, macOS, Safari/Firefox,
physical touch hardware, the packaged desktop or the complete upstream suite.
Saved-point navigation is not automatic topology repair or a guarantee that the
point still lies on the current model. Stored normals can be noisy; complex
occlusion-aware camera planning remains outside this increment. Geometry and
section visibility are not changed to expose hidden targets. Deviation placement
remains scan-side and single-viewport. Build warnings for WASM module shims and
large bundles remain; no performance or geometric-accuracy improvement is claimed.
