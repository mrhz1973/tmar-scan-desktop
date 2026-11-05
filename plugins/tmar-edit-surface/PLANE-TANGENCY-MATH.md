# Plane tangency: isolated mathematical proposal

`planeTangency.ts` is a pure, unconnected helper. It does not change the editor,
worker, topology, recipes, documents or GUI. Input is an explicit `Net`, a
natural edge `U0/U1/V0/V1` (constant U or V), a plane point and unit normal,
locked pole indices, optional other natural edges whose existing first
derivative must be preserved, and a distance residual budget in model units.

The proposed edit projects only the first interior pole row onto the plane.
The complete perimeter, all weights, knots, degrees and every locked point
remain bit-for-bit unchanged. A locked/perimeter/protected-row pole that is
incompatible with the plane causes an atomic refusal. A compatible locked point
is retained even when its residual is nonzero but within the explicit budget.
Preserving another tangent ring preserves its original derivative; it does not
establish that the original adjacent surface was tangent.

For positive weights at a clamped natural boundary, write its homogeneous
boundary row as `(A,W)` and its first interior row as `(B,V)`. Up to a nonzero
degree/knot factor, the two rational derivative numerators are

```
T = A' W - A W'
D = B W - A V
```

If both pole rows lie on the plane exactly, both derivatives are in that plane.
Nonuniform rational weights are supported and unchanged. Merely projecting the
row is insufficient if these derivatives become parallel or zero.

For the selected edge, an independent continuous regularity check uses
outward-rounded binary64 interval arithmetic on homogeneous Bernstein controls,
their derivative controls and recursive de Casteljau subdivision. Each accepted
interval has a strictly signed enclosure of `(T cross D) dot normal`. The sign
must agree across every leaf, including edge endpoints. Initial homogeneous
products and translations are enclosed too. This proves nonvanishing cross
derivatives over that edge for the input floating-point geometry. It uses no
unrounded knot insertion and no sampling inference. Overflow, ambiguous signs,
14 subdivision levels, or a 4095-node budget cause refusal.

Explicit limits:

- Each along-edge knot span is extracted into an outward-rounded interval
  Bernstein representation and checked, including its endpoints. Internal
  knots in either direction must have at least C1 continuity. Nets are clamped,
  nonperiodic, positive-weight and <=1600 poles.
- The plane normal must already be unit length within 1e-12. The explicit
  signed-plane coefficient residual budget must be positive and <=1e-6 model
  units. Its reported bound is outward-rounded. Projection is floating-point;
  exact zero residual is not asserted. The owner CAD-reference target of
  0.005 mm is not redefined by this numerical budget.
- A 9 by 9 grid per knot-span pair rejects sampled singularities and rejects
  sampled boundary normal errors above sine 1e-7. It does not exclude interior
  singularities, folds or self-intersections between samples. Continuous
  regularity is proven only on the selected edge.
- No continuous bound for normalized angular error or global G1 join is
  certified. `globalG1Certified` is always false. The algebraic construction,
  coefficient residual bound, edge regularity proof and sampled angular checks
  are separate evidence.
- `Net` contains no trims, adjacency, orientation or body identity. The caller
  must independently establish a natural, untrimmed, appropriate boundary and
  compatible plane reference before any future integration. This module does
  not authorize arbitrary trimmed/periodic edges or solid-face replacement.
- No worker/UI/history/recipe integration, real owner scan, packaged executable,
  QS comparison or macOS ARM64 runtime is qualified here.

`tests/planeTangency.test.ts` covers all four edges, positive nonuniform rational
weights, oblique translated planes, all preserved coefficients, immutable input,
compatible and conflicting locks/other edge constraints, malformed/periodic
inputs, multi-span and repeated C1 knots, degeneracy and a between-grid edge singularity.
Two real OCCT WASM tests construct rational and nonrational faces, perform
rejection checks on actual OCCT readback nets, verify valid natural-boundary
faces, export/reimport STEP, check 33 by 33 surface samples and 33 boundary
normals per result, and verify unchanged entire perimeter with changed interior.
Weights are checked exactly before STEP export; STEP text quantizes them, so
the roundtrip weight comparison uses 11 decimal places.

Run from the repository root:

```
node node_modules/vitest/vitest.mjs run plugins/tmar-edit-surface/tests/planeTangency.test.ts
node node_modules/typescript/bin/tsc --noEmit --pretty false
```
