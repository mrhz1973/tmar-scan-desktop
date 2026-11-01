<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Zebra implementation - contributor coordination

Recorded November 2, 2026. This is a coordination agreement, not a runtime
implementation, an automated lock or a claim that Zebra tests have passed.
The contributor has been assigned Zebra; the coordinating chat is updating
documentation only and will not implement Zebra in parallel.

## Reference revision and branch

- Repository: `mrhz1973/tmar-scan-desktop` (not the upstream repository).
- Runtime baseline: `496fe2eb0fb7a140fa9b8d9707e126030db2b70c`, the merge of
  PR #1 containing Deviation notes and CAD-body STL export.
- Existing implementation commit: `da646bdbd46b132382c83d70ec7501515f458aaf`.
- Documentation branch: `docs/web-feature-status-20261102`.
- Suggested contributor branch: `feat/tmar-zebra-analysis`, in a separate clone
  or worktree. The branch name is a suggestion, not a branch created by this document.

The runtime baseline remains valid if `main` advances only by documentation.
Fetch before creating the branch and before integration; report the actual base
and head SHAs. Do not reset another worktree, replace its branch or reload an
active ScanRuler session. No direct push or force-push to `main`.

## Ownership and overlapping files

The contributor owns the proposed `plugins/tmar-zebra/` implementation,
including `plugin.ts`, UI/rendering logic, README, tests, synthetic fixtures
and any plugin-local browser checks. Keep documentation in English; Italian
localization is future work.

The current documentation-only change covers:

```text
README.md
CHANGELOG.md
plugins/README.md
plugins/reverse/README.md
plugins/tmar-body-export/README.md
plugins/tmar-quick-notes/README.md
docs/development.md
docs/tmar-web-validation.md
docs/tmar-zebra-handoff.md
```

Avoid editing these shared documents during the first Zebra increment. Put
Zebra documentation in its own README and describe suggested root-document
changes in the draft PR. They can be reconciled during review after the docs
change is integrated. Preserve `README.upstream.md`, licenses and existing
attribution; do not overwrite the already implemented plugins.

No changes to runtime API, viewport, CAD kernel or note/body-export code are
reserved by the documentation task. Necessary shared-code changes can be
proposed in the isolated Zebra branch, but list them explicitly in the draft
PR and keep them minimal, backward-compatible and separately reviewable.

## Existing integration points to inspect

| File/interface | Intended use or boundary |
| --- | --- |
| `src/plugins/api.ts` | Existing `ScanRulerPlugin` and runtime contribution contract. |
| `src/plugins/registry.ts` | Build-time discovery of `plugins/*/plugin.ts`; avoid hard-coding a Zebra import in core. |
| `src/plugins/panelExtensions.tsx` | Generic panel registry added in PR #1. Current slots are `reverse.export` and `deviation.extra`; these are not general material/shader hooks. |
| `src/viewer/sceneLayers.ts` | `SceneManager.addLayer` contract, transforms, clipping and layer lifecycle. |
| `plugins/reverse/viewer/reScene.ts` | Existing CAD-body rendering; inspect before proposing a visual-material hook. |
| `plugins/reverse/app/reSession.ts` | Existing session/body meshes; avoid a duplicate CAD store or kernel. |
| `plugins/README.md` | Plugin boundary and source-layout rules. |

Do not inject controls into an export slot just because it exists. If Zebra
needs a missing analysis/display or material override hook, identify the
smallest reusable host interface and explain it in the draft PR. No core file
may import `plugins/tmar-zebra` by name. Document an intentional dependency on
`reverse`; a build that omits that source must also omit dependent plugins.
Do not patch an active application's DOM or shared live session.

## Scope and acceptance expected for review

Implement a visual Zebra mode for supported CAD bodies/surfaces with explicit
on/off and target selection, adjustable stripe orientation and density, and
repeatable view parameters. Do not modify CAD geometry or export data merely
to change its appearance. Restore original materials and display state when
Zebra is disabled or the workspace changes; dispose resources appropriately.

Test transforms, clipping, visibility, interaction with deviation coloring
and the existing note overlays. Validate enable/disable and target changes,
project reopening where relevant, and host operation with the plugin disabled.
Use shareable synthetic cases with smooth surfaces, known discontinuities and
intentional sharp edges; document tessellation and normal-related limitations.
Zebra is a visual aid, not a numeric CAD/mesh comparison or certification of
geometric continuity. No speed or accuracy claim without measurements.

Run the plugin's unit/browser checks, TypeScript/build, plugin-boundary and
unit-policy checks. Re-run the existing TMAR web regression when changing a
shared hook. Clearly separate PASS, FAIL, SKIP and NOT RUN, and name the actual
platforms. Do not mark macOS qualified merely because a Windows build passes.
Never publish private scans, photographs, credentials or personal paths.

## Delivery preferred

Open a **draft pull request into `mrhz1973/tmar-scan-desktop:main`**, not into
`CNCKitchen/ScanRuler`. Keep the source on the isolated branch; do not merge it
or create a release during this handoff. Include the review packet below in
the PR description and return the PR number/URL and final head SHA to this chat.

```text
BASE_HEAD =
BRANCH =
HEAD =
PR =
CHANGED_FILES =
SHARED_HOOKS =
IMPLEMENTED_SCOPE =
TESTS_PASS_FAIL_SKIPPED_NOT_RUN =
TESTED_PLATFORMS =
KNOWN_LIMITS =
```

Include reproducible commands, public-safe screenshots and a description of
how the plugin is disabled. If PR creation is unavailable, push the isolated
branch and supply its head SHA and changed-file list; a patch is a fallback,
not a reason to overwrite shared files. Review and integration remain explicit.
