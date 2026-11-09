# Saved pair: derivatives, oriented tangency and regularity

Contract declared 2026-11-09 for continuation of checkpoint `360d460fe260e6763cdff9cd18a87e1a35d19d29` on `codex/edit-surface-tubo-periodic`. This document defines questions and criteria; execution results belong to the new evidence and receipts.

The owner executes isolated work under `plugins/tmar-edit-surface/**`. Host/kernel/MCP updates, live CAD, the other worktree, Tube candidate changes and merge remain outside this increment. The previous `reopened-own-support-mismatch` STOP, its guard, receipt and consumed markers remain unchanged.

## Evidence boundaries

The completed continuous position bounds for both supports and the shared rim are inherited by their immutable receipts. They are not rerun. Their binary64 coefficient-model scope does not include OCCT evaluator arithmetic, derivative agreement, G1, regularity or the complete Tube.

The remaining-curve contract stays separate: edge 5 requires its own padded-to-clamped conversion, an admissible closed-clamped canonicalization and an outward addition of any reported clamp error; quintic edges 10 and 4 use the unchanged-basis coefficient hull. Edge 9's acquired exact serialized agreement is reused. See [experimentalSavedPairCurveCorrespondence.ts](experimentalSavedPairCurveCorrespondence.ts) and [EXPERIMENTAL-SAVED-STEP-CHECKPOINT.md](EXPERIMENTAL-SAVED-STEP-CHECKPOINT.md).

All new bounds concern the exact mathematical splines defined by the saved finite binary64 coefficients. A positive local result is not transferred to the full Tube.

## Boundary parameters, scales and signs

For the shared boundary, define the real common parameter `s` on `[0,1]`:

```text
L323 = 252.00932454753
L324 = 261.52535017517
Gamma323(s) = S323(L323*s, 0)
Gamma324(s) = S324(L324*s, 1)
Ti(s) = Li * Su_i(Li*s, Vside)
Di(s) = Sv_i(Li*s, Vside)
Ni(s) = normalSign_i * (Ti(s) x Di(s))
```

`T` has units mm per normalized `s`; `D` has units mm per original V unit. The transverse derivatives retain increasing V. Inward transverse signs are `+1` for 323/V-min and `-1` for 324/V-max. The coefficient comparison declares `normalSign=[+1,+1]`.

The saved edge-use orientations are forward on 323 and reversed on 324. That reversal does not reverse the positive affine pcurve correspondence. Face orientation is a separate sign, required when comparing a coefficient normal to a native oriented face normal.

Each U knot is normalized as an exact ratio of integer binary64 units. Common knots are ordered and merged by exact rational comparison; close distinct parameters are never merged by an epsilon or by conversion to Number.

## Continuous boundary derivatives and oriented tangency

[experimentalSavedPairDifferential.ts](experimentalSavedPairDifferential.ts) first extracts each boundary's own native Bernstein patch, differentiates with its native widths, and only then restricts the derivative fields to the exact common normalized partition. This order avoids dividing extraction uncertainty by an almost zero common-cell width.

On a native U span of width `hU`, the normalized tangent uses the factor `3*Li/hU`. On the selected terminal V span of width `hV`, the increasing-V derivative uses `5/hV`. The V-max formula retains the increasing-V difference of the final two Bernstein controls.

The two before/after boundary comparisons report continuous upper bounds on `||Tafter-Tbefore||` and `||Dafter-Dbefore||`. Vector norm budgets are Euclidean; an L1 hull is a conservative enclosure method, not a different required metric. Their new experimental criteria are independently fixed at:

| Quantity | Criterion | Units |
|---|---:|---|
| Normalized boundary tangent drift | `<= 1e-6` | mm per normalized `s` |
| Increasing-V boundary derivative drift | `<= 1e-6` | mm per original V unit |
| Oriented normal sine | `<= 1e-6` | dimensionless |

These derivative criteria were chosen for this isolated comparison; they are not supplied as Tube engineering requirements. They concern the two shared-boundary derivative fields, not derivative drift over the entire surfaces.

For each comparison, Bernstein products retain parameter correlation. A component separated from zero bounds a vector norm from below. Every covered leaf must establish positive tangent and normal norm lower bounds, positive `Nfirst dot Nsecond`, and

```text
sineUpper = upper(||Nfirst x Nsecond||)
            / (lower(||Nfirst||) * lower(||Nsecond||))
sineUpper <= 1e-6
```

The post-STEP 323/324 joint uses the same normal criterion. Its tangent and transverse derivative differences are reported separately: G1 does not require equal transverse derivatives, and their difference is not silently promoted to a C1 criterion.

An endpoint interval may prove an oriented normal mismatch or a sine above the budget. An upper bound above the budget without such a witness is inconclusive. Coverage and regularity are reported separately; an absence of unresolved angular leaves alone is not a regularity certificate. Fixed budgets are 1,024 common cells, subdivision depth 8 and 8,192 leaves per comparison.

The result is tangency within a declared tolerance. It does not establish exact G1: the inherited positional evidence bounds differences rather than proving an identical common curve. No position, C2/C1 metadata or finite sample result is substituted for this differential check.

## Regularity on each full support

[experimentalSavedSupportRegularity.ts](experimentalSavedSupportRegularity.ts) covers every closed native U/V knot cell of each reopened support. It uses the acquired Bernstein extractor and [experimentalBernsteinPatchNormalBound.ts](experimentalBernsteinPatchNormalBound.ts) with the patch compared to itself. A strictly positive lower bound on `N dot N` proves a nonzero parametric normal on that whole polynomial piece, including its own endpoint limits.

The extractor uses local normalized coordinates `(r,q)`. Consequently

```text
Nlocal = (DeltaU * DeltaV) * (Su x Sv)
nativeNormLower = localNormLower / upper(DeltaU * DeltaV)
```

The division is outward. Local bounds in mm² per normalized-cell coordinates and native bounds in mm² per native-U/native-V remain distinct. Only complete coverage with every native cell certified supplies a whole-support lower bound. A failed or budget-limited cell yields an inconclusive result, or a separately identified nonpositive witness; subsequent cells are still covered within the declared budget.

The fixed limit is 1,024 native cells per support and Bernstein subdivision depth 12, with the normal helper's own finite cell budget. This proves regularity of each closed polynomial cell. It does not establish cross-cell G1, face orientation, injectivity, trim correctness or a solid.

## Periodic seam over all V

The U seam is saturated: its multiplicity equals degree 3. Periodic representation alone does not establish C1 or G1 there. Keep the increasing-U derivatives at `0+` and `1-` distinct.

[experimentalPeriodicSeamDerivativeGap.ts](experimentalPeriodicSeamDerivativeGap.ts) supplies a continuous bound `J >= ||Su+ - Su-||` over the full V domain. Its internal absolute derivative comparison with `1e-7` is reported separately; it is not itself a G1 result.

At the two seam sides, the boundary column and V basis are exactly the same, so `Sv+ = Sv-` in the coefficient model. Bound `D >= ||Sv||` using all 11 derivative coefficients of the 12-pole V curve. For expanded V knot vector `F`:

```text
Qj = 5 * (P[j+1] - P[j]) / (F[j+6] - F[j+1]), j=0..10
D  = max_j upperL1(Qj)
```

Let `B>0` be the complete-support native normal norm lower bound. With increasing native parameter directions:

```text
upper(||N+ - N-||) <= J*D
unitNormalChordUpper <= 2*J*D/B
```

All products and division are outward. The new seam criterion is `unitNormalChordUpper <= 1e-6`, dimensionless. This also bounds the sine by `1e-6` and establishes positive normal orientation, because the chord is below `sqrt(2)`; no rounded `asin` or `sqrt` acts as a proof oracle. An unavailable positive `B` or an excessive upper bound is inconclusive. The result remains a tolerance statement, not exact G1.

## Separate native saved-BREP contract

The subsequent native experiment materializes the existing `pair-reopened.brep` in a new isolated kernel instance through `fromBREP`. It is not a rerun of the consumed STEP roundtrip: no new STEP export/import, sewing, healing or live mutation is part of this contract. New preflight, marker and receipt identify its own inputs, implementation and observations.

Associate faces, edges and pcurves from the saved graph and exact coefficient provenance. Do not infer identity from nearest geometry or an assumed native enumeration order. Declare every sampled parameter and the corresponding pcurve map. For a pcurve `(u(t),v(t))`, use the chain rule `d(S o p)/dt = Su*u'(t) + Sv*v'(t)` when constructing the coefficient direction to compare with the native curve direction.

The native experimental criteria are:

| Observation at declared samples | Criterion |
|---|---:|
| Native curve/support position agreement | `<= 1e-7 mm` |
| Native versus coefficient-model unit-direction chord | `<= 1e-8` |
| Pair oriented normal sine | `<= 1e-6`, with positive normal dot |

The position criterion uses the existing local edge-tolerance scale without changing stored CAD tolerances. These are isolated consistency criteria, not whole-Tube acceptance requirements. Confirm finite, nondegenerate directions before normalizing or comparing them. Sample interior parameters for derivatives, and record any endpoint evaluator convention separately: an OCCT value exactly at a knot does not automatically identify the requested one-sided limit.

The pinned 5.7.1 facade computes `surfaceNormal` from `D1` cross products, normalizes only when its magnitude exceeds `1e-10`, and reverses the result for a `TopAbs_REVERSED` face. `curveTangent` similarly calls `D1` internally and normalizes only above that threshold. The exposed returned vectors do not provide raw D1 magnitudes. Therefore this native contract compares directions; it makes no claim to have measured the derivative magnitudes or a native regularity lower bound. Any direction below the normalization threshold requires an explicit inconclusive result rather than an assumed unit vector.

Native samples do not certify continuous G1 or regularity and do not enclose evaluator arithmetic. Those remain separate from the continuous coefficient proofs. The historical exact-signature STOP is neither weakened nor reclassified by the new contract.

## Sources and provenance

Local mathematical implementations are linked above; their actual hashes, runner hashes and immutable input receipts belong in the new evidence. The inherited position evidence is documented in [recovered support correspondence](evidence/recovered-support-correspondence-20261109/README.md) and [recovered rim affine correspondence](evidence/recovered-rim-affine-correspondence-20261109/README.md).

The native API semantics were checked read-only on 2026-11-09 against occt-wasm 5.7.1, commit `9892357968bc6ef0b52b98d20620a3f9c2385bc9`:

- [Public TypeScript wrapper](https://github.com/andymai/occt-wasm/blob/9892357968bc6ef0b52b98d20620a3f9c2385bc9/ts/src/index.ts), together with the installed `dist/index.d.ts`: `surfaceNormal`, `pointOnSurface` and `curveTangent` are exposed; raw surface/curve D1 magnitudes are not.
- [Generated native facade](https://github.com/andymai/occt-wasm/blob/9892357968bc6ef0b52b98d20620a3f9c2385bc9/facade/generated/kernel.cpp): the retrieved source SHA-256 is `0e4e9ee8d0640dff55cd991c125495dfa9eb6b43c78176095fe4f9761b38abec`. It supplies the normalization threshold and face-orientation behavior described above.

This source inspection does not install or qualify a different kernel version. The prior ScanRuler 0.9.10/occt-wasm 5.15.0 comparison remains acquired and is not repeated here.
