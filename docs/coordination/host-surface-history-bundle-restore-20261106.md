# TMAR ScanRuler — Host-side restoreHistoryBundle integration (6 novembre 2026)

## Versioni e ownership
- Parent host: PR #36, commit `77c814c89a129a38a3f5aea40a00ad08ea27a832`.
- Plugin di qualificazione **esatto**: `f338d340ef32ba423691db107ee06aec7a0c9bf8`; subtree `20abe9d3936466426211ae052a3b1493c35e780b`.
- Worktree QA isolato: `D:\TMAR-QA\tmar-host36-f338-history-bundle-qa-20261106`.
- Non sono stati modificati `codex/edit-surface`, la PR #36, la sessione CAD attiva o il file STEP originale.
- L'ownership dell'host include soltanto `plugins/reverse/**`, la documentazione e gli adattatori del progetto.

## Contratto integrato: riapertura su sessione fresca
1. `reopenSurfaceHistory(feature,stepFiles,replay,signal,notes)` verifica sorgente STEP archiviata, STEP copia CAD, hash della ricetta, witness/UV/feature UUID, attachment corrente e replay CAD indipendente. Se mancano note, fallisce un digest o non esiste replay, restituisce `copy-only`, senza mutare l'host.
2. La risposta `verified` emette un token monouso, non un generico flag JSON. `restoreVerifiedSurfaceHistory` consuma tale token e invoca `makeFreshSession` **esclusivamente** con lo STEP sorgente upstream, con bodyKey stabile e segnale AbortSignal.
3. Dal checkpoint `f338d34`, il controller deve offrire `restoreHistoryBundle({recipe,notes}, signal?)`. Questo metodo del plugin adotta la ricetta, attende la nuova preview verificata e riaggancia tutte le note insieme. **L'host non effettua più due ripristini indipendenti**.
4. Dopo l'operazione, l'host verifica nuovamente il documento, lo stato CAD `valid`, il numero di note e la loro identità/testo; se fallisce, dispone soltanto il controller nuovo. Anche dopo successo l'installazione della sessione nel viewport resta esplicita, a carico del chiamante.
5. Il wrapper `reopenAndRestoreSurfaceHistory` gestisce l'intero preflight+restore e restituisce `{status:'restored',session,record}` oppure `{status:'copy-only',reason}`. La copia STEP e il NoteStore salvati restano sempre autorevoli; nessun dato viene cancellato o aggiornato in automatico.
6. I bundle senza note passano `notes:[]` allo stesso contratto; non occorrono due API diverse o una ricetta modificata.

## Test con OCCT reale e di sicurezza
- Host PR #36 + plugin f338 esatti, su STEP sintetico 20×30×10 mm: creazione e validazione indipendente delle ricette; pubblicazione host e transazione atomica di copia CAD con history metadata; Undo/Redo; salvataggio e riapertura dei dati del progetto.
- Riapertura su un **nuovo** `WorkspaceSurfaceSession` e un worker con `SurfaceEditorKernel` reale, usando esclusivamente il file sorgente archiviato, sia per bundle `{recipe,notes:[]}` sia con nota annotata. Attesa automatica della preview e verifica faccia, note e testo aggiornato: PASS.
- UV deliberately invalid at the plugin boundary: plugin refuses restoration, closes the new incomplete controller, and host returns `copy-only`. Pre-existing CAD and notes unchanged: PASS.
- Source/document revoked after asynchronous bundle callback: new controller disposed, host returns `copy-only`, saved CAD/notes unchanged: PASS.
- Original plugin session test uses fake timers for some async OCCT previews; the host QA uses real timers and does not advance them artificially. No package installer is claimed.

## Collaudi della coppia esatta
- Vitest mirati, **174/174 PASS su 11 suite**; TypeScript `tsc --noEmit` PASS; `npm run build` (TypeScript + Vite) PASS.
- Applicazione sorgente isolata con file reale `lego mod qs.stp`, secondo corpo `1.0009765625`, faccia 19: **21/21 PASS**, inclusi note Zebra mediante mouse, drag, Undo/Redo, freeze, replay indipendente, ordinary annotated CAD-copy Apply, Save/Reopen, STEP valido e SHA sorgente invariato. Tessellazione replay: **20.776 vertici** corrispondenti, distanza massima **0 mm**. Non certifica l'uguaglianza delle superfici B-rep continue.
- Applicazione Vite **compilata**, file STEP sintetico, mouse su nota Zebra: **9/9 PASS**, attachment `verified` al salvataggio e dopo riapertura, due solidi STEP validi distinti.
- Evidenze: `D:\TMAR-QA\host36-f338-history-bundle-evidence-20261106\real-lego\run-q7zNEE\result.json` e `...\compiled-note\compiled-QcWuix\result.json`. I risultati della riapertura parametrica sono nei test host con worker OCCT, **non** nell'interfaccia compilata.

## Contratti rimanenti (HOLD)
- Nessuna nuova firma plugin è necessaria per il ripristino di un bundle: la firma `restoreHistoryBundle({recipe,notes},signal?)` è sufficiente, purché l'host crei un controller con sorgente, documento e token corretti.
- Resta da integrare un comando UI per selezionare il record archiviato, ottenere una nuova sessione con un input/preview lease esclusivo e installarla soltanto dopo tutti i gate; occorre definire la gestione di Cancel/Undo di sessione viva. I test del wrapper **non** certificano la UI.
- Una feature `surfaceEdit` autonoma nel grafo di ricostruzione (dipendenze, source remap, replay per build, timeline parametrica) non è ancora implementata. Attualmente il risultato è una `ImportFeature` con sidecar opt-in; non dichiararla modificabile nel browser di progetto.
- Save/Reopen del file progetto reale e attachment sono verificati con `cad-copy`; il roundtrip parametrico è qualificato con i dati della sezione progetto nei test OCCT. Mancano test app compilata, installatori Windows/macOS e hardware fisico per il comando di riapertura parametrica.
- Test complessi G1 v5/v6, superfici trim/periodiche, grandi scansioni, equivalenza B-rep continua, review CI e QuickSurface parity restano HOLD.
- **No merge, deploy, release.** La PR figlia è Draft e non cambia il ramo dell'autore del plugin.

## Riferimenti tecnici
- PR #36: https://github.com/mrhz1973/tmar-scan-desktop/pull/36
- Plugin checkpoint: https://github.com/mrhz1973/tmar-scan-desktop/commit/f338d340ef32ba423691db107ee06aec7a0c9bf8
- Contratto plugin: https://github.com/mrhz1973/tmar-scan-desktop/blob/f338d34/plugins/tmar-edit-surface/RECIPE-INTEGRATION.md
