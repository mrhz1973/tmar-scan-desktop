<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# TMAR unified CAD body export

One **Export body...** button opens a dialog. Choose **STEP** or **STL**, choose
visible bodies or explicitly selected body-list items, then press **Save**.
This is the existing web application; no desktop shell is required.

STEP uses the existing CAD exporter and includes eligible sheets as well as
solids. STL uses the existing solid-body tessellator, never the source scan or
the display mesh. The STL-only chord control defaults to 0.02 mm, accepts
0.0001-1 mm internally, and follows the display units selected in Settings.
STL has no unit metadata: import it as millimetres. Multiple bodies in one STL
are not automatically Boolean-unioned. Export is not a printability certificate.
Keep the project for the feature history and notes; STEP does not retain them.

Explicit selections include component contents, including selected hidden
bodies. Empty/stale selections and sheets requested as STL are refused; none
silently becomes export-all. Active edits/builds block export. A model change
during export rejects the result rather than downloading an ambiguous revision.

## Modularity

`plugin.ts` registers `reverse.export`; `BodyStlExport.tsx` is the unified dialog
(the historical filename is retained); `bodyExport.ts` contains selection and
output checks. `tests/bodyExport.test.ts` covers both formats. The kernel and
`reverse.export.step` / `reverse.export.stl` commands are reused, not replaced.

The host shows its inherited STEP button when no export contribution is
registered. Excluding this build-time plugin retains that fallback. This
plugin depends on `reverse`; no dynamic package manager is provided.

## Verification

[Validation record](../../docs/tmar-usability-validation.md). Synthetic browser
checks download actual STEP and STL files of the selected body and verify that
the STL excludes the differently sized scan and second body. No macOS,
real-part or desktop qualification is implied.

```bash
npx vitest run plugins/tmar-body-export/tests/bodyExport.test.ts tests/exportStl.test.ts
node plugins/tmar-quick-notes/scripts/e2e-usability.mjs
node plugins/tmar-quick-notes/scripts/e2e-tmar-web.mjs
npm run build
```
