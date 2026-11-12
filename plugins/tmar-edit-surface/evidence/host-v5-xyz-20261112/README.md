# TMAR Edit Surface — real Host V5 UX qualification

Date: 12 November 2026. Integration branch `integration/host-v5-ux-20261111`.
Baseline: ScanRuler 0.11.1 + TMAR Versione 5, main `c268658d5677440703618cd9524b5722dfadf9a0`.

## Scope and protected boundaries

This integration edits **only** `plugins/tmar-edit-surface/**` and its tests. It does not modify the original Edit Surface/T2 worktrees, BREP V3, Tube Finale STEP/copy 6b, CAD live, VPS or production installers.

The real V5 workspace uses `WorkspaceSurfaceParameters.tsx`, not the legacy standalone modal. The panel groups all existing controller actions into six compact bilingual icon tools (Select, Move, Modify, Edges/Constraints, Analysis, History); the host-owned Apply/Cancel footer is preserved. Native V5 i18n handles live Italian/English switching without losing a numeric draft.

The V5 viewport renders red world-X, green world-Y and blue world-Z handles on **every editable selected pole**, with U/V/N local mode still selectable. The host-space picker tests the real part-to-screen projection of each arrow; dragging an arrow chooses that direction regardless of the previous numerical axis and translates the editable multi-selection. Locked control points do not get draggable arrows; selecting one displays its guard reason. G0/G1 and shared seam protection remain enforced by the pre-existing CAD controller, without automatic unlocking.

## Isolated synthetic CAD evidence

- `gizmo.receipt.json`: **PASS 7/7**, actual V5 browser pointer gestures + Undo, X `+1.0956182806328485` mm, Y `+1.3274134410658824` mm, Z `+1.0089500856702234` mm, with the two off-axes unchanged on each move; zero browser errors.
- `palette.receipt.json`: **PASS 20/20**, six tool groups, selected protected G1 pole explanation, world XYZ default, live Italian/English switch preserving numeric input, host Apply/Cancel visible; zero browser errors.
- `roundtrip.receipt.json`: **PASS 9/9**, real V5 editor with synthetic box, numeric control-pole displacement, Apply as one new CAD body and one history entry; both source and copy reimport as valid native STEP solids with face count intact; Save Project writes a `.scanruler` and a new browser page reopens the edited solid with the same volume; zero browser errors.
- Targeted Vitest: `surfaceGizmo.test.ts`, `poleEditability.test.ts` and `workspaceGizmoPick.test.ts`: **12/12 PASS**.
- TypeScript `tsc --noEmit` and production `npm run build`: **PASS**. `git diff --check`: **PASS**.

Original local test receipts:
`D:\TMAR_HOST_V5_UX_QA_20261112\v5-gizmo-IqDJTp\receipt.json`
`D:\TMAR_HOST_V5_UX_QA_20261112\v5-tools-fvNqDC\receipt.json`
`D:\TMAR_HOST_V5_UX_QA_20261112\v5-roundtrip-eEIpoY\receipt.json`

SHA-256 of original receipts copied byte-for-byte into this folder:
- `gizmo.receipt.json` — `9d1e2b576869755287d14e0bf15911a2cc27e27d71aa313d1fec7809b789f45c`
- `palette.receipt.json` — `9996e95c7ec11440f9ac6b399ce900f3dd16107b00e4d16908e38a89949f99c8`
- `roundtrip.receipt.json` — `36aeb8e60500a1246943671c2c96ac65066a9d17b9eabeb76c432cc3e66458f9`

## Remaining release gates

The three browser scenarios qualify only their **isolated synthetic** V5 host/plugin combination. They do not establish general production stability for arbitrary CAD geometry or the Tube Finale. Native Tubo acceptance remains separate (full geometry, continuous G1, pcurve/joins, protected faces, volume/thickness/dimensions, global STEP roundtrip and 16 gate matrix).

Do not merge or deploy to Stable before GitHub CI is complete and the operator has reviewed the new interface. No consumed Tube, BREP V3 or T2 native test was repeated. The other agents' protected WIP remains unchanged.
