<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# TMAR CAD body STL export

A build-time web plugin. No Electron shell or native installation is required.

## What it does

Adds **CAD body STL** to Reverse engineer, next to the existing export area.
Choose **Visible solid bodies** or **Selected body-list items**, set the chord
tolerance and press **Export body STL**. Body-list selection includes bodies in
selected components. An empty, stale or surface-containing explicit selection
is refused; it never silently becomes "export everything".

The plugin calls the existing `reverse.export.stl` command. It tessellates the
CAD bodies using the existing Open CASCADE exporter. **It does not export the
source scan or use the viewport's display mesh.** STEP export is unchanged.

STL coordinates are millimetres. The chord field follows the display units
chosen in Settings and converts to millimetres for the exporter. Default chord: 0.02 mm; this UI accepts 0.0001–1 mm. STL contains triangles, not a
parametric model or unit metadata. Import it as millimetres. Several bodies
share one file but are not automatically Boolean-unioned. Export success is
not a certificate that the resulting part is manufacturable or watertight.

Export is disabled during active edits/builds. If the model changes during an
export, the result is rejected instead of downloading an ambiguous revision.

## Source and integration

- `plugin.ts`: registers the `reverse.export` panel contribution.
- `BodyStlExport.tsx`: scope, chord, progress and download UI.
- `bodyExport.ts`: pure selection rules and binary-file checks.
- `tests/bodyExport.test.ts`: selection, validation and error scenarios.

Depends on the upstream `reverse` plugin and its body-folder/command interfaces.
No duplicate CAD kernel, exporter or geometry store is introduced. The host
integration is the generic `src/plugins/panelExtensions.tsx` registry and one
slot in `plugins/reverse/ui/ReversePanel.tsx`.

This plugin is included at build time. To omit it, exclude its folder before
building. `?plugins=none` disables all plugins for host smoke checks; independent
runtime installation and package updating are not implemented. A build that
removes the reverse source must also omit this dependent plugin.

## Tests

From the repository root:

```bash
npx vitest run plugins/tmar-body-export/tests/bodyExport.test.ts tests/exportStl.test.ts
node plugins/tmar-quick-notes/scripts/e2e-tmar-web.mjs
npm run build
node scripts/check-plugin-boundary.mjs
```

The combined browser regression uses synthetic geometry and an isolated Chrome
profile. It downloads a selected 40 × 20 × 10 mm CAD block and verifies that the
STL excludes a differently sized source scan and a second body. `CHROME` can
specify the browser executable. Browser-test results do not qualify untested
platforms or arbitrary production models.
