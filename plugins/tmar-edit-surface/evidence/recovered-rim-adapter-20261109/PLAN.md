# One isolated recovered-rim adapter check

Prepared 2026-11-09, before execution. Executor: this Edit Surface session only.

- Base branch: codex/edit-surface-tubo-periodic.
- Expected HEAD: 8540f37238399abcc7192f4baaa33e2b48fe665b.
- Installed kernel: occt-wasm 5.7.1; no dependency, host or MCP changes.
- Source: the frozen STEP with SHA-256 6b711960fcded7972ded41ed1ceaa2f09e2dd8332fc7ee980b76d2514c94e8ae.
- Input coefficients: recovered packet SHA-256 4ee5216ef839d236688c04823df17c46e60a09396f917ebf698de7e988a26476, edge #207767 / curve #207771.
- Target: the detached string of protected face 324 only; face 323 supplies the neighboring native association.
- New marker: evidence/recovered-rim-6b-8540f37.local/attempt-1.local.run-once (relative to the plugin).
- New receipt and original BREP strings stay in that private directory. Existing Tube markers and receipts are never changed.

## Why this is a distinct check

The consumed natural-topology manifest inspected a broader natural-face model and stopped at seam-rim-vertices. It is not rerun, renamed, patched or imported here. The current question is whether the actual detached face meets the existing adapter's curve ownership, vertex-representation, range and pcurve contract. Native project files and recovered text did not contain that BREP; the new primary evidence is therefore explicitly a fresh isolated read, not a recovered historical dump.

## Fixed gates and operations

1. Check HEAD, kernel, protected WIP, source hash and unused marker/receipt. Create the marker exclusively before loading the kernel.
2. Import the frozen STEP exactly once into a new isolated kernel. Do not rebuild the native project or connect to any live CAD session.
3. Require the known face count (624); treat indices 323/324 as candidates until the following checks identify them.
4. Save both complete original face BREP strings and the shared rim before any operation that changes geometry. Read all vertex tolerances and representation lists. Never assume an absent list is empty.
5. Require one shared edge, exact source-curve coefficients and native range [0,252.00932454753], one wire use on each face, forward/reversed orientation.
6. Match each native pcurve's referenced support against the own Fa support in the same import. Require the supplied LINE(t,0) on 323 and degree-1 affine pcurve to V=1 on 324, preserving its native U domain.
7. Invoke the unchanged adapter once on the string of face 324. If it rewrites, verify that everything outside the Curves table stays bytewise unchanged and save the rewritten text as unmaterialized.
8. Check frozen-file hash, complete source BREP hash and all 43 original WIP hashes after the attempt. Always retain a receipt, including STOP.

No fromBREP, sewing, STEP export, tessellation, surface sampling, volume, fitting, target reconstruction or candidate Tube is allowed in this check. A structural rewrite is not geometric or topological qualification. A STOP consumes this marker and is not followed by changing a guard and retrying.
