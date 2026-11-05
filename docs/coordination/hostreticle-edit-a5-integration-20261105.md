# TMAR — integrazione isolata host «Inquadra reticolo» + Edit Surface a5e3af7

Data: 5 novembre 2026. Stato: REVIEW ONLY / DRAFT. Nessun merge, rilascio o sessione CAD modificata.

## Identita dei checkpoint

- Base host (PR #30): 2281e39b16512e3ac55956d75db636e714b8fecd.
- Snapshot autore Edit Surface: a5e3af768fea55abca2281523602cb2f56ba9ee3.
- SHA del tree plugin nell'autore e nell'indice di QA: 8334edfdf983a81c87f063971e015feea4df8.
- Diff dal plugin precedentemente integrato (73a4f36): 51 commit, 70 file, tutti in plugins/tmar-edit-surface.
- Host ha aggiunto l'API opzionale publishReticleFrame. Il plugin a5e3af7 non la chiama ancora; il pulsante Inquadra reticolo resta disabilitato.

## Verifiche indipendenti nell'ambiente isolato

- npm ci --no-audit --no-fund: PASS.
- npx tsc --noEmit: PASS.
- npm run build: PASS (avvisi Vite noti di externalization/chunk dimension).
- Suite host + plugin: 399/399 PASS in 60 file (tests host reticolo inclusi).
- E2E source-host isolato con STEP sintetico: 16/16 controlli PASS, zero errori browser, exit code 0. Esaminati canvas/camera condivisi, editor dock, trascinamento puntatore, validazione CAD, Undo/Redo, Zebra, annotazione in bozza e sua rimozione, Apply e reimport STEP.
- Il test source-host ha verificato due solidi STEP validi a sei facce ciascuno; geometria della copia differente dalla sorgente (volumi 6000 e 5996,776447556514 mm³ nel solo caso sintetico).
- Report sintetico riprodotto nella cartella evidence/edit-a5-hostreticle-20261105/result.json. Profili browser, screenshot e fixture restano fuori dal repository.
- Il server QA su localhost:18064 è stato arrestato dopo il test.

## Limitazioni e gate aperti

- Il plugin non pubblica bounds: il pulsante host non è stato provato abilitato con un reticolo Edit Surface reale. Nessuna inquadratura automatica viene eseguita.
- Nessuna qualifica di applicazione desktop pacchettizzata, scansioni reali, STEP arbitrari, comportamento su reticolo reale fuori inquadratura o parità completa QuickSurface.
- G1 continua a essere sperimentale senza comando UI/apply annotato/ricetta del vincolo completamente qualificati. Non va dichiarato disponibile agli utenti.
- I controlli CAD campionati e la discrepanza del volume periodico rimangono gate separati.
- Confronto esatto del tree plugin conservato senza modifiche. Il controllo whitespace Git segnala una riga vuota aggiuntiva in tests/g1SupportIntegration.test.ts; non è stata alterata per mantenere l'identità dello snapshot autore.

## Integrazione futura

L'autore Edit Surface dovrebbe pubblicare i bounds correnti dei punti del reticolo nella lease, aggiornati a cambi di revisione e azzerati quando il reticolo non è disponibile. Successivamente testare su browser isolato e build compilata il clic esplicito, con tutti i punti inizialmente anche fuori vista, verificando camera invariata prima del clic e geometria/progetto invariati dopo.
