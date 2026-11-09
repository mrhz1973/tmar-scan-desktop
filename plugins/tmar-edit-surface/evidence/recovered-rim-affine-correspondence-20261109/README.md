# Continuous correspondence of the saved shared rim

Date: 2026-11-09. Base checkpoint: `b699c6eb08a73621774adab2f00c821297ef4173`, branch `codex/edit-surface-tubo-periodic`.

## Results

A new pure coefficient analysis completed at **2026-11-09 12:43:53 UTC / 13:43:53 Europe/Rome**. It used the two existing saved BREP dumps and the previous hash-pinned topology audit. No CAD experiment, topology audit or completed support proof was replayed.

| Comparison over the whole active interval | Continuous Euclidean position-error upper bound | Common cells | Bernstein control pairs |
|---|---:|---:|---:|
| Pre-STEP clamped rim, 239 poles → post-STEP periodic rim, 238 poles | `2.5200029563077225e-11 mm` | 378 | 1,512 |
| Post-STEP rim → post-STEP face 323 / V-min, identity pcurve | `1.5931700403371003e-14 mm` | 236 | 944 |
| Post-STEP rim → post-STEP face 324 / V-max, exact affine pcurve | `2.1633226460204837e-11 mm` | 471 | 1,884 |

All three upper bounds are below the existing native rim tolerance `1e-7 mm` in the coefficient model. They are continuous bounds, including knots and the periodic seam, not sampled maxima. The receipt explicitly retains `nativeCadAcceptance: false`, `tubeAcceptance: false`, `nativeCadCertified: false` and `tubeAccepted: false`.

The first comparison requires equal original parameter domains. The second uses the saved map `(t,0)`. The third uses the exact real map `U=t*261.52535017517/252.00932454753`, `V=1`. The reversed topological use of the rim in face 324 does not reverse this increasing-U pcurve map.

Together with the preceding support certificate at `b699c6e`, these results give continuous coefficient-model bounds for both changed supports, the shared 3D rim's representation change and its two own-face pcurve images. They do not qualify other edges, derivatives/G1, native floating-point evaluation, a solid or the complete Tube.

## New plugin functionality

`experimentalPeriodicCurveAffineDifference.ts` provides two pure functions:

- `canonicalizeExperimentalClosedClampedCurve(input)`: converts an exactly closed clamped polynomial curve to the equivalent saturated-periodic coefficient representation. The input must have end multiplicities `degree+1`, internal multiplicities at most the degree, unit weights, degree 1–3 and an exactly duplicated final pole. Only that final pole and one occurrence of each endpoint knot are removed. The original input is unchanged.
- `boundExperimentalPeriodicCurveAffineDifference(original, candidate, maxCells = 4096)`: bounds `C(a+s*(b-a)) - D(c+s*(d-c))` for every real `s` in `[0,1]`. Inputs are polynomial periodic curves with saturated seams, equal degree, pole count and multiplicities. Natural domains and interior knot values may differ. It makes no tolerance decision and reports the correspondence explicitly.

### Why the 239→238 conversion is exact before comparing STEP drift

For a clamped degree-p curve with N poles, let T be its expanded knot sequence. Removing one endpoint occurrence on each side gives the saturated periodic sequence F. In every local de Boor recurrence, the relevant indices satisfy `F_i = T_(i+1)`. Active controls remain unchanged. On the last span the periodic wrap supplies the first pole, exactly equal to the discarded final pole. Thus each polynomial piece and its endpoint values coincide.

This identity neither assumes nor proves equal one-sided tangents. It applies to the closed clamped shared rim here; it is not automatically valid for the padded outer boundary, which remains outside this analysis.

### Exact affine comparison

Each normalized knot is represented as an integer fraction. The integers come from the plugin's existing `binary64Units` conversion, so differences of the input finite binary64 values are exact. The union of normalized knots is ordered and deduplicated by integer cross-products. No normalized knot is rounded to Number for partitioning.

For a common endpoint `s=N/D`, a native period `P` and native local knot offsets `lo,hi`, the exact de Boor factor is `(N*P-lo*D)/((hi-lo)*D)`. Its complement is formed exactly. Directed floor/ceil conversion encloses these ratios in binary64; the recurrence then produces interval Bernstein controls on the same normalized cell for both curves. The maximum outward L1 norm of the coefficient differences bounds their Euclidean positional distance continuously.

This avoids two pitfalls: treating a rounded affine knot map as exact, and losing a real microcell when two different rational knots happen to round to the same floating-point value. Native span denominators remain intact, including for subnormal spans. Exact integer arithmetic is limited to 8,192 bits; the real attempt had a fixed 1,024-cell budget per comparison and used one pass.

The face boundaries are the endpoint V control rows of the validated polynomial support. Their V basis is clamped, so these rows represent the natural isocurves exactly. Associations, edge ranges and the pcurve tokens come from the previous immutable serialized-graph audit; no nearest-point matching was used.

## Verification

**8/8 new pure numerical tests passed**. They cover a nonzero-origin affine correspondence with an exact normalized knot `1/3`, distinct fractions that round to the same Number, knot-only displacement, a cubic with an unsaturated interior knot, the wrapped last span, a one-ULP common cell, subnormal native spans, exact canonicalization and malformed/budget-exceeding input.

The test `1/3` versus `6004799503160661/18014398509481984` is deliberate: the Number values coincide, but the exact normalized fractions differ. The comparer retains three cells, including the intervening real interval.

Targeted strict TypeScript checks passed. The private driver's final fail-closed preflight guard was reviewed and checked before the one-shot execution. All bundle source paths and hashes came from esbuild metadata; no OCCT runtime was bundled. The preceding 13 support tests were not repeated, giving **21 passing targeted tests across the two increments**.

The new attempt performed one exact canonicalization and three continuous curve comparisons, covering **1,085 cells and 4,340 control pairs**. The existing CAD roundtrip STOP, the earlier support receipt and all consumed markers remain unchanged. All **86 protected files**, including the original 43-file WIP, retained their hashes; the frozen 6b STEP was unchanged.

There were zero kernel initializations, CAD samples, BREP materializations, STEP imports/exports, sewing operations, topology-audit replays, support-proof replays, live-CAD actions, fitting, deformation, healing or volume measurements. Checkout and installed kernel remain `0.9.4 / 5.7.1`; no host/kernel/MCP update or merge occurred.

## Evidence and remaining qualification

The new state is `saved-rim-continuous-coefficient-bounds-computed`. See [PLAN.md](PLAN.md) for the predeclared scope and hashes, and [evidence.json](evidence.json) for the complete sanitized numerical receipt and verification records. The private receipt is 11,740 bytes, SHA-256 `2127916903deb8cd368e7792ffa655600784fcc92fa4c3cff8ccdc1b94457aed`. No raw CAD or source XYZ is published.

The original native roundtrip receipt remains `stopped / reopened-own-support-mismatch`, unchanged at SHA-256 `32f2b99c16c5f4ddf4177c5b8ec2431ebd9cc7c417dcf502595ed779b87fcc92`. The support and rim certificates are new evidence under explicitly different, mathematical coefficient contracts. They do not change that receipt to PASS.

Still separate: the padded outer boundary's representation change, the two quintic seam curves, derivative/G1 checks, native post-STEP qualification and full Tube acceptance. No result is transferred automatically to those items or to the Tube chat.

Sources actually used: the pre/post BREP dumps generated on 2026-11-09; the saved topology audit and support receipt completed at 12:24:23 UTC on 2026-11-09; the existing binary64-unit converter, periodic validator, BREP parser and interval arithmetic at the source hashes recorded in the evidence. Mathematical reasoning and the new analytic unit cases are documented above; no new external API/version claim is made.
