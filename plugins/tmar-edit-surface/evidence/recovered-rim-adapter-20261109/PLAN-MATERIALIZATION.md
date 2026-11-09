# One saved-face materialization and readback

Prepared 2026-11-09, before execution. Executor: this Edit Surface session only.

The preceding structural check succeeded with private receipt SHA-256 `ca86479242ee96252777527d12ea6d8949432bdda3b611ac0c6000cf2fa1cba7`. It did not load the rewritten text. This distinct check addresses that remaining native-representation question; it does not replay the adapter, import the original STEP or reopen the consumed topology manifest.

## Fixed inputs and environment

- Branch `codex/edit-surface-tubo-periodic`, HEAD `8540f37238399abcc7192f4baaa33e2b48fe665b`, installed occt-wasm 5.7.1.
- Original face 323: `be5d618395055efb262e53c200e435754a5675b870a9d19e8d422f2156ef2148`.
- Original face 324: `d9dcfeda56d7c76d50ebb24c1a841bdb41ab83d94a8b70bd14d67d3c12059e64`.
- Rewritten, unmaterialized face 324: `c3bb88719cec31fe8dd6f65ccad849d2ac36a102880f5a34f94a574b781fc565`.
- Prior input and rim dump remain digest-bound in the runner. All 43 original protected WIP files and source STEP are checked before/after.
- New exclusive marker: `evidence/recovered-rim-6b-8540f37.local/materialization-1.local.run-once`, relative to the plugin. Receipt and BREP readback stay in that private directory.

## Fixed operations and gates

1. Check prerequisites and hashes; create the exclusive marker before kernel initialization.
2. Load the two original face strings and the rewritten face 324 through `fromBREP`, once each. No new source STEP import.
3. Require native validity of both originals and the rewritten face. Require a single detached face and no shell/solid for each; preserve the original 324 topology counts.
4. Serialize the loaded faces and require bytewise preservation outside the Curves table, including every pcurve, support, vertex, tolerance and topology record. Check orientation, UV bounds, other native 3D curves and rim wire use explicitly.
5. Require the exact expected nonperiodic polynomial cubic rim: 239 unchanged poles, 237 active distinct knots, endpoint multiplicities 4/4, 235 unchanged simple interior knots, original trim range and native edge tolerance 1e-7. No alternate periodic representation is silently accepted.
6. Sample all 237 active knots and the quarter, midpoint and three-quarter point of all 236 spans: 945 parameters. Compare the native clamped edge to its original curve and to both unchanged supports via the previously verified native maps `(t,0)` and `(261.52535017517*t/252.00932454753,1)`. Require each maximum gap at most the unchanged native edge tolerance 1e-7. This is a sampled consistency check, not a continuous geometric or dimensional certificate.
7. Save native readback on success; retain receipt and marker on every armed outcome. Check source file, primary inputs, original handles and protected WIP remain unchanged; cleanup errors fail the attempt.

No sewing, STEP export/import, healing, fitting, deformation, volume, mesh, full Tube candidate or live CAD action. No host/kernel/MCP change or merge. A STOP consumes this marker; do not change a guard and rerun. A success qualifies only this detached native face and these finite samples, not a modified Tube or STEP roundtrip.
