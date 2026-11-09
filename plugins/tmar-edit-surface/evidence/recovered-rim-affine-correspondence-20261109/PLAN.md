# Saved rim: exact affine coefficient correspondence

Declared 2026-11-09 before this new numerical execution. Base checkpoint: `b699c6eb08a73621774adab2f00c821297ef4173`, branch `codex/edit-surface-tubo-periodic`.

## Three bounded questions

1. Compare the existing pre-STEP shared rim, clamped cubic with 239 poles, to the existing reopened periodic cubic with 238 poles, at identical original parameters. Canonicalize the closed clamped input only when its last pole is exactly its first pole, its endpoint multiplicities are degree+1 and all internal multiplicities are at most the degree. Remove only the final duplicate and lower the two endpoint multiplicities by one. This is an exact coefficient-model representation identity; it makes no derivative or native-CAD claim.
2. Compare the reopened 3D rim to the reopened face-323 natural V-min boundary over its entire active domain. The saved own-face pcurve is the exact identity map `(t,0)`.
3. Compare the same reopened 3D rim to the reopened face-324 natural V-max boundary under the exact affine pcurve `(t*261.52535017517/252.00932454753,1)`.

The natural boundary is extracted from the endpoint V control row only after validating the saved U-periodic, V-clamped polynomial surface and its endpoint V multiplicity. The saved own-face association, ranges and pcurve tokens must match the prior immutable topology audit. Equal domains are required explicitly for questions 1 and 2. Question 3 uses the exact affine relation, without rounding its knot preimages.

## Inputs and preservation

| Input | SHA-256 |
|---|---|
| Saved `pair-sewn-before-step.brep` | `a03b57c7b416952efe642094a818c249b2f996a952f25f1ce4408275be79567b` |
| Saved `pair-reopened.brep` | `29623dd22e2442777a9abdba1610b981e4c718d19b186beb1cbdd59932499b89` |
| Prior saved support/topology receipt | `6fd01a409c2721fb6f18abc8086578dc37e0a20a027f7ccccdf2563a6d170d12` |
| New 86-file protected baseline | `4a566d6a4014ad3e42952f70382663392decdfa3b2b848039800b12663e457dc` |

The 86-file baseline includes all 73 previously protected files plus all new private support-analysis artifacts and runners. Preserve the original 43-file WIP, every consumed marker, source STEP, raw CAD dump, previous receipt, runner and completed source revision. The previous CAD STOP and completed support proof are not replayed or reclassified.

## Exact affine method

Normalize each curve's knot as `(binary64Units(k)-binary64Units(first))/(binary64Units(last)-binary64Units(first))`. Store numerator and denominator as integers. Form the common partition by exact cross-product ordering and equality. Two distinct fractions remain distinct even when converting them to Number would produce the same value.

On each closed common cell, extract both univariate Bernstein pieces using their own native periodic bases. Compute the endpoint de Boor blend fractions exactly as integers, then enclose each fraction by directed binary64 floor/ceil rounding. Retain native denominators. Interval control differences relative to a common origin and their outward L1 hull bound the continuous Euclidean position difference. No CAD evaluator or sample grid acts as the oracle.

Fixed budgets: 1,024 common cells per comparison, three comparisons, one pass; exact integer arithmetic limited to 8,192 bits by the new helper. Any unsupported representation, invalid fraction, incomplete coverage, nonfinite bound or exhausted budget stops the new attempt. No adaptive retry or tolerance relaxation.

Compare each bound with the existing `1e-7 mm` rim tolerance as a coefficient-model observation only. A successful bound does not validate OCCT evaluation, derivative/G1 agreement, the other edges, a solid or the full Tube. In particular, the padded outer edge's 239→238 conversion is outside these three questions and receives no transferred result.

## Execution

Run only the new pure curve-comparison unit file, then targeted TypeScript checking of the new helper, tests and private driver. Do not rerun the 13 completed support tests, the support coefficient attempt or any consumed CAD experiment. Build the pure driver with recorded dependency hashes and verify that no OCCT runtime is bundled. Arm a new exclusive marker under `evidence/recovered-rim-affine-b699c6e.local/`, then write a new receipt regardless of numerical result and recheck all protected hashes.

No CAD/live access, BREP materialization, STEP import/export, sewing, healing, fitting, deformation, volume, mesh, dependency update, host/kernel/MCP change or merge is authorized by this plan. The new public implementation and sanitized evidence may be committed/pushed within the plugin branch.
