<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Patch Network 3D + Edit Surface 73a4f36: integrazione verificata

4 novembre 2026, Europe/Rome. Checkpoint di integrazione in bozza, non release o deployment.

## Revisioni effettive e confini

- Patch Network: `0db2026f21bc858338d934f24d7481a80cb2f321`, PR #26, base `5f39ff521d0095e01fb9b7f1a5af833bca9e28ba`.
- Plugin autore: `73a4f36b2e807499cd0fab488fc0cebb1badc0fa`, include il drag in profondit? di 2ee3cc2.
- Albero plugin esatto: `bb26828d9ca1d7ae80a6abb520541228660e68e8`.
- Runtime integrato: **`ce6004c629165658f4291a2c2eeaa0210854f861`**, parent 0db2026.
- Ramo runtime: `integration/patch3d-editsurface73-20261104`.
- Ramo documentazione: `review/patch3d-edit73-final-20261104`, senza modifiche runtime aggiuntive.

Il commit integrato sostituisce soltanto il sottoalbero Edit Surface con lo snapshot esatto dell'autore (13 file cambiati), senza importare file host dal suo ramo. Le modifiche Patch Network rimangono nel parent. Nessuna correzione all'host annotato o al plugin ? stata introdotta per far passare questi collaudi. Gli hash di tutti i file runtime tracciati sono stati ricontrollati a fine prova; la copia recuperata originale e il suo indice sono invariati.

## Funzione Patch Network e limiti del magnete

Il parent collega nodi, grip delle curve condivise e centri derivati a fitting accoppiato, anteprima e progetto. Quote XYZ nel riferimento del pezzo e direzione normale alla mesh all'ancora; drag, Esc, un solo Undo locale al rilascio e un solo Undo progetto alla conferma. Il difetto Ctrl+Z durante il drag ? riprodotto e corretto nel parent, non nascosto dai test.

**Funziona:** proiezione continua dell'ancora sulla scansione, movimento libero XYZ/normale, persistenza degli offset, protezione dei vincoli CAD esistenti. La modalit? sulla scansione conserva un offset gi? presente finch? non viene azzerato esplicitamente.

**Non implementato in Patch Network:** magnete 3D di prossimit? verso scan/altri CAD, portata, Alt on/off, snapping esatto B-rep. La normale di mesh non ? il Local N della NURBS. Il nuovo fallback di trascinamento in profondit? di Edit Surface resta nel plugin: la rete rifiuta il drag quasi parallelo alla vista e offre la quota numerica. Queste differenze sono dichiarate nel pannello e non attribuite implicitamente alla rete.

## Nuove esecuzioni su questa coppia

Windows/Chrome isolati, Node 26.8.1 e occt-wasm 5.7.1; dipendenze del lockfile. Nessun profilo personale o progetto CAD attivo usato.

| Controllo | Esito |
| --- | --- |
| TypeScript e build completa | PASS |
| Test mirati plugin/rete/host annotato/storia | **180 PASS su 11 file** |
| Patch Network sorgente: drag, storia, nodi/grip/centro, Save/Load | **27 PASS** |
| Patch Network compilato: quote, Undo/Redo progetto, Save/Load/export | **14 PASS** |
| Edit Surface sorgente: drag allineato alla vista, preview viva, Undo e CAD | **16 PASS** |
| Edit Surface compilato: nota con mouse, Zebra, deformazione, Apply, Undo/Redo, Save/Load/export | **16 PASS dopo sincronizzazione QA descritta sotto** |
| Riapertura compilata del progetto salvato durante verifica pendente | **6 PASS** |
| Hash runtime dopo tutte le prove | Invariati |

I conteggi delle suite del parent e della coppia si sovrappongono: non si sommano per ottenere una copertura totale. Il checker generale dei confini plugin fallisce ancora sul solo import preesistente dello script galleria. Non ? CI generale verde e non ? stato aggirato.

Il test di tolleranza del plugin verifica la modifica della calotta piana del cilindro sintetico, la conservazione delle tolleranze di bordi/vertici dopo STEP e il rifiuto della faccia cilindrica. Nessuna superficie cilindrica diventa editabile.

Le prove Patch Network riutilizzano soltanto il nuovo baseline sintetico prodotto dalla medesima coppia. La rete esportata ? una sheet valida a quattro facce; gap condiviso 0.0009676439875026526 mm nel caso sorgente. Il caso triangolare piano del centro produce gi? due patch prima dello spostamento e ne conserva due; non qualifica tre settori completi. Test kernel su calotta curva separato verifica tre facce. Compilato: quote/nodi/grip, non qualifica il drag mouse del centro.

## Stato nota pendente: osservazione mantenuta, nessuna modifica runtime

La prima esecuzione compilata ha superato i sei controlli iniziali e pubblicato la copia, ma il primo Save ha catturato `attachment.status=unresolved`. Il test precedente presumeva che un campione DOM senza avviso e Save abilitato significasse rivalidazione terminata. Questa implicazione non ? garantita: `watchAnnotations` pu? schedulare una nuova verifica dopo l'aggiornamento di fingerprint/UV.

La nuova prova osserva il file nativo effettivo, con un massimo di sei salvataggi distinti, richiedendo sempre stessa nota/feature/corpo/operazione, hash STEP/testimone, testo e ancoraggio immutati. La verifica finale accetta soltanto `verified`; nessuno stato ? forzato. Tutte le asserzioni originali di geometria, storia e normale firmata restano.

Nel nuovo run, dopo Apply e dopo Redo la prima osservazione ? unresolved e la seconda verified, senza modifica della geometria n? riapertura nel frattempo. La riapertura finale ? verified gi? alla prima osservazione. Sono conservati entrambi i file di ogni passaggio e l'esecuzione iniziale negativa. Questo qualifica la convergenza e la persistenza, **non garantisce che ogni Save immediato dopo Apply contenga gi? verified**.

Una prova aggiuntiva ha caricato in una pagina compilata nuova proprio il file pending del primo Save: la nota ? stata rivalidata automaticamente e risalvata verified, con stessi UUID, corpo, posizione e normale. Non ? necessario cancellare o ricreare la nota; il file originale pending resta invariato.

Non si importano moduli sorgente o controller QA nel browser compilato. Le sole modifiche alla copia del test sono la precedente correzione del lettore hiddenBodies vuoto, le etichette di revisione e l'attesa verificata sopra. Gli script originali/eseguiti e i relativi hash sono conservati. L'applicazione e le sue guardie non sono state modificate.

### Dati del ciclo annotato riuscito

Nota UUID `32bb51bb-3694-4858-b400-9437aeb53a16`; feature UUID `40954d11-34e2-4193-988c-476b108f52a9`; corpo 2. Il caso compilato usa una faccia piana forward del box, non una nuova qualifica compilata su faccia reversed. Export OCCT indipendente: due solidi validi, volumi misurati 6000 e 6001.875048749859 mm?.

Progetto riaperto/risalvato SHA256 `e8c4b25e1cce8913fe63f900e3798f0477f84c1ea06e3159d862782c359f9f09`.
Progetto pending usato per la prova aggiuntiva SHA256 `85d87fda8c0acb1d59b940ddb6764b4916fcd1f4b61e311c9f4e60a57a49498d`.

## Contratto invariato e limiti residui

API host 1, annotationVersion 1, cad-copy/annotated-cad-copy; `freezeAnnotated`, `prepareAnnotatedApply`, `notesRevision`, guardie sorgente, occultamento reversibile e normale gi? orientata restano invariati. Nessuna firma nuova richiesta al plugin.

Non qualificati: magnete 3D della rete, fallback profondit? della rete, grandi scansioni, tutte le topologie/offset/vertici straordinari, G1 generale, cilindri editabili, parit? QS, packaging desktop o persistenza parametrica surfaceEdit. Il drag in profondit? ? nuovo collaudo sorgente, non compilato. Non ? stata eseguita una nuova suite completa di tutti i magneti del plugin.

L'agente di revisione in sola lettura tentato sul checkpoint Patch Network ? terminato senza rapporto; nessuna revisione indipendente tramite subagente ? rivendicata. Nessun merge su main, release, deployment o incremento Versione 1; i soli server QA creati sono stati chiusi. Le sessioni CAD del proprietario restano intatte.

Evidenze: `docs/coordination/evidence/patch3d-edit73-integration-20261104/`. Solo risultati, hash, screenshot ispezionabili, script e progetti sintetici; esclusi profili browser, credenziali e progetti utente. Gli originali dei JSON e le versioni anonimizzate sono distinti nel manifest.
