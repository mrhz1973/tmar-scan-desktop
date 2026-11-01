<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# TMAR Scan Desktop

**An open-source desktop project derived from ScanRuler, aiming to provide better control over project saves, session continuity and updates when working with 3D scans.**

An independent fork of [ScanRuler by CNC Kitchen](https://github.com/CNCKitchen/ScanRuler), maintained at [mrhz1973/tmar-scan-desktop](https://github.com/mrhz1973/tmar-scan-desktop). This is not an official CNC Kitchen distribution.

> **Status as of November 1, 2026: initial design and documentation.**
> This repository contains the ScanRuler source baseline and the plan described below. **No installable TMAR desktop release is available yet.** Versioned desktop saves, AI workflow pause/resume, TMAR updates, additional plugins and CUDA/Metal acceleration are goals to implement and validate, not delivered features.

**Documentation language:** English is the primary language of this README. Italian localization of the application and documentation is planned for a later stage; it is not available yet.

[Status and roadmap](#status-and-roadmap) · [Benefits and limitations](#why-a-desktop-application) · [Updates](#updates-without-manual-builds) · [Multi-selection](#model-tree-multi-selection-and-bulk-actions) · [Quick notes](#quick-notes-on-the-model) · [Settings and display](#settings-collapsible-panels-and-per-workspace-labels) · [Languages](#languages-and-future-italian-localization) · [Try it today](#how-to-try-it-today) · [Original documentation](README.upstream.md)

## Why this fork exists

The goal is to make long reverse-engineering sessions more practical: save work reliably, pause deliberately and resume without reconstructing the operational state from scratch. We also want to follow ScanRuler's frequent updates without requiring users to compile the application or maintain a fork manually.

The chosen direction is **a Windows and macOS application with a desktop shell separate from the ScanRuler web bundle**, together with project-management, update and AI-integration services. Customizations should remain modular wherever possible, so the project can continue benefiting from upstream development.

This project is intended for personal use and community sharing. Modification sources will be public, and future releases should include prebuilt packages, not only source code intended for developers.

## Is this repository right for you?

| Your need | Recommended choice today |
| --- | --- |
| Use ScanRuler immediately without installing anything | Use the [original application](https://scanruler.com/) and its documentation. |
| Follow or contribute to a desktop edition with persistent workflow management | This repository describes the project and will host its implementations. |
| Install a stable TMAR application on Windows or Mac today | No installer is available yet. Wait for an explicitly qualified release. |
| Obtain CUDA or Metal acceleration immediately | Not implemented: this is a later phase, subject to benchmarks. |
| Modify the code and experiment | The source baseline is available; development instructions appear below. |

## Why a desktop application

**These are benefits we intend to deliver**, not results of an already completed performance comparison.

| Desktop goal | Expected benefit | Limitation to consider |
| --- | --- | --- |
| Dedicated window | Separate CAD work from the browser used for browsing and chat | A desktop window can still crash: verified saving and recovery are necessary. |
| Projects and snapshots on disk | Locate files, retain revisions and recover the last valid state | Backups need testing; autosave cannot prevent every possible loss. |
| Operational pause and resume | Continue from the last completed operation and saved work plan | This does not freeze any arbitrary calculation at its exact internal execution point. |
| Managed updates | Receive verified packages without manual compilation | Incompatible upstream changes may delay a TMAR release. |
| Windows and macOS | Share a workflow and portable project files | Local paths, dependencies and compatibility require validation on both platforms. |
| Resource controls | Make consumption, budgets and compute activity visible | More memory or a GPU does not automatically accelerate every operation. |

Original ScanRuler **already processes scans locally**, saves `.scanruler` projects, and provides browser recovery and MCP integration. These are not inventions of this fork. Our goal is to add desktop management and operational continuity around those capabilities. Inherited documentation is preserved in [README.upstream.md](README.upstream.md).

The planned shell uses Electron: it remains a web engine embedded in an application, not a complete native rewrite of the CAD system. Installation, disk space, shell memory use and security maintenance are trade-offs. **Moving to desktop does not by itself guarantee better speed, geometric accuracy or privacy.**

## Status and roadmap

The source baseline verified for this plan declares **ScanRuler 0.9.4** in [package.json](package.json), at upstream commit [`5c1f2f9`](https://github.com/CNCKitchen/ScanRuler/commit/5c1f2f96b7ac336d5c2bad64148ae19790b0443c). This identifies the inherited baseline, not a TMAR desktop release.

| Area | Status | Intended outcome |
| --- | --- | --- |
| Public fork and English project overview | Available | Provenance, goals and limitations are visible before choosing the project. |
| ScanRuler web capabilities | Present in inherited source | Measurement, comparison, reverse engineering, mesh tools, projects and MCP; no new desktop qualification is implied. |
| Desktop application | Planned | Windows x64 and macOS Apple Silicon packages, with declared requirements and platform testing. |
| Disk saves and recovery | Planned | Explicit saves, configurable autosave, snapshots and verified restoration. |
| AI workflow pause and resume | Planned | Persistent checkpoints, operation state and reconstruction of operational context. |
| Updates and rollback | Planned | Automated builds and tests, versioned packages, stable/fast channels and safe activation. |
| Resources and backend selection | Planned | Monitoring, RAM/GPU-memory budgets, controlled concurrency and a CPU execution path. |
| GPU computation on Windows and Mac | Later investigation | Evaluate WebGPU and CUDA/Metal modules where a benefit can be demonstrated. |
| Zebra surface analysis plugin | Planned | A dedicated, community-editable plugin for visual inspection of surfaces and joins, adjustable stripes and report images, complementing quantitative CAD/mesh comparison. |
| Model-tree multi-selection and bulk-actions plugin | Planned | Consistent Ctrl/Cmd, Shift and Select All behavior across relevant feature, body and construction-element lists, with collective visibility and supported actions. Reuse existing upstream capabilities. |
| Quick-note access plugin | Planned | A directly accessible Note action and a shortcut configurable in Settings: activate, click a point on the object, write and save the annotation. Reuse the existing note system. |
| Collapsible Features and Notes panels | Planned | Independently collapse/expand long panels, retain their state and selection, and configure layout preferences in Settings. |
| Per-workspace labeling and annotation visibility plugin | Planned | Settings-based display controls, including hiding note text and markers in Mesh Tools without deleting notes or changing their availability to a connected agent. |
| Italian application and documentation localization | Planned for a later stage | An English-first project with translatable UI strings, a selectable Italian interface and maintained Italian documentation. |
| Customizations and contributions | Planned | New extensions organized as plugins with dedicated source, README and tests; explicit dependencies and update-compatibility checks. |

The development order is **desktop shell → persistence and recovery → pause/resume → verified updates → measured optimization**. Usability plugins may be developed alongside these foundations. Some tasks can proceed in parallel, but speed must not come before reliability. This README does not set delivery dates.

## Saves, pause and resume

Projects should support disk saves with periodic snapshots and checkpoints before critical operations. Writes must avoid replacing the last valid copy with an incomplete save and must handle failures such as a full disk or an unexpected shutdown.

Saving an AI workflow requires more than the model: its goal, requirements, notes, completed operations, outstanding work, performed checks and component versions must also be retained. Resuming must verify the project's actual state before issuing further commands, avoiding duplicate operations.

**The initial pause mechanism will stop between safe operations.** A running geometric calculation may need to finish, or be cancelled and repeated from the last checkpoint. Arbitrary resumption at an internal instruction of a CAD operation is not promised.

A project checkpoint does not automatically preserve a conversation or an AI model's internal memory. It does not remove AI-service limits, network interruptions or the need to start a new agent session. These conditions must be detected and handled explicitly.

Windows/Mac portability does not mean automatic cloud synchronization: project transfer and external-file references need a verified procedure. Uncoordinated concurrent edits to the same project should not be allowed.

## Updates without manual builds

**Approved architecture, not yet implemented:**

1. **Desktop shell:** an initial installation for each platform and independent updates, including security maintenance.
2. **ScanRuler web bundle:** a separately downloadable local version, without rebuilding the entire installer for every upstream change.
3. **Services and native modules:** MCP components, project management and possible GPU backends, versioned and checked together with the web bundle.
4. **GitHub pipeline:** detect upstream releases, integrate customizations, build, test and publish only approved candidates.

Even with several upstream releases in one day, users should not have to follow each one manually. The pipeline may consolidate updates onto the latest candidate. The **stable** channel should favor consolidated versions; the **fast** channel should make versions available sooner after checks pass. Instant upstream-update availability is not guaranteed.

An update must be downloaded and verified without replacing components used by an active job. Activation should happen with the project saved and compatibility checked across the application, MCP, modules and project schema. Packages and manifests must have authenticity and integrity checks rather than come from arbitrary downloads.

**If an update fails checks, the last verified version stays in use.** Projects may pin their working version. Preserve a copy before migration: rolling back the application does not guarantee that an already migrated project will open in an older version.

The goal is offline work with installed components. Update downloads and remote AI services still require connectivity. Users will not need their own fork to use future public packages.

## GPU and memory: optimize where it helps

Using the GPU to display a scene and using it for geometric computation are different things. There is no planned switch that automatically turns the entire CAD system into GPU code.

Performance work will begin with reproducible bottleneck measurements. Initial candidates include distance calculations, deviation maps, nearest-point searches and parts of alignment. We will evaluate WebGPU for cross-platform operations and dedicated **CUDA backends on Windows with NVIDIA** and **Metal backends on macOS Apple Silicon**, retaining a CPU path when a GPU backend is unavailable or not beneficial.

RAM and GPU-memory budgets should guide caches, batch sizes and concurrency. They are not promises of exclusive physical allocation or an automatically enforced hard limit on the entire application. Mac memory management requires its own qualification rather than a copy of settings intended for a discrete Windows GPU.

An optimization will be accepted only after measuring **end-to-end time, memory use, result correctness and failure behavior**. No TMAR benchmarks demonstrating acceleration are available yet. No speed multipliers or automatic accuracy improvements are promised.

## Customization without losing updates

**New TMAR features, starting with zebra analysis, will be designed as separate, community-editable plugins**, rather than changes scattered throughout the application core. Use existing extension points and keep desktop-shell services in separate modules. Core changes remain possible when required, but must be minimal, justified, documented and covered by tests. See the [upstream plugin architecture](plugins/README.md).

### TMAR plugin requirements

Each extension should make it easy to identify where a change belongs and how to verify it:

| Requirement | Expected outcome |
| --- | --- |
| Dedicated source directory under `plugins/<id>/` | Find plugin logic, UI and resources without searching for scattered core modifications; register through upstream extension points. |
| A README for the plugin | Explain purpose, source layout, development and test instructions, configuration, examples and known limitations. |
| Explicit interfaces and dependencies | Document access to the host and other plugins, supported versions and compatibility; avoid undeclared coupling. |
| Dedicated tests and reproducible cases | Contributors can modify a plugin, verify its behavior and submit a focused pull request. |
| Optional activation and separate state | The rest of the application remains usable without the plugin; saved preferences/data have distinct namespaces and a compatibility strategy. |

The initial model follows upstream plugins included at build time: **a separate directory does not automatically mean hot installation of an external package**. Source changes require rebuilding and testing the affected bundle; the TMAR pipeline should provide prebuilt packages to end users. A manager for independently installable/updatable plugins would need a separate compatibility, authenticity and security design and is not available.

A new upstream version must not erase a customization just to install successfully. If it introduces a conflict or changes an interface, distribution of that candidate must stop until integration is verified. Automation reduces users' manual maintenance; it does not eliminate all project-maintenance work.

General fixes may also be proposed upstream under its contribution rules. A fork does not imply that CNC Kitchen accepts or supports those changes.

## Zebra analysis — planned plugin

**Added to the roadmap on November 1, 2026. Status: planned, not implemented.** Introduce a zebra-analysis mode to visually inspect reconstructed surfaces and their joins, helping identify unwanted waviness and discontinuities before delivery.

**Proposed organization:** a `tmar-zebra` plugin under `plugins/tmar-zebra/`, with source, `plugin.ts`, `README.md` and dedicated tests. The directory and implementation do not exist yet. Contributors should be able to improve visualization, controls and checks within the plugin; CAD-body and viewport integration must be explicit and documented.

- [ ] Implement the separate plugin, document its interfaces and verify that the application still works without it enabled.
- [ ] Display zebra stripes on selected CAD bodies and surfaces, with an on/off control.
- [ ] Provide adjustable stripe orientation and density to inspect from different directions.
- [ ] Capture views with reproducible parameters for verification reports and AI review.
- [ ] Test reference surfaces with smooth joins, known discontinuities and intentional sharp edges; check tessellation and displayed-normal effects on Windows and macOS.

Zebra analysis must complement, not replace, quantitative CAD/mesh comparison and dimensional/topological checks. A regular-looking display is not by itself proof of geometric continuity or agreement with the real part. Intentional sharp edges must be distinguished from defects.

## Model-tree multi-selection and bulk actions

**Added to the roadmap on November 1, 2026. Status: planned, not implemented as a TMAR extension.** AI-assisted modeling can produce very long lists of features and construction elements. Selecting and hiding each row individually must not be the only practical way to manage them.

The [upstream Reverse engineer documentation](plugins/reverse/README.md) already describes Ctrl/Shift multi-selection for the body list. First audit and reuse that behavior; this item is about extending and making it consistent across the relevant feature, body and construction-element lists, not claiming that multi-selection is absent everywhere.

**Proposed organization:** `plugins/tmar-model-tree/`, with a documented adapter to the host's selection, visibility and history mechanisms. The directory is not created yet. Where existing extension points cannot reach an original list, add minimal documented hooks rather than a competing selection state or scattered core changes.

| Interaction | Required behavior |
| --- | --- |
| Click a row | Select that row and show clear selection feedback. |
| Ctrl+click on Windows / Cmd+click on macOS | Add or remove individual, non-adjacent rows from the selection. |
| Shift+click | Select the contiguous range from an anchor row to the clicked row, including rows reached by scrolling. |
| Ctrl+A on Windows / Cmd+A on macOS | Select all eligible entries in the focused list's current scope, not merely the rows currently rendered on screen. |
| Escape / Clear selection | Clear the selection without changing the geometry or visibility. |

- [ ] Provide explicit Select All, Clear Selection and selected-count controls, plus keyboard access that does not hijack text fields or other panels.
- [ ] Apply **Show selected**, **Hide selected** and **Isolate selected** to the entire selection, with a way to restore the visibility state from before isolation. Mixed visibility must resolve to the requested state, not blindly toggle each item.
- [ ] Allow other supported actions, such as grouping or suppression where appropriate, only after checking the selected item types and dependencies. Hiding is not suppression or deletion. Destructive actions require a separate dependency preview and confirmation.
- [ ] Clearly define filtered-list and collapsed-group scope. Use stable item IDs; adding new rows during AI work must not silently add them to an existing selection or redirect an action.
- [ ] Route grouped changes through the host's history, aim for one undoable action, and avoid rebuilding the entire model once per selected row. Respect active-operation guards and report unsupported items or failures explicitly.
- [ ] Test long and mixed lists, scrolling, range selection, filtering, mixed visibility, undo/redo, AI-created rows and both platform keyboard conventions. Publish measured responsiveness before claiming scalability.

The initial priority is reliable selection and collective visibility. More invasive batch operations should follow only when their dependency and recovery semantics are verified.

## Quick notes on the model

**Added to the roadmap on November 1, 2026. Status: planned, not implemented as a TMAR extension.** Make it easy to attach an observation or correction to a specific location without repeatedly searching through panels.

**Requested flow: activate Note → click the target point on the object → write the annotation → save.** Provide a directly accessible Note button and a keyboard shortcut configurable in **Settings** (proposed group: **Shortcuts**). The exact default binding must be chosen after checking existing shortcuts on Windows and macOS; no key is assigned by this document.

The [upstream documentation](README.upstream.md#when-your-part-does-not-come-out-right) already describes a Note action followed by clicking a point and entering feedback under Notes for the agent. This extension should reuse that data model and workflow, improving quick access and usability rather than creating a duplicate annotation system.

**Proposed organization:** `plugins/tmar-quick-notes/`, with source, a dedicated README and tests. The directory is not created yet. Any required integration with the existing note editor, picking, persistence and MCP should use explicit host interfaces or minimal documented hooks.

- [ ] Expose Note directly in an appropriate toolbar and through a shortcut configurable in Settings, with conflict feedback and a reset-to-default option, without stealing keystrokes while typing or overriding an active editor unsafely.
- [ ] Show an armed placement mode and target feedback. Clicking the object places a marker and opens a focused text editor; a miss must not create an arbitrary note.
- [ ] Support explicit Save and Cancel, and Escape to leave placement mode without an empty annotation. Restore normal model navigation afterward.
- [ ] Preserve the note text and location through project save/load. Record suitable object references and model-space coordinates; if rebuilding or changing the target invalidates the association, flag it instead of silently moving the note elsewhere.
- [ ] Keep notes accessible through the existing agent-note mechanism when the user has explicitly connected an agent. Creating a local note must not automatically enable an agent connection or upload data.
- [ ] Test placement on supported scan/CAD targets, cancel, focus handling, shortcut conflicts, save/reopen and target transformations on Windows and macOS.

## Settings, collapsible panels and per-workspace labels

**Added to the roadmap on November 1, 2026. Status: planned, not implemented as a TMAR extension.** Settings should provide a central place for shortcut, panel-layout and labeling preferences. The concrete problem reported by the user is that notes remain visually intrusive in Mesh Tools, while long Features and Notes lists consume too much panel space.

**Proposed organization:** a `tmar-display-controls` plugin under `plugins/tmar-display-controls/`, with a dedicated README and tests, integrated with `tmar-model-tree` and `tmar-quick-notes` through explicit host interfaces. This directory is not created yet. Audit and reuse existing display preferences first; add only minimal, documented hooks where the original Settings, panels or viewport do not expose the required controls. The proposed Settings group names below are design labels, not currently available menus.

### Independently collapsible Features and Notes panels

- [ ] Provide an accessible expand/collapse control in each panel header; Features and Notes must be independently collapsible, with a visible title and item count when collapsed.
- [ ] Keep preferences in **Settings → Layout**, remembering each panel's expanded/collapsed state per workspace across workspace switches and application restarts, with a reset-to-default option.
- [ ] Preserve list selection, scroll position and unsaved note drafts when collapsing and reopening. Do not silently commit or discard an active edit; handle focus explicitly and keep keyboard navigation usable.
- [ ] New features or notes created by an AI must not force a collapsed panel open or steal focus; update the count or show an unobtrusive indicator instead.

Collapsing a panel changes its layout only. It must not hide the corresponding geometry, suppress features, remove notes or implicitly change viewport annotation visibility.

### Labeling and annotation visibility in each workspace

- [ ] Provide **Settings → Display → Labels and annotations**, with a global default and clearly indicated per-workspace overrides for each applicable workspace, explicitly including **Mesh Tools**, not only Reverse engineer. Include a direct workspace toggle for quick show/hide access.
- [ ] Offer a master **Show labels and annotations** control, plus separate categories for note text, note markers/leader lines, element/body/feature names and measurement labels where those categories exist. This controls viewport overlays, not the names used to identify rows in the model tree.
- [ ] Provide a **Hide notes in this workspace** action that hides note text, markers and leader lines together. Hidden note overlays must not intercept clicks or show leftover hover labels, so mesh selection and editing remain unobstructed.
- [ ] Persist the per-workspace choices and restore them on workspace switches and restart. For example, notes may stay visible in Reverse engineer while being hidden in Mesh Tools; changing one workspace must not silently change another's override.
- [ ] Treat all these switches as display-only: do not delete notes, alter geometry, suppress features or change note access through the existing connected-agent mechanism. Hidden notes must still be saved with the project.
- [ ] When explicitly placing or editing a note while annotations are hidden, show only the necessary temporary placement/edit feedback; restore the saved display preference on Save or Cancel without silently enabling all annotations.
- [ ] Test many features and notes, panel collapse/reopen, draft retention, selection, label categories, hidden-overlay picking, AI-created items, workspace round trips including Mesh Tools, preference persistence, and Windows/macOS keyboard behavior. Verify that disabling the plugin leaves the host usable and does not remove annotation data.

**Acceptance example:** collapse Features and Notes, hide annotations in Mesh Tools, edit/select the mesh without note overlays obstructing it, and return to Reverse engineer with its independent display preferences and all note data intact. This is a planned regression scenario, not a test already passed.

## Languages and future Italian localization

**English README now; Italian application and documentation localization later.** Localization is a planned addition, not a second fork or a separate CAD implementation.

- [ ] Extract user-facing strings into translation resources with stable keys, including labels, tooltips, errors and plugin UI; use English as the fallback.
- [ ] Add an Italian language resource and an in-app language selector, remembering the preference.
- [ ] Let each plugin own its translation resources through a shared localization contract, so contributors can improve wording without changing geometric code.
- [ ] Provide maintained Italian documentation, including a future `README.it.md` linked to the primary English README once it exists.
- [ ] Test longer translated labels, numeric presentation and platform shortcuts. Changing language must not change model units, stored numeric values, object IDs or MCP command identifiers.

Existing developer documentation retains its original language unless explicitly translated. Neither Italian UI support nor a translated README is declared delivered by this roadmap.

## Quality, security and personal data

Before qualifying a desktop release, provide evidence for opening, saving, reopening, STEP export, pause/resume and crash recovery on the declared platforms. Test updates against existing projects and pre-migration snapshots as well.

Geometry changes require tests with declared data, tolerances and results: solid validity, coverage and deviations such as RMS, P95 and maximum where relevant. Comparing CAD with a scan does not by itself certify the real part's accuracy. Tolerances are contextual, not a universal number imposed by this fork.

Public pipelines must use synthetic or shareable fixtures. **Private scans, photographs, credentials, tokens, personal paths and non-anonymized logs must not be published in the repository or test artifacts.**

A desktop application does not make a remote AI service local: what an agent reads may be transmitted to its provider. Agent connections must be explicit and controlled; accounts, models and their costs remain separate from the application. See the [upstream agent privacy warning](README.upstream.md#agents).

## How to try it today

**For immediate use:** use [original ScanRuler](https://scanruler.com/). This fork has no published TMAR desktop installers yet.

**For developers:** the inherited code remains a web project. With Node.js 22 or later, as specified in [package.json](package.json):

```bash
git clone https://github.com/mrhz1973/tmar-scan-desktop.git
cd tmar-scan-desktop
npm ci
npm run dev
```

This starts the web development environment, **not** a desktop edition. The inherited `npm test`, `npm run build` and `npm run e2e:ci` commands are described in the [development documentation](docs/development.md); some tests require additional fixtures or prerequisites. Documentation updates do not constitute runtime validation.

When available, TMAR packages will appear in [this repository's releases](https://github.com/mrhz1973/tmar-scan-desktop/releases), identifying the upstream baseline, tested platforms, instructions, known limitations and corresponding source. Signing and distribution procedures for Windows/macOS remain to be implemented; Intel Macs and other platforms are not declared supported at this stage.

## Contributing and references

Suggestions and pull requests are welcome. Describe the concrete problem, desired outcome, effect on upstream updates and required tests. For performance improvements, include hardware, shareable data, timings and correctness checks.

Fork documentation must track releases: a capability moves from **planned** to **available** only with implementation and documented verification. Instructions and workflows in [CONTRIBUTING.md](CONTRIBUTING.md) are inherited from upstream; differences in the TMAR contribution process must be made explicit before applying them to new contributions.

| Reference | Content |
| --- | --- |
| [README.upstream.md](README.upstream.md) | Full copy of the original README at baseline `5c1f2f9`, retained for attribution and documentation; not a list of new TMAR capabilities. |
| [docs/manual.md](docs/manual.md) | Manual for inherited features. |
| [mcp/README.md](mcp/README.md) | Upstream MCP connection and tools. |
| [plugins/README.md](plugins/README.md) | Original project extension points. |
| [plugins/reverse/README.md](plugins/reverse/README.md) | Inherited Reverse engineer behavior, including existing body-list selection. |
| [docs/development.md](docs/development.md) | Web-baseline development and testing. |
| [CHANGELOG.md](CHANGELOG.md) | Inherited software history; not evidence that the desktop features planned here are available. |

## License and acknowledgements

Code derived from ScanRuler remains under **AGPL-3.0-only**; see [LICENSE](LICENSE). Preserve attribution, notices and dependency licenses. The original project is by **CNC Kitchen / Stefan Hermann and its contributors**; TMAR Scan Desktop is an independent initiative.

Future TMAR distributions must make their corresponding source available and comply with dependency obligations, including any GPU components. Commercial licenses described in [COMMERCIAL.md](COMMERCIAL.md) concern the original project's rights holder; they are not a TMAR commercial offering. The personal/community purpose of this fork adds no restrictions to the license.

CNC Kitchen/ScanRuler names and trademarks are not presented as this fork's branding. Original documentation is retained for provenance and reference; the desktop distribution must have its own identity.

---

**Project principle:** preserve work before accelerating it; automate updates without interrupting it; publish only demonstrated benefits, always distinguishing them from future goals.
