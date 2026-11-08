# Synthetic detached rim: 239 poles / 235 simple interior knots

Date: 2026-11-08, Europe/Rome. Base: `e20e4b2c2db77417900ec62cd189df1716f2a06c`.
Branch: `codex/edit-surface-tubo-periodic`. Kernel package: `occt-wasm@5.7.1`.

## Requested scope

Verify the existing detached BREP rim adapter on a synthetic fixture with
239 poles and 235 simple interior knots. Do not transfer a synthetic PASS
to the Tube. The adapter, its clamping dependency, the existing fixture
builder, host and dependencies are unchanged by this checkpoint.

The fixture is generated entirely from synthetic coordinates. It does not
read the Tube, its coefficient bundle, frozen STEP or private diagnostics.

## Fixture declared before execution

- Cubic, polynomial, nonperiodic, closed source curve with **239 poles**.
- Active domain `[-2, 234]`, with **235 distinct interior knots** `-1..233`,
  each of multiplicity one. Active endpoints initially have multiplicity 3;
  padding knots `-3` and `235` each have multiplicity one.
- Total multiplicity is `1 + 3 + 235 + 3 + 1 = 243 = 239 + 3 + 1`.
- Clamping gives endpoint multiplicities 4, preserves the interior knots and
  all 239 poles, and must report an exact coefficient-model bound of zero.
- The two periodic supporting faces use domains `0..118` and `-2..234`,
  with pcurve maps `(t + 2) / 2` and `t` respectively. Their underlying
  periodic U nets have 238 poles. Coordinates use a `1/1024` grid.
- Coverage is **945 distinct parameters**: every one of the 237 active
  breakpoints, plus `1/4`, `1/2`, `3/4` of each of the **236 spans**.
- The sampled gap limit is `1e-7 mm`; the edge tolerance ceiling is `1e-6 mm`,
  unchanged from the existing synthetic adapter test.
- After STEP, accept only the explicit clamped 239-pole representation or
  the specified equivalent periodic representation with 238 poles and
  endpoint multiplicities 3. This allowance was defined before the run.

## Executed verification

One focused Vitest test passed in the single recorded execution. It checks
the cardinalities on the actual kernel-read source, applies the adapter to
the detached protected face, preserves its other native curves, rebuilds
the synthetic neighbor, sews the pair and exports/reimports STEP in memory.
Both native pcurves are matched to their own supports. Range, orientations,
shared edge, tolerances and sampled geometry are checked before/after STEP.
The original synthetic face and source BREP remain unchanged.

| Result | Before STEP | After STEP |
|---|---:|---:|
| Maximum sampled edge-to-support gap | `3.580361673049448e-15 mm` | `3.580361673049448e-15 mm` |
| Maximum sampled edge-to-original gap | `0 mm` | `0 mm` |
| Edge tolerance | `1e-7 mm` | `1e-7 mm` |
| Curve representation | clamped, 239 poles | periodic, 238 poles |
| Simple interior knots | 235 | 235 |

The exact coefficient-model clamping bound was zero. The test separately
checks all expected knot, multiplicity and pole arrays; the periodic result
is the explicitly specified equivalent representation, not an unchecked
reduction in complexity.

Test: `../../tests/experimentalDetachedBrepRimClamp239.test.ts`.
Runtime receipt and exact command: `attempt-1.json`.
Focused TypeScript command and result: `typecheck.json`.

## Limits

This is one open two-face synthetic shell, not a closed solid. Finite
sampling across every span does not prove continuous G1, absence of all
intersections, wall thickness, volume or a production application workflow.
The saturated periodic seam is structurally C0. Integer/dyadic data and the
zero clamping bound do not prove tangent continuity there.

**No Tube qualification follows from this PASS.** Its real coefficients,
topology, vertex representations and pcurve/support associations still need
their own applicability evidence. Existing real-data STOPs and host
integration/release HOLD remain unchanged.
