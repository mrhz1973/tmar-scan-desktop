# Edit Surface and occt-wasm 5.15.0

Checkpoint: 10 November 2026. This is the plugin compatibility work for the
ScanRuler 0.11.1 integration. It does not replace integration/build/browser
gates or qualify the separate T2/Tubo experiment.

## Runtime and API scope

The installed facade changed from `occt-wasm` 5.7.1 to 5.15.0. Existing APIs
used by the editor are retained in the package declarations. Added optional
arguments do not require call-site changes. The 5.15.0 facade adds exact NURBS
surface construction, tighter spline bounding boxes and improved integrated
mass properties. A volume measured by the older implementation is therefore
not treated as an exact geometric invariant across these versions.

Upstream release: [occt-wasm v5.15.0](https://github.com/andymai/occt-wasm/releases/tag/v5.15.0),
published 2 November 2026 at 23:49:50 UTC. The release tag targets
`bce9299aa7e7bd85f9e6c0e6aeae30f655d98ef6`. This plugin continues to use its
existing surface-edit reconstruction and acceptance checks; the dependency
update does not silently substitute a new surface algorithm.

## Recipe identity and recovery

New recipes record `occt-wasm-5.15.0/brep-v3`. The parser can read the recorded
5.7.1 identity without rewriting it. Unknown runtime identities remain invalid.

Ordinary versions 2 through 6 can attempt isolated replay with the new kernel.
They must still pass the exact source BREP hash, source topology, base-net
hash, locked-pole constraints, original geometry checks and, when reopened
through the host, the exact canonical replay STEP hash. Existing G1 support,
map and accepted-coefficient checks remain intact. A mismatch preserves the
saved CAD as a copy; it does not adopt a partially restored editable session.
Creating a new recipe after successful restoration records the current engine.

Old experimental v7/v8 histories are refused before importing CAD. Their
cross-runtime migration has not been qualified. Their stored metadata remains
unchanged; the ordinary UI's separate restriction on adaptive history also
remains in force. No archived T2 target, candidate, marker or STOP is changed.

## Genuine old-runtime fixtures

`tests/fixtures/occt571-recipes.json` contains six synthetic cases, produced by
the existing 5.7.1 checkout, then consumed unchanged by 5.15.0:

| Version | Saved case |
| --- | --- |
| 2 | Locked solid face |
| 3 | Free natural sheet |
| 4 | Refined locked solid face |
| 4 | Refined free natural sheet |
| 5 | Plane G1 support and accepted coefficients |
| 6 | Compatible curved G1 support and accepted coefficients |

The producing checkout is `099fe5493af3305ef8cae8fd385051b1b7a00277`.
The fixture embeds producer source and WASM hashes. Its complete SHA-256 is
`8a5ab58e7f18a76e48f96c10b69f1d238deecccc2d54b5e4b1d8f1bfa45926b3`.
It is 469,793 bytes. Preserve this artifact; do not regenerate it with the new
runtime or relabel a current recipe as a legacy fixture.

The reproducible old-runtime generator is
`tests/fixtures/generate-occt571-recipes.mjs`. It requires an explicit old
source root and checks the installed package version before generating CAD.
Its use is separate from the normal test suite. Fixtures contain synthetic
geometry only.

## Checks completed at this checkpoint

`recipeEngineMigration.test.ts`: **9 passed** on the actual 5.15.0 runtime.
The six saved cases all passed independent host replay, exact canonical STEP
matching, exact restored coefficient nets and locks, and native source/result
sample comparisons. Each face uses a 5 by 5 grid of positions and normals;
these sampled checks supplement the exact guards and do not certify arbitrary
cross-version geometry. The test also checks tampered data refusal, preservation
of the current validated face on a failed restore, truthful new recipe identity,
and explicit refusal of old adaptive v7/v8 histories before touching CAD.

The first migration test run had four test-harness failures because it checked
an old preview revision after serializing a fresh recipe. The corrected test
checks failed-restore atomicity before serialization. No production geometric
criterion or hash check was relaxed; the earlier failure log is preserved.

Before changing recipe identity, the existing `recipe.test.ts`,
`g1RecipeKernel.test.ts` and `g1CurvedRecipeKernel.test.ts` also passed on 5.15.0:
**16 tests across three files**. These establish a separate new-runtime native
baseline and are not evidence about arbitrary old projects.

The strict G1 schema, adaptive v7/v8 schema and independent replay transport
tests add **18 passing tests across four files**. One existing transport test
initially raced its asynchronous hash by replying after a fixed 10 ms sleep;
it now waits for the actual worker request with a bounded timeout. The four
transport cases then passed. No runtime behavior or acceptance threshold changed.

## Limits

The successful migration covers these six synthetic ordinary contracts and the
unchanged strict replay guards. It is not a universal promise that every old
BREP serializes identically. Annotated-history recovery and integrated workspace
behavior require their own host tests. The T2 target search, complete Tubo
acceptance, general G1 support and unqualified adaptive histories remain separate.
