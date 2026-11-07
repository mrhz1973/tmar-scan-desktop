# Experimental curved seam: coefficient-only checkpoint

`proposeExperimentalCurvedSeamTangency` and its validator extend the existing
coefficient calculation to a compatible natural seam that may be curved.
They are separate from the existing straight-seam API, and are not wired to
the CAD topology recognizer, worker, UI or project history.

The admissible inputs remain clamped, nonperiodic C1, nonrational unit-weight
control nets with exactly matching seam coefficients and bases. The proof
requires a strictly monotone control polygon along its chord, a positive
constant transverse derivative scale and a conservative interval-hull
regularity check; valid geometries outside those restrictions can be refused.
It does not establish that either net corresponds to a shared CAD edge, prove
the global validity of a body, or certify global G1. No guard in the existing
straight-only workflow was removed.

A synthetic OCCT fixture sews two faces with a shared quadratic B-spline
edge. In 33 samples, the maximum magnitude of the cross product of unit
normals fell from 0.3713906764 to 3.34e-16; the maximum sampled gap after the
proposal was 7.78e-16 mm and the sewn result was reported valid. Those finite
samples are a diagnostic, not a topological certificate or a measurement on
a production part. The existing compatible-seam suite and the new pure-net
and OCCT suites were run on this checkpoint; TypeScript also passed.

Periodic seams, general rational surfaces, trimmed edges and STEP solids are
not qualified by this experiment. A real tube case remains blocked by a volume
guard and must not be inferred from the synthetic fixture. The next step is a
separate CAD topology and shared-edge identity proof before integration.

An additional read-only topology experiment identifies a shared curved edge
on a synthetic two-face STEP after export and reimport. It checks actual shared
edge identity, face incidence and natural pcurves, then requires the 3D curve
coefficients to match both surface sides exactly. It deliberately does not
claim G1 or expose an editable candidate. Only nonperiodic polynomial curves with complete
natural sides and exactly compatible parameterizations are supported. It
does not qualify a closed solid or the periodic, differently parameterized tube.

The experimental edge selection now includes a source-stamped identity and a
resolver that reimports and rechecks the complete evidence. A separate natural
side matcher supports exact reversed coefficients and knot reflection, rejecting
reflections not representable in binary64. A synthetic OCCT/STEP roundtrip now
demonstrates a shared edge with opposite parameter directions on the two faces.
That fixture covers nonrational single-span clamped surfaces; the matcher alone
is not evidence of topological orientation or G1 continuity.

A separate cylindrical fixture now sews two periodic faces whose common closed
edge has different U knot subdivisions. The shared edge and distinct bases
survive a synthetic STEP roundtrip. OCCT refinement gives matching coefficients
for the two fixture boundaries on a common basis; 65 samples and knot positions
are diagnostic only. The comparison helper does not bound OCCT rounding, and
therefore cannot certify input equality or replace topology and volume guards.
It currently requires identical parameter domains, phase, orientation and weights.
No real tube, closed solid, or user-facing edit is qualified by these results.

The separate affine comparison experiment supports distinct full-period
parameter domains when every transformed knot is exactly representable. It
keeps seam phase and orientation fixed and reports refined OCCT coefficients,
not a proof about source surfaces. A synthetic closed-cylinder study is recorded
in `PERIODIC-VOLUME-BASELINE.md`: volume readings vary substantially after
representation changes despite the sampled support points matching. The existing
volume guard is unchanged; this observation does not qualify the tube.

An isolated periodic G1 proposal now modifies the adjacent control row for
compatible periodic U bases while preserving the shared boundary and opposite
boundary tangent. Its interval bound applies to the supplied coefficients only.
The separate `verifyExperimentalPeriodicTangencyReplay` gate rebuilds the
original, adjacent and edited supports through OCCT BREP. It reads the
support referenced by each replayed face and requires exact coefficient,
periodicity, knot, multiplicity and weight retention. The closure criterion
requires an exactly representable period and translated U padding knots for
the cyclic C1 basis, plus OCCT position checks at paired parameters on both
sides of the cut. Synthetic fixtures reject weights normalized by OCCT and
a large period whose translated knots collapse despite exact BREP readback.
The evidence concerns the mathematical basis and sampled OCCT support
closure; the sampled tolerance is not a global bound between sample points.
An independent review observed an unsampled gap exceeding that tolerance on a
large-coordinate synthetic support that passed the sampled check. Topology,
trims, STEP, interior regularity and solid validity remain
unqualified. The experiment has no editor integration.

The periodic proposal has also been materialized on a synthetic open two-face
shell with matching polynomial periodic bases. A STEP roundtrip preserved the
expected shell topology and orientation, and 65 sampled seam positions and
normals remained close. Source face BREP was unchanged. This fixture does not
qualify a closed solid, different bases, global continuity, the tube, or an
editor operation; it is not a general-purpose CAD edit implementation.

An isolated U-refinement prototype constructs a common periodic knot basis
row by row for compatible input degrees, domain, cut multiplicity, phase and
direction. Each input keeps its V basis. Independent synthetic review found
that OCCT can change a curve when its U pole count is below its degree; the
prototype conservatively rejects pole counts less than or equal to the degree.
The measured support comparison is sampled, not a global error certificate.
It is not connected to tangency publication or qualified on the tube.

A synthetic open-shell pipeline now reads two faces with distinct U knots,
confirms that direct tangency rejects their incompatible bases, refines each
to a common basis, applies the periodic proposal and reopens its STEP. It
checks topology and orientation, preserves both source BREPs byte for byte,
and measures seam normals and gaps at 73 samples. This fixture uses the same
degree, parameter interval and phase; it does not qualify the tube, a closed
solid, different parameterizations, global G1 or editor integration.

Another synthetic fixture closes two compatible periodic sides with end caps.
Conversion and basis refinement retain the existing OCCT volume check; the
intentional tangency edit changes volume and is compared separately with a
converging section-based estimate. STEP reimport preserves the reported volume
within the original tolerance and the tested solid topology. Seam geometry and
G1 are sampled; the test does not qualify arbitrary solids or the tube.

A separate non-affine correspondence test proves an exact identity for four
explicit polynomial Bezier spans under a supplied monotone quadratic map.
It does not find a map automatically or qualify general periodic B-splines.

An isolated affine-periodic proposal now maps a compatible support to the
selected face's U domain, refines a common basis and computes tangency without
changing that selected domain. A synthetic open-shell STEP fixture exercises
distinct affine domains, knots and linear V support; topology and orientation
are checked, with geometry measured at samples. STEP pcurve trimming and
general solids remain unqualified. Inputs requiring rounded affine knots are
rejected; this method has not been applied to the tube.

A separate affine knot mapper rounds to nearest binary64, refuses collisions,
and returns an outward-rounded bound on parameter error for the knots and their
real piecewise-linear interpolant. Independent exact-fraction tests cover the
rounding. It does not bound CAD geometry, floating-point interpolation, knot
union with native data, or permit the existing exact-mapping guard to be bypassed.

An isolated follow-up searches seam phase, parameter direction and the local
quadratic maps automatically for polynomial quadratic/quartic periodic curves
with matching Bezier-span counts and knot-to-knot correspondence. It compares
all extracted binary64 coefficients with exact integer arithmetic and rejects
ambiguous matches. Direct and reversed synthetic cases were checked with OCCT
samples. This narrow subclass does not establish face topology, pcurve ownership,
general B-spline equivalence, or any result on the tube.
