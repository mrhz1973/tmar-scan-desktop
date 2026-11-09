# Edit Surface — saved STEP coefficient checkpoint

Updated 2026-11-09. This chat owns `plugins/tmar-edit-surface/**` and executes plugin work. Host/kernel/MCP updates and coordination remain outside this owner; Tube CAD/candidate work remains with Tube. Do not merge or alter live sessions.

## State to resume

Assigned worktree: `edit-surface-tubo-periodic/tmar-scan-desktop-zebra`; resolve its absolute location from `git worktree list` and the private handoff.
Branch: `codex/edit-surface-tubo-periodic`.
The support increment is committed/pushed at `b699c6eb08a73621774adab2f00c821297ef4173`, parent `1abf89d214ed5898e362a714a5bbb64d5ad15196`. The rim increment is committed with this checkpoint; reconcile its actual HEAD/remote before doing anything else.

The other `codex/edit-surface` worktree, the pre-existing Tube WIP and `EditSurface.tsx` are outside these changes. The original 43 protected WIP files remain unchanged. Current private preservation baseline contains 86 files at `evidence/recovered-rim-affine-b699c6e.local/baseline.local.json`, SHA-256 `4a566d6a4014ad3e42952f70382663392decdfa3b2b848039800b12663e457dc`. Include the newer artifacts too when forming a baseline for the next increment.

Checkout and installed kernel: `0.9.4 / occt-wasm 5.7.1`. The completed read-only comparison with ScanRuler `0.9.10 / occt-wasm 5.15.0` is in `evidence/recovered-rim-adapter-20261109/API-COMPARISON.md`; do not repeat it or install anything for this checkpoint.

## DONE

- The previous CAD pair roundtrip remains **STOP `reopened-own-support-mismatch`**. Its saved receipt SHA-256 is `32f2b99c16c5f4ddf4177c5b8ec2431ebd9cc7c417dcf502595ed779b87fcc92`. Native validity/topology was reached; post-STEP native rim/pcurve/sample gates were not. The 945 samples belong only to pre-STEP.
- New support coefficient proof, on the existing saved pre/post BREP texts: bounds `2.891975547925087e-11 mm` (323), `2.930494735764457e-11 mm` (324), 1,134 cells each, accounting for poles AND U knots. Full-domain identity UV, not a native-CAD claim. See `evidence/recovered-support-correspondence-20261109/`.
- The saved oriented graph, own-face pcurve maps/ranges and all edge ranges/headers agree. Two vertex positions change within outward L1 `9.062972594620083e-12 mm`. The shared rim label changes C2→C1; this is metadata, not a derivative result. Some other curves also change representations or coefficients.
- New rim coefficient proof: exact closed-clamped239→canonical-periodic238 identity followed by pre/post STEP drift bound `2.5200029563077225e-11 mm`; post-rim versus323/V-min `1.5931700403371003e-14 mm`; versus324/V-max under its exact affine pcurve `2.1633226460204837e-11 mm`. Three comparisons, 1,085 cells. See `evidence/recovered-rim-affine-correspondence-20261109/`.
- 13 support/extractor tests and 8 new curve tests passed, with targeted TypeScript checks. The 13 were not rerun during the rim increment. All new real-data proofs were pure coefficient calculations: no OCCT initialization, import/export, sewing, CAD sampling or live action.

## Consumed — never replay

Earlier native attempts remain under `evidence/recovered-rim-6b-8540f37.local/`: adapter-1, materialization-1 and pair-roundtrip-1, together with their markers and private one-shot runners. Older Tube consumed tests/markers remain protected too.

New support attempt: `evidence/recovered-rim-support-1abf89d.local/coefficient-analysis-1.local.run-once`, receipt SHA-256 `6fd01a409c2721fb6f18abc8086578dc37e0a20a027f7ccccdf2563a6d170d12`.

New rim attempt: `evidence/recovered-rim-affine-b699c6e.local/rim-affine-1.local.run-once`, receipt SHA-256 `2127916903deb8cd368e7792ffa655600784fcc92fa4c3cff8ccdc1b94457aed`.

The latter directory retains its original preflight draft and final preflight/bundle. Only `rim-affine-1-final.local.cjs` was executed, once. The final private driver explicitly requires `kernelRuntimeImported === false`.

## NEXT — separate remaining contracts

1. Finish coefficient correspondence for the other curves of the saved two-face pair, without transferring the shared-rim result. Edge ID 5 is padded/nonperiodic before STEP, periodic afterward: it cannot use the closed-clamped canonicalizer directly. First require an exact/reported-error clamp on its own active interval using the existing helper, then carry any clamp error outward into a separate bound. Edge IDs 10 and 4 are quintic with unchanged knots/multiplicities and changed poles; edge ID 9 already has exact serialized coefficient agreement.
2. Keep derivative/G1 and regularity separate from position bounds and C2/C1 labels. Establish the precise derivative/orientation comparison needed before any new bounded experiment. No positional bound supplies a G1 certificate.
3. Any future native qualification must use a separately declared contract and new evidence. Do not weaken the old exact-signature guard, edit its receipt or rerun the consumed STEP experiment to manufacture a PASS.

## WAIT / limits

The absent post-STEP native checks cannot be recovered as completed measurements from the old stopped attempt. The saved-text proofs certify the mathematical binary64 coefficient models. They do not enclose the OCCT evaluator's arithmetic or accept the full Tube. No synthetic PASS, support PASS or rim coefficient result is automatically transferable to Tube.

The original handoff and archive provenance remain in the preceding reports. Do not infer full transcript access from a chat title. No direct cross-chat delivery is claimed. AIRBOX remains paused. Do not repeat M08/NPZ/source/archive recovery already recorded in the earlier evidence.
