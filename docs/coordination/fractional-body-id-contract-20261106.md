# ScanRuler / TMAR — Contratto ID frazionari nel percorso host Edit Surface

**6 novembre 2026** · Host derivato da PR #33 `25b5401624b678e9a5551e9e8df99cb3d0c59169`.

## Regola di identità

I corpi CAD sono identificati da numeri **finiti, strettamente positivi**. Una feature produce il corpo principale con ID intero e i corpi aggiuntivi con `featureId + n/ISLAND_IDS`, dove `ISLAND_IDS = 1024`. Un secondo corpo della feature 1 può quindi avere ID `1.0009765625`. Non applicare `Number.isSafeInteger` agli identificativi di **corpo**.

La validazione resta una congiunzione di `Number.isFinite(id) && id > 0` e dell'esistenza **esatta** in `before.bodies`. Non normalizzare, troncare o arrotondare l'ID; non confonderlo con ID feature, indice di faccia, contatore note, pointer ID, epoca o lunghezza file, che conservano la semantica intera.

## Fix host

- `plugins/reverse/app/reSession.ts`: `stageEditorCopy` accetta un ID frazionario valido per `hideSourceBodyId`, senza indebolire il controllo di appartenenza. Il percorso `cad-copy` esistente resta invariato nei suoi altri gate, compreso l'Apply annotato.
- `plugins/reverse/app/surfaceEditHistory.ts`: lo schema versionato della sorgente della ricetta ammette lo stesso corpo frazionario. I campi `size`, `selectionEpoch`, `draftEpoch` rimangono interi.
- `plugins/reverse/tests/fractionalBodyCopy.test.ts` e `surfaceEditHistoryContract.test.ts`: regressioni positive e negative. Nessun file del plugin Edit Surface modificato.

## Audit salvataggio e riferimenti

- `workspaceEditors.open` già accetta ID finiti e positivi.
- `projectSection` conserva `hiddenBodies` come numeri finiti e ripristina gli stessi valori; `bodyStyles` usa chiavi numeriche convertite da JSON; `bodyFolders` richiede ID di *cartella* interi ma consente ID di *corpo* finiti nella lista `bodies`.
- `annotatedCopyValidation` richiede un intero per `diagnosticFaceIndex`, non per `bodyId`; gli anchor di note e i riferimenti corpo non richiedono l'arrotondamento.
- Le altre validazioni intere rilevate (`rolledTo`, indici, contatori, pointer ID, ID note e ID di feature) non devono essere allargate.

## Evidenze QA

1. STEP sintetico di due solidi: import → ID `1` e `1.0009765625` → lettura sorgente del secondo → staging isolato e Apply → occultamento esatto solo del secondo corpo → Undo/Redo → raccolta e ripristino sezione progetto: **PASS**.
2. ID frazionario inesistente, zero, negativi, NaN e ±Infinity: **rifiutati senza mutazione**.
3. Schema history: la sorgente `bodyId=1.0009765625` è valida; valori non numerici o non finiti vengono respinti, senza allargare gli altri campi.
4. Prova headless **host-only** con file reale `lego mod qs.stp` (398720 byte, SHA-256 `f47e9d2ff01ed35f392c762edd860fba5b6c90514de68d9cbc29951537931243`): due corpi, staging di copia CAD del secondo, Apply, Undo/Redo, project save/reopen, SHA del sorgente invariato: **PASS**. Evidenza `D:\TMAR-QA\host33-fractional-body-evidence-20261106\lego-host-only-result.json`.
5. La prova reale host è **senza** modifica della superficie mediante editor e non certifica la UI plugin. Il relativo script QA è conservato accanto al JSON, **fuori dal Git repository**, per evitare dipendenze dai file personali.

## Gate aperti

Il fix plugin su `codex/edit-surface` che abilita il corpo frazionario non è ancora accompagnato da uno SHA pubblicato dal proprietario. Fino a tale riferimento **non** dichiarare PASS la combinazione UI reale Edit Surface → Apply deformato. Restano invariati gli altri gate della PR #33 (replay, freeze, note, history parametrica modificabile, desktop e QuickSurface).

**Stato:** Draft/HOLD; nessun merge, rilascio o deploy.
