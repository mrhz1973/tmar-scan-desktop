# Annotated host V1: recovered, reviewed and published for integration

Review only; no merge, release, desktop qualification or Versione 2.
Base: `27c75c3364511dd77e2ec0c5b8f314f529df6291`.
Bundle commit: `c9a9f3453bb941d06e7e64d83df9b03344a9a299`.
Bundle SHA256: `2d740932429b19d5fa719ebf7d37501095f289b13485cd87ff216e5578286220`.
Author plugin paired for tests: `130d12bf9b4150aa7349365b2200bda80e153feb`; NOT imported into this host branch.

## What is published
The complete 34-file host delta, including corrected oriented normals and both corrected fixtures; the permanent real-OCCT reversed-face regression; the exact real-controller source-browser regression; this receipt and a source hash manifest. No changes under plugins/tmar-edit-surface, no dependencies, workflows, credentials, profiles or user projects. Original Windows worktrees are untouched. The original contract/validation documents are historical records: their earlier QA-controller limitations and older plugin SHA are not this new review's result.

## Independent rerun
GitHub Actions run `41736131010`: ZIP digest, all 50 member CRCs and 49 supplied digests PASS. Local sandbox verification repeated these byte checks.
GitHub Actions run `41736875852`, workflow revision `88a16399debcccbac54cf6a58b68ff1e6b25b4d7`: exact-base git apply --check PASS; applied contents match every archive source after CRLF/LF normalization; occt-wasm 5.7.1; TypeScript and production build PASS. Targeted host/plugin suite: **153 tests PASS across 8 files**. Real controller, source app on Linux/Chrome: **14 checks PASS**, zero application console or atomic-publication errors.

The source scenario imports a synthetic STEP box, chooses a reversed face, enables Zebra, prepares a note through the actual controller, deforms numerically, applies one copy plus note in one history action, hides the preserved original, performs Undo/Redo, saves and reopens in a fresh page. Note UUID, feature UUID and receipt body ID are checked before continuing. The note remains verified with an outward normal; the reimported copy is a valid solid. A signed normal test accepts the correct vector and rejects its inverse. Source-review output: `annotated-edit-ajfgjj`; saved synthetic project SHA256 `fd12e77ffbfb4986e05ede9a8dd4ea60a9e32a5e12fb3f3bfc6742c21febc62b`.

This is a new independent execution, not relabeling the author's prior 14 PASS. The original bundled exact-identity project is a different run: SHA256 `1884663fcf66262bb7c9017b40df69009189822af7d615c1e19e5343d55b2a7b`. The first early asynchronous check and later author results remain in the immutable review ZIP. No assertion was weakened.

## Actual contract
Use src/plugins/annotatedCopyTypes.ts, src/plugins/workspaceEditorTypes.ts and src/plugins/workspaceEditors.ts. Capability: apiVersion=1, annotationVersion=1, commitKinds=[cad-copy, annotated-cad-copy]. Controller methods freezeAnnotated and prepareAnnotatedApply plus monotonically changing notesRevision are required; unsupported controllers still block annotated Apply. Return all notes with the final STEP and one final-face BREP witness. orientedNormal is already face-oriented; no second reversed sign and no abs(dot). Existing cad-copy, viewport lease and source-hiding option remain. Witness and destination UV are distinct; persisted verified status is revalidated against CAD on load. This is not parametric surfaceEdit.

## Limits before broader acceptance
The compiled application was built, but annotated Apply/Save/Load of this exact real-controller pair was not driven in the compiled browser in this review. No fresh qualification of Lego, arbitrary trims, periodic/multiple faces, large-model performance, packaged desktop/macOS, generalized QS parity, Patch Network, layout/timeline or Settings/tooltips. Face correspondence uses conservative finite CAD samples, classification and unique-match checks, not a universal proof of topological identity. The old modal import race remains separate. No independent subagent endorsement is claimed.

## Integration
Keep a28c747, 64af91e and 27c75c3 frozen. Review this host branch separately and pair it with an explicit plugin SHA in an isolated checkout. Do not identify the raw bundle commit, workflow commit or old 27c75c3 as the new runtime revision: use this branch's resulting git SHA.
