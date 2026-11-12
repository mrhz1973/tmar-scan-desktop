# TMAR Edit Surface — Host V5 tool palette and true XYZ gizmo

Date: 12 November 2026. Integration branch: `integration/host-v5-ux-20261111`.
Baseline: ScanRuler 0.11.1 + TMAR Versione 5, starting from `c268658d5677440703618cd9524b5722dfadf9a0`.

## Scope

This integration affects only `plugins/tmar-edit-surface/**` and its isolated tests. It does not modify a production deployment, the Tube Finale CAD/copy 6b, T2 refinement, the BREP V3 adaptor or the other agents' worktrees.

The **real Versione 5 workspace** uses `WorkspaceSurfaceParameters.tsx` (not the legacy standalone modal). Its six bilingual tool groups are Select, Move, Modify, Edges/Constraints, Analysis and History. Existing CAD controller commands are retained behind the palette, with the host-owned Apply/Cancel footer untouched. Italian is the default; English uses the native V5 language store, without resetting numeric drafts.

The V5 CAD viewport renders three simultaneous world-X/Y/Z arrows on each editable selected pole, with local U/V/N also available. Pointer picking uses the V5 host's own transformed part-to-screen projection and selects the arrow's actual direction, not the previously chosen numerical axis. Protected poles have no draggable arrow. On selection their constraint reason is explained, with a conditional G0 suggestion for the G1 tangent ring, never automatically bypassing shared seams.

## Evidence — actual V5 host, isolated synthetic six-face CAD body

- `gizmo.receipt.json`: **PASS 7/7**, host viewport pointer drags and Undo for X, Y and Z; delta X `+1.0956182806328485` mm, Y `+1.3274134410658824` mm, Z `+1.0089500856702234` mm; other two coordinates unchanged in each case. No browser errors.
- `palette.receipt.json`: **PASS 20/20**, six active groups, host Apply/Cancel visible, G1 remains protected, locked-point reason displayed without changing the guard, world XYZ default, Italian/English switch preserving an uncommitted numeric input, no browser errors.
- Vitest targeted: `surfaceGizmo.test.ts`, `poleEditability.test.ts`, `workspaceGizmoPick.test.ts`: **12/12 PASS**.
- TypeScript `tsc --noEmit`: **PASS**.
- Production `npm run build`: **PASS** (verify again on the final integration commit and in CI).

Source Windows test receipts:
`D:\TMAR_HOST_V5_UX_QA_20261112\v5-gizmo-IqDJTp\receipt.json`
`D:\TMAR_HOST_V5_UX_QA_20261112\v5-tools-fvNqDC\receipt.json`

Receipts were copied byte-for-byte into this folder, SHA-256:
- `gizmo.receipt.json`: `9d1e2b576869755287d14e0bf15911a2cc27e27d71aa313d1fec7809b789f45c`
- `palette.receipt.json`: `9996e95c7ec11440f9ac6b399ce900f3dd16107b00e4d16908e38a89949f99c8`

## Limits and release gate

No complete V5 Apply→project Save→Reopen acceptance has been established by the tests above; the historical UX branch's 50/50 synthetic report does **not** qualify this exact V5 host/plugin pairing for that roundtrip.

This is not validation of full Tube Finale geometry, global G1, pcurves/seams, solid validity, thickness, dimensional preservation, or STEP roundtrip. Do not merge or deploy to Stable before the full CI and project roundtrip are qualified. Do not repeat already consumed native Tube/T2 probes.

Keep the existing plugin owner branch, CAD live, protected files and WIP untouched.
