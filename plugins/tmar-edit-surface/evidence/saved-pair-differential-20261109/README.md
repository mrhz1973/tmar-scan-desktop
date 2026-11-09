# Saved pair: remaining curves, differential contracts and native readback

Evidence date: **2026-11-09**. Base checkpoint: `360d460fe260e6763cdff9cd18a87e1a35d19d29`, branch `codex/edit-surface-tubo-periodic`. The three NEXT items of the base checkpoint are completed for the existing, undeformed saved two-face pair. This increment does not accept the full Tube.

The original support-position and shared-rim-position proofs are reused by their immutable receipts. They were not executed again. No live CAD, host/kernel/MCP configuration, installed dependency, other worktree or Tube WIP was changed; no merge was performed.

## Outcomes and primary receipts

| Distinct experiment | UTC interval | Result | Private receipt SHA-256 |
|---|---|---|---|
| Remaining curve coefficients, boundary derivatives, full-cell regularity and periodic seams | 18:00:28.590–18:00:33.706 | Computed; one conservative derivative upper initially inconclusive against its budget | `e569858adc9d89d8afe80a86cbbb64f4b7526da85dd6de91104ae0fb544a9413` |
| Native materialization/readback of the already saved post-STEP BREP | 18:03:39.921–18:03:40.304 | New native readback criteria satisfied | `05fd21686e2798dfca6c600a2f8becfd87b716f1cc373c5e504cb70084f25e3d` |
| Targeted squared-Euclidean tangent bound for face 324 | 18:07:34.707–18:07:35.204 | Same derivative budget satisfied; all declared local coefficient criteria resolved | `d0871ad3ebd0ce6b964a24fbfa9c003cdf08c61c0ad80407d508e5e092022aac` |

Public summaries: [coefficient-summary.json](coefficient-summary.json), [native-summary.json](native-summary.json), [tangent-324-summary.json](tangent-324-summary.json), [verification.json](verification.json). Complete raw receipts, preflights, execution records, one-shot runners and consumed markers remain in `../recovered-pair-completion-360d460.local/` and the local `tests` files. They are deliberately not published as raw CAD evidence.

## 1. Other curves: separate representations and contracts

| Saved edge ID | Contract | Continuous Euclidean position-difference upper, mm |
|---|---|---:|
| 5 | Its own padded nonperiodic cubic, clamp on the full active interval, exact closed-clamped canonicalization, then periodic comparison on the original parameter | `2.4797369019280437e-11` |
| 10 | Nonperiodic quintic, unchanged knots/multiplicities and unit weights; outward coefficient-difference hull | `1.5036860645523127e-11` |
| 4 | Same distinct quintic contract | `1.7640999772083897e-11` |
| 9 | Exact serialized coefficient agreement inherited from the acquired topology receipt | Already acquired; not recomputed |

Edge 5 independently returned `clampExactInBinary64=true`, `clampErrorUpper=0`. That result was obtained on this edge; the shared-rim clamp result was not transferred. The generic helper carries a nonzero clamp-emission error outward when present, and a synthetic test exercises that case. The comparison covered 378 exact common cells and 1,512 control pairs. Each quintic comparison covered its 12 paired controls on the full closed domain.

## 2. Derivatives, oriented tangency and regularity

Use the explicit positive maps

`Gamma323(s)=S323(252.00932454753*s,0)` and `Gamma324(s)=S324(261.52535017517*s,1)`, `0<=s<=1`.

Tangents are `T_i=period_i*Su_i`. Transverse derivatives are `Sv_i` in increasing native V; the respective inward transverse signs are `+1,-1`. Normals compared here are `T_i x Sv_i`, both with sign `+1`. The topological edge uses remain forward/reversed and do not change the positive affine map.

The exact-rational common partitions retain very narrow cells. Derivatives are formed on the native Bernstein cells before restriction, so no derivative is obtained by dividing by the width of a tiny common cell.

### Boundary derivative drift

The declared before/after budgets are Euclidean `1e-6 mm/ds` for normalized tangent difference and `1e-6 mm per native-V unit` for transverse difference. These are isolated experimental criteria, not Tube engineering requirements.

| Face | Tangent drift evidence | Increasing-V derivative drift upper | Normal sine upper, pre/post |
|---|---|---:|---:|
| 323 | L1 enclosure of Euclidean difference `<=5.71732657661528e-7 mm/ds` | `1.9962989872279747e-9` | `2.907465909345293e-9` |
| 324 | Targeted squared Euclidean upper `5.712958998687521e-13 (mm/ds)^2`, strictly below the lower squared-budget endpoint `9.999999999999998e-13` | `1.957534606633616e-9` | `3.892927296448085e-9` |

The initial face-324 L1 upper was `1.1979254543881274e-6`, too conservative to certify the Euclidean budget. This was not a geometric violation witness. Its receipt still records `localCriteriaSatisfied=false`. The separate targeted calculation kept the same geometry, correspondence, parameter units and `1e-6` Euclidean threshold; it used a squared Euclidean control hull on 378 common cells, without square roots in the decision. It returned `within-unchanged-euclidean-tangent-budget`. The combined criteria are reported in the new supplement, not retroactively written into the first receipt.

### Shared boundary tangency

On all 471 common cells, positive normal and tangent lower bounds and positive oriented normal dot products were certified. The continuous normal-sine upper is `3.4722390945302286e-9`, below the declared `1e-6`. The normalized tangent-difference upper between the two faces is `8.812470451147195e-7`; the increasing-V derivative-difference upper is `2.9414131130778308e-9`.

This is oriented tangency within a declared tolerance in the binary64 coefficient model. The earlier position bounds do not establish exact coincident boundary curves, so **exact G1 is not claimed**. The metadata label C1 is neither the premise nor the proof of this result.

### Full support regularity and natural periodic seams

Both post-STEP supports were certified on all their closed native polynomial cells: **708 per face, 1,416 total**, no unresolved cells or omitted domain. The lower bounds for `||Su x Sv||` in native parameters are:

| Face | Native normal-norm lower bound |
|---|---:|
| 323 | `5.7563073973595795` |
| 324 | `5.434544778129242` |

These bounds use native parameter units; each local normalized-cell lower bound is divided outward by the upper native cell-area scale. They establish local regularity, not global injectivity or validity of a solid. Internal U multiplicities are 1 for degree 3 and internal V multiplicities are 3 for degree 5, so the interior knots of these particular supports are at least C1 by their spline bases. The saturated periodic endpoints require a separate check.

For the periodic seam, the two one-sided U derivatives remain distinct. The V derivative fields on both seam sides share exactly the same stored periodic boundary column. Over all V, the new seam calculations give:

| Face | `||Su(0+) - Su(1-)||` upper | Unit-normal chord upper |
|---|---:|---:|
| 323 | `1.5176983787983567e-11` | `5.776655784808827e-11` |
| 324 | `1.65896042292518e-11` | `7.513744727525126e-11` |

The chord proof uses `2*J*D/B`: derivative-jump upper `J`, an outward hull of all 11 V-derivative coefficients `D`, and the independently certified native normal lower bound `B`. Both chords satisfy the declared `1e-6` criterion with consistent orientation. This remains a tolerance result, not exact parametric C1 or exact G1.

## 3. A separate native contract, executed once

The new experiment initialized installed `occt-wasm 5.7.1` once and called `fromBREP` once on `pair-reopened.brep`. It performed **zero** STEP imports/exports, sewing, fitting, healing, deformations, volume/mesh checks or live CAD actions.

Native topology was valid: two faces, five edges, three vertices, one shell, zero solids. Face and edge associations used the saved graph plus exact post-STEP own-support and curve coefficients. Own-face pcurve maps/ranges, oriented wire uses and graph agreed. The native readback BREP is byte-identical to the saved input, SHA-256 `29623dd22e2442777a9abdba1610b981e4c718d19b186beb1cbdd59932499b89`.

New measurements used knots plus span thirds for positions, strictly interior parameters for derivative directions, and native cell midpoints for interior normals:

| Observation | Coverage | Largest observed discrepancy | Declared limit |
|---|---:|---:|---:|
| Native 3D curve / own surface positions | 1,583 curve parameters; 2,312 pcurve associations | `2.3162552761135214e-11 mm` | `1e-7 mm` |
| Native curve tangent / model chain-rule direction | 1,536 comparisons | `1.6150483312315e-10` unit-vector chord | `1e-8` |
| Native / model surface normals | 1,416 cell centers plus joint samples | `5.990528825160287e-13` unit-vector chord | `1e-8` |
| Native normal pairs along the shared rim | 472 pairs | sine `1.3507876727045193e-10`; minimum dot `0.9999999999999997` | sine `<=1e-6`, dot `>0` |

The native receipt explicitly records `nativeReadbackCriteriaSatisfied=true`. These are sampled observations; they do not certify continuous native arithmetic, native G1 or native regularity lower bounds. The installed facade exposes tangent/normal directions but not raw surface D1 magnitudes. The latter were not claimed as measured.

## Preservation and verification

- **25 new pure tests passed**: 8 curve contracts, 6 boundary differential, 6 support regularity and 5 targeted tangent tests. Only the 8 new curve tests were rerun after a TypeScript control-flow narrowing fix. No acquired support/shared-rim tests were replayed.
- All three final targeted TypeScript checks passed. The initial narrowing-only compile error is retained in its own private log.
- The one new native readback test passed, with its numerical receipt gate also true.
- The original 43 WIP files and the inherited 100 protected items are unchanged. The final preservation manifest contains 127 items; SHA-256 `de9c4680960bb05a072317e733745cffd6ed387d599f7d9cf815a86f6a0020d6`.
- The earlier native STOP `reopened-own-support-mismatch`, SHA-256 `32f2b99c16c5f4ddf4177c5b8ec2431ebd9cc7c417dcf502595ed779b87fcc92`, and every consumed marker remain intact. The original exact-signature guard remains unchanged.

The environment remains checkout `0.9.4` with installed kernel `5.7.1`. The already completed comparison with ScanRuler `0.9.10` / kernel `5.15.0` was not repeated and no installation was performed.

## Further use

The saved undeformed pair is now covered by the declared local contracts. A future edited candidate needs its own explicit geometry/change contract and new evidence; these results do not automatically qualify another deformation, another face pair or the whole Tube. Do not rerun any consumed experiment merely to reproduce this checkpoint. Coordinate host/kernel/MCP and merge decisions outside this plugin owner.

See [the detailed differential contract](../../EXPERIMENTAL-SAVED-PAIR-DIFFERENTIAL.md) for formulas, orientations, qualifications and the pinned primary kernel source inspected on 2026-11-09.
