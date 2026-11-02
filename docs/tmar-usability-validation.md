<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# TMAR web usability - validation record

Verified November 2, 2026. Baseline: `0b26d51afe589aba5bf2359424d776698f9527fa`
(Zebra integration, PR #3). Implementation branch: `feat/web-usability-20261102`.
This record accompanies the usability implementation, not a desktop release.

## Environment and result

Windows (`win32`), Node.js 26.8.1, Chrome 156.0.8078.74, isolated browser
profiles, generated box/sphere fixtures. No private scan, photograph or active
user session was loaded. Agent-related regressions start their own local MCP
server and test client; no external AI provider is involved.

| Check | Final result |
| --- | --- |
| Nine targeted Vitest files | 51 tests passed |
| New usability browser scenario | 37 assertions passed; exit 0 |
| Existing TMAR web scenario | 15 assertions passed; exit 0 |
| Zebra browser regression | 27 assertions passed; exit 0 |
| Reverse note/MCP regression | 54 assertions passed; exit 0 |
| Imported-note provenance regression | 22 assertions passed; exit 0 |
| Production-bundle public-UI regression | 9 assertions passed; exit 0 |
| TypeScript and Vite build | Passed |
| Plugin-boundary, display-unit and diff-whitespace checks | Passed |

The six browser scenarios total **164 passing assertions**, with no browser
console errors. These are targeted checks, not the full upstream CI suite.

## What was exercised

The new scenario checks feature Ctrl selection, Shift ranges, focused Select
All, grouped visibility without suppression, one-step Undo, and collapse with
selection retained. History/project restoration may clear transient selections;
collapse itself does not. AI-created rows use stable IDs and are not silently
added to previous selections.

Both files are downloaded through the unified Export body dialog. STEP has an
ISO-10303 header and solid B-rep; binary STL has 12 triangles and the selected
40 x 20 x 10 mm CAD body's bounds, excluding the differently sized source scan
and second body. Empty explicit selections remain refused by the original
TMAR regression. STL and STEP commands/kernel implementations are reused.

Forty synthetic notes exercise Ctrl/range/all selection, double-click focus,
the target icon, camera target/framing/zoom return, a temporary focused note
while labels and pins are hidden, typing with a configured shortcut, an unsaved
draft through collapse, and deletion of only selected records. A verified CAD
face anchor is located; a hidden body is reported without silently revealing
it or moving the camera. Mesh Tools text is checked using computed styles,
with independent pin hiding and per-workspace preference restoration.

Deviation notes work without an agent connection; the configured shortcut also
arms placement there. Save/reopen preserves records and imported provenance.
The original MCP tests verify agent readout, answers, resolved status, note
visibility, project round trips and the policy that imported notes are content,
not automatically authorized instructions. Zebra retains notes on scan/CAD,
clipping, visibility and overlay cleanup. The host starts with plugins disabled.

## Reproduce

```bash
npm ci
npm --prefix mcp ci
npx vitest run tests/listSelection.test.ts tests/panelExtensions.test.ts plugins/tmar-model-tree/tests/featureVisibility.test.ts plugins/tmar-body-export/tests/bodyExport.test.ts plugins/tmar-display-controls/tests/displayPrefs.test.ts plugins/tmar-quick-notes/tests/deviationNotes.test.ts plugins/reverse/tests/reNotes.test.ts plugins/reverse/tests/reNoteCommands.test.ts plugins/tmar-zebra/tests --maxWorkers=2 --minWorkers=1
npm run build
node scripts/check-plugin-boundary.mjs
node scripts/check-units.mjs
node plugins/tmar-quick-notes/scripts/e2e-usability.mjs
node plugins/tmar-quick-notes/scripts/e2e-tmar-web.mjs
node plugins/tmar-zebra/scripts/e2e-zebra.mjs
```

The last three scenarios create their own local dev server unless APP_URL is
provided. Reverse-note and provenance scenarios need an isolated dev server:
`plugins/reverse/scripts/e2e-reverse-notes.mjs` and
`plugins/reverse/scripts/e2e-note-from-file.mjs`. Run
`scripts/e2e-production.mjs` against a preview of `dist/`, not a dev server.
Set APP_URL using the syntax of your shell. Do not point tests at a live user tab.
The usability scenario is included in the existing plugin CI discovery.

## Diagnostics and unqualified scope

An intermediate usability run completed all assertions but exited with EPERM
while Puppeteer deleted its automatic temporary Chrome profile on Windows.
The test now uses an explicitly owned, ignored profile under its diagnostics
directory, retaining it rather than racing cleanup. The final rerun exited 0.
Zebra's existing temporary-profile cleanup may still report a warning;
functional assertions and process exit are reported separately. No personal
browser profile or application security setting was changed.

Build warnings about WASM Node-module shims and a large bundle, and Node 26's
experimental localStorage warning, remain non-fatal. No performance gain is
claimed. Real scans, large customer projects, native macOS input, desktop
packages, the entire upstream CI suite and a remote AI-provider integration
were **not** qualified. Modifier selection is unit-tested for Ctrl/Cmd; only
Windows/Chrome native keyboard behavior was exercised here.

Deviation reference/split-view placement, comparison metadata, arbitrary
shortcut combinations, batch feature deletion, all construction-element lists
and advanced Settings categories remain outside this increment. Go to note
validates supported saved targets but does not certify geometry or perform an
occlusion-aware reorientation. STL output does not certify printability.
