# Modifiche di superficie riapribili

Questo modulo collega Edit Surface al progetto ScanRuler. Dopo una modifica
supportata, **Mantieni la modifica riapribile** conserva la geometria insieme
alla ricetta dei poli e alle eventuali note. **Applica** crea una nuova copia
CAD; il progetto può quindi essere salvato nel normale formato `.scanruler`.

Dopo aver riaperto il progetto, selezionare la copia salvata e premere
**Riprendi modifica** nel pannello Reverse Engineer. Se sono disponibili più
copie, scegliere quella desiderata. L'editor recupera la superficie sorgente,
la modifica e le note verificate; il successivo **Applica** crea una nuova
copia e mantiene disponibili Annulla e Ripeti del progetto.

La riapertura supporta i formati stabili della ricetta, versioni 2–6, incluse
le modalità compatibili di tangenza e le annotazioni associate alla faccia.
Le operazioni su cilindri, strisce e la modalità adattiva sperimentale v8 non
sono abilitate per questa cronologia. **Duplica faccia CAD** produce una copia
CAD ordinaria. Per una copia ordinaria è inoltre possibile disattivare
**Mantieni la modifica riapribile** prima di applicare.

Il progetto conserva la copia CAD anche quando una ricetta o un'associazione
alle note non supera i controlli per la riapertura. In quel caso il comando
spiega il motivo del rifiuto e lascia invariati i dati salvati.

## Verifica dell'integrazione

`plugins/reverse/tests/surfaceHistoryWorkspaceIntegration.test.ts` esercita
controller e blocchi reali, replay OCCT indipendente, salvataggio ZIP,
riapertura e nuove pubblicazioni, con e senza note. La prova browser
`plugins/reverse/scripts/e2e-surface-history-workspace.mjs` copre i comandi
visibili e la riapertura del progetto in una pagina pulita.

Il modulo è composto sopra le API esistenti di Edit Surface. Non abilita
ricette sperimentali e non attribuisce la qualifica di questa integrazione
a modelli CAD o progetti esterni.
