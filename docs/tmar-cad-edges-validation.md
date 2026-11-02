<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# CAD edges / Zebra / STEP reference — validation

Checked November 2, 2026. Base `82998e5f3d44fd3ce38b902d27bc8c106dad5493`.
Tested source `85a1586a2a7fcafc99d9c624fb39a8bbfbed42af`. Documentation is not final user acceptance.

## Findings and change

Editable CAD bodies already had face/fillet boundary and silhouette rendering,
including a Tangent edges option. Zebra's negative polygon offset could place
its depth-writing fill in front of them. The fix reuses these lines and changes
only display depth ordering, keeping depth tests and source material ownership.
A dedicated optional plugin exposes the switch, color and pixel width.

The reference STEP parser formerly discarded CAD face identities after
meshing. A pure display helper now retains cross-face and open-boundary segments
from the same tessellation, excluding same-face internal triangle diagonals.
Buffers/units travel through the existing worker; numerical geometry is unchanged.
Reference silhouettes are drawn in the reference datum frame, not the scan's
alignment frame. Mapped and ordinary reference fills follow the same depth rule.

## Actual checks

Windows / Node 26.8.1 / Chrome 156.0.8078.74, isolated browser profiles.
The final targeted suite passed **88 unit tests** across 15 files. An additional
**26 tests** passed for STEP import/round trips, reference-map geometry, import
queue, native edge lines and silhouettes (114 unit tests across those two runs).
The 26 dependency-free category resolver checks also passed. Whole-app TypeScript,
production build, plugin boundary and unit-policy checks passed. Existing category, export, note security,
Zebra reflection and compiled focus/panel regressions were retained.

| Browser scenario | Result |
| --- | --- |
| cad-edges | 25 assertions; exit 0 |
| categories | 35 assertions; exit 0 |
| zebra | 32 assertions; exit 0 |
| usability | 40 assertions; exit 0 |
| tmar-web | 15 assertions; exit 0 |
| reverse-notes | 54 assertions; exit 0 |
| note-provenance | 22 assertions; exit 0 |
| cad-edges-production | 9 assertions; exit 0 |
| category-production | 22 assertions; exit 0 |
| focus-production | 31 assertions; exit 0 |
| production | 9 assertions; exit 0 |

Total: **294 passing synthetic application-browser assertions**. Final
processes exited 0 with no application console errors. Separate real-file reruns
are not added to this total. Hosted CI success is not inferred from local tests.

The unit checks verify exact source position/index equality across STEP parsing,
no internal diagonal on a shared CAD face, a real boundary between tangent faces,
width/color normalization, reference-frame placement, clipping, cleanup without
disposing source geometry, and Zebra's depth relation to CAD lines. A cube edge
may contain multiple collinear segments; its 12 geometric supports and total
edge length, not an arbitrary segment count, are verified.

Browser checks inspect actual rendered changes for edge on/off, color and width,
fillet edges, non-mutated buffers/material identities, face picking, local note
placement/focus, reference loading, clipping, guarded split view and project
round trips. The production test has no development hooks and loads a real
saved synthetic project. Mesh wireframe is not used to substitute for CAD edges.

## Same-file native comparison

An authorized local STEP exported by Revo Design was opened unchanged in
Revo Design Pro 8.0.123 (QuickSurface executable), and separately as editable CAD
and a Surface Deviation reference in this fork. Private diagnostics record the
file SHA-256 and screenshots; the source model and native project are not public.

The comparison used visually corresponding three-quarter views, with equal X/Y
view components, Z up and about 30 degrees elevation in the target. Native camera
matrices were not exported: this is an equivalent visual inspection, not an exact
pixel-registration claim. Face rims, tangent fillet borders and visible outlines
were examined with Zebra enabled. Target edge on/off and custom widths/colors were
also checked on that same file. Model geometry was not edited or saved by the
comparison. Independent STEP/OCCT tessellation and stripe width affect band shape;
no universal shading equivalence is inferred.

## Limits and intermediate corrections

The initial cube test assumed one segment per straight edge; it was corrected to
verify exact geometric support and length. An early browser fixture imported an
extra coincident body; the fixture now checks body counts and avoids duplicates
before evaluating edge visibility. Those attempts are not final PASS evidence.
Existing WASM/chunk-size, Node localStorage and Windows profile cleanup warnings
remain explicit where encountered.

Current limits: single-view Deviation; scan-side note placement; no topology for
mesh-only references; no macOS/Safari/native-touch qualification or full upstream
suite. The owner is still reviewing the visual result. Generalized real-part
accuracy, continuity and manufacturing suitability remain unqualified. See the
[open review backlog](tmar-review-backlog.md) and [plugin use](../plugins/tmar-cad-edges/README.md).
