# Recovered real rim: native applicability checkpoint

Date: **2026-11-09 UTC**. Scope: the frozen 6b rim **323/V0 ↔ 324**, STEP edge #207767 / curve #207771. This is separate from the bundle junctions 323/V1 ↔ 322/V0 and 321/V0 ↔ 322/V1.

The missing original detached BREP has been obtained through one new isolated source read. The unchanged adapter rewrites the real protected face 324 successfully, and a separate native readback validates that detached face and the declared finite consistency checks. A subsequent undeformed-pair check passed its pre-STEP gates but **stopped after STEP at `reopened-own-support-mismatch`**. Both control-point components and native U knots changed along the roundtrip. These are new real-input results, not a transfer of the synthetic fixture's PASS. No deformation bundle has been applied.

## Source recovery and continuity

- Read the supplied coordinator handoff `HANDOFF_GPT_EDIT_SURFACE_20261108.md` and the recovered Tube packet dated 2026-11-08. The two handoff ZIP copies were identical. No separate later final handoff from the original Edit Surface executor was recovered.
- Reused the earlier selective recovery of the original Edit Surface archive; this was not a full transcript read. The current Tube archive recovery was bounded to rows 52000–60355 and selected record types, including original communications at rows 60318 and 60346. Archived commands were not replayed.
- Read the frozen `.scanruler` ZIP directly. Its SHA-256 is `cc64b9284f11f92093563325fe407a046a8d54dbb26c1cac3344d7047e491263`; it has six members. `project.json` records saved app version **0.9.5**, which is not a live-version observation. The project contains STEP imports, not the missing primary vertex/BREP tables. Mesh members were not inspected.
- The STEP attached to saved import feature 309 is byte-identical to frozen 6b: **27,555,617 bytes**, SHA-256 `6b711960fcded7972ded41ed1ceaa2f09e2dd8332fc7ee980b76d2514c94e8ae`. The recovered packet SHA-256 is `4ee5216ef839d236688c04823df17c46e60a09396f917ebf698de7e988a26476`.
- The previous coefficient-only result at `8540f37238399abcc7192f4baaa33e2b48fe665b` remains valid in its stated scope. Its wait for actual detached BREP is superseded by the new evidence here, without modifying the historical receipt.

Actual base: branch `codex/edit-surface-tubo-periodic` at **8540f37238399abcc7192f4baaa33e2b48fe665b**. Checkout package **0.9.4**, installed kernel **occt-wasm 5.7.1**. All 43 pre-existing WIP files, including Spiana and private Tube tests, markers and receipts, retain their original hashes. No other worktree was changed.

## Three distinct, consumed attempts

Each plan was saved before its respective runtime; each attempt has an exclusive consumed marker and persistent private receipt. Focused TypeScript checks passed. Each Vitest test ran once: two passed and the pair roundtrip failed at its declared support-identity guard. No consumed historical test was rerun.

| Check | New operations | Result |
| --- | --- | --- |
| [Structural plan](PLAN.md) | One frozen STEP import; original face 323/324 and rim BREP dumps; one unchanged adapter call on face 324's string | `structural-contract-satisfied` at 2026-11-09T00:50:21.689Z |
| [Materialization plan](PLAN-MATERIALIZATION.md) | Three `fromBREP` calls on saved strings; native validity/readback and 945 finite samples; no STEP import | `detached-face-readback-satisfied` at 2026-11-09T00:58:05.185Z |
| [Undeformed pair plan](PLAN-PAIR-ROUNDTRIP.md) | Clamp the saved 323 string once; three `fromBREP` calls; one raw sew and one raw STEP export/import | Pre-STEP checks satisfied; STOP `reopened-own-support-mismatch` at 2026-11-09T01:12:20.779Z |

Full sanitized results, hashes, native counts, actions and original receipt hashes are in [evidence.json](evidence.json). Raw BREP, input coefficients, exact Windows paths, one-shot runners and markers remain private in the assigned worktree. A Windows CP1252 console-rendering error occurred after the first launcher's successful child result was saved; the saved execution receipt and test receipt were read back, without rerunning the test.

## What the real data establish

The source has 624 faces. The selected shared rim is identified by exact native 3D coefficients, range, shared-edge identity, both native pcurve/support associations and opposite wire uses, rather than by face indices alone.

| Property | Observed result |
| --- | --- |
| Source curve | Polynomial cubic, nonperiodic, 239 poles, 239 distinct stored knots |
| Original active range | `[0,252.00932454753]` |
| Active interior knots | 235, each multiplicity 1 |
| Native support grids | Both 323 and 324: 238 × 12, periodic in U |
| Vertices in each detached face | Two; each tolerance `1e-7`; representation list present and empty |
| Own-face tolerance | `1e-7` on both faces |
| Rim pcurve on 323 | Native LINE `(t,0)` |
| Rim pcurve on 324 | Degree-1 affine map to `(261.52535017517*t/252.00932454753,1)` |
| Native wire uses | Forward on 323; reversed on 324 |
| Adapter target | Unique curve-table entry 3 in face 324 |
| Materialized rim | 239 unchanged poles; 237 distinct knots; endpoint multiplicities 4/4; all 235 simple interior knots unchanged |
| Detached topology | One face, one wire, three edges, two vertices; zero shells/solids |

The raw STEP grids of 239 × 12 and the native periodic grids of 238 × 12 remain distinct representations. No row was removed from a support to force equality. Removing the rim's two inactive padding knot entries is the already-qualified curve clamp; it does not cut an active segment.

The original and rewritten detached faces are valid under the installed native checker. Native readback preserves every pcurve, support, vertex, tolerance and topology record outside `Curves` byte for byte. The other native 3D curves, face orientation, UV bounds, edge range and wire use are unchanged.

All 237 active knots and the quarter, midpoint and three-quarter point of all 236 intervals were sampled: **945 distinct parameters**. Maximum distances in millimetres:

| Comparison | Maximum |
| --- | ---: |
| Materialized rim versus original native curve | 0 |
| Materialized rim versus support 323 through its native pcurve | 8.533911106286719e-14 |
| Materialized rim versus support 324 through its native pcurve | 8.664469239778968e-12 |

The fixed limit was the unchanged native edge tolerance **1e-7 mm**. This is a finite consistency check, not a continuous error certificate or a dimensional requirement for the finished Tube. The complete source BREP hash, original loaded handles, frozen STEP and protected WIP remained unchanged in their respective checks.

## Undeformed pair: pre-STEP success, post-STEP STOP

The final attempt used the saved source faces only, without moving either support. It applied the same adapter to 323's string so that both sides supplied the clamped rim. Raw sewing produced a valid pair with **two faces, one shell and no solid**. Exact own-support signatures, the 239-pole clamped shared rim, both native pcurve maps, opposite uses, unchanged other curves/ranges and rim header `[1e-7,1,1,0]` all satisfied their gates. Its 945 pre-STEP samples reproduced the three maxima listed above.

Raw STEP reopening also produced a valid shape with two faces, one shell and no solid. **Neither own-support signature matched the original.** The runner therefore stopped before checking the reopened rim, pcurves, ranges, orientations, other curves or samples. No post-STEP geometric PASS follows from the earlier 945 samples. The check did not compare every vertex coordinate/tolerance after sewing or STEP and makes no such preservation claim.

The saved sewn BREP, exported STEP and reopened BREP are all retained with hashes. A subsequent **text-only** comparison used the existing `surfaceTable` parser, with zero kernel invocations or geometric evaluations. Pairing records for diagnosis by their distinct, unchanged native U extents yields:

| Source support | Changed pole components / 8,568 | Max component difference, mm | Max stored-pole distance, mm | Changed U knots / 237 | Max U-knot difference, native U |
| --- | ---: | ---: | ---: | ---: | ---: |
| 323 | 8,530 | 9.49995637711254e-12 | 1.535018717853387e-11 | 142 | 9.421796676178928e-12 |
| 324 | 8,540 | 9.49995637711254e-12 | 1.613393366576604e-11 | 142 | 9.478640095039736e-12 |

Degree, 238 × 12 grid, U periodicity, rational flags, weights, multiplicities, V knots and U/V extents are unchanged. This diagnoses small numeric changes, not a row-count or periodicity conversion. The pole distances are **not surface-error bounds**, because the U knot vector also changed. The U-knot differences are parameter values, not millimetres. This static correspondence does not replace the failed exact-identity gate or complete the unexecuted post-STEP checks.

The concrete remaining requirement is a separately justified correspondence/error contract for the changed support coefficients **and knots**, followed by the associated real rim/pcurve checks. No guard, numeric threshold, allowed representation or consumed marker was changed to accept this output. No retry was performed. Zero explicit healing calls does not assert that the raw STEP importer performs no internal normalization.

## Historical inputs M08 recovered

The three files already existed under the known `QA_GUARDIE/ORACOLO_SVD` directory. Their bytes were hashed and matched the bundle; neither numerical solver nor constrained solution was rerun. The two NPZ files were not deserialized.

| Bundle role | Existing file | Bytes | Last modified UTC |
| --- | --- | ---: | --- |
| snapshot | `snapshot_sistemi_sparsi.json` | 4,157,782 | 2026-11-07T22:39:23.871713Z |
| systems | `sistemi_svd.npz` | 409,038 | 2026-11-07T22:41:21.269143Z |
| constrained | `risultato_vincolo_esatto_5mmV.npz` | 5,694 | 2026-11-07T22:44:53.082253Z |

`SHA256_ORACOLO.txt` confirms the filename/hash mapping. The saved README explicitly discards the older approximate-cap `risultato_con_vincolo_5mmV`; preserve the exact constrained solution for V0 and unconstrained SVD solution for V1. The snapshot's holdout parameter arrays have 713/710 entries while the actual holdout rows have 711/708; do not pair them by assuming equal lengths. Full hashes and provenance are in the evidence JSON; absolute locations are saved privately.

## API reuse decision

[API-COMPARISON.md](API-COMPARISON.md) records the primary-source comparison of **ScanRuler 0.9.10 at 28e0a100aaf6f1440e0a728eb49f77bed466b3fa** and **occt-wasm 5.15.0 at bce9299aa7e7bd85f9e6c0e6aeae30f655d98ef6**, read on 2026-11-09.

Reuse the existing binary BREP transport and local test transport. The newer package's coefficient-surface constructor is useful, but is not exposed by the upstream host wrapper and does not preserve imported wires or both pcurves. The missing coordinated replacement operation remains; the upstream update does not make this adapter redundant. Host export mending and changed native volume integration are separate behaviors that must not silently enter these tests. No update was installed.

## Remaining qualification boundaries

- **M01/M02:** Primary vertex/face/tolerance evidence is now available for the inspected 323/324 pair. It does not assign values to the remaining face 321/322 records or historical vertex #207174.
- **M03:** The original rim now has a persistent primary dump, both associations, flags/header, ranges, orientations and vertex lists. This records native flags; a `C2` label is not a proof of global G1 or parametric C2.
- **M04:** The inspected pair's detached topology is available. The full oriented shell/solid graph and the remaining affected side boundaries are not thereby qualified.
- **M05/M07:** No deformed Tube candidate, stored target control net, wall-thickness check, external-shape check, protected-detail check, global G1 proof or qualified volume result is produced by these checks. The exported diagnostic pair is not the modified Tube.
- **M06:** Real source coefficients, structural adapter application, detached native readback and the undeformed pair before STEP are now covered. Its post-STEP gate remains STOP; the modified-model roundtrip is not qualified.
- **M08:** Closed for location and bytewise identity of the three historical inputs; numerical contents have not been requalified.
- **M09:** Live CAD was not queried and is not needed for this isolated source-based evidence.

Integration, merge, distribution and host/kernel/MCP changes remain HOLD. The immediate blocker is the unqualified post-STEP support correspondence described above, with the original STOP preserved. Construction of deformed periodic side faces and their coordinated seam representations remains a separate subsequent task. The successful isolated face and pre-STEP pair do not resolve those operations by implication.
