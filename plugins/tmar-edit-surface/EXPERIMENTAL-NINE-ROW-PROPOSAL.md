# Nine-row periodic strip: proposed next qualification

Status: experimental proposal; the tube coordinator has lifted the general
hold for the distinct nine-row method only after synthetic prerequisites are
completed and reviewed and parameters/guards are defined in advance. The
previous four-row coefficient-only scenario failed its sampled normal-rotation
check. It was not a client authorization refusal. Its source and diagnostic
remain private and unchanged; a nine-row scenario is a distinct method.
The whole-solid volume refusal is a separate, unresolved gate. No release or
host integration is authorized by this note.

## Candidate method

Use the periodic U basis of the central linear-V strip. Elevate/refine its V
basis to nine cubic rows, bounding the coefficient-model change with
`boundPeriodicLinearVRefinement`. Derive both neighboring inward derivative
fields through the already established affine edge maps, sample and fit them
in the central U basis, and propose changes only to V rows 1 and 7. Preserve
the boundary and central rows, source geometry, pcurves and existing guards.
Report the fit residual against each actual support, not merely the residual
between the proposed and fitted coefficients.

The scale lambda, sampling and meaningful acceptance budgets for angles,
positions, displacement, and normal regularity have not been approved or
qualified for the real part. They must not be tuned after a refusal to force
acceptance. The 2 mm nominal wall is not a global measurement; a pre-existing
approximately 1.98645 mm sample is a separate observation.

## Evidence currently available

- `experimentalPeriodicNineRowStripFit.integration.test.ts`: two non-nested
  synthetic support bases; unchanged boundary and interior rows; holdout
  residuals and a fixture-specific analytic orientation bound. It is not a
  real-part, generic surface or continuous G1 qualification.
- `experimentalPeriodicStripSamplingBlindSpot.test.ts`: an analytic synthetic
  counterexample demonstrating that the five former interior V samples can
  all miss a normal reversal.
- `experimentalPeriodicLinearVRefinementBound.test.ts`: a coefficient-model
  position bound, independent of OCCT evaluation or solid validity.

## Prerequisites before requesting a new real-data trial

1. Validate a common analytic derivative/normal evaluator on synthetic
   periodic surfaces, including U seam, multiple knots, both V sides, and
   independent comparison to OCCT. Do not infer agreement from sign alone.
2. Demonstrate on synthetic negative cases that an inversion between samples
   is detected by a continuous conservative check or is explicitly refused;
   five V samples and an unbounded finite difference are insufficient.
3. Reconcile edge/pcurve orientation, source identity and both support
   mappings. Establish non-ambiguous predeclared sampling and numerical budgets;
   report whether they are measured or continuously bounded.
4. Require independent review of the method and retain the failed-run record.
   Reconcile existing owner authorization and coordinator instructions before
   a distinct real-data trial; do not assume another approval is required
   without an applicable instruction or actual authorization gap.

Progress: an experimental analytic derivative evaluator has been compared
with OCCT on synthetic C1 unit-weight periodic fixtures. Its numerical error
is not bounded, and C0 crease derivatives are refused. A continuous
regularity check exists only for the restricted mathematical form
`S(U,V)=(X(U),Y(U),Z(U,V))`; it detects the synthetic blind spot, but no
general claim for the real tube follows from it. Continuous regularity for
general surfaces, budgets and actual-candidate validation remain open.

Two additional experimental controls have distinct scopes. A per-knot-cell
interval test bounds regularity of a general unit-weight C1 periodic strip
relative to a fixed local witness; it can conservatively refuse valid cells
and does not compare with the original normal. Separately, an interval
Bernstein patch routine can bound the dot product of two patch normals on a
common parameter square and report an inconclusive result. Extracting and
corresponding such patches from general periodic source and candidate nets is
not implemented. Neither routine qualifies a real solid or OCCT evaluation.

For the structurally C0 periodic seam case, separate experimental tools now
evaluate explicitly selected one-sided derivatives and compare the two U
derivative coefficient fields exactly in binary64 arithmetic. Equal fields
prove only parametric C1 at that seam in the coefficient model; zero fields,
geometric G1, orientation, regularity and CAD topology remain separate. The
existing C1-only evaluator and all operational guards are unchanged.

Only when the prerequisites are met and reviewed and parameters and guards
are specified in advance, perform one
coefficient-only candidate evaluation in memory, preserving the original hash,
without replacing the solid. Report pre/post gap and oriented tangent angles,
fit and actual-candidate residuals, regularity/orientation, local displacement,
sampling coverage and uncertainty on both junctions. Stop on any failure.
An apparently successful coefficient proposal would still not qualify the
part: pcurves, topology, intersections, wall, functional details, STEP
roundtrip, volume and the existing host release gate remain separate.
