# ScanRuler TMAR — Host qualification of Duplicate CAD Face (dd8f3b8)

Date: 2026-11-07. **DRAFT / HOLD; host QA only.** Base host PR #39 `b11ad183ad8393c66554957eb7d453132fab385f`. Plugin overlay: `dd8f3b89978822d7d0d6424d39a466e96b8bfff1`, exact subtree `eb684fb305d2425bb2fc20ee823fad360c0421c4`.

## Scope and ownership

- This host work includes only `plugins/reverse/tests/**` and this `docs/coordination/**` file. **No host runtime change or plugin contract change.**
- Keep PR #41 off-screen v6 parametric history recovery distinct. The duplicated sheet publishes via the pre-existing ordinary `cad-copy` transaction and has **no** stored `surfaceEditHistory` sidecar or procedural `surfaceEdit` feature.
- No integration into installed applications, no changes to source CAD, AIRBOX/Tubo Finale, package, installer, merge or release.

## Existing bounded UI evidence (read independently)

Author's GUI report:
`D:\TMAR-QA\edit-surface-whole-boundary-gui-20261107\workspace-duplicate-cad-face-gui-6CGeys\result.json`

- Verdict `PASS_BOUNDED_GUI_DUPLICATE_CAD_FACE`, 6 checks; host `b11ad183`, plugin checkpoint `dd8f3b8`; source synthetic box 20 × 30 × 10 mm, SHA-256 `69ef2314c1cff4b2bd5bf01036ebb8765ded1941fb6ffa000141e0a034cd0105`.
- UI chooses one natural top face, stale preview blocks Apply without changing project, Apply creates visible ID 2 sheet via `cad-copy` (source remains visible), Undo removes the sheet and Redo restores it, new copy can be reopened in Edit Surface through the body chooser.
- Source: valid six-face solid, 6000 mm³. Copy: valid single face, 0 solids, one wire/four edges, area 600 mm²; 81 planar samples with maximum measured deviation 0 mm.
- Console errors [], browser exceptions [], startup navigation single. The 2216 `diagnostics.startupModuleEvents` events were not loaded as part of this qualification.
- Prewarm handoff: `D:\TMAR-QA\edit-surface-whole-boundary-gui-20261107\duplicate-cad-face-prewarm-run-clr9ht7o\handoff.json`, `harnessExitCode:0`, `status:ONE_ATTEMPT`, no restore conflicts and server stopped. This does not prove the cause of the earlier React Invalid hook call.

## Independent host regression added

`plugins/reverse/tests/surfaceDuplicateCadFaceHost.test.ts` opens the same-size independently generated synthetic box in the real host Reverse command/session/kernel path. It calls the plugin's current `duplicateCadFace(previewRevision)` to produce a detached STEP, then exercises **existing host** `stageEditorCopy`, one `cad-copy` publish and history, Undo/Redo, Reverse archive `collectReversePart/applyReversePart`, and `reverse.body.edit_source` after restoring both bodies. Source remains a valid six-face solid with 6000 mm³, copied sheet remains a valid one-face zero-solid 600 mm² CAD surface; editor reopens the copy on the current host source binding. The copied `ImportFeature` has no parametric recipe sidecar, by design.

Independent QA working directory:
`D:\TMAR-QA\tmar-host42-duplicate-face-dd8f3b8-qa-20261107`
Evidence:
`D:\TMAR-QA\tmar-host42-duplicate-face-evidence-20261107`

Initial isolated Vitest gate on the host test + existing host CAD-source tests + plugin native face-copy tests: **8 PASS / 0 FAIL**.

## Unqualified gates and decision

- Project persistency is established for the **native Reverse section archive** in a headless host test, not through the complete application `.scanruler` ZIP save/load UI or a cold packaged desktop restart.
- One planar natural face of a synthetic solid only; not a general curved CAD face, trimmed support, pcurve continuity, real scan/owner STEP, thickness/assembly or QuickSurface parity qualification.
- No claim of parametric persistence: the duplicate is an ordinary editable CAD sheet, not a rebuilt procedural feature.
- A successful Vite prewarm is a bounded mitigation, not proof that HMR mixing caused the earlier React hook error.
- **HOLD** broader UI, merge, release and integration with shared-plane/native sewing or the parametric PR #41.

**NEXT:** independent reviewer checks the exact pinned pair and scope. Qualify a curved natural face, full project ZIP Save/Reopen, cold packaged application and any new UI guards separately. Maintain ordinary CAD-copy fallback without inventing a recipe.
