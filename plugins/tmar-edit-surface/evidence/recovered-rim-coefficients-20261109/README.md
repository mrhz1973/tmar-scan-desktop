# Recovered rim coefficients ? 2026-11-09

Status: **coefficient-only PASS; WAIT for the actual detached BREP**. Integration remains HOLD.

## Scope and sources

This is a new, single evaluation of the existing `clampExperimentalPolynomialBSpline` on the recovered binary64 coefficients of STEP edge #207767 / curve #207771 (323/V0 ? 324). The detached BREP adapter was **not** invoked. No new numerical method or API was implemented.

Source: the user-supplied `TUBO_6B_DATI_RECUPERATI_20261108(1).zip`, created by the Tube chat on 2026-11-08 at 22:15:54 Europe/Rome. All 12 listed members matched their declared SHA-256 and byte sizes, and the member set was exact. The original frozen CAD was not opened, imported or rehashed here.

- Archive SHA-256: `4ee5216ef839d236688c04823df17c46e60a09396f917ebf698de7e988a26476`.
- `dati_recuperati.json` SHA-256: `8d60108498ab64b76d296ae6062b45443b87dee776189031bf4e48e9f08908f5`.
- Source STEP SHA-256 declared by the attached provenance: `6b711960fcded7972ded41ed1ceaa2f09e2dd8332fc7ee980b76d2514c94e8ae`.
- Source keys: `edges["207767"].curve_3d`, `edges["207767"].range_reported_by_historical_probe`, `pcurves["207823"]`, `pcurves["207830"]`, and `surface_coefficients_raw_step["207539"]`.
- The embedded coefficient bundle equals `fonti/bundle_storage_6b.json`; its V0/V1 labels concern the separate 323/V1?322/V0 and 321/V0?322/V1 junctions.
- The attached `00_LEGGIMI.md`, `provenienza.json`, historical communications and stopped-manifest receipt were read as sources. Archived commands were not replayed.
- The two attached local receipts also match the corresponding files in the assigned worktree.

Base branch/commit: `codex/edit-surface-tubo-periodic` at `57bffc7e1662757e6aa90612679927ce776eaa3f`. The existing 43 WIP files, including Spiana and all Tube local tests, receipts and consumed markers, were preserved. The checkout remains host 0.9.4 / installed occt-wasm 5.7.1. No host/kernel/MCP update was performed.

## New coefficient result

Executed once at **2026-11-09 00:12:55 Europe/Rome** (2026-11-08T23:12:55.129Z). The helper and dependency hashes, runtime, payload hash and results are in [attempt-1.json](attempt-1.json).

| Check | Result |
| --- | --- |
| Source degree / poles | 3 / 239 |
| Source distinct knots / sum of multiplicities | 239 / 243 |
| Active range from knot table | [0, 252.00932454753] |
| Interior active knots | 235, each multiplicity 1 |
| Source active endpoint multiplicities | 3 / 3 |
| External padding knots | ?5.22967851052 and 257.2169418737 |
| Output poles | 239, all components unchanged |
| Output distinct knots | 237 |
| Output endpoint multiplicities | 4 / 4 |
| Output interior knots / multiplicities | All unchanged |
| `maximumCurveErrorUpper` | 0 |
| `exactInBinary64` | true |
| Input arrays after evaluation | Unchanged |
| Helper invocations / adapter invocations | 1 / 0 |
| CAD kernel calls / geometry evaluations | 0 / 0 |

The source poles, knots and multiplicities are also identical to the raw STEP V0 boundary row of support #207539 (face 323). This is an array comparison, not a new geometric evaluation.

The result certifies the existing helper's exact clamping of the supplied binary64 curve model on its active interval. Removing the two padding entries from the output knot table does not trim an active portion of this curve. It does not establish that a later OCCT representation has the same coefficients or that either native pcurve remains geometrically consistent after a CAD operation.

## Pcurve and topology evidence

The supplied STEP chain associates pcurve #207823 with support #207539: LINE UV(t,0). Pcurve #207830 belongs to support #207831 (reported face 324): a degree-1 spline over the same t interval, with UV poles (0,1) and (261.52535017517,1). Preserve these native mappings and distinct U domains.

The edge references vertex #207768 twice. Its incidence to the two recovered seams is present in the excerpt. This is not the complete oriented BREP graph, and it does not provide any OCCT vertex representation list.

The edge tolerance 1e-7 mm and header `1e-07 1 1 0` are historical reports, not a new primary BREP dump. The vertex tolerance is missing. Neither the edge tolerance nor a missing representation list may be substituted for a vertex value or an empty list.

## Minimum remaining input for the adapter

The adapter still needs the actual detached BREP V3 to verify:

1. Its unlocated one-face structure, complete tables and topology.
2. The exact stored source curve and its unique curve-table entry and edge owner.
3. Every vertex's tolerance and representation list, including possible PointOnCurve references. `unsupported-vertex-table` remains unchanged.
4. The edge's primary header, tolerances, flags, ranges and native pcurve/support references.

The STEP extracts cannot replace this BREP with a fabricated table. No candidate BREP was synthesized from assumed missing values. Obtaining the missing primary evidence belongs to a separately scoped, single-executor real-case step; the consumed topology manifest remains consumed.

## Relation to previous checkpoints

The attachment's M06 discussion cites the older 13-pole fixture at `82942bf`. The later `57bffc7` checkpoint already verifies a **synthetic** 239-pole / 235-simple-knot fixture through the adapter and STEP. That result remains separate from this new **real-input, coefficient-only** result.

M06 is not closed for the real BREP adapter. M01?M05 and the CAD qualifications in M07 remain open to the extent recorded in the packet; M08 and M09 were not newly investigated.

No real CAD PASS, global G1, wall thickness, external-shape tolerance, detail preservation, solid validity, topology, volume or STEP roundtrip is claimed. No consumed test was rerun, no marker changed, no live session accessed, and no code, threshold, host dependency or kernel was changed.
