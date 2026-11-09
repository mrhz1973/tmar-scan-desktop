# Edit Surface — completed saved-pair checkpoint

Updated **2026-11-09**. This chat executes `plugins/tmar-edit-surface/**`. Coordination and host/kernel/MCP changes remain with the coordinator; live Tube CAD/candidate work remains with Tube. No merge or live-session change is authorized by this checkpoint.

## Reconcile before resuming

Assigned worktree: `C:\Users\mrhz\.codex\worktrees\edit-surface-tubo-periodic\tmar-scan-desktop-zebra`.
Branch: `codex/edit-surface-tubo-periodic`.
Parent acquired by the coordinator for this increment: `1887859163f8fd260189e5cbd218acdd007a9c91`. The saved-pair contracts below were completed in that checkpoint; the distinct candidate preparation follows it. Obtain the exact new HEAD and remote ref from Git before continuing. The other `codex/edit-surface` worktree is outside scope.

The original `EditSurface.tsx` WIP and all **130 inherited protected files** remain unchanged. The new preservation manifest contains **146 files**:

`evidence/modified-candidate-1887859.local/preservation-final.local.json`

SHA-256: `35168a99af24d3876f38d268a07d1f56f598ae563974b50a9dec519e3581aa44`.

The manifest itself and later commit/push receipts must enter the next baseline. The earlier 127-file manifest (SHA-256 `de9c4680960bb05a072317e733745cffd6ed387d599f7d9cf815a86f6a0020d6`) remains preserved. Never overwrite a manifest or consumed marker.

Checkout / installed kernel remain `0.9.4 / occt-wasm 5.7.1`. The earlier read-only API comparison with `0.9.10 / 5.15.0` remains acquired in `evidence/recovered-rim-adapter-20261109/API-COMPARISON.md`. Do not repeat it or install/update anything to reproduce this checkpoint.

## DONE — NEXT from 360d460 completed

### Acquired position proofs, not replayed

- Full-support coefficient position bounds for 323/324 remain those committed at `b699c6eb08a73621774adab2f00c821297ef4173`.
- Shared-rim coefficient correspondence and the two explicit support-boundary maps remain those committed at `360d460`.
- The indexed/oriented graph and exact serialized identity of edge9 remain acquired from the saved topology receipt. No second old topology experiment was run.

### New other-curve correspondence

- Edge5: its own padded clamp returned exact binary64 emission and zero clamp error; subsequent identity-parameter periodic comparison bounds the continuous difference by `2.4797369019280437e-11 mm` over378 common cells.
- Quintic edges10/4: unchanged-basis coefficient hulls bound the continuous differences by `1.5036860645523127e-11 mm` and `1.7640999772083897e-11 mm`.
- The padded and quintic contracts remain distinct; no shared-rim PASS was transferred.

### New derivative, tangency and regularity evidence

- Common normalized parameter: `S323(252.00932454753*s,0)` and `S324(261.52535017517*s,1)`. `T=period*Su`; transverse fields use increasingV. Inward transverse signs are+1/-1. The reversed edge use on324 does not invert its positive affine map.
- The post-STEP joint has continuous oriented normal-sine upper `3.4722390945302286e-9` under the declared1e-6 criterion, with positive tangent and normal lower bounds on471 common cells.
- All **708 native polynomial cells of each support** are regular. Native `||Su×Sv||` lower bounds are `5.7563073973595795` and `5.434544778129242`.
- Natural periodic seams are treated separately. Their all-V unit-normal chord bounds are `5.776655784808827e-11` and `7.513744727525126e-11` under the1e-6 criterion.
- Boundary pre/post derivative drift satisfies the declared Euclidean1e-6 budgets. Face324 needed an independent targeted squared-Euclidean hull: upper `5.712958998687521e-13`, below the squared budget. The first L1 upper `1.1979254543881274e-6` and its initial `localCriteriaSatisfied=false` remain in the first receipt. The criterion was not relaxed and that receipt was not amended.
- Tangency is within the declared tolerance of the coefficient models. ExactG1, global injectivity, native continuous arithmetic and full-Tube acceptance are not claimed.

### New native readback contract

One new isolated `fromBREP` on the existing saved post-STEP BREP satisfied its declared native criteria. It observed a valid two-face, five-edge, three-vertex shell; exact post-STEP support/curve associations, own pcurves/ranges and oriented uses; and a byte-identical BREP readback.

New coverage:1,583 curve parameters;2,312 curve/surface associations;1,536 direction comparisons;1,416 interior cell normals;472 joint normal pairs. Largest curve/surface gap `2.3162552761135214e-11 mm`; largest native joint-normal sine `1.3507876727045193e-10`. No STEP import/export, sewing, healing, fitting, deformation, mesh/volume or live CAD action occurred.

The native observations are sampled and separate from the continuous coefficient proofs. Raw surfaceD1 magnitudes are not exposed by the installed5.7.1 facade; no native derivative-magnitude or continuous regularity lower bound was claimed.

### Code and validation

Four new reusable helpers and four focused test files implement the curve, boundary differential, full-cell regularity and targeted Euclidean tangent contracts. **25 unique new pure tests passed**, plus the one distinct native readback test with its numerical receipt gate true. The8 new curve tests were rerun only after a TypeScript narrowing fix; no acquired support/rim tests were replayed. Final targeted TypeScript checks passed.

Full results, contract and public receipts:

- `evidence/saved-pair-differential-20261109/README.md`
- `evidence/saved-pair-differential-20261109/coefficient-summary.json`
- `evidence/saved-pair-differential-20261109/native-summary.json`
- `evidence/saved-pair-differential-20261109/tangent-324-summary.json`
- `evidence/saved-pair-differential-20261109/verification.json`
- `EXPERIMENTAL-SAVED-PAIR-DIFFERENTIAL.md`

## Consumed — never replay

All old Tube markers and the earlier native adapter, materialization and STEP pair attempts remain consumed. The historical STOP is still **`reopened-own-support-mismatch`**, receipt SHA-256 `32f2b99c16c5f4ddf4177c5b8ec2431ebd9cc7c417dcf502595ed779b87fcc92`. Its exact-signature guard and receipt are unchanged. Its missing post-STEP checks were not retroactively recovered as measurements.

The acquired support and rim markers remain consumed:

- `recovered-rim-support-1abf89d.local/coefficient-analysis-1.local.run-once`; receipt `6fd01a409c2721fb6f18abc8086578dc37e0a20a027f7ccccdf2563a6d170d12`.
- `recovered-rim-affine-b699c6e.local/rim-affine-1.local.run-once`; receipt `2127916903deb8cd368e7792ffa655600784fcc92fa4c3cff8ccdc1b94457aed`.

New consumed markers in `evidence/recovered-pair-completion-360d460.local/`:

- `coefficient-completion-1.local.run-once`; receipt `e569858adc9d89d8afe80a86cbbb64f4b7526da85dd6de91104ae0fb544a9413`.
- `native-readback-1.local.run-once`; receipt `05fd21686e2798dfca6c600a2f8becfd87b716f1cc373c5e504cb70084f25e3d`.
- `targeted-tangent-324-1.local.run-once`; receipt `d0871ad3ebd0ce6b964a24fbfa9c003cdf08c61c0ad80407d508e5e092022aac`.

Preserve all source hashes, preflight drafts/finals, failed initial typecheck, successful logs, native readback, receipts and runners. A new question requires a new declared contract and new evidence; do not clear a marker or weaken a guard to manufacture a PASS.

## DONE — modified candidate prepared after 1887859

The next requested candidate is now concrete: **`tubo-6b-derivative-storage-candidate-1`**, prepared at 2026-11-09T18:52:05Z with a distinct one-shot coefficient contract. See [EXPERIMENTAL-MODIFIED-CANDIDATE.md](EXPERIMENTAL-MODIFIED-CANDIDATE.md) and [the public evidence](evidence/modified-candidate-20261109/README.md).

- The real frozen bundle supplies inward-derivative targets for 323/V1–322/V0 and321/V0–322/V1. No translation or new fitting was invented. The packet labels 5 mm an estimate; the derivative-change cap is 5 mm/native-V.
- Both target and source inward-derivative arrays match the original bundle hashes exactly. New raw/periodic applicability for 321/322 has 14 exact zero-error clamps; 323 reuses its original saved BREP with exact raw coefficient identity.
- The candidate modifies 476 poles per lateral: 323 rows 9/10 in V[.95,1], 321 rows 1/2 in V[0,.05]. All other rows and basis data are identical. 322 and 324 remain unchanged. The qualified rim 323/V0–324/V1 remains a different relation from the bundle joins.
- Complete source/candidate nets, targets, all XYZ deltas and both replacement U seam curves are saved in `evidence/modified-candidate-1887859.local/candidate-1.coefficients.local.json` (1,112,885 bytes), SHA-256 `4b1e81b166e373707a9e0df1063bf757de6303e71a02d9a818631b3036b4350a`.
- New receipt: `candidate-preparation-1.local.receipt.json`, SHA-256 `9859fb45965821441fc8cd6a6e439ca21bad0c88843c9a672c008a04bcbf5777`. Preflight hash `1876d5e8ad5f1d76cdc2d606e02067d870cc73d5261297c57dcddcd7e86d4132`. Marker `candidate-preparation-1.local.run-once` is consumed; do not replay preparation to reproduce the artifact.
- Stored D1/D2 residuals are below 1.8e-12 in their declared native units. The maximum observed pole movements are 0.10000000000000121mm and 0.06492088175293244mm; these are not continuous surface-displacement bounds.
- Read-only STEP text recovery supplies the 321 U seam/far-boundary chain and all selected pcurve maps. No kernel/STEP import or old topology test was invoked.
- Nine new pure tests and final targeted TypeScript checks passed. The initial narrowing typecheck failure is retained. No old test, solve, kernel initialization, live CAD change, host/kernel/MCP update or merge occurred.

Status is **`prepared-unqualified-coefficient-candidate`**. Preparation criteria are satisfied; continuousG1/nativeCAD/Tube acceptance remain false.

## NEXT

Continue from this artifact and its exact hash. Implement the distinct continuous qualification for the modified candidate's two bundle joins, regularity/orientation and declared movement criteria, then a separately declared isolated native construction/readback of coherent supports, both U seam curves and both pcurves per seam. Reuse acquired saved-pair evidence within its own scope. Do not rerun the saved pair or consumed storage/fitting wrapper. A future native runner needs its own preflight/marker/receipt and must preserve the earlier STOP.

The candidate contract fixes parameter maps, inward/normal signs, dimensional and angular diagnostic criteria, and the original source/frame. The prospective native consistency budgets are 1e-7 mm position and 1e-8 unit-direction chord; bundle normal chord remains 1e-4. Those are distinct from the qualified rim contract and from whole-Tube physical acceptance.

## WAIT / scope limits

No technical blocker remains for the saved pair or for preparation of this derivative-driven candidate. No requested geometric datum had to be invented. Whole-Tube acceptance still lacks explicit tolerance bands for the nominal 2 mm wall, 4.75 mm hole and 17.09 mm block dimensions, and any required global angular specification. Those gaps do not block the isolated candidate qualification work. Native raw surfaceD1 verification would require a separately supplied/exposed capability; updates remain the coordinator's responsibility. AIRBOX stays paused. Original handoff/archive provenance remains in earlier reports; no full transcript access or direct cross-chat delivery is inferred.
