# Saved STEP supports: bounded coefficient comparison

Declared 2026-11-09 before the new real-data numerical execution. Base checkpoint: `1abf89d214ed5898e362a714a5bbb64d5ad15196`, branch `codex/edit-surface-tubo-periodic`.

## Question and scope

Compute a continuous positional-error upper bound between each of the two support surfaces serialized immediately before and after the already completed raw STEP roundtrip. Compare the exact mathematical splines defined by the saved binary64 coefficients at the same real `(u,v)` parameters. Both poles and U knot vectors are included. The caller declares the identity-UV correspondence; common domain endpoints alone are not evidence of phase or orientation.

The earlier receipt remains `stopped` at `reopened-own-support-mismatch`. This is a new coefficient-model analysis of immutable files, not a replay, continuation or reclassification of that CAD attempt. Its 945 samples remain pre-STEP evidence only.

## Immutable inputs

Private directory: `evidence/recovered-rim-6b-8540f37.local/` relative to this plugin.

| Input | SHA-256 |
|---|---|
| `pair-sewn-before-step.brep` | `a03b57c7b416952efe642094a818c249b2f996a952f25f1ce4408275be79567b` |
| `pair-reopened.brep` | `29623dd22e2442777a9abdba1610b981e4c718d19b186beb1cbdd59932499b89` |
| Original roundtrip receipt | `32f2b99c16c5f4ddf4177c5b8ec2431ebd9cc7c417dcf502595ed779b87fcc92` |
| Continuation baseline, 73 protected WIP/evidence files | `390545e4a4763ef67ec9e2c41f507dff518b84427bbf4b595ef13e42e38c1ba7` |

The 73-file baseline includes the original 43 protected WIP files, the three consumed private runners and all 27 files of the preceding private evidence directory. It also pins the frozen source STEP. No existing marker, receipt, runner or private dump may be edited.

## Method and acceptance boundaries

1. Read the two existing BREP texts with pure parsers. Resolve each face's own surface through its serialized `Fa` reference, then pair the declared surfaces 323 and 324 by their distinct exact U domains, with the before-surface signatures pinned to the original detached-face evidence. Audit the serialized face/wire/shared-edge graph separately.
2. Require polynomial U-periodic, V-clamped supports with unit weights, U degree at most three and saturated U seam, V degree five, equal degrees/counts/multiplicities/domains and unchanged V basis. The two U knot vectors retain their own exact values.
3. Form the exact union of U knot values. No epsilon merging, rounded midpoint classification, knot insertion, fitting or kernel construction. For each common U subcell and each V span, reuse the existing outward-interval de Boor-to-Bernstein extraction on each support's native basis.
4. Each pair of patches uses the same real rectangle and normalized Bernstein basis. Subtract interval-enclosed controls relative to a common origin. The maximum outward L1 norm of the difference controls bounds Euclidean positional error everywhere on that closed cell, by positivity and partition of unity of the Bernstein basis.
5. Cover every cell, including both closures at internal knots and the periodic seam. Budget: at most 4,096 cells per support, two supports, one pass, no adaptive retry. Abort on unsupported data, nonfinite intervals, incomplete coverage or exhausted budget.
6. Report the upper bound and whether it is below the pre-existing rim tolerance `1e-7 mm`, as a contextual comparison only. This threshold is neither a new Tube dimensional requirement nor permission to replace the previous exact-identity gate. No native CAD, rim consistency, derivative, G1, solid, volume or Tube acceptance follows from the support bound.

## Saved topology audit

Read the serialized pair graph, shared rim, 3D curves, pcurve maps and associations, ranges, oriented uses, vertex records and flags from the same two files. Record exact agreements and differences without interpreting an OCCT continuity label as a geometric proof. Changes of poles and knots are coefficient observations unless covered by the numerical certificate above. Do not publish raw source XYZ coefficients.

## Execution and preservation

Only the new pure numerical unit tests and the directly affected pure Bernstein extraction regression tests may run. None imports an OCCT runtime. The real-data analysis gets a new exclusive `.run-once` marker and a receipt under `evidence/recovered-rim-support-1abf89d.local/`; the marker is consumed regardless of result. Pin source, runner and helper hashes before arming it. Check the 73-file baseline, frozen STEP hash, old receipt and old markers before and after execution.

Allowed actions: read saved text, parse coefficients/topology, interval arithmetic, write new plugin code/tests/evidence and commit/push a plugin-only checkpoint. Forbidden actions: CAD/live access, `fromBREP`, STEP import/export, sewing, geometric sampling in OCCT, healing, fitting, deformation, mesh/volume work, dependency or host/kernel/MCP updates, merge, and any replay of consumed tests.
