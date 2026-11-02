<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# TMAR Scan Desktop

**An open-source ScanRuler fork with working web plugins for Deviation notes and CAD body STL export, and a planned Windows/macOS desktop application.**

An independent fork of [ScanRuler by CNC Kitchen](https://github.com/CNCKitchen/ScanRuler), maintained at [mrhz1973/tmar-scan-desktop](https://github.com/mrhz1973/tmar-scan-desktop). This is not an official CNC Kitchen distribution.

> **Status as of November 2, 2026: two web plugins implemented and merged into `main`.**
> **CAD body STL export** and **scan-side notes in Deviation** are available when running this fork, within the scope documented below. They were integrated by [PR #1](https://github.com/mrhz1973/tmar-scan-desktop/pull/1) at [`496fe2e`](https://github.com/mrhz1973/tmar-scan-desktop/commit/496fe2eb0fb7a140fa9b8d9707e126030db2b70c). **No installable desktop release or hosted TMAR deployment has been published by this work.** Desktop saves, AI pause/resume, automatic updates and GPU acceleration remain planned.

**Documentation language:** English is the primary language of this README. Italian localization of the application and documentation is planned for a later stage; it is not available yet.

[Available now](#web-extensions-available-on-main) | [Body STL](#cad-body-stl-export) | [Status and roadmap](#status-and-roadmap) · [Benefits and limitations](#why-a-desktop-application) · [Updates](#updates-without-manual-builds) · [Multi-selection](#model-tree-multi-selection-and-bulk-actions) · [Quick notes](#quick-notes-on-the-model) · [Deviation notes](#notes-directly-in-deviation) · [Settings and display](#settings-collapsible-panels-and-per-workspace-labels) · [Languages](#languages-and-future-italian-localization) · [Try it today](#how-to-try-it-today) · [Original documentation](README.upstream.md)

## Web extensions available on main

These are **implemented web-source features**, not just roadmap entries. They run in the browser without an Electron shell or native installation.

| Extension | Available now | Current boundary |
| --- | --- | --- |
| [CAD body STL export](plugins/tmar-body-export/README.md) | Export visible solid bodies or explicit body-list selections, including selected components, with a unit-aware chord setting. STEP remains available. | Exports CAD solids, never the source scan. Multiple bodies share a file without a Boolean union; this is not a printability certificate. |
| [Notes in Deviation](plugins/tmar-quick-notes/README.md) | Place, edit and save notes on the scan-side map without leaving Deviation. The same notes appear in Reverse engineer and survive project save/reopen. | Single viewport, visible scan side. Notes can be opened locally through Zebra; agent connection remains an independent choice. Reference-side and split-view placement remain unsupported. |

**Recorded validation:** 36 targeted unit tests, 15 combined TMAR browser assertions and 9 upstream production-bundle assertions passed on Windows/Chrome. TypeScript/Vite build, plugin-boundary and display-unit checks passed. See the [validation record](docs/tmar-web-validation.md) for the tested source, environment and reproduction commands. These are the implementation run's recorded results, not a claim that this documentation update reran them. macOS, the complete upstream suite and a live AI-provider connection remain unqualified.

Use [the fork's web build](#how-to-try-it-today) to see the new controls. Publishing source on GitHub does **not** update `scanruler.com` or reload an already open session. Prebuilt desktop packages and a managed update service are not available yet.

The two capabilities above were integrated in PR #1. This source also includes an initial [Zebra analysis plugin](plugins/tmar-zebra/README.md), developed separately under the [coordination handoff](docs/tmar-zebra-handoff.md). Go to note, configurable shortcuts, collapsible panels, per-workspace label preferences and Italian localization remain separate work items. The Zebra change is a web-source increment, not a desktop release.

## Why this fork exists

The goal is to make long reverse-engineering sessions more practical: save work reliably, pause deliberately and resume without reconstructing the operational state from scratch. We also want to follow ScanRuler's frequent updates without requiring users to compile the application or maintain a fork manually.

The chosen direction is **a Windows and macOS application with a desktop shell separate from the ScanRuler web bundle**, together with project-management, update and AI-integration services. Customizations should remain modular wherever possible, so the project can continue benefiting from upstream development.

This project is intended for personal use and community sharing. Modification sources will be public, and future releases should include prebuilt packages, not only source code intended for developers.

## Is this repository right for you?

| Your need | Recommended choice today |
| --- | --- |
| Use ScanRuler immediately without installing anything | Use the [original application](https://scanruler.com/) and its documentation. |
| Use body STL export and scan-side Deviation notes now | Run this fork's web source; see the instructions and explicit limits below. |
| Follow or contribute to a desktop edition with persistent workflow management | The web plugins are already in `main`; the desktop application remains planned. |
| Install a stable TMAR application on Windows or Mac today | No installer is available yet. Wait for an explicitly qualified release. |
| Obtain CUDA or Metal acceleration immediately | Not implemented: this is a later phase, subject to benchmarks. |
| Modify a TMAR extension | Both implemented plugins have dedicated source, English README files and tests. |

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

**Status key:** **Implemented in web source** means code is merged and the documented checks exist; it does not mean a desktop installer or hosted deployment exists. **Partial** identifies delivered subfeatures with remaining work. **Planned/assigned** is not an availability claim. The source-level integration reference is `496fe2eb0fb7a140fa9b8d9707e126030db2b70c`; documentation updates do not change the inherited package version.

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
| Zebra surface analysis plugin | Initial web implementation | View-only bands for visible or selected CAD bodies or the scan; notes can be pinned locally. Further continuity fixtures, macOS and real-part validation remain open. |
| Model-tree multi-selection and bulk-actions plugin | Planned | Consistent Ctrl/Cmd, Shift and Select All behavior across relevant feature, body and construction-element lists, with collective visibility and supported actions. Reuse existing upstream capabilities. |
| Quick-note access and navigation plugin | Partial | The Deviation Note button and shared list are implemented in `tmar-quick-notes`. Configurable shortcuts, Go to note and previous-view navigation remain planned. |
| Notes directly in Deviation | Implemented in web source; scan-side scope | Add/edit/save notes in the single scan-side comparison view; shared IDs and project round trips verified. Reference-side/split-view anchors and comparison metadata remain planned. |
| CAD body STL export UI | Implemented in web source | Export visible or explicitly selected solid bodies through the existing backend, with adjustable chord. The source scan is excluded; STEP remains available. |
| Collapsible Features and Notes panels | Planned | Independently collapse/expand long panels, retain their state and selection, and configure layout preferences in Settings. |
| Per-workspace labeling and annotation visibility plugin | Planned | Settings-based display controls, including hiding note text and markers in Mesh Tools without deleting notes or changing their availability to a connected agent. |
| Italian application and documentation localization | Planned for a later stage | An English-first project with translatable UI strings, a selectable Italian interface and maintained Italian documentation. |
| Customizations and contributions | Partial | Three dedicated TMAR plugins are in this source, with English documentation, tests and generic panel hooks. A runtime plugin/package manager and automated update pipeline remain planned. |

There are two tracks: **web plugins can be implemented and used now**, independently of the desktop shell; the desktop track remains **shell -> persistence and recovery -> pause/resume -> verified updates -> measured optimization**. Follow-up work includes reference/split-view notes, note navigation and shortcuts, display controls, Zebra and broader qualification. Tasks can proceed in isolated branches; reliability takes priority over speed. This README does not set delivery dates.

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

**The implemented `tmar-quick-notes` and `tmar-body-export` extensions are separate, community-editable plugins. Future additions, including Zebra, follow the same approach**, rather than scattering their implementation throughout the application core. Use existing extension points and keep desktop-shell services in separate modules. Core changes remain possible when required, but must be minimal, justified, documented and covered by tests. See the [upstream plugin architecture](plugins/README.md).

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

## Zebra analysis — initial web plugin

The initial plugin visually inspects displayed surfaces and their joins, helping identify unwanted waviness and discontinuities. It is a browser rendering aid, not a numerical continuity test or desktop release.

The [tmar-zebra plugin](plugins/tmar-zebra/README.md) uses a removable display layer and an independent analysis slot in Reverse engineer. It supports local pinned notes while active, without enabling an agent connection. The [coordination handoff](docs/tmar-zebra-handoff.md) records its integration boundaries.

- [x] Implement the separate plugin and document its interfaces; the host was smoke-tested with plugins disabled.
- [x] Display zebra stripes on visible or selected CAD bodies, or the scan, with an on/off control.
- [x] Provide adjustable stripe orientation, width and color.
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

## CAD body STL export

**Implemented in web source and merged into `main`; documentation checked November 2, 2026.** The [tmar-body-export plugin](plugins/tmar-body-export/README.md) adds **CAD body STL** near the Reverse engineer export controls. It exposes the existing `reverse.export.stl` backend in the UI; it is not a second CAD kernel or scan exporter. Existing body STEP export is unchanged.

Choose **Visible solid bodies** or **Selected body-list items**, set **Chord tolerance**, then press **Export body STL**. Explicit selection includes bodies in selected components; an empty/stale selection or one containing a sheet is refused instead of silently exporting everything. The selected scope may intentionally include a hidden solid.

- [x] Export reconstructed CAD solid bodies rather than the source scan or viewport display mesh.
- [x] Offer visible/selected scope and a chord field following Settings display units; default 0.02 mm, accepted range 0.0001-1 mm in this UI.
- [x] Reuse the existing exporter and check the returned binary STL length and triangle count before downloading it.
- [x] Block export during active edits/builds and reject a result when the checked model revision changes during export.
- [x] Verify an actual selected-body download with synthetic geometry: a 40 x 20 x 10 mm body, excluding the larger scan and the second CAD body. See the [validation record](docs/tmar-web-validation.md).

STL coordinates are written in millimetres; STL carries no unit metadata, so import it as millimetres. Several bodies share one file but are not automatically Boolean-unioned. Keep STEP or the project for editable CAD. Chord controls tessellation, not the accuracy of the reconstructed part; export success does not certify watertightness or manufacturability. macOS and arbitrary production parts are not qualified by the recorded tests.

## Quick notes on the model

**Partial implementation, updated November 2, 2026.** The [tmar-quick-notes plugin](plugins/tmar-quick-notes/README.md) exists with source, documentation and tests. Its first delivered capability is the shared Note action/list in the scan-side Deviation workspace. A general toolbar shortcut and navigation to a note are not implemented yet.

The [upstream note workflow](README.upstream.md#when-your-part-does-not-come-out-right) already supplies the note records, editor and agent commands. The extension reuses them instead of introducing a second annotation database.

| Capability | Current state |
| --- | --- |
| Note button and list in scan-side Deviation | Implemented; single viewport and visible scan required. |
| Click the surface, enter text, keep the note | Implemented using the existing editor; Escape cancels placement. |
| Shared note IDs/text/position and project save/reopen | Implemented; targeted browser round trip recorded. |
| Existing connected-agent note interface | Reused, not replaced; live AI-provider/MCP qualification remains pending. The plugin does not enable a connection automatically. |
| Configurable shortcut in Settings | Planned; no default key assigned yet. |
| Double-click/target button to Go to note | Planned; see the navigation requirements below. |
| Reference-side/split-view placement and captured deviation values | Planned; not implied by scan-side support. |
| Per-workspace annotation preferences and collapsible panels | Planned; the current implementation retains upstream behavior. |

**Remaining quick-access requirements:** provide a directly accessible toolbar action and a shortcut configurable in **Settings > Shortcuts**, with conflict feedback and reset to default. Choose the default key only after checking Windows/macOS bindings; do not steal keystrokes from text fields or an active editor. Preserve explicit Save/Cancel behavior, focused editing, normal navigation after completion, and safe cancellation without empty annotations. Record suitable object references and report an invalid association after a rebuild rather than silently moving a note elsewhere. These general improvements are not implied by reusing the existing scan-side editor.

### Notes directly in Deviation

**Implemented for the visible scan-side, single Deviation viewport.** Inspect the comparison map, press **Note**, click the scan surface, write the observation and keep it, without switching to Reverse engineer.

**Delivered and checked within the recorded scope:**

- [x] Expose the existing Note button, note list and editor directly in Deviation while retaining the working comparison view.
- [x] Store the actual scan-surface hit in the part frame; do not anchor to screen pixels or apply a display alignment twice.
- [x] Reuse the same note records in Reverse engineer and Deviation. The browser test preserves the note ID, text and position through save/reopen without duplication.
- [x] Keep placement distinct from map reading/pinning: the synthetic test leaves the map revision and measurement-pin count unchanged, and Escape cancels placement.
- [x] Explicitly guard reference-side/split-view placement, hidden scans, busy operations, alignment picking, surface marking, deformation animation, empty space and clipped hits. Some guards are unit-tested; see the evidence record for the exact test levels.

Notes can be made locally using Zebra's **Add note on the part** action; existing saved notes remain accessible without an agent connection. They also appear in Deviation when its existing placement guards allow it. The application never enables an agent connection on the user's behalf; independent per-workspace visibility overrides remain planned.

**Still to implement or qualify:**

- [ ] Add reference/CAD-side and split-view anchoring with explicit target identity, transforms and stale-reference handling; never silently turn a reference hit into a scan note.
- [ ] Add the configurable Settings shortcut, Go to note and temporary single-note focus feedback while labels are hidden.
- [ ] Attach valid comparison context when available: deviation value and units, tolerance, compared targets and comparison revision. Keep it as a captured observation and mark it stale after relevant changes; never infer numeric values from map colors. Plain notes must remain possible without this metadata.
- [ ] Qualify target replacement/rebuild behavior, shared completion state and editing across additional workflows, macOS and a live explicitly connected agent. Resolving a note must not be treated as proof that the geometry was corrected.

**Recorded scenario:** place and save a note in Deviation, observe the same record in Reverse engineer, then save and reopen the project with its ID, text and position intact. **Future extension of that scenario:** use a target button to locate the note on reference geometry and validate independent label preferences. The future portion has not passed a test yet.

### Locate an existing note on the model

**Added to the roadmap on November 1, 2026. Status: planned, not implemented.** With 30–40 or more notes, selecting a list entry should not leave the user searching the whole part for its marker. Extend the same `tmar-quick-notes` plugin with a **Go to note** command, reusing any existing host camera/annotation navigation rather than creating another note system.

| Interaction | Required behavior |
| --- | --- |
| Single-click the note row | Select and highlight the entry without automatically moving the camera. |
| Double-click the note row | Run Go to note: frame the annotated location and highlight its marker on the model. |
| Click the row's target/crosshair button | Run the same Go to note command with one click; place this distinct button beside the existing X and green check controls, without changing their meanings. |

- [ ] Give the target button a recognizable crosshair/target icon, a **Go to note** tooltip and an accessible name; make it keyboard-operable. Do not rely on color alone to explain the action.
- [ ] Center the view on the note's actual anchor and use an appropriate local zoom, retaining enough surrounding geometry to understand where it is. Orient the view when reliable target information allows it. Move the camera, never the model or the note's coordinates.
- [ ] Highlight the matching marker and list entry so the selected note remains identifiable among neighboring annotations. If workspace annotations are hidden, show only this note's temporary focus feedback, not all notes, and leave the saved labeling preferences unchanged.
- [ ] Preserve the pre-navigation camera pose and provide **Return to previous view**. Clear temporary focus feedback when leaving note focus or selecting another note; restore the normal workspace display policy without deleting or resolving any note.
- [ ] Resolve the saved anchor using the current target transform and stable references. If the target is missing or the association is invalid, explain that the note cannot be located rather than jumping to a guessed point or the origin. If geometry is hidden, clipped or occluded, identify that condition and offer an explicit, reversible reveal action where supported; do not silently change global visibility or section settings.
- [ ] Keep navigation separate from editing, resolving and deleting: clicking X/check, typing, selecting text in an editor or double-clicking those controls must not trigger Go to note. Do not discard an unsaved note draft or change note status as a side effect of camera navigation.
- [ ] Test both entry points with at least 40 notes, long/scrolled lists, neighboring anchors, hidden annotations in Mesh Tools, transformed targets, save/reopen, missing references and Windows/macOS input. Verify that locating a note leaves geometry, annotation text/status and saved display preferences unchanged.

**Acceptance example:** in a project with 40 notes, double-click one row or click its target button; the corresponding location is framed and its marker is clearly highlighted. Return to the previous view without changing the note's completion state. Repeat with Mesh Tools annotations hidden and confirm that unrelated labels remain hidden. These are planned tests, not results already achieved.

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

- [ ] Provide **Settings → Display → Labels and annotations**, with a global default and clearly indicated per-workspace overrides for each applicable workspace, explicitly including **Deviation and Mesh Tools**, not only Reverse engineer. Include a direct workspace toggle for quick show/hide access.
- [ ] Offer a master **Show labels and annotations** control, plus separate categories for note text, note markers/leader lines, element/body/feature names and measurement labels where those categories exist. This controls viewport overlays, not the names used to identify rows in the model tree.
- [ ] Provide a **Hide notes in this workspace** action that hides note text, markers and leader lines together. Hidden note overlays must not intercept clicks or show leftover hover labels, so mesh selection and editing remain unobstructed.
- [ ] Persist the per-workspace choices and restore them on workspace switches and restart. For example, notes may stay visible in Reverse engineer while being hidden in Mesh Tools; changing one workspace must not silently change another's override.
- [ ] Treat all these switches as display-only: do not delete notes, alter geometry, suppress features or change note access through the existing connected-agent mechanism. Hidden notes must still be saved with the project.
- [ ] When explicitly placing, editing or locating a note while annotations are hidden, show only the necessary temporary placement/edit/focus feedback. Restore the saved display policy on Save, Cancel or leaving note focus without silently enabling all annotations; Go to note must not change the saved preference.
- [ ] Test many features and notes, panel collapse/reopen, draft retention, selection, label categories, hidden-overlay picking, AI-created items, workspace round trips including Deviation and Mesh Tools, preference persistence, and Windows/macOS keyboard behavior. Verify that disabling the plugin leaves the host usable and does not remove annotation data.

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

**To use the new TMAR controls, run this fork's web application.** The original [ScanRuler website](https://scanruler.com/) is still an option for upstream-only use, but publishing these changes does not add them to that site. No prebuilt TMAR release or desktop installer is published yet.

With Git and Node.js 22 or later, as declared in [package.json](package.json):

```bash
git clone https://github.com/mrhz1973/tmar-scan-desktop.git
cd tmar-scan-desktop
git switch main
npm ci
npm run dev -- --host 127.0.0.1 --port 5197 --strictPort
```

Open the local address printed by Vite. This explicit port avoids silently selecting an unknown port; choose another unused port if it is occupied. Use a separate browser tab/profile for testing and save active projects before intentionally reloading or replacing their app version. These commands do not update an already running upstream session.

In the fork, open **Reverse engineer > CAD body STL** for solid-body export, or **Reverse engineer > Zebra surface analysis** for Zebra and local notes. Available notes also appear in Deviation for scan-side placement. Connecting an agent is optional and retains its existing privacy warning. See each plugin's README for exact steps and restrictions.

For an existing clone, preserve any local changes and check its branch before updating; do not reset or overwrite an active worktree to follow these instructions. A production web bundle can be built with `npm run build` and served locally with `npm run preview`. This is still a web application, not a desktop package or public deployment.

Development/test details are in [docs/development.md](docs/development.md), and the precise recorded test scope is in [docs/tmar-web-validation.md](docs/tmar-web-validation.md). The complete upstream test suite has not been qualified by the targeted checks. Some tests require additional fixtures or prerequisites.

Future prebuilt packages will appear in [this repository's releases](https://github.com/mrhz1973/tmar-scan-desktop/releases), identifying the upstream baseline, tested platforms, known limits and corresponding source. Desktop signing, distribution and automatic updates remain to be implemented. Windows/Chrome is the recorded test environment, not a declaration of macOS qualification.

## Contributing and references

Suggestions and pull requests are welcome. Describe the concrete problem, desired outcome, effect on upstream updates and required tests. For performance improvements, include hardware, shareable data, timings and correctness checks.

Fork documentation must track releases: a capability moves from **planned** to **available** only with implementation and documented verification. Instructions and workflows in [CONTRIBUTING.md](CONTRIBUTING.md) are inherited from upstream; differences in the TMAR contribution process must be made explicit before applying them to new contributions.

| Reference | Content |
| --- | --- |
| [README.upstream.md](README.upstream.md) | Full copy of the original README at baseline `5c1f2f9`, retained for attribution and documentation; not a list of new TMAR capabilities. |
| [docs/manual.md](docs/manual.md) | Manual for inherited features. |
| [mcp/README.md](mcp/README.md) | Upstream MCP connection and tools. |
| [plugins/README.md](plugins/README.md) | Plugin catalog, upstream extension points and implemented TMAR host hooks. |
| [Body STL plugin](plugins/tmar-body-export/README.md) | Available UI, selection/units rules, source layout and tests. |
| [Deviation notes plugin](plugins/tmar-quick-notes/README.md) | Available scan-side annotation workflow, dependencies and remaining scope. |
| [Web validation](docs/tmar-web-validation.md) | Recorded implementation checks, baseline and explicit qualification limits. |
| [Zebra handoff](docs/tmar-zebra-handoff.md) | Coordination, source baseline, integration boundaries and contribution delivery. |
| [plugins/reverse/README.md](plugins/reverse/README.md) | Inherited Reverse engineer behavior, including existing body-list selection. |
| [docs/development.md](docs/development.md) | Web-baseline development and testing. |
| [CHANGELOG.md](CHANGELOG.md) | Merged TMAR source changes and inherited upstream history; no desktop release is implied. |

## License and acknowledgements

Code derived from ScanRuler remains under **AGPL-3.0-only**; see [LICENSE](LICENSE). Preserve attribution, notices and dependency licenses. The original project is by **CNC Kitchen / Stefan Hermann and its contributors**; TMAR Scan Desktop is an independent initiative.

Future TMAR distributions must make their corresponding source available and comply with dependency obligations, including any GPU components. Commercial licenses described in [COMMERCIAL.md](COMMERCIAL.md) concern the original project's rights holder; they are not a TMAR commercial offering. The personal/community purpose of this fork adds no restrictions to the license.

CNC Kitchen/ScanRuler names and trademarks are not presented as this fork's branding. Original documentation is retained for provenance and reference; the desktop distribution must have its own identity.

---

**Project principle:** preserve work before accelerating it; automate updates without interrupting it; publish only demonstrated benefits, always distinguishing them from future goals.
