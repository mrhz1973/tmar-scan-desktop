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
