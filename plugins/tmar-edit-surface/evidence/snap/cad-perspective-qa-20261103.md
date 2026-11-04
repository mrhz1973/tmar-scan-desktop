<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# CAD snapping: perspective test correction and gesture integration

2026-11-03. Source-only isolated QA against `127.0.0.1:17525`; synthetic box and second CAD body. No production build, main-viewport integration, user project or QuickSurface parity claim.

Before correcting the test, the full `e2e-snap-cad.mjs` run **failed** on both the preceding HEAD viewport and the gesture-integrated viewport, with identical measurements: snapped center Z 10.5 mm, Alt center Z 10.4641652049835 mm. The comparison is not counted as a pass.

The test formed its 1.5 mm pointer destination by projecting a much longer axis segment, then linearly scaling that pixel displacement. That is not valid for a perspective projection. A read-only probe of the actual synthetic viewport found its world matrix differed from the test reconstruction by at most 1.43e-14. Projection matrices differed by 0.00072 because the viewport used an integer client width of 1085 px while its bounding rectangle measured 1085.390625 px. With the runtime camera, the prior pointer destination yields 1.8566607685 mm along the axis; projecting the actual +1.5 mm endpoint yields 1.5000000000 mm.

The test now projects that endpoint directly. No assertion or tolerance was weakened. One subsequent complete source run **passed**: snapped center Z 10.5 mm, Alt and disabled-snap center Z 10.37499992666925 mm, no console errors; its existing checks reimport valid six-face, one-solid STEP outputs. See `cad-perspective-source-20261103.json`.

The separate source `e2e-snap.mjs` passed scan snapping, Alt, disabled snap, Escape capture release and foreign-pointer handling. `e2e-direct-selection.mjs` also passed picking, direct drag/Undo, pointer cancellation and view navigation. These test the prototype dialog, not the future shared viewport.
