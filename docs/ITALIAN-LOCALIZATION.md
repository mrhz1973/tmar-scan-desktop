# Italian interface — TMAR Versione 5

The application starts in Italian in a fresh browser. **Impostazioni → Lingua
dell’interfaccia** switches between Italiano and English without reloading the
page, replacing the viewer, or closing a project. The preference belongs to the
browser (`tmar.language`), not to the saved project. `?lang=it` and `?lang=en`
override the initial preference; changing the selection updates that parameter
without removing other URL parameters.

## Scope and data boundary

The three catalogs in `src/i18n/it/` cover the main measuring interface,
Ricostruzione CAD, mesh tools and TMAR extensions, including Modifica superficie,
Zebra, notes, history and display controls. Translate interface messages at the
React boundary. Keep commands, enum values, project keys, geometry, formulas,
file paths, free text and user-supplied names unchanged. A translated label must
not be used as a command identifier or written back into the model.

`coreText`, `reverseText` and `pluginText` select the appropriate catalog and
fall back to the other catalogs for shared vocabulary. Unknown diagnostics retain
their original text. Non-string values pass through unchanged. Rendering a
parameter does not translate that parameter, and React escapes the resulting
text normally. No HTML injection or DOM text-replacement observer is used.

Stored progress and history messages are localized on display by matching known
catalog templates. Their stored values and MCP responses are not rewritten.
Node/headless consumers default to English. Subscribe with `useLanguage()` in a
component that renders translated text so an open dialog updates immediately.
Shared presentational components must receive a label translated only once.

## Translation conventions

Use a formal Italian register. Examples: feature → operazione, body → corpo,
face → faccia, edge → bordo, sketch → schizzo. Draft means **Sformo** for the CAD
operation and **Bozza** for an export resolution. Preserve numbers and units from
the existing display-unit formatters. Technical identifiers and file formats
remain unchanged.

Catalog placeholders use `{0}`, `{1}`, etc. Preserve placeholders that carry
values or user content. Some English plural suffixes and grammatical fragments
are intentionally omitted or reordered in Italian; the review records are
stored beside this document in `italian-placeholder-review.json`.

## Validation

`tests/i18n.test.ts` checks language selection, parameter preservation, unknown
diagnostics and assembled display messages. `scripts/e2e-italian.mjs` tests the
production bundle in a fresh browser: Italian defaults, translated workspaces,
live language switching, unchanged saved-project members, retained viewer,
persistence and project reopen. Existing English functional scenarios select
English explicitly and retain their original assertions.

The normal architecture, units, unit/MCP, TypeScript/build and browser gates
remain required. ScanRuler stays at upstream **0.11.1**; the independently
numbered TMAR delivery is **Versione 5 — Anteprima**. No kernel dependency or
geometry qualification changes are part of this localization.
