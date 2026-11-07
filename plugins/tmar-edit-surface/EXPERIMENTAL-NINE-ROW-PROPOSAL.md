# Nine-row periodic strip: proposed next qualification

Status: experimental proposal, **not authorization to retry the real tube**.
The previous coefficient-only real-data scenario was refused by its sampled
normal-rotation gate. Its source and diagnostic remain private and unchanged.
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
   Ask for explicit authorization before any new attempt on the protected copy.

Only if separately authorized and prerequisites are met, perform one
coefficient-only candidate evaluation in memory, preserving the original hash,
without replacing the solid. Report pre/post gap and oriented tangent angles,
fit and actual-candidate residuals, regularity/orientation, local displacement,
sampling coverage and uncertainty on both junctions. Stop on any failure.
An apparently successful coefficient proposal would still not qualify the
part: pcurves, topology, intersections, wall, functional details, STEP
roundtrip, volume and the existing host release gate remain separate.
