# Candidato Tubo 6b — qualifica continua del 9 novembre 2026

**Esito: `candidate-qualification-stop`. Il candidato salvato non soddisfa tutti i criteri dichiarati. Il collaudo nativo non è stato avviato.**

Base acquisita: `2849cc01855fef259553bf603eecf243554ec2e2`, ramo `codex/edit-surface-tubo-periodic`. Candidato invariato: `tubo-6b-derivative-storage-candidate-1`, SHA-256 `4b1e81b166e373707a9e0df1063bf757de6303e71a02d9a818631b3036b4350a`.

Una sola nuova esecuzione coefficientale, **2026-11-09T22:16:40Z–22:17:23Z**, ha completato tutti gli ambiti previsti, anche dopo il primo criterio fuori limite. Non ha richiamato preparazione, solve, fitting, prove consumate o kernel CAD.

## 1. Evidenze e criteri

- [Contratto e metodo](../../EXPERIMENTAL-CANDIDATE-QUALIFICATION.md): unità, parametrizzazioni, orientazioni e classificazioni.
- [qualification-summary.json](qualification-summary.json): risultati numerici, coperture, testimoni e hash della ricevuta integrale.
- [criterion-matrix.json](criterion-matrix.json): **54 voci**, ciascuna collegata alla propria evidenza; 44 entro criterio, 3 violazioni dimostrate, 3 inconclusive, 4 informative. I conteggi non costituiscono una percentuale di accettazione.
- [input-manifest.json](input-manifest.json): input e codice effettivi, hash e criteri del preflight.
- [verification.json](verification.json): verifiche del codice, esecuzione unica e vincoli rispettati.

Ricevuta integrale privata: `evidence/candidate-qualification-2849cc0.local/continuous-qualification-1.local.receipt.json`, **126.563 byte**, SHA-256 **`4c3694a521fafd83440c5434ede700ea5b717366219b84c23045dc14cb4eef4d`**. Preflight finale, revisione 2: **`7b0fde5ae637ea8f78b2550fba737a52d530b6da8e54ef9bc42ee53a1ef4d6bc`**. Il primo preflight non è stato eseguito e rimane conservato con il relativo bundle.

## 2. Limite di variazione 5 mm/V

| Laterale | Target meno base del bundle | Derivata effettiva candidata meno sorgente |
|---|---|---|
| 323, V1 | **238/238 entro limite**; massimo racchiuso in `[4.999999999999989, 4.99999999999999]` | **237/238 entro limite**; unico coefficiente fuori: **U=205**, indice da zero |
| 321, V0 | **238/238 entro limite**; massimo in `[3.246044087647178, 3.2460440876471783]` | **238/238 entro limite**; massimo in `[3.246044087646621, 3.2460440876466214]` |

Per 323/U205, la norma della variazione derivativa effettivamente rappresentata dai poli salvati appartiene all'intervallo esterno **`[5.000000000000056, 5.000000000000057] mm/native-V`**. Il margine quadratico esatto è:

```text
25 − ||Delta_D[205]||²
= −1145015349844183 / 2028240960365170645274427025
< 0
```

È una violazione del criterio per coefficienti, anche se minima. Non è un semplice bound inconclusivo. Non prova, da sola, un superamento del campo derivativo in uno specifico parametro U o del limite di spostamento della superficie.

I residui acquisiti restano validi e distinti: D1 ≤ `1.6539825065109432e-12` / `1.701416785238053e-12 mm/V`, variazione D2 ≤ `1.394440118929197e-12` / `6.217248937900883e-13 mm/V²`, rispettivamente per 323/321. Sono sotto i propri limiti `1e-9`; non aggiungono tolleranza al cap 5 mm/V.

## 3. Giunzioni del bundle

Le mappe crescenti sono **74: 323 `(252.00932454753*s,1)` ↔ 322 `(242.48253589446*s,0)`** e **75: 321 `(237.3422596445*s,0)` ↔ 322 `(242.48253589446*s,1)`**, con `s∈[0,1]`. Le normali confrontate usano i segni entranti espliciti del contratto. I limiti U=0+ e U=L− restano distinti.

| Criterio continuo | Giunzione 74 | Giunzione 75 |
|---|---|---|
| Gap posizione ≤ `1e-6 mm` | Entro: upper `2.0467183503569696e-11` | Entro: upper `2.7300828264742466e-11` |
| Norme tangente nativa e trasversa ≥ `1e-8` | Entro | Entro |
| Concordanza orientata di tangenti e normali | Entro | Entro |
| Scala λ ≥ `0.0625` | Entro; lower `0.803348280121197` | Entro; lower `1.2419629880210443` |
| Corda tangente ≤ `1e-10` | **Inconclusiva**, 8.192 foglie non certificate; nessun testimone di violazione | Entro, 331/331 foglie |
| Corda normale ≤ `1e-4` | **Violazione dimostrata** | **Violazione dimostrata** |
| Criterio storico del residuo normale campionato ≤ `1e-3 mm/V` | **Inconclusivo** per questa evidenza continua | **Inconclusivo** per questa evidenza continua |

Entrambe le giunzioni hanno 330 celle nella partizione comune esatta. La 74 ha 8.521 foglie, la 75 ne ha 331. Il criterio della corda normale è verificato come disuguaglianza polinomiale, con vettori regolari e prodotto scalare positivo. Esistono testimoni con **upper del margine negativo**: sulla cella 49 della giunzione 74, al punto locale 1/2, il margine è racchiuso in `[-147665.81409427823, -147665.8134908928]`; sulla cella 105 della 75, al punto locale 1/2, in `[-388810.28266873973, -388810.28228773305]`. Questi numeri sono margini dell'ineguaglianza vettoriale, **non angoli né corde**. Le frazioni esatte dei domini e gli altri testimoni sono nella ricevuta integrale.

I limiti superiori continui aggiuntivi del residuo normale sono `0.026316328297860254` e `0.0018516255628473661 mm/V`. Essendo maggiori di `1e-3`, non chiudono il criterio campionato; un upper maggiore non ne prova la violazione. Non è stato riutilizzato automaticamente il PASS dei vecchi campioni.

## 4. Supporti, cuciture e spostamenti

**Regolarità e orientazione relativa risultano certificate su tutte le 1.511 celle native**, comprese le chiusure unilaterali:

| Supporto | Celle certificate | Lower nativo di `||Su × Sv||`, mm²/(native-U·native-V) |
|---|---:|---:|
| 321 candidato | 708/708 | `1.6472252124461777` |
| 322 fisso | 95/95 | `0.09768515949807488` |
| 323 candidato | 708/708 | `4.718672646190998` |

Le cuciture periodiche U delle tre superfici soddisfano i rispettivi criteri. Le corde normali hanno upper `4.350967784373393e-11` su 321, `1.7339382009241636e-10` su 322 e `1.1784739882345132e-11` su 323, tutte sotto `1e-4`. Salti assoluti e variazioni dei salti sono sotto `1e-9 mm/native-U`; i valori separati sono nella matrice e nel riepilogo. La posizione delle curve sostitutive è legata all'identità della colonna U0 già acquisita sullo stesso artefatto.

| Quantità, mm | 323 | 321 | Criterio |
|---|---:|---:|---|
| Upper continuo dello spostamento della superficie | `0.04977416992187588` | `0.049214389679658105` | **≤0.05, soddisfatto** |
| Upper continuo dello spostamento della cucitura | `0.009089103447495039` | `0.006818452451454857` | **≤0.05, soddisfatto** |
| Upper del movimento dei poli | `0.10000000000000124` | `0.06492088175293245` | Descrittivo; distinto dal limite sulla superficie |

## 5. STOP, validazione e prosecuzione

Sono passati **21 nuovi test puri unici**, oltre al controllo TypeScript mirato finale. Il test aggiuntivo sul reporting di λ negativo ha inizialmente rilevato una versione Windows non sincronizzata: il file è stato sincronizzato e solo quel test è stato rieseguito. Il log negativo rimane conservato. L'analisi del candidato è stata eseguita una sola volta; il suo exit code 0 indica che la ricevuta è stata scritta, non un PASS dei criteri.

I **149 file ereditati protetti** sono identici prima e dopo l'analisi. Il WIP originale, il candidato, i vecchi marker e la STOP storica `reopened-own-support-mismatch` restano conservati. Nessun CAD live, aggiornamento host/kernel/MCP, merge, preparazione o solve.

**NEXT:** conservare questo candidato come evidenza negativa; un eventuale candidato successivo richiede un contratto distinto che affronti sia il cap derivativo memorizzato sia la corda normale continua delle due giunzioni. Le questioni ancora inconclusive richiedono evidenze mirate proprie. Nessun riavvio del runner consumato o correzione silenziosa del candidato 1.

**WAIT:** costruzione e collaudo nativo dei supporti, curve 3D e pcurve coerenti restano subordinati a un candidato che soddisfi tutti i criteri richiesti. Il blocco è nei risultati locali appena ottenuti. Le bande dimensionali mancanti del Tubo completo non hanno fermato questa qualifica.

Il rim **323/V0 ↔ 324/V1, edge `#207767`**, mantiene la qualifica acquisita nel proprio contratto. Non è una delle due giunzioni del bundle. Nessun esito locale viene trasferito al Tubo completo.
