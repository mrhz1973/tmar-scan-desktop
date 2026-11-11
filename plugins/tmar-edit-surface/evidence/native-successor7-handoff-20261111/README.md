# Successor7 V3 — native detached qualification and handoff to Tubo 3

Date: 2026-11-11. Candidate: tubo-6b-t2-successor7-storage-candidate-1.
Isolated native branch: codex/edit-surface-native-v3-20261111, parent 0f3ce9536dbc95b87cadad5fca90daa341442b28.
Engine: ScanRuler OCCT wasm 5.7.1, frozen source STEP/copy6b unchanged.

## DONE: original archive and transfer (no re-transfer in this handoff)

Original ZIP: TMAR_NATIVE_V3_SUCCESSOR7_INPUTS_20261111.zip.
Archive bytes 709301; SHA256 ee31639c7e47c19bb78a151455734cb6f9aae616fa7e64036f5a06fcad9ca2e8.
ZIP CRC verified, manifest schema TMAR_NATIVE_V3_SUCCESSOR7_INPUT_SET_V1; 10/10 payload SHA256 matched.
Windows transfer prior to this handoff: TRANSFER_VERIFIED, 10 promoted; no overwrite.
Windows destination: D:\TMAR_EDIT_SURFACE_NATIVE_V3_INPUTS_20261111.
All ten files were independently re-hashed against the original manifest during this handoff: 10/10 match.
Input preflight: INPUT_PREFLIGHT_READY_NO_NATIVE_ATTEMPT; missing=0, mismatches=0, source/engine pinned.
Do not repeat transfer or preflight without new inputs.

## DONE: actual successor7 native V3 result already consumed

Authoritative one-shot marker:
D:\TMAR_EDIT_SURFACE_NATIVE_V3_QA_20261111\successor7-native-v3-single-run.CONSUMED.json
Scope ID: tubo-6b-successor7-native-v3-single-attempt-20261111-v2.
Plan SHA256 f0e5f292bb402dd3a1152aabfc358ded2ef2a335f77e1d73a93e6cee473a80df.
Native receipt generated 2026-11-11 12:38:14Z (13:38 Italy).
Receipt SHA256 862be868c63b0f075a71f1dafb9662aa8e58ad9d59c5f541497990c56aba7833.
Verdict: LOCAL_DETACHED_AND_SAMPLED_ASSEMBLY_PASS_NOT_FULL_TUBE.
No duplicate native run or solve in this handoff.

Native operations: 1 OCCT kernel init; 3 fromBREP, 1 sew, 6 toBREP; 14639 kernel calls;
0 STEP imports/exports, 0 healing, 0 fitting, 0 live CAD, 0 automatic retries.
Both editable faces 321 and 323: native detached face valid, forward orientation, support exact,
raw pcurves preserved, one quintic U seam with two UV branches; 322 is protected and bytewise
unaltered. Reference face 324 unchanged.
Own seam maximal curve-to-support gaps:
321 2.8477166477147972e-14 mm; 323 2.95110562224397e-14 mm.
Assembly: valid shell with 3 faces, 7 edges, 4 vertices, 1 shell, 0 solids.
Postsew shared edge: exactly one for each joint 74 and 75.

Joint 74 (323/322), 850 position and 566 direction samples:
max position gap 1.4267311098874461e-11 mm,
max joint-edge gap 1.3205000413569156e-11 mm,
max normal chord 9.997007604435642e-5,
minimum normal dot 0.9999999950029916,
max unit tangent chord 4.1945443899442217e-9,
max edge tangent chord 1.095434265217756e-8.
Joint 75 (321/322), 850 position and 566 direction samples:
max position gap 1.8949312873699076e-11 mm,
max joint-edge gap 1.598793155502818e-11 mm,
max normal chord 8.476575204231985e-5,
minimum normal dot 0.9999999964073836,
max unit tangent chord 5.0975259621183719e-11,
max edge tangent chord 9.113153780444411e-9.
Interior normals: 321 708/708, 322 95/95, 323 708/708 finite, nonzero;
orientation forward for all three. Native receipt errors=[] and cleanupErrors=[].

## Protection reconciliation

Before reporting: original branch codex/edit-surface-tubo-periodic at f0b051806750fb503519c13f2f24e9e2b2e97221,
194/194 protected files SHA256 unchanged, original WIP entries 66, original staged 0.
Two untracked test scripts found in the isolated native worktree; they belong to
the preceding prepared native run and are not staged or changed by this handoff.

## NEXT for the responsible Tubo 3 and the 16-gate matrix

Reconcile the actual native receipt (below) against each of the 16 gate rows,
marking only the specific locally demonstrated gates as evidenced.
For each gate record the exact check ID, sample domain, tolerance, orientation,
source SHA and receipt SHA. The 64/64 coefficient gate remains separate.
Do not promote the entire candidate to T2 globally qualified based on these
sampled native results alone. Further checks, if required by the existing
contract, must be newly scoped and authorised (no replay of consumed marker).
Do not infer full Tube thickness, volume, final STEP reopened invariance,
global G1 over the continuous domain, or full production acceptance.

The native receipt explicitly records:
exactG1Certified=false; fullNativeGateCertified=false; globalTubeAccepted=false.

## Included authentic receipts (copied byte-for-byte, no recalculation)

- transfer.receipt.json: SHA256 0fc9a8517aef9cf0d6dae2be72ba83918c4416f4a30840d2a167eb5947f11a03
- inputs-preflight.receipt.json: SHA256 1867f2b4e02cdf0d38ee30f4b89d9c96bd30980f7427af83ee346c39f522c1e5
- inputs-static.receipt.json: original file successor7-static-inputs-v1.receipt.json
- native-single-run.receipt.json: SHA256 862be868c63b0f075a71f1dafb9662aa8e58ad9d59c5f541497990c56aba7833
- native-single-run.CONSUMED.json: exact copy of consumed marker, not a reset.

No CAD live/copy6b changes, no original worktree edits, no merge main,
no 50-file historical publication. This handoff reports verified existing
receipts; it does not claim that a message was delivered to another ChatGPT chat.
