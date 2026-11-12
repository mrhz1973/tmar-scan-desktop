<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# TMAR numbered versions

Owner decision, 2026-11-03: use **Versione 1, Versione 2, Versione 3...** rather than a Git hash as the user-facing identifier.

## Source of truth

`tmar-version.json` contains the positive integer `number` and the separate `channel` (`preview` or `stable`). Vite validates and embeds this manifest. The badge shows **Versione N**, with **Anteprima** or **Stabile** separately. The full source commit, dirty-tree status and build time remain available in Settings → Dettagli tecnici. The original ScanRuler version, attribution and project `appVersion` are not changed.

A number belongs to a coordinated user delivery, not a commit, browser session, computer, date or compilation. Rebuilding, testing or reloading does not increment it. The same delivery on Windows/macOS keeps the same number. This numbering does not imply desktop packaging, automatic updates or stability approval.

## Next delivery

Before preparing a distinct subsequent user snapshot, advance exactly once from the last coordinated delivery. For example, after Versione 1:

```sh
node scripts/tmarVersion.mjs next 1
```

The explicit expected current number and exclusive writer lock prevent stale/concurrent increments. The command only updates the manifest: it does not build, tag, push, release or deploy. Review the CHANGELOG, run checks, commit the manifest with the delivery changes, then build and package from that clean commit. Record the same version in the preview manifest and package name. Never distribute two different snapshots under the same number; additional development commits are not a new user delivery until that process runs. Coordinate the single sequence across branches.

Do not relabel or rewrite old frozen previews. They retain their historical technical identifiers and are not retroactively Versione 1. Opening an old URL does not update it; old user sessions must not be reloaded automatically.

## Numbered preview history

| Version | Date | Channel | Change |
| --- | --- | --- | --- |
| 1 | 2026-11-03 | Preview | First human-numbered TMAR preview; prominent Versione 1 label, explicit Anteprima, technical provenance moved behind expandable Settings details. |
| 2 | 2026-11-05 | Preview | Pinned web beta on `release/beta-version2-20261105`; manifest verified at `e8182ae74ea45ed5ea2f93788790660bc30f1410`. |
| 3 | 2026-11-10 | Preview | Consolidated host and ordinary Edit Surface plugin; visible saved-edit recovery, annotation/duplicate integration and display-unit corrections. Scope and gates: [integration record](tmar-host-integration-20261110.md). |

Versione 3 continues the existing sequence after the verified Versione 2
manifest. It does not renumber either previous snapshot or imply a stable
release, installer, deployment or an automatic update of an open session.

Versione 1 is based on the current review branch with Edit Surface direct selection. Numbering changes no geometry or input behavior. The previously reported one-pixel drag threshold and Escape-during-drag limitations, unfinished annotated transactions/parametric history and recovery remain open. No general QS parity or stable desktop release is declared.

## Controllo dell'indirizzo e della versione prima di ogni pubblicazione

Il punto di ingresso canonico richiesto dall'operatore è
`https://scanruler.31-70-139-73.sslip.io/`.
La pagina deve continuare a indirizzare ai canali Stable e Dev e a mostrare
l'identità reale delle build letta da `/tmar-live-versions.json`.
Il canale Dev è su `https://scanruler-dev.31-70-139-73.sslip.io/`.

**Regola obbligatoria:** ogni nuova snapshot pubblicata sotto Stable/Dev che
contenga modifiche visibili deve avere un `tmar_number` incrementato
rispetto alla consegna precedente. Un commit, un rebuild di prova o una
ricompilazione della medesima snapshot non costituisce un nuovo rilascio.
Non distribuire due snapshot diverse con lo stesso numero.

Preflight di consegna: confrontare SHA Git, `tmar-version.json` e
`tmar-preview-version.json`, controllare i metadata pubblici, validare il
collegamento d'ingresso e il DNS/redirect, aggiornare il changelog, quindi
verificare da rete esterna che il badge e il portale mostrino la nuova versione.
Se il link pubblico cambia, notificare l'operatore e preservare il redirect
dell'indirizzo canonico; non sostituire automaticamente il suo preferito.

**Candidato successivo (non ancora in Stable/Dev):**
TMAR **Versione 6 — Anteprima**, nel ramo `integration/host-v5-ux-20261111`.
La Versione 5 rimane l'ultima build realmente pubblicata, finché la Versione 6
non supera CI e accettazione operatore. L'upgrade ufficiale CNCKitchen 0.11.2
è un lavoro separato da verificare con le personalizzazioni TMAR.

## Checks

```sh
node --test scripts/test-tmar-version.mjs scripts/test-build-identity.mjs
node node_modules/vitest/vitest.mjs run plugins/tmar-build-info/tests
```
