# TMAR ScanRuler — Bounded host sampling for thin trimmed annotated faces (2026-11-07)

## Ownership and isolation
- Host-only draft, parent `feat/host-v8-history-optin-20261106` / PR #38 at `3188afbd47cc3964485f176c285b2f6c5a96754a`.
- Changed code: `plugins/reverse/core/kernelAnnotatedNotes.ts`; focused host regressions in `plugins/reverse/tests/**`.
- Plugin `plugins/tmar-edit-surface/**` is exclusively plugin-owner territory and must not be edited or overlaid outside an isolated QA checkout. The Tubo Finale CAD session and any active operator application are strictly out of scope.
- No production feature flag, v8 UI, automatic project migration, deploy or release.

## Reproduced failure mechanism
The existing `sampleFace` classified just 9x9 UV-grid coordinates before demanding at least three interior points. A narrow trimmed annulus can lie entirely between those positions even though the CAD face is nonempty. In isolated plugin QA on an owner's LEGO STEP, 9x9 found 0 points while 17x17 found 6. Those observations establish a sampling-coverage issue but not, on their own, a valid annotated CAD-copy transaction.

## Change under host review
- Progressive UV-grid subdivisions 8, 16, 32, 64 (9x9 through 65x65). Each refinement evaluates only *new* coordinates, for a strict maximum of 4,225 classifications per face, not an unbounded retry.
- A minimum of 12 verified `classifyPointOnFace === 'in'` interior samples is now required, stricter than the historical threshold of three. Boundary samples do not count toward it.
- If even the final grid has fewer than 12 interior samples, the face is **refused** with the existing thin/unverifiable-domain error. Invalid or degenerate UV bounds and non-finite CAD evaluations are explicitly refused.
- Existing sampled CAD edge data is added only *after* interior sufficiency is established. Its finite values and parameter ranges are checked.
- Existing candidate filtering, exact-type and edge-count checks, area and centroid tolerances, **bidirectional** surface-point/trim/normal correspondence, unique-match requirement, and per-note UV/3D/normal checks are untouched. The 1e-5 mm position tolerance and 1-1e-6 normal-dot requirement are not relaxed. No closest-face, mesh or face-index fallback is permitted.
- This is a conservative coverage improvement, not a proof of continuous surface equivalence between samples. Very narrow faces still fail closed.

## Focused regressions
`plugins/reverse/tests/annotatedAdaptiveSampling.test.ts` exercises a synthetic thin UV annulus centered off the coarse lattice:
- 9x9: 0 valid interior positions.
- 17x17: 6 positions (still below the stricter target).
- 33x33: 25 positions (sufficient for verification).
- Safe acceptance for a single geometrically matching destination.
- Refusal of ambiguous duplicate destination faces, displaced destination geometry, a note in the trim hole, an inverted note normal, absent interior (bounded 65x65), degenerate UV and non-finite geometry.
The isolated mock validates sampling and guards, **not OCCT topology or the actual LEGO file**. Existing real-OCCT tests of annotated copies and signed normals remain required.

The opt-in v8 host test previously expected *every* note on that face to fail merely because the 9x9 sampler returned zero points. Its negative regression was replaced with a deterministic **inverted-normal** rejection and the same atomic-state checks. This does not assert that a valid annotated v8 transaction now passes.

## Qualification before removing HOLD
1. Execute targeted Vitest, TypeScript and full application build on the exact host commit, then ordinary annotated-copy regressions.
2. In an independent QA worktree, pair this host branch with an **exact published plugin commit** and record subtree SHA and worker/build identity; do not edit plugin files.
3. Test the owner's actual LEGO thin annular face with real OCCT, valid and deliberately wrong notes, candidate ambiguity, atomic refusal, host Undo/Redo, archived source and project Save/Reopen. A valid annotated v8 acceptance is **not yet established**.
4. Verify compiled browser/worker and real app project roundtrip, then separately installed application and physical navigation/annotation if pursuing release.
5. Preserve `experimentalAdaptiveV8` opt-in test gate, the unannotated CAD copy fallback and Draft/HOLD PR status.

**Disposition: implementation for isolated review. V8 annotated notes, UI, installed builds, full topology/G1 and release remain HOLD.**
