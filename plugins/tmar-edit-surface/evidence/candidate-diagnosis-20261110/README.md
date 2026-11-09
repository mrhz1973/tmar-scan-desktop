# Diagnosi mirata del candidato 1 e contratto di correzione

**10 novembre 2026, Europe/Rome — `diagnosis-complete-fixed-target-contract-infeasible`.**

Base acquisita: `acf8b75a1a0b79d19d2ce100dc8215ebc5e9fc11`, ramo `codex/edit-surface-tubo-periodic`. La singola nuova esecuzione è avvenuta il 9 novembre alle 23:08:20–23:08:52 UTC, cioè il 10 novembre alle 00:08:20–00:08:52 Europe/Rome. Sei scope conclusi senza errori tecnici; nessuna preparazione, solve, prova acquisita o attività nativa ripetuta.

Il candidato `tubo-6b-derivative-storage-candidate-1` conserva hash `4b1e81b166e373707a9e0df1063bf757de6303e71a02d9a818631b3036b4350a` e STOP. La sua ricevuta negativa `4c3694a521fafd83440c5434ede700ea5b717366219b84c23045dc14cb4eef4d` e il marker consumato sono immutati.

## Esiti ed evidenze

| Domanda | Nuova evidenza | Conclusione nel proprio perimetro |
|---|---|---|
| Violazione angolare 74 | Stesso punto della cella 49; corda target almeno `1.277575802380674e-4`; target–stored al più `3.460539360856138e-13 mm/V` | Violazione già nel target; fedeltà D1 1e-9 incompatibile con corda <=1e-4 |
| Violazione angolare 75 | Stesso punto della cella 105; corda target almeno `1.1927966344900997e-4`; target–stored al più `6.14460121687973e-13 mm/V` | Incompatibilità autonoma, già nel target |
| Cap effettivamente memorizzato U205 | Patch non applicata, Z del polo 2470 +1 ULP; cap upper `4.999999999999921 mm/V` | Realizzazione locale possibile; candidato1 non corretto |
| Fedeltà D1 / variazione D2 della patch | Upper L1 `8.160670372482024e-13 mm/V` / `2.2737367544323167e-10 mm/V²` | Entrambe entro 1e-9, separatamente dal cap |
| Corda tangente 74 | Prova razionale esatta su 330/330 celle, upper `3.991146044755004e-12` | Entro 1e-10, nessuna cella irrisolta |
| Residui storici 74 | 950 training + 711 holdout; upper massimo `0.0006702716323938 mm/V` | Entro 1e-3 sui 1661 punti |
| Residui storici 75 | 946 training + 708 holdout; upper massimo `0.00016349952982484567 mm/V` | Entro 1e-3 sui 1654 punti |

I lower delle correzioni D1 puntuali necessarie sono `0.00013870211014614664` e `0.00014455948739709146 mm/V`. La prova ammette qualsiasi perturbazione del campo entro la fedeltà dichiarata, con target, bordo, supporto e mappe fissi: non è il solo confronto tra due realizzazioni. Entrambi i lower superano 1e-9; un nuovo tentativo di arrotondare i medesimi target non può soddisfare tutti i criteri.

La patch U205 non modifica i testimoni: sulla 74 la campata U35 ha coefficienti attivi tutti <=108; la 75 usa le superfici 321/322. Nessuna ipotesi sui soli nodi interni semplici è necessaria. La patch è salvata separatamente con hash `8e8017b33ffa243de2dac3b8aa042c160430205be425243cdb0a3d84bc5aaf0e`; la composizione con i 237 coefficienti invariati è solo condizionata a un'eventuale applicazione esatta, che non è avvenuta.

I residui storici mantengono il proprio contratto campionato e i due limiti della cucitura. Ai testimoni angolari, esterni a quegli insiemi, il residuo è maggiore di 1e-3: il nuovo esito sui 3315 punti non stabilisce un limite continuo. La tangente 74 dipende invece dai bordi protetti e può essere riutilizzata soltanto dimostrando la loro identità e quella di basi/mappe; una modifica delle derivate inward non la modifica.

## Contratto successivo

Il [contratto completo](../../EXPERIMENTAL-CANDIDATE-CORRECTION.md) distingue:

- **Contratto stretto T6b:** incompatibilità dimostrata; nessun candidato corretto esiste.
- **Proposta T2:** nuovi target applicati, salvati e hashati prima della realizzazione; T6b rimane il riferimento immutabile. Si propone di minimizzare lo scarto massimo dei coefficienti da T6b, poi la somma dei quadrati, con tutti gli altri criteri invariati. Non è una modifica tacita della fedeltà D1.
- **Geometria modificabile:** soltanto 323/V9–V10 e 321/V1–V2. Bordi, altre righe, 322/324, rappresentazione e frame restano protetti. Il rim 323/V0–324/V1 è distinto dalle giunzioni 74/75.
- **Gate:** fattibilità globale T2 da accertare con nuove evidenze continue, cap esatti e criteri separati. Il nativo rimane subordinato a tutti gli esiti favorevoli sul medesimo nuovo candidato.

La revisione del target è una decisione sostanziale da adottare prima della costruzione successiva. Non mancano dati indispensabili per la diagnosi; l'ostacolo è l'incompatibilità delle condizioni attuali. La proposta non esegue un nuovo solve, non inventa una deformazione e non allenta il cap 5 mm/V o le altre soglie.

## File e provenienza

- [diagnosis-summary.json](diagnosis-summary.json): intervalli, lower di infeasibilità, prova tangente e residui campionati.
- [criterion-followup.json](criterion-followup.json): associa le sei voci originarie alle nuove evidenze, lasciando intatti la vecchia matrice e lo STOP.
- [correction-contract.json](correction-contract.json): variabili, protezioni, parametri, criteri e proposta T2 non adottata; output/hash futuri esplicitamente assenti.
- [input-manifest.json](input-manifest.json): 13 input, 19 file di codice/build e nuove evidenze private identificati per SHA-256.
- [verification.json](verification.json): 32 nuovi test puri favorevoli, controlli TypeScript e unica esecuzione diagnostica.

Nuovo preflight: `23e2747c766dc33f2e9f938e53c4fe93d88f228ca13d8b5210c941bef610d8f2`.

Nuova ricevuta privata: `evidence/candidate-diagnosis-acf8b75.local/targeted-diagnosis-1.local.receipt.json`, 954.048 byte, SHA-256 `28d0e77e9b59ae00051eee6d349940e68a4d86fa49d7764fcd917e034659a870`. Il relativo marker `targeted-diagnosis-1.local.run-once` è consumato.

Manifest finale di preservazione: `evidence/candidate-diagnosis-acf8b75.local/preservation-final.local.json`, **191 file**, SHA-256 `5a2a86cec65f49dcdee5c9c381da3a084aa79f2f6d3c420996f6ba24196e21d6`. Comprende i 176 file ereditati e 15 nuovi artefatti privati. Il manifest stesso e i successivi record commit/push devono entrare nel prossimo baseline.

I primi controlli TypeScript non riusciti, uno sui nuovi helper e uno sul driver, restano salvati. Le correzioni precedono le rispettive prime esecuzioni. Sono stati aggiunti cinque helper puri e quattro file di test. Il bundle eseguibile non importa il vecchio runner né il kernel.

Zero modifiche al CAD live, aggiornamenti host/kernel/MCP o merge. STOP storico `reopened-own-support-mismatch` preservato. Nessun esito locale viene trasferito al Tubo completo; nessuna consegna diretta al coordinatore viene presunta.
