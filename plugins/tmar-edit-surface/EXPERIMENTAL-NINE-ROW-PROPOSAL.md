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

A separate seam diagnostic gives an absolute upper bound on the difference
of the two U derivative fields across the entire V domain. It uses exact
binary64 coefficient arithmetic before rounding its L1 hull bound upward.
Exceeding a caller-specified tolerance is inconclusive, not proof of a crease;
the bound does not imply G1, regularity, OCCT precision or solid validity.

The experimental nine-row diagnostic composes these bounds with explicit
training and holdout samples for both joints. It rejects nonpositive sampled
interior normal alignment independently of the configured chord budget, and
records which measurements include the seam. Joint normal checks and interior
orientation checks remain sampled: they do not establish continuity or rule
out defects between samples. This diagnostic is not wired into the app and
does not authorize solid replacement or export.

An independent experimental localized displacement bound handles the special
case where only V rows 1 and 7 change. It bounds each row's V basis weight by
interval Bernstein subdivision and includes the original refinement error;
it also preserves the independent coefficient-hull bound. Nonuniform knots
and protected-row changes have synthetic coverage. This is not connected to
the diagnostic gate and has not been evaluated on the rejected Tube proposal.
It does not establish thickness, continuity or solid validity.

An independent quintic-side prototype explores distributing an inward
derivative change over the first two interior V rows while keeping both
boundary rows and the opposite first interior row fixed. It checks the selected
edge's second-derivative change and coefficient displacement with outward
bounds. It requires a structurally C1 periodic U basis and therefore refuses
the Tube supports with a structurally C0 seam. The target correspondence,
continuous regularity, wall thickness and CAD validity remain unproved.
The helper has only synthetic coverage and is not connected to the app.

A separate quintic-side entry point handles a saturated structural C0 U seam
only when an absolute derivative-gap bound passes both before and after the
coefficient proposal. It keeps the whole seam column fixed; an incompatible
target is refused and no proposal is returned on an inconclusive seam bound.
The original C1 guard remains in place. This preserves seam position only in
the coefficient model and does not validate pcurves, trims, G1 or a solid.

A synthetic quintic-side fit fixture exercises different nested U bases and
opposite traversal, then checks the stored candidate on separate samples and
both seam sides. Incompatible seam targets are refused even when unconstrained
fit residuals are low. This demonstrates a narrow representable case; general
targets require fitting with the seam coefficient constrained during the solve.
The sampled joint normals are not a continuous interior regularity proof.

A separate experimental U-vector fit fixes coefficient zero during QR by
eliminating it from the unknowns. It reports reduced rank, pivot ratio and
training residuals; callers must independently apply their own pivot and
residual gates, and check separate holdout samples and the stored seam bound.
Fixing the derivative coefficient does not itself lock the surface seam.
No production or real-part qualification follows from this solver.

The experimental quintic-side diagnostic composes the fixed-first fit for one
moving side with explicit gap, pivot, residual, displacement and seam checks.
It measures the stored proposal on separate holdout samples, including both
seam sides, and refuses sampled opposed joint normals. A structural C1 fixed
support is identified separately from a bounded structural C0 seam. The
diagnostic does not establish interior regularity, G1, trims or solid validity
and has not been applied to a real part.

An experimental pair coordinator evaluates two distinct quintic sides against
one unchanged center, with separate budgets and no candidate on a failed side.
A synthetic counterexample also demonstrates an interior normal inversion
despite accepted sampled joint normals and a coarse interior grid. Therefore
pair diagnostic success cannot qualify a side, authorize a real-part run, or
replace a continuous interior regularity and orientation check.

The experimental interval normal-dot proof now accepts Bernstein patches up
to degree three in U and five in V. It remains a patch-level proof only:
extracting corresponding periodic spline patches and checking all cells is
separate, and no result here qualifies trims, thickness or a CAD solid.

An experimental cell extractor now encloses a corresponding pair of U2/U3,
V5 periodic spline cells as interval Bernstein patches. Synthetic checks cover
nonuniform knots and both one-sided seam cells. It is still a per-cell
primitive: a full-domain check, trim and CAD qualification remain separate.

An experimental full-domain orchestrator now checks each closed U/V knot cell
against the original using the interval patch normal-dot bound, including the
two one-sided seam cells. A nonpositive witness or an unproved cell stops the
check. Synthetic coverage includes the earlier hidden inversion. Its sign
proof applies to the coefficient models at corresponding parameters; cell
dot magnitudes are local, and cross-cell continuity, self-intersection, wall
thickness, trimmed faces and CAD validity are not established.

Only when the prerequisites are met and reviewed and parameters and guards
are specified in advance, perform one
coefficient-only candidate evaluation in memory, preserving the original hash,
without replacing the solid. Report pre/post gap and oriented tangent angles,
fit and actual-candidate residuals, regularity/orientation, local displacement,
sampling coverage and uncertainty on both junctions. Stop on any failure.
An apparently successful coefficient proposal would still not qualify the
part: pcurves, topology, intersections, wall, functional details, STEP
roundtrip, volume and the existing host release gate remain separate.
