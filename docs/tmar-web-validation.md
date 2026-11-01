<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Initial TMAR web extensions — validation record

Baseline: `6748a79ebe755c12d212b88a4937be2a1992d80f`, inherited ScanRuler
0.9.4 plus the fork's roadmap. This record concerns the first source-level web
plugins, not a desktop release or a hosted deployment.

## Tested environment and scope

Windows (`win32`), Node.js `v26.8.1`, Chrome `156.0.8078.74` in an isolated
headless profile. Only generated geometry was used. No private scans,
photographs or active user sessions were loaded. The browser test replaces the
agent socket with an inert test double; it does not contact a real MCP session.

| Check | Result |
| --- | --- |
| Targeted Vitest suites, six files | 36 tests passed |
| Combined TMAR browser regression | 15 assertions passed; no browser console errors |
| Upstream production-bundle public-UI regression | 9 assertions passed; no browser console errors |
| TypeScript and Vite production build | Passed |
| Plugin import-boundary check | Passed |
| Display-units policy check | Passed |
| `git diff --check` | Passed |

The complete upstream test suite, all upstream browser scenarios, macOS and a
live AI-provider/MCP connection were **not** qualified in this session. This
record does not certify arbitrary customer models, performance or printability.

## Body STL evidence

The generated source scan spans `[-2, -2, 0]` to `[42, 22, 14]` mm. Two CAD
solids are created. Exporting only the selected first body through the actual
UI download produces a binary STL containing **12 triangles**, bounds
`[0, 0, 0]` to `[40, 20, 10]` mm and the expected binary byte count. It excludes
both the source scan and the second body. An empty explicit selection disables
export. The original STEP export control remains available.

Unit tests additionally cover visible-only solids, explicitly selected hidden
solids, component expansion, deduplication, missing selected bodies, surfaces,
chord bounds and malformed file output. The chord field uses the host's
unit-aware `NumberField`; the existing exporter still receives millimetres.

## Deviation-note evidence

The browser test opens the scan-side comparison, arms Note, clicks the top
surface and saves an observation without leaving Deviation. Its anchor is on
the scan at `z = 14`, not on the CAD top at `z = 10`. The map revision and
measurement-pin count are unchanged. Escape cancels placement. Reverse
engineer shows the same note, and saving/reopening the project preserves the
note ID, text and position without duplication.

Reference-side and split-view placement are explicitly disabled with an
explanation. Unit tests cover missing scans, busy states, marking, alignment
picking, deformation animation, hidden scans, clipped/missing hits and
part-frame coordinates under a display transform. A final browser smoke check
opens the host with `?plugins=none` and verifies that it remains usable.

## Reproduce

```bash
npm ci
npx vitest run tests/panelExtensions.test.ts plugins/tmar-body-export/tests/bodyExport.test.ts plugins/tmar-quick-notes/tests/deviationNotes.test.ts plugins/reverse/tests/reNotes.test.ts plugins/reverse/tests/reNoteCommands.test.ts tests/exportStl.test.ts --maxWorkers=2 --minWorkers=1
node plugins/tmar-quick-notes/scripts/e2e-tmar-web.mjs
npm run build
node scripts/check-plugin-boundary.mjs
node scripts/check-units.mjs
git diff --check
```

For the production test, serve `dist/` with Vite preview and run
`APP_URL=<preview-address> node scripts/e2e-production.mjs` (set the environment
variable with the syntax for your shell). The new browser scenario is also
declared in the plugin's `ci.json` for the normal `npm run e2e:ci` pipeline.
The full CI pipeline has not been substituted by this targeted local record.

Observed non-fatal diagnostics: Vite externalizes Node module shims used by the
WASM dependencies and warns about a large main bundle; Node 26 emits an
experimental localStorage warning in some unit tests. Build and listed tests
still exit successfully. No performance improvement is claimed.
