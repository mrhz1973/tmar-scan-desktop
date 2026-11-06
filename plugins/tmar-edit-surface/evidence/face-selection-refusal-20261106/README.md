# Rifiuto selezione faccia e bozza conservata — 6 novembre 2026

Verifica del comportamento introdotto in `6b052ead5a59871e46a5c125c38e2044d9f65f34`.
Nessuna modifica ai file host, apertura di progetti utente o commit.

## Prova CAD eseguita

Comando dal repository:

```powershell
node node_modules/vitest/vitest.mjs run --config plugins/tmar-edit-surface/evidence/face-selection-refusal-20261106/node.config.mjs
```

`node-run.log`: un test PASS, 1,206 secondi per il test e 2,92 secondi totali.
`native-cdZdNO/result.json` conserva il risultato; nella stessa directory sono
conservati STEP sintetico originale ed esportazione dopo la seconda modifica.

Il test usa davvero SurfaceEditorKernel/OCCT WASM, SurfaceRuntime,
SurfaceDraft, SurfaceWorkerClient e changeSurfaceFace. Solo il trasporto
Worker è sostituito da un bridge in processo che inoltra i comandi al kernel
reale. La forma sintetica combina una scatola e un perno cilindrico.

- Piano editabile: faccia 4. Rifiuto reale cilindro: faccia 6, messaggio
  `Prototipo: solo piani e B-spline non periodiche.`
- Dopo il rifiuto: identità esatta snapshot e frame cronologia conservata,
  selezione/blocco e anteprima invariati, note locali e faccia attiva conservate.
- Witness della precedente anteprima ancora ottenibile dal kernel. Il campo
  JSON `retainedWorkerWitness` indica questo witness attraverso il bridge;
  non dimostra l'esecuzione di un Worker browser.
- Dopo sblocco esplicito e ulteriore modifica: polo Z da -0,2 a -0,3 mm,
  revisione CAD da 2 a 3. STEP esportato/reimportato valido, un solido,
  otto facce, variazione volume 11,250292499163152 mm³ rispetto all'originale.

La prova non qualifica dialogo completo, input fisico, Worker browser,
app compilata, scansione reale, QuickSurface o macOS.

## Tentativo browser non eseguito

Il driver `verify.mjs` crea un server Vite e un profilo Chrome nuovi e isolati,
su una pagina QA vuota, senza usare la pagina applicativa dell'utente.
Comando: `node plugins/tmar-edit-surface/evidence/face-selection-refusal-20261106/verify.mjs`.

Avvio Chrome fallito prima di qualsiasi prova: codice processo `2147483651`.
Ricevuta `run-IvasZV/result.json`: INCOMPLETE. Server chiuso, browser non
avviato; nessun retry o cambiamento delle impostazioni di sicurezza.
Gli errori Vite durante chiusura sono successivi a questo fallimento d'avvio.

Il test preesistente `tests/e2e-real-step.mjs` è stato letto e non ripetuto:
le ricevute già presenti indicano un precedente PASS su 51 facce e originale
invariato, ma non esercitano il rifiuto di selezione di questo commit.
