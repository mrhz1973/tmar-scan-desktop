# TMAR ScanRuler — VPS web preview: coordination and acceptance
Date: 2026-11-03 · Status: **IN PROGRESS / NOT ACCEPTED**

## Scope
The owner has requested a live HTTPS preview on the **new** IONOS VPS, accessible also from a work computer, automatically tracking the latest **approved and verified** `main` version, with at least 10 reusable non-sensitive 3D test examples. Work must be coordinated with chats **“ScanRuler TMAR App Desktop”** and **“2 - SurfaceLab Imple Codex 1 2D Sketch”**.

### Infrastructure identity and collision guard
- Live VPS: `31.70.139.73`; Tailscale `100.99.54.93`. Do not deploy to old `217.160.71.145`.
- The current VPS serves other applications via a public Caddy container and private Nginx. Do **not** replace or restart unrelated services.
- A deploy **already exists in progress** in `/opt/tmar-scanruler-preview` with scripts `ops/deploy.sh`, candidate Caddy configuration, generated fixtures, a `current` release pointer and `tmar-preview-*` units. **This is an existing, separate deployment executor.** Before any filesystem/config mutation, check ownership and state; only one deployment executor may modify it. Do not create a second live deployment.
- Ten public *mesh* fixtures already observed in `fixture-preflight/`: `01-planar-plate.stl`, `02-linear-ramp.stl`, `03-diagonal-ramp.stl`, `04-convex-dome.stl`, `05-concave-bowl.stl`, `06-saddle.stl`, `07-raised-ridge.stl`, `08-twin-bosses.stl`, `09-central-pocket.stl`, `10-sinusoidal-wave.stl`. Their existence does **not** prove web accessibility or CAD suitability. Inspect their `manifest.json` and validate each import.
- No GitHub Actions CI runs were returned from the public repository API at audit time. A successful source push is **not** evidence of a qualified build.

### Release contract
1. HTTPS site on a dedicated host (not within an unrelated product site); authenticated access or an explicit determination that the public preview exposes only non-sensitive local-browser processing. Never publish agent/MCP services or personal workpieces.
2. Build SHA / version displayed and linked to an immutable Git commit. A branch under `codex/*` may be deployed only as an explicitly labelled opt-in ephemeral preview, never silently as approved `main`.
3. Automatic update only after an actual build/test/smoke gate; a failed candidate leaves the previous release intact. Keep an atomic activation and a documented rollback path.
4. Opening `.scanruler` remains user-initiated. Do not refresh an open editing session merely because a new release was published. Existing AIRBOX/STL2 sessions stay untouched.
5. `/tests/` has 10+ downloadable models, a stable manifest with dimensions/units, expected surface features, operations to try, expected outcomes, and licenses/attributions. Clearly label **STL as mesh**, not B-Rep; all test files must be synthetic or have redistribution rights.
6. No DNS/SSL changes, Caddy reload, Docker recreation, systemd enablement or server migration outside the dedicated preview scope without preflight and collision checks.

### Agent ownership
- **ScanRuler TMAR App Desktop:** web UI regression, sample import, project save/reload, mesh tools, Reverse engineer, STEP import/export, Zebra, annotations, build marker and browser compatibility; publish measured test results and limits.
- **2 - SurfaceLab Imple Codex 1 2D Sketch:** provide a focused **CAD STEP** fixture set for true B-Rep Edit Surface testing. Demonstrate edit of an *imported* face/control surface, flatten/pull, boundary-lock, continuity G0/G1, rebuild/export and solid-validity checks. Do not imply that an imported STL is an editable solid; no proprietary decompiled source reuse.
- **VPS executor:** verify fixture publication and end-to-end HTTPS on the dedicated host, perform safe atomic deploy/rollback, log main SHA and release outcome, and preserve all unrelated services. Coordinate via this document and a PR instead of parallel server edits.

### Acceptance checks
- [ ] Public HTTPS URL verified externally (not just a localhost request)
- [ ] Correct `main` SHA and visible build ID in UI
- [ ] At least 10 example files downloadable and successfully imported
- [ ] True CAD STEP cases for Edit Surface distinctly validated
- [ ] Automatic update gated by checks; failed release does not replace current
- [ ] Rollback demonstrated and documented
- [ ] No changes to existing TecnoOne/n8n/PostgreSQL/LiteLLM/RustDesk or other private gateways
- [ ] Related work/PRs in ScanRuler and SurfaceLab linked here

**Stop rule:** if another executor is already updating `/opt/tmar-scanruler-preview`, use read-only inspection and communicate with that owner. Do not overwrite or start competing build/deploy jobs.
