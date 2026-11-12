# Direct left-mouse control-point drag — ScanRuler V5

Date: 12 November 2026. Branch: `integration/host-v5-ux-20261111` / PR #48.
Starting checkpoint: `83f0b0016613edcc69e42ff65ac9c5eefb17975d`.

## Operator interaction

- **Yellow movable pole:** left mouse button down on the pole, move the mouse, release to commit. It moves freely on the **camera-facing screen plane through that control point**. The same visible pole tracks the pointer in both viewport directions. Moving in depth requires orbiting the camera and dragging again (or using a precise XYZ axis).
- **Coloured XYZ or U/V/N arrow:** unchanged, constrains the displacement strictly to the selected arrow axis.
- **Multiple selected movable points:** dragging an already selected yellow pole retains the selection and moves all selected editable poles by the same CAD-space displacement.
- **G0/G1 boundary, trim and manual locks:** unchanged. A locked point cannot move via the new gesture.
- Other canvas gestures (Fusion Shift+MMB, MMB pan; CNC Kitchen empty-canvas LMB orbit and RMB pan; orientation gizmo) are unchanged.
- On-screen Italian/English hint documents direct drag and view/depth limitations. No CAD command, source body, project file schema, native T2/BREP or global geometry is modified.

## Exact V5 synthetic QA

Three untouched receipts copied from original isolated browser runs (the copies have matching SHA-256):

- `direct-pole.receipt.json` — **14/14 PASS**. Direct LMB drag on non-central G0 pole 6 tracks the screen displacement with sub-pixel error (~`5.7e-14` px). CAD delta includes multiple components. Multi-selection [6,7] moves both by an identical vector, retained selection and Undo restores both. The G0 boundary pole 0 cannot be dragged. No browser JavaScript errors.
  SHA-256: `f38a8793ca04f69bc6cfa2efdec78fe9f9c4e51a1e7367bd34a933ccb4502898`.
- `xyz-arrows.receipt.json` — **7/7 PASS**. X, Y, Z each continue to move only their own world coordinate with actual V5 mouse pointer drags and Undo.
  SHA-256: `7dfaf3dbdcbcb5a857721c42a531869b2836c30d684fa4c981b573f4b50a4e8a`.
- `navigation-host.receipt.json` — **17/17 PASS**. Fusion/CNC Kitchen camera navigation, CAD duplicate, independent native readback, Undo/Redo and clean-page project reopen.
  SHA-256: `e8f5d44d714caf0a61c118adf80b7d0133f7dbb6cde1600dae7e9fdd2ecd8e2d`.

Targeted Vitest **167/167 PASS** across six files including new `workspacePoleDragMode.test.ts` (all three user modes, axes/face/cell/edge exclusions). TypeScript `tsc --noEmit` PASS. Production `npm run build` PASS; diff check PASS.

## Qualification boundary

QA runs above were performed against an **isolated synthetic OCCT box**, not the Tube Finale 6b or any production CAD document. New direct LMB drag is in the unmerged V5 integration branch. No stable or VPS deployment, Git merge, native BREP V3/T2 solve, or original Edit Surface worktree modification occurred. GitHub CI and operator visual acceptance of the exact new head remain required prior to release. Preserve consumed Tube native markers and WIP.
