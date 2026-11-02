<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# STEP-as-Scan borders and TMAR build identification

Verified November 2, 2026. Base: `212ad150a5858d47d83b7f1e721856c945026ce1`.
Tested source: `94d092fa171a8d095b1b53cc1e420827a7b4ebc4`. User visual acceptance remains **OPEN**.

## Reproduced cause

The reported screenshot loads a STEP as **Scan**, with zero editable bodies.
The preceding implementation covered CAD bodies and STEP references only. The
scan parser discarded boundary metadata and the display plugin had no scan-edge
source. Increasing the line width could not draw edges that never reached it.
This is a missing supported import route, not an incorrect user setting.

The original STEP face boundaries now travel with the scan display buffers.
The face tessellation/mesh graph remain unchanged. Boundaries are keyed to the
actual scan geometry, survive shading resplits and project reopening, and follow
the scan frame. Mesh replacement invalidates old topology instead of transferring
STEP edges onto STL/PLY/OBJ or a geometrically edited preview. A baked transform
also updates its separate display coordinates. The reusable edge layer draws
boundaries and silhouettes, never all internal triangle sides; it does not take
picking events. Scan fill uses the same edge/Zebra depth contract as CAD bodies.

The panel identifies **STEP loaded as Scan**, instead of telling that STEP user
that an STL lacks topology. Native-body tangent settings are only offered when
bodies exist. STEP mesh routes show their original face boundaries, including
fillet interfaces, but do not claim an editable CAD body was created.

## Actual verification

Windows ASUSDESKTOP, Chrome, Node 26.8.1. Isolated worktree and owned profiles.
Whole-app TypeScript and production build pass. 117 targeted Vitest tests
pass, plus 26 category-resolver checks and two build-provenance Node tests.
Plugin boundary and display-unit policy pass. Zebra reflection regressions and
previous category, note, export, import and production checks are retained.

| Browser scenario | Final result |
| --- | --- |
| step-scan | 22 checks, exit 0 |
| cad-edges | 25 checks, exit 0 |
| categories | 35 checks, exit 0 |
| zebra | 32 checks, exit 0 |
| usability | 40 checks, exit 0 |
| tmar-web | 15 checks, exit 0 |
| reverse-notes | 54 checks, exit 0 |
| note-provenance | 22 checks, exit 0 |
| step-scan-production | 16 checks, exit 0 |
| cad-edges-production | 9 checks, exit 0 |
| category-production | 22 checks, exit 0 |
| focus-production | 31 checks, exit 0 |
| production | 9 checks, exit 0 |

Total: **332 passing synthetic application-browser assertions**. The same
local STEP file from the user's report was separately checked as **Scan**, not
as a CAD-body workaround: 23 development-app and 17 compiled-UI
checks passed. This file and its screenshots remain private/local. No native
QuickSurface window was opened, controlled, reloaded or saved in this follow-up.

The new image checks crop the actual model area, excluding controls and hints:
a changed checkbox is not accepted as proof of visible edges. Tests compare
on/off, changed color and the reported **5.5 px** width. They retain identical
source buffers/materials under style changes, no triangle-wireframe activation,
scan note placement/focus, source visibility/clipping, project roundtrip and
removal of stale lines after switching to an STL. Production uses public UI and
checks original STEP bytes in a downloaded project, not development globals.
The original local STEP hash is unchanged.

The header badge is checked against the compiled source, including its clean-tree
state and the matching full revision in Settings. ScanRuler's inherited version
is unchanged. The badge remains visible in the tested compact header. No server
lookup, telemetry or agent connection is added. A blank-source/no-Git fallback
and dirty working-tree detection are covered independently.

## Scope and intermediate corrections

The first development check caught a missing boolean in the new Settings button;
it was corrected. Its hide-scan assertion also needed the Reverse workspace's
own visibility store, not the independent 3D Measure flag. Both checks were
retained and rerun. Intermediate failures are not counted as passing results.
Existing Node localStorage/build-size/profile-cleanup warnings remain recorded
in local logs. No success of hosted GitHub CI is inferred from local results.

This change does not create CAD topology for ordinary STL/PLY/OBJ, implement
split-view notes, repair geometry or provide general QuickSurface parity. Mac,
Safari/Firefox, all possible source files and the complete upstream suite are
not qualified. User review of Zebra and the reconstructed model remains open.

## Reproduction

```sh
npm run build
node --test scripts/test-build-identity.mjs
npx vitest run tests/cadBoundaries.test.ts plugins/tmar-cad-edges/tests plugins/tmar-build-info/tests
node plugins/tmar-cad-edges/scripts/e2e-step-scan-edges.mjs
node plugins/tmar-cad-edges/scripts/e2e-step-scan-production.mjs
```

The first script owns a dev server; the second uses a compiled preview. Each
owns its browser profile. Optional `REAL_STEP` selects an authorized local file;
never attach these scenarios to a live user tab. `EXPECTED_SOURCE_REV` checks
that the compiled badge records an exact clean commit. Preserve historical
validation documents as records of their original, narrower scope.
