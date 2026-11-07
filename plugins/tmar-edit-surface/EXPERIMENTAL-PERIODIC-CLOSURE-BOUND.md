# Experimental periodic U seam position bound

`boundExperimentalPeriodicClosure` reads the natural B-spline support referenced
by one untransformed OCCT BREP face. It accepts periodic U and clamped,
nonperiodic V, with positive weights. It compares the two natural endpoint
curves, `S(Umin, V)` and `S(Umax, V)`, over the entire natural V interval.

The coefficient model expands the cyclic U knot vector with binary64 period
and padding calculations and wraps the pole indices. It then treats the
resulting expanded knots as exact data. Outward-rounded de Boor evaluation
at each U endpoint yields intervals for the homogeneous V coefficients.
On each V span the common basis is a nonnegative partition of unity, so
each numerator difference and weight difference lies in the hull of its
active coefficient differences. The smallest active lower weight bounds the
denominator from below. With `H` the vector numerator and `W` the weight,
the identity below gives a span-wide upper bound using the L1 norm, which
also bounds Euclidean distance.

```text
HA / WA - HB / WB = ((HA - HB) + (HB / WB) * (WB - WA)) / WA
```

The maximum of the span bounds includes the knots and both V endpoints.
Conservatism can make this upper bound exceed the tolerance even when the
coefficient curves coincide. An upper bound above tolerance leaves the
inequality unproved. Collapsed U padding at the cut or failure to establish a
positive denominator is rejected.

The report carries `globalOcctClosureCertified: false`. It bounds exact
evaluation of the stated coefficient model. Evaluation and span selection in
`occt-wasm` can have additional rounding error. The estimate covers endpoint
position only. Paired U probes on either side of the cut, derivatives,
topology, trims and solid validity require separate evidence. This helper
runs independently of the replay gate and editor.

The tests use the installed OCCT WASM kernel with four fixtures.

- A generated cylinder exported to STEP, reimported, converted to a B-spline
  and reread from BREP. Both its original one-span V representation and its
  six-span refined representation give model bounds below `1e-8` mm. At 65
  V values on each representation, OCCT also reports gaps below that tolerance.
- The counterexample from `EXPERIMENTAL-CURVED-SEAM.md`, with
  `request.net.poles[5][0] = 116520000.00000001`. The existing replay reports a
  sampled maximum below `1e-8` mm. At `V = 0.625`, `U = 0` and `U = 16`, OCCT
  reports a gap of about `1.12e-8` mm. The coefficient-model curves coincide
  because the U padding in this fixture is exact. The interval calculation
  returned a bound above tolerance in this run because it encloses both
  endpoint evaluations independently. The OCCT gap is a separate observation.
- A quadratic fixture with unequal rounded padding gives a nonzero endpoint
  gap in the coefficient model. The interval bound encloses an independent
  calculation of that gap using the two surviving U poles.
- A support with a period of `2^54` and a first interior knot at `0.5` retains
  its serialized coefficients, but the first translated right padding knot
  rounds to the endpoint. The helper rejects this support.
