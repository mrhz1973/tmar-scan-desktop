# TMAR ScanRuler — Host Surface Edit: navigazione Fusion e history annotata opt-in

**6 novembre 2026.** Integrazione host isolata, nessuna modifica al plugin `codex/edit-surface`.

## Revisioni qualificabili e ownership

- Host autoritativo: PR #34 `bc59b1a5d875e419f9f65c26e3b1afae961903c2`, che discende dalle PR host #31 (navigazione), #32 (gizmo), #33 (preflight history).
- Plugin referenziato: `a7a47bcdce9c9fa345eb64cd62b91839dd7245de`; subtree `317e7aecab8633f7cf92c34b51c97a461be4ef43`.
- Worktree coppia QA: `D:\TMAR-QA\tmar-host34-edita7-navigation-history-qa-20261106`.
- Contratto host e test: `plugins/reverse/app/surfaceEditHistory.ts`, `plugins/reverse/app/reSession.ts`, `plugins/reverse/tests/surfaceEditAnnotatedHistoryHost.test.ts`, `plugins/reverse/tests/surfaceEditHistoryContract.test.ts`.
- Ownership: solo `plugins/reverse/**` e `docs/coordination/**`. Qualsiasi modifica alla firma dei metodi del plugin richiede coordinamento con l'autore.

## Gate navigazione, distinti per natura della prova

- App **sorgente isolata** con worker OCCT, LEGO reale, body `1.0009765625`, face 19: `TEST_FUSION_NAVIGATION=1`, Shift+centrale orbit, centrale pan, rotella zoom, drag polo dopo navigazione, Undo/Redo, Apply annotato, Zebra e Save/Reopen note: 21/21 PASS; prova con mouse automatizzato, non su installazione proprietario.
- App **compilata Vite**, fixture STEP sintetica, stessa coppia SHA: 12/12 PASS per navigazione CNC Kitchen, Fusion (compreso tasto centrale), stabilità camera in idle, frame reticolo solo esplicito, nessun errore browser.
- Nessuna regressione riprodotta nei casi provati; la distribuzione desktop e la build effettiva dell'utente rimangono HOLD.

## Modalità distinte: `cad-copy` e snapshot history

### CAD copy

- `WorkspaceEditorHost.stage` e `stageAnnotated` restano le opzioni operative, anche in presenza di note; mantengono la transazione `historyAtomic` e gli attachment verificati.
- Il file STEP importato della copia è sempre autorevole per la ricostruzione ordinaria. Un recipe/restore guasto non può sovrascrivere, ricostruire automaticamente o eliminare quel file.

### History parametrica opt-in (non abilitata UI)

- Envelope `tmar.host.surface-edit-history` versione 1, `notePolicy:'none'` retrocompatibile o `notePolicy:'annotated-v1'`. Lato host il secondo conserva recipe SHA-256, sorgente STEP originale, digest della copia CAD, `featureUuid`, validazione `annotationEnvelopeSha256`, witness SHA e note con ID bozza/testo/faccia/UV e digest dell'associazione.
- `qualifyAnnotatedSurfaceHistory` controlla l'identità della sessione, ricetta/epoche, note UV, ticket di copia annotata passato attraverso `validateAnnotatedCopy`, source hash, replay CAD indipendente e guard di freschezza prima/dopo gli await. Restituisce un token interno **monouso** legato alla ricetta.
- `stageEditorCopy(..., annotationPlan, historyToken)` ri-verifica ticket/UUID/UV, prende una propria copia del ticket, verifica la sorgente prima della mutazione, e pubblica ricetta, STEP e note nella **stessa** transazione già usata per la copia annotata. Nessun nuovo flag o pulsante UI.
- `reopenSurfaceHistory` verifica file salvati, witness, digest e note in archivio. Usa `attachment.featureUuid`, `draftId`, witness UV, destinazione del corpo e `status:'verified'`. Solo in caso di corrispondenza perfetta restituisce `notesToRestore`; in caso contrario `copy-only`.
- La normale UI note può modificare il testo dopo Apply: il successivo ripristino usa il testo più recente nel Note Store. Se la nota è stata cancellata, **non** viene resuscitata: il replay parametrico annotato è rifiutato e rimane la copia CAD.
- `bindIndependentPluginReplay` è un adattatore host indipendente dal nome del plugin; può usare il servizio `replaySurfaceHistory` del plugin (v2–v5, v6 curvo) mediante dependency injection e controllo sorgente a ogni boundary.
- `restoreVerifiedSurfaceHistory` accetta **solo** il risultato monouso di `reopenSurfaceHistory`, crea un controller nuovo con lo STEP **upstream**, richiede una preview valida, invoca `restoreHistoryRecipe` e `restoreHistoryNotes`; una failure dispone il controller e non altera la copia già archiviata.
- Attualmente queste API sono contratti host interni. Non risultano ancora cablate al comando pubblico `workspaceEditors.open` e non fanno di `kind:'import'` una vera feature editabile nel rebuild.

## Contratti ancora da concordare con l'autore del plugin

1. **Freeze transazionale:** `prepareAnnotatedHistory` e `isAnnotatedHistoryStampCurrent` sono preflight; `freezeAnnotated` fa diventare il guard storico falso, quindi serve un ticket congelato versionato, destinato alla pubblicazione che mantenga invariati sorgente, recipe, notes e preview fino al commit sincrono.
2. **Ri-apertura editabile:** API host per creare `WorkspaceSurfaceSession` su STEP upstream archivato, non sulla copia modificata, ripristinando nuova ownership di layer, lease viewport e click; non sovrascrivere una sessione già attiva.
3. **Feature graph:** nuova `surfaceEdit` con referenza all'ID corpo anche frazionario, rebuild-time replay e dipendenze; il record di questa PR è ancora un `import` con provenance opt-in, non una feature parametrica certificata.
4. **Note reali:** qualificazione su annotate ZIP in UI compilata, click posizione nota nella vera area mesh, audit attachment UUID e recupero dopo modifiche topologiche; garanzia esplicita di orphan policy.
5. **Confronto geometrico:** SHA byte resta integrità; `canonicalReplayStep` normalizza solo seriale prodotto OCCT e timestamp exporter identificabili, ma non garantisce parità CAD universale. Necessario verificatore geometrico indipendente per topologie arbitrarie.
6. **Release gates:** test desktop Windows/macOS, progetti complessi/scansioni reali, hardware fisico, parità QuickSurface e review indipendente.

## Conservazione e stato

L'originale `lego mod qs.stp` è stato usato in sola lettura, SHA-256 invariato `f47e9d2ff01ed35f392c762edd860fba5b6c90514de68d9cbc29951537931243`.

L'assetto QA è **Draft/HOLD**: nessun merge, deploy o release. Il plugin dell'autore e le PR host #31–#34 rimangono immutati.
