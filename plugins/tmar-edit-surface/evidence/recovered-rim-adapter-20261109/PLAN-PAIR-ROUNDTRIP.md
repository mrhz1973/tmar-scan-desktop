# One undeformed pair through raw sewing and STEP

Prepared 2026-11-09 before armament. Runtime executor: the parent Edit Surface session only. This is a distinct pair-level gate after the successful detached-face materialization, not a replay of either consumed check.

## Fixed environment and inputs

- HEAD `8540f37238399abcc7192f4baaa33e2b48fe665b`, occt-wasm 5.7.1, unchanged adapter SHA `38de2090a1c92c711183e8631993f3f2675d673c0bcfeb242967ed76bc85578d`.
- Prior materialization receipt SHA `25a52c306da6676132043695b411d2b716faa8d633a752f34cf040b4910773fb`; qualified face 324 readback SHA `60774a823a35a32b0d91cd9affc561a15af607b0329497b18e12152a2049dacc`.
- Original face 323, original face 324, original rim, configuration, prior results and both consumed markers are digest-bound in the runner. Source STEP and all 43 protected WIP files are checked before/after. The frozen STEP is never imported.
- New flag `TMAR_RECOVERED_RIM_PAIR_ROUNDTRIP=SEW_UNDEFORMED_PAIR_8540F37_ONCE`; exclusive marker `pair-roundtrip-1.local.run-once` and receipt `pair-roundtrip-1.local.receipt.json`, within `evidence/recovered-rim-6b-8540f37.local` relative to the plugin.

## Fixed operations and acceptance

1. Complete preflight reads and hashes before the exclusive marker. Apply the unchanged adapter exactly once to the original **323 string**; preserve everything outside its Curves table. This changes only the rim representation; the source supports and geometry are undeformed.
2. Perform exactly three `fromBREP` calls: clamped 323, previously qualified clamped 324, and the original rim as an isolated comparison reference. Validate both prepared faces and record their other native curve coefficients and trim ranges before sewing.
3. Sew the two prepared faces once at `1e-7`, without a separate healing operation. Require a valid shape with two faces, one shell and no solid. Identify each face through the complete canonical numeric signature of its own Fa support from the original dumps, not enumeration order.
4. Require one shared rim with the original range and exact **239-pole clamped cubic** coefficients before STEP: 237 active knots, endpoint multiplicities 4/4, 235 simple interior knots. Require oriented uses forward on 323/reversed on 324, native tolerance `1e-7`, Ed flags `1/1/0`, and two native pcurves associated with the exact own supports and original maps. Other native curves and their ranges must equal the prepared-face baseline.
5. Export the raw sewn pair to STEP once and import that STEP once. Repeat the same pair, support, association, orientation, tolerance, other-curve and range gates. Only two exact rim arrays are allowed after STEP: the same 239-pole clamped representation, or periodic 238 with **only the final binary64-identical duplicate of the first pole removed**, unchanged pole order and 237 active knots, endpoint multiplicities 3/3. No shift, reversal, rescaling or other coefficient equivalence is accepted.
6. At both sewn and reopened stages, sample all 237 active knots plus the quarter, midpoint and three-quarter positions of all 236 spans: 945 distinct parameters per stage. Compare the actual shared 3D edge with the isolated original rim and the **actual faces at that stage**, using the verified maps `(t,0)` and `(261.52535017517*t/252.00932454753,1)`. Every maximum gap must be at most the unchanged native tolerance `1e-7`. These are finite samples, not a continuous certificate or a Tube dimensional requirement.
7. Save private raw evidence as soon as each stage exists: `pair-sewn-before-step.brep`, `pair-raw.step`, `pair-reopened.brep`, each with receipt hashes. Thus a later STOP retains its available primary evidence. Check original files, prior results/markers and all protected WIP afterward. Temporary input handles are disposable; sewing is not required to leave their in-memory serialization unchanged. Cleanup errors force STOP.

The allowed periodic rim is a predefined admissible model, still subject to the support and sample gates. A different periodic origin, changed non-rim curve representation, or changed support coefficients fails the fixed exact-data contract even if an additional geometric equivalence might exist. Such a STOP must be described at that precise scope; it is not proof that the geometry is unrecoverable.

No source deformation, fitting, mesh, volume, separate healing, whole-Tube candidate, delivery bundle, host/kernel/MCP changes, live CAD, merge or consumed-test replay. A success qualifies only this undeformed pair and this raw STEP roundtrip. A STOP consumes the new marker; do not change guards, models or thresholds and rerun.
