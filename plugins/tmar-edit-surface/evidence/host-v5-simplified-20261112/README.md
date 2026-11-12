# Host Versione 5 — simplified control-point editing and bilingual interface

Date: 12 Nov 2026. Built on PR #48 integration branch `integration/host-v5-ux-20261111`, base `63c1980ac73608f43f11363a876692c39b67b5b8`.

## Reported issues and corrections

The G1-protected 5×5 control net made only its centre pole editable; moving another selected inner-ring pole showed no manipulator. The UX now displays `movable / total` counts, a high-visibility protected/editable legend and a plain-language button to allow more **interior** points with the shared boundary fixed. On a selected G1 tangent-ring pole, the contextual action switches to G0 through the existing guarded controller; the selected point remains selected and becomes movable with X/Y/Z arrows after the viewport redraw. The command is disabled when G0 changes are incompatible with ongoing tangency/gestures. It never unlocks shared solid boundaries or trim/manual locks.

The original V5 workspace and host dock were partially Italian when global English was selected, because presentation strings were authored as Italian source literals. A scoped panel catalog now covers 190/190 distinct literal UI messages in Italian and English, with placeholder interpolation. Host dock English source strings use the standard core i18n catalog, while launcher English sources use the existing plugins catalog. CAD model names, user notes, data, units and saved recipes are never translated. The interface's internal G0/G1 labels now explain what each protection choice does, and manual unlocking is explicitly distinguished from geometry guards.

## Isolated proof on a synthetic six-face STEP solid

- Actual V5 workspace browser: **PASS 15/15** in `lock-language.receipt.json`.
- G1 shows 1/25 movable points; an explicitly selected inner-ring point is protected; one-click G0 unlocks nine interior points; the same point then has three separate X/Y/Z handles; all boundaries remain guarded.
- Global English change updates the host Edit Surface header, launcher tooltip, tool panel, technical dropdown and selection explanation while retaining the selected pole. The visible Italian language selector restores Italian without editor reload. No browser JavaScript errors.
- Targeted Vitest: **143/143 PASS** across five files, including 129 session tests and the static 190/190 translation coverage test.
- `tsc --noEmit` and `npm run build`: PASS. `git diff --check`: PASS.
- Receipt SHA-256: `2d27ce5827ac8e9be49f9ee473660dac59a8cb93789073683cc469a0c92d39ca`.
- Original receipt: `D:\TMAR_HOST_V5_UX_FIX_QA_20261112\v5-lock-locale-Pr6dEJ\receipt.json`.

## Explicit limits

These are synthetic workflow and interface tests. This result is **not** a global qualification of Tubo Finale, BREP V3/T2, continuous G1, shared seam pcurves, thickness, volume or full STEP roundtrip on Tube geometry. It does not authorize the UI to edit shared solid boundaries. No CAD live, copy 6b, predecessor protected WIP, VPS or Stable deployment was changed.

The PR stays draft pending the next complete GitHub CI and operator approval of this exact new head. Do not repeat consumed native Tube tests.
