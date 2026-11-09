# Saved support correspondence after the STEP stop

Date: 2026-11-09. Base: `1abf89d214ed5898e362a714a5bbb64d5ad15196`, branch `codex/edit-surface-tubo-periodic`.

## Result

The new pure coefficient analysis completed at **2026-11-09 12:24:23 UTC / 13:24:23 Europe/Rome**. It computed continuous position bounds for the two support surfaces in the existing pre-STEP and reopened BREP dumps. Both pole drift and the changed U knots are included.

| Declared support | Continuous Euclidean position-error upper bound | Common U spans | V spans | Closed cells | Bernstein control pairs |
|---|---:|---:|---:|---:|---:|
| Face 323 | `2.891975547925087e-11 mm` | 378 | 3 | 1,134 | 27,216 |
| Face 324 | `2.930494735764457e-11 mm` | 378 | 3 | 1,134 | 27,216 |

These are upper bounds over the full shared natural domain under the declared identity-UV correspondence, not maxima obtained by sampling. The actual exact union contains 379 U knots for each pair. The original and reopened supports retain their separate stored U knot vectors throughout the calculation.

Both bounds are below the existing native rim tolerance `1e-7 mm`. That comparison is recorded with `acceptanceGate: false`: it is not a Tube dimensional requirement, a native CAD qualification or a replacement for the earlier exact support-signature gate.

The earlier CAD receipt remains **`stopped / reopened-own-support-mismatch`** at `reopened-topology`, with unchanged SHA-256 `32f2b99c16c5f4ddf4177c5b8ec2431ebd9cc7c417dcf502595ed779b87fcc92`. Its 945 samples still belong only to the pre-STEP inspection. The new result has its own state, `saved-support-position-bounds-computed`, and its own consumed marker.

## Plugin implementation

- `experimentalPeriodicSupportDifference.ts` introduces `boundExperimentalPeriodicSupportDifference(original, candidate, maxCells = 4096)`.
- `experimentalPeriodicQuinticBernsteinCells.ts` gains extraction on a shared U subcell using each model's native U basis. The existing common-basis API retains its algorithm.
- `tests/experimentalPeriodicSupportDifference.test.ts` covers analytic knot-only displacement, the periodic cubic seam, an unsaturated quadratic interior, translation and identity, a one-ULP microcell, repeated V knots, unsupported input and incomplete/budget-exceeding cells.

The current contract requires polynomial unit-weight surfaces, periodic U with saturated seam and U degree 1–3, clamped quintic V, equal degrees/grid sizes/U multiplicities, unchanged V basis, and the same U endpoints. Values of the interior U knots may differ. Missing coefficients, unsupported representations, interval overflow and incomplete coverage fail closed. The routine makes no tolerance decision and returns `nativeCadCertified: false`.

### Why poles alone were insufficient

The saved STEP diagnosis found different poles **and different U knots**. The old maximum pole distance was therefore not a surface-error bound. The new test with identical poles and different knots explicitly reproduces nonzero geometric displacement, preventing that incorrect inference.

### Continuous bound

The exact union of the stored U knots partitions the whole U domain. Each common U subcell lies in one native span of each support. The existing local de Boor recurrence is restricted to that subcell, producing a pair of interval-enclosed Bernstein patches in the same normalized coordinates. Denominators remain native de Boor spans, including when the common subcell is only one ULP wide; no tiny-cell denominator, rounded midpoint or epsilon merge is introduced.

For a common cell, write the positional difference as `sum B_i(u) B_j(v) D_ij`. Bernstein weights are nonnegative and sum to one. Consequently the Euclidean norm of the positional difference is bounded by the largest L1 norm of a difference control. The subtraction, restriction and L1 sums use the plugin's existing outward interval arithmetic. Taking the maximum over every closed common cell covers internal knots and both pieces meeting at the periodic seam.

Both patches are expressed relative to a common pole origin to reduce unnecessary interval width. This does not change their difference. The caller declares `(u,v) -> (u,v)`; common bounds alone do not discover a periodic phase or orientation.

## Additional evidence recovered from the saved topology

A private, read-only parser compared the serialized `TShapes` graph and derived the unique shared rim from the face/wire uses. It did not construct shapes or call OCCT.

| Observation | Saved pre/post comparison |
|---|---|
| Indexed and oriented graph | Exact agreement: 3 vertices, 5 edges, 2 wires, 2 faces, 1 shell |
| Shared rim pcurve maps, ranges and uses | Exact agreement; face 323 forward, face 324 reversed |
| All pcurve maps referenced by the two own faces | Exact agreement |
| All 3D edge ranges and edge headers | Exact agreement |
| Face, edge and vertex tolerances | Unchanged in these serialized records |
| Vertex coordinates | Two of three change; maximum outward L1 position bound `9.062972594620083e-12 mm` |
| Shared rim representation | Nonperiodic clamped cubic: 239 poles, 237 knots, end multiplicities 4/4 → periodic cubic: 238 poles, 237 knots, end multiplicities 3/3 |
| Shared rim continuity label | `C2` → `C1`; recorded metadata only, no derivative conclusion |
| Additional outer boundary, edge ID 5 | Padded nonperiodic 239-pole representation → periodic 238-pole representation |
| Quintic seam curves, edge IDs 10 and 4 | Same knots/multiplicities; poles change |
| Other boundary, edge ID 9 | Exact serialized coefficient agreement |
| Entire geometry table | 4 → 2 support records and 10 → 8 pcurve records; own-face associations remain present |

The audit also records the three changed seven-bit shape flag words. It does not treat these flags or the continuity label as a geometry oracle. It does not infer that a numerical bound on one support proves edge/support consistency. Curve coefficient differences remain `geometricErrorBound: null` in this audit.

## Verification and preservation

- **13/13 pure numerical tests passed**: 8 new support-difference tests and 5 tests of the affected extractor. No consumed CAD runner was executed.
- Targeted strict TypeScript checks passed, including the private driver and parser. A final check followed the driver's receipt-preservation correction.
- The execution bundle's complete input list was recorded from esbuild metadata; all source hashes were checked before and after execution. No `occt-wasm` runtime was bundled.
- Two support pairs and 2,268 cells were analyzed in one pass. No OCCT initialization, BREP materialization, STEP import/export, sewing, CAD sampling, healing, fitting, deformation, mesh, volume or live-CAD action occurred.
- The original 43 protected WIP files and all 30 additional pre-existing private runners/evidence files were unchanged: **73/73 protected hashes**. The frozen 6b STEP and the previous CAD receipt were unchanged.
- Checkout/installed kernel stayed `0.9.4 / 5.7.1`. This work does not qualify or install `0.9.10 / 5.15.0` and does not repeat the prior API comparison.

## Evidence and next scope

See [PLAN.md](PLAN.md) for the predeclared scope and immutable input hashes, and [evidence.json](evidence.json) for the sanitized result, source hashes, coverage, topology audit and verification receipts. The full private analysis receipt is 80,229 bytes, SHA-256 `6fd01a409c2721fb6f18abc8086578dc37e0a20a027f7ccccdf2563a6d170d12`. Raw BREP/STEP/XYZ data and existing local runners remain private and untouched.

The next distinct question is the continuous correspondence of the 3D rim through its 239→238 representation change and its consistency with both affine pcurve images. That requires its own coefficient proof. G1/derivative agreement, native post-STEP consistency and full Tube acceptance remain separate; the support bound does not supply them.

## Sources actually used

1. The hash-pinned `pair-sewn-before-step.brep`, `pair-reopened.brep` and stopped roundtrip receipt generated on 2026-11-09; no new import of the frozen model.
2. The existing plugin parsers, periodic validator, local Bernstein extraction and outward interval arithmetic, with their exact revisions recorded in the evidence.
3. [Official OCCT BREP-format description](https://github.com/Open-Cascade-SAS/OCCT/wiki/brep_format), last wiki edit shown as 2025-05-19, consulted 2026-11-09. Used for reverse TShape numbering, oriented links, surface/curve references and continuity-record syntax. The wiki marks itself deprecated; the observed V3 records and parser guards remain the actual input contract here.
4. [Official `Geom_BSplineSurface` reference](https://dev.opencascade.org/doc/refman/html/class_geom___b_spline_surface.html), consulted 2026-11-09; the current site redirects to the OCCT 8.0.1 manual. Used only for the mathematical periodic-knot contract and the distinction between bounds and orientation. It is not evidence about the installed 5.7.1 facade or an API/version upgrade.
