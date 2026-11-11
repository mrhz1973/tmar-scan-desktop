# Edit Surface — detached BREP V3 / successor7

Date: 11 November 2026. Engine: ScanRuler. Isolated branch:
codex/edit-surface-native-v3-20261111, parent f0b051806750fb503519c13f2f24e9e2b2e97221.
Technical scope: plugin-only native BREP V3. The ScanRuler V5 host and UX commit
57d09a4 are owned by the coordinator and are not modified here.

## DONE: new detached native adapter

- The pure adapter experimentalNativeBrepV3.ts supports only source face 321 or
  face 323. It refuses face 322 (protected) and other unexpected face layouts.
- It rewrites exclusively each target face's own periodic B-spline support and
  its own 3D U-seam curve. The quintic seam uses 12 control poles, V knots
  [0, 0.05, 0.95, 1] and multiplicities [6,3,3,6]. Each seam pole must
  exactly match the candidate support's first U column, in binary64.
- Candidate V=0 and last V rows must be bytewise/numerically identical to the
  source poles. Support degree, knots, weights, periodic/rational flags remain
  unchanged. Non-target curve tables, Curve2ds and both U-seam pcurves,
  vertices, oriented uses, surface metadata and topology are preserved
  byte-for-byte outside the two rewritten records. Unexpected serialization
  fails closed.
- The frozen original detached BREP files were used read-only:
  face321 SHA256 10c20fdbd4752cb4642ffd9ec8a4d6f7860dd8d4ef9c93d979bcc7e6cda5ce0a
  face322 SHA256 9ee0420ec25064f89bdaa049f9f1e6899c6c0a185d4797f53831bd0212ccfa64
  face323 SHA256 be5d618395055efb262e53c200e435754a5675b870a9d19e8d422f2156ef2148
- Three new focused tests were executed separately, without replaying consumed
  historical trials. Identity + internal 0.0001 mm perturbation; distinct U0
  seam 0.0001 mm perturbation and OCCT curve/UV two-branch readback at V
  0.25/0.5/0.75 (measured gap <= 1e-7 mm); and fail-closed refusals for
  protected V row, foreign face, altered weights and altered pcurve ownership.
  Native detached face validity, orientation and edge counts passed.
  These are synthetic perturbations, NOT the successor7 CAD geometry.

## DONE: source graph and source-only native preflight

- One new source-only assembly preflight, consumed once in its own isolated QA
  scope: 3 BREP imports + one sew + OCCT valid 3-face / 7-edge / 4-vertex /
  1-shell / 0-solid result. Zero STEP exports, healing, fitting or live CAD.
- IMPORTANT: pair74=0 and pair75=0 in that receipt were requested on the
  independent face handles before sewing; they are NOT the postsew shared-edge
  identity of the resulting shell. Do not infer that either sewn joint passed.
- Separate static STEP graph source audit: 15 checks PASS, including original
  edge #207475 74 (face322 forward, face323 reversed) and edge #207173 75
  (face321 forward, face322 reversed); dual U seam uses, curve chains and
  four pcurve source IDs. Post-materialization native joint identity remains
  untested and required.
- Successor7 original V0/Vlast pole rows for both editable faces were
  independently checked exactly in binary64 against corresponding BREP source.
  This necessary boundary-coefficient invariant is not a global G1 proof.

## T2 saved-receipt-only verification

The existing successor7 saved evidence confirms 16 negative witness constraints
(321: 1; 323: 15), primary 321 reused with checked applicability and primary
323 recalculated for successor7, plus two operationally accepted secondary
receipts. Declared tau is 0.06331257184549093 mm/V, working tau is
0.06331257164529092 mm/V. Gap upper sum:
1.1737830960824175e-11 (mm/V)^2 versus 1e-10 budget. Respectively 3 and
7 nonzero exact-row violations remain within permitted operational tolerance.
Exact primal feasibility and global optimality are not certified.
The historical coefficient PASS 64/64 and 8 informational checks are not
native geometric qualification. No old solver or test marker was rerun.

## WAIT: actual successor7 detached candidate

The new read-only preflight nativeBrepV3Successor7Preflight.mjs verifies
three frozen source BREP files, source capture, OCCT wrapper and WASM SHA pins,
plus 194/194 protected files, 66 original WIP entries and zero staged files.
The canonical ten successor7 candidate inputs are still MISSING on Windows:
supports face321, face322, face323, reference face324, seams 321/323,
candidate coefficient file, qualification receipt, frozen T2 target and
native contract. They are packaged as exact originals in the separate
TMAR_NATIVE_V3_SUCCESSOR7_INPUTS_20261111.zip artifact; do not claim that
these inputs have been unpacked into the Windows worktree.
Expected destination for the archive's root contents is
D:\TMAR_EDIT_SURFACE_NATIVE_V3_INPUTS_20261111 .
A missing input causes WAIT; the preflight starts no kernel, performs no solve
and does not consume a candidate geometry marker.

After verifying these ten SHA pins, the next authorized native trial is a
new candidate-scoped import of editable face321/323 (no writes to 322/324),
readback of 3D seam curves and both pcurve branches, protected V rows and
topology; then a separately budgeted post-assembly shared-edge/normal and
geometric gate verification. No automatic STEP roundtrip or global Tube PASS.

## Receipts (exact original bytes copied into this commit)

source-assembly.receipt.json
 SHA256 a1db30f9f909665ecd33cc78fe9e954415f8a37216c58f476ede4d5c7c4d4f06
source-graph.audit.json
 SHA256 b164f451d3440be7e59ec6c8a4ceb13f31c12d9f8841527702b02bf110b32598
successor7-preflight.receipt.json
 SHA256 52f316d204018439c6fca940d87f5796e7a52d22646cf0432386818e2c4379e4

Static saved T2 audit is separately available as
TMAR_T2_SUCCESSOR7_STATIC_AUDIT_20261111.json
 SHA256 bcab7481cb576866b6a5917c734eab5149c963cee13a0575f467519949667275.
It is intentionally not imported into Windows plugin without its upstream
source package. Experimental adapter SHA256 at this checkpoint:
d30a033a7e339bec750c08e7a11f625d0aa360381a6cc85466b725aa90d70bc0.

Constraints unchanged: no live CAD or copy 6b modifications, no face322 or
reference324 modifications, no source WIP changes, no historical marker reset,
no main merge, no GitHub push or 50-file historical publication.
