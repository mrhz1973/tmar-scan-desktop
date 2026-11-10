# ScanRuler TMAR — Host v8 adaptive history: opt-in safety contract (2026-11-06)

## Ownership, versions and release gate
- Parent: **host PR #37 Draft** at `b9a2c958436c75bfbf0e67719b1c89a206f9e731`.
- Plugin QA snapshot: `codex/edit-surface` at `11a65d72e6371830b003f82003ac925d83ea989b`; the plugin owner retains all `plugins/tmar-edit-surface/**` files.
- Host work is limited to `plugins/reverse/**` and this coordination document. The experimental shared-support method, automatic UI activation, merge, deploy and release remain **HOLD**.
- Production default **rejects v8**. Only an explicit *per-call* `experimentalAdaptiveV8:true` supplied in host QA can qualify or reopen a v8 record. No UI path passes this option. This is not a user-facing feature switch.

## Contract and controls
1. `surfaceEditHistoryV8.ts` validates the exact host-side structure of an adaptive locked v8 recipe: `plane-to-bicubic`, locked circular-fine policy, source, B-rep/base hashes, face index, dense knot insertions, edits and immutable lock positions. It rejects extra keys, invalid numbers, duplicated indices and inconsistent snapshot/lock membership. Structural checks are not a CAD authenticity proof.
2. `surfaceEditHistory.ts` retains the v2–v6 contract without changes. An opted-in v8 **still requires independently re-evaluated OCCT STEP** to match the frozen result using the existing canonical replay fingerprint, current source binding, note/witness identity and one-use qualification token.
3. `reSession.ts` re-reads a v8 record **only after** a host-qualified one-use token and a frozen history lease have been claimed; it preserves the existing atomic CAD-copy transaction and does not accept raw plugin JSON as publication authority.
4. `projectSection.ts` archives the original upstream STEP for any structurally valid v8 sidecar, even if the UI/reopen capability is default-disabled. Saving the source is not the same as enabling editable restore.
5. `reopenSurfaceHistory` and `reopenAndRestoreSurfaceHistory` require their **explicit optional v8 gate**; otherwise the existing CAD import remains `copy-only`, with saved source, edited STEP and notes intact. Successful fresh-session installation remains the caller's explicit responsibility.

## QA: what passed and what remains open
- Host-only parser tests: 3 PASS, including default-disabled semantics and malformed v8 protection/geometry input.
- Exact QA pair host PR #37 + host v8 changes + plugin `11a65d7`: real LEGO STEP first solid, adaptive face 7, edited pole (+0.02 mm X) and lock-at-current-value v8, real OCCT independent replay. Host CAD-only frozen qualification and atomic Apply/copy, host Undo/Redo, native Reverse project archive section Save/Reopen, source preservation, and a fresh `WorkspaceSurfaceSession` restored through the real plugin dispatcher/kernel with a simulated in-memory transport: PASS in the scoped opt-in test.
- Negative checks: absent opt-in defaults to rejection/copy-only; missing independent replay and mutated v8 lock values fall back safely. A test also changes the recipe SHA consistently with a tampered lock snapshot: the independent kernel must still refuse.
- **Annotated v8 on the actual LEGO annular face: HOLD.** `validateAnnotatedCopy` can construct a witness, but `ReClient.verifyAnnotatedNotes` refuses the narrow face as *"Faccia troppo sottile o dominio non verificabile"*. This conservative geometry guard is **not weakened**. The test requires an atomic refusal with no host feature, note or Undo entry. A general qualified note-annotation path and 3D positional verification remain open.
- Host v8 feature remains an `ImportFeature` with an optional history sidecar: no independent `surfaceEdit` node in the procedural feature graph. No packaged Windows/macOS app test, no true browser/desktop UI Save/Reopen, no physical pointer drag or camera-navigation verification, no continuous G1/topological proof, and no dense scan performance qualification.

## Repeatable isolated test
Use a separate host checkout; overlay exactly the plugin's published subtree **for QA only**, never edit or commit plugin-owned files. On the ASUS Windows system:
- `HOST_SURFACE_V8_QA=1` and `SURFACE_QA_STEP` set to the absolute **read-only** `lego mod qs.stp` source.
- `npx vitest run plugins/reverse/tests/surfaceEditAdaptiveV8Contract.test.ts plugins/reverse/tests/surfaceEditAdaptiveV8Host.test.ts`
- The real STEP test **skips** unless both opt-in environment conditions are true. A separate QA-only Vite config may be required for symlinked `node_modules/manifold-3d/manifold.wasm`; do not modify production Vite security settings.
- Plugin source hash and test results should be pinned in the QA report. Never treat successful in-memory worker restore as installed app qualification.

## Decision
**Host v8 structural + CAD-only opt-in archive/restore: scoped PASS.** **Annotated adaptive v8, actual UI/installer, full CAD feature editing and release: HOLD.** Host PR #37 remains a Draft dependency. No user CAD project is accessed or modified by these isolated test cases.
