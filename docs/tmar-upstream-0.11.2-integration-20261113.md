<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# TMAR Versione 7 — ScanRuler 0.11.2 source integration

## Provenance and scope

- Official upstream source: `CNCKitchen/ScanRuler`, release `v0.11.2` published 11 November 2026. Annotated tag object: `70772c027e33f1eb89e9f501afb3d5ca65548b01`; peeled upstream commit and second merge parent: `89ca713c0abe606bffd30e2f7ca9ff0a7d823358`.
- TMAR parent: integrated Edit Surface Versione 6 candidate `e9182137e62b252f4de4632057a145229cd0ae72`.
- This is a **two-parent source merge**, not a selection of patches. The upstream tag adds 43 changed paths relative to its preceding tag.
- The preview manifest is `tmar-version.json` with `number: 7`, `channel: preview`. The original application package version is `0.11.2`; the separate MCP package version is `0.6.4`.

## Official features carried forward

- Curvature combs for sections and 2D sheets, including cursor radius and the `flat.curvature` command.
- Pending edited-mesh-copy warning across other workspaces.
- List-row context menus and custom Chrome/Edge dropdown appearance.
- Densify midpoint keys corrected for large meshes.
- Updated MCP stale-tools and connector guidance.

## TMAR-specific adaptations retained

- Edit Surface: six grouped tools, bilingual workspace/host controls, safe G0/G1 locked boundaries, mouse freehand on selected poles, three independent XYZ arrows, source protection and CAD-validation guards.
- Source/CAD history: independent STEP readback, Apply and Undo/Redo, saved edit recipe and fresh-session reopen.
- No loss of project data, user notes, original scan identity or units. New upstream interface text for curvature comb, edited scan notices and context menus is localized without changing stored CAD values.
- Merge conflicts were reconciled in six files: the CI workflow and changelog, `DimensionRow`, `ElementRow`, `Panel` and `ProbeList`. CI keeps upstream sharded unit tests **and** TMAR architecture/MCP, launcher and browser regression gates.

## Local qualification evidence

- `npm ci` / `npm --prefix mcp ci`, plugin-boundary, units, CSP and TypeScript: PASS.
- Production build: PASS.
- Targeted upstream curvature, Densify and TMAR layer/i18n tests: **217 PASS, 2 existing skips**.
- MCP 0.6.4 tests: **149/149 PASS**.
- Host browser native STEP Apply, history, project reopen and Undo/Redo: **26/26 PASS**.
- Browser direct yellow-pole drag on synthetic closed CAD: **14/14 PASS**, including safe G0 boundary and multi-selection.
- Browser XYZ arrows on synthetic closed CAD: **7/7 PASS**.
- Full browser regression suite and GitHub CI must also be green on the frozen merge commit before any Dev publication. Older receipts do not qualify this new runtime.

## Isolation and release guard

Integration used an isolated worktree, not the Tubo Finale worktree, Native successor7, copy 6b, source CAD or live application. No native Tube test was repeated. This source composition is **not** a Tube BREP/T2 qualification.

The current public selector `https://scanruler.31-70-139-73.sslip.io/` remains the canonical entrypoint. Stable continues to serve **TMAR 5**. Dev continues to serve **TMAR 6** until the exact Versione 7 merge commit has passed complete GitHub CI and the single existing Dev deployment service atomically promotes the verified release. Keep the previous Dev release for rollback and never promote a different source under the same human version number.
