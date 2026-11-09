# Qualifica continua del candidato derivativo del Tubo

**Data del contratto e della qualifica: 9 novembre 2026. Stato: `candidate-qualification-stop`.** Una nuova esecuzione ha completato la qualifica del candidato salvato: tre criteri sono violati, tre restano inconclusivi. Il collaudo nativo non è stato avviato. I risultati completi sono in [evidence/candidate-qualification-20261109/README.md](evidence/candidate-qualification-20261109/README.md).

## 1. Oggetto congelato e perimetro

Si prosegue dal commit acquisito **`2849cc01855fef259553bf603eecf243554ec2e2`**, ramo `codex/edit-surface-tubo-periodic`, usando esclusivamente il candidato già salvato **`tubo-6b-derivative-storage-candidate-1`**. La preparazione, la corrispondenza con il bundle e il solve sono conclusi e non vengono rieseguiti. Nessuna rete candidata viene corretta o ricostruita per ottenere un risultato diverso.

| Input / evidenza acquisita | SHA-256 |
|---|---|
| `evidence/modified-candidate-1887859.local/candidate-1.coefficients.local.json`, 1.112.885 byte | `4b1e81b166e373707a9e0df1063bf757de6303e71a02d9a818631b3036b4350a` |
| Ricevuta della preparazione | `9859fb45965821441fc8cd6a6e439ca21bad0c88843c9a672c008a04bcbf5777` |
| `bundle_storage_6b.json` | `4e6bcf262c2897d45e1689ab0e72c19fd0f2aeb67ec76dcd2aa5a53a1cc75b37` |
| STEP sorgente congelato, identificato per provenienza | `6b711960fcded7972ded41ed1ceaa2f09e2dd8332fc7ee980b76d2514c94e8ae` |
| Cattura statica delle reti e della topologia | `02a34618425c96fe82e7355a9b31467a09399849b7cb3339d6b1fda89e7d1539` |
| Manifest finale di preservazione del checkpoint precedente | `35168a99af24d3876f38d268a07d1f56f598ae563974b50a9dec519e3581aa44` |

Coordinate e unità restano quelle del frame STEP originale, senza trasformazioni. Prima della nuova esecuzione il preflight deve vincolare anche codice, driver, ricevute riutilizzate e manifest esteso, includendo i successivi record di commit/push. I risultati nuovi devono riferirsi a questo hash del candidato. Gli indici delle facce valgono sulla base recuperata; la loro eventuale enumerazione nativa richiede una corrispondenza distinta.

Le fonti normative già acquisite sono [EXPERIMENTAL-MODIFIED-CANDIDATE.md](EXPERIMENTAL-MODIFIED-CANDIDATE.md), [preparation-summary.json](evidence/modified-candidate-20261109/preparation-summary.json), [input-manifest.json](evidence/modified-candidate-20261109/input-manifest.json) e [topology-summary.json](evidence/modified-candidate-20261109/topology-summary.json), tutte del 9 novembre 2026. I requisiti fisici provengono dal packet dell'8 novembre. Non è necessaria una nuova importazione dello STEP per la qualifica coefficientale.

## 2. Ogni quantità ha il proprio criterio

| Quantità | Criterio e unità | Evidenza pertinente |
|---|---|---|
| Variazione dei target del bundle rispetto ai suoi coefficienti base | Norma euclidea ≤ **5 mm/native-V**, per ciascuno dei 238 coefficienti e per lato | Nuovo confronto esatto `targetChange` |
| Variazione della derivata effettivamente rappresentata dai poli salvati | Norma euclidea ≤ **5 mm/native-V**, per ciascun coefficiente e per lato | Nuovo confronto esatto `storedChange` |
| Residuo D1 rispetto al target richiesto | ≤ `1e-9 mm/native-V` | Ricevuta di preparazione acquisita, legata allo stesso artefatto |
| Variazione D2 al bordo | ≤ `1e-9 mm/native-V²` | Ricevuta di preparazione acquisita, legata allo stesso artefatto |
| Posizione sulle giunzioni 74 e 75 | Gap ≤ `1e-6 mm`, sull'intero dominio corrispondente | Nuove celle Bernstein su partizione comune |
| Direzione delle tangenti delle giunzioni | Corda unitaria ≤ `1e-10`, prodotto scalare positivo | Nuovo criterio polinomiale continuo, distinto dalla posizione |
| Direzione delle normali delle giunzioni | Corda unitaria ≤ `1e-4`, prodotto scalare positivo | Nuovo criterio polinomiale continuo con normali regolari |
| Residuo normale del criterio campionato storico | ≤ `1e-3 mm/native-V` | Il nuovo limite continuo ≤ soglia è sufficiente per qualsiasi campione; un limite maggiore lascia il criterio inconclusivo |
| Scala trasversa λ | ≥ `0,0625`, adimensionale | Nuova disuguaglianza polinomiale con denominatore positivo |
| Velocità tangente nativa / trasversa | ≥ `1e-8 mm/native-U` / `1e-8 mm/native-V` | Nuovi limiti inferiori continui, senza normalizzazione prematura |
| Regolarità dei supporti 321, 322, 323 | `||S_u × S_v|| > 0` su tutte le celle native chiuse | Nuovi limiti inferiori, in unità native dichiarate |
| Orientazione rispetto alla sorgente | Prodotto scalare delle normali sorgente/candidato strettamente positivo, ovunque | Nuovo confronto continuo sui supporti |
| Cuciture periodiche U | Salto assoluto e variazione del salto ≤ `1e-9 mm/native-U`; corda normale ≤ `1e-4` | Nuove evidenze sui due limiti unilateri, per tutti i valori V |
| Spostamento della superficie a parametri corrispondenti | ≤ **0,05 mm** | Nuovo limite continuo su `S_candidato(u,v)−S_sorgente(u,v)` |
| Spostamento delle curve di cucitura U | ≤ **0,05 mm** | Nuovo limite continuo sulle curve, distinto dal limite della superficie |
| Movimento dei poli | Quantità descrittiva, senza sostituire il criterio della superficie | Delta e misure già salvati nella preparazione |

Un residuo D1 piccolo indica che la derivata memorizzata è vicina al target; **non dimostra** che la sua variazione rispetto alla sorgente sia entro 5 mm/V. Il residuo D2 riguarda ancora un'altra quantità. Non si somma automaticamente la tolleranza D1 al limite 5 per accettare un eccesso.

## 3. Limite esatto di variazione delle derivate

Per un bordo naturale di grado V pari a `p`, indicare con A il polo sul bordo e con B il primo polo interno. La derivata entrante del modello è `D = p*(B−A)/h`, dove `h` è la prima ampiezza V misurata dal bordo. Su V1 la scelta del primo polo verso l'interno incorpora il segno della derivata entrante.

La nuova verifica usa, separatamente:

```text
Delta_target[u] = targetInward[u] - baseInward[u]
Delta_stored[u] = p/h * ((B_candidate[u] - A_candidate[u])
                         - (B_source[u] - A_source[u]))
```

Coordinate e nodi binary64 sono trattati come valori esatti. Le differenze vengono formate in aritmetica intera prima della divisione per l'ampiezza esatta dei nodi; il confronto è `sum(delta_axis²) <= 25`. L'uguaglianza è ammessa. La norma calcolata con `Math.hypot`, un fattore `p/h` già arrotondato o un epsilon aggiunto non decidono il risultato.

[experimentalDerivativeCoefficientCap.ts](experimentalDerivativeCoefficientCap.ts) produce due certificati principali, `targetChange` e `storedChange`, con conteggi, indici U oltre limite, massimo, frazione esatta del margine `cap²−norm²`, segno e intervalli esterni. La diagnostica aggiuntiva `targetFromExactSourceChange` distingue la derivata sorgente esatta dall'array base arrotondato del bundle; resta esplicitamente separata dai due criteri principali.

Se tutti i coefficienti memorizzati soddisfano il limite, la base periodica non negativa e a somma unitaria fornisce anche il limite sul campo lungo U. Un coefficiente fuori limite viola il criterio dichiarato per coefficienti; non è, da solo, un testimone di superamento del campo in uno specifico parametro. Un eventuale eccesso molto piccolo resta registrato, senza modificare il candidato o il limite.

## 4. Giunzioni e parametrizzazioni

Le etichette V0/V1 del bundle indicano i bordi della **centrale 322**. Definire `s ∈ [0,1]` crescente e:

```text
L323 = 252.00932454753
L322 = 242.48253589446
L321 = 237.3422596445
L324 = 261.52535017517
```

| Relazione | Laterale | Supporto | Edge STEP | Parametro dell'edge |
|---|---|---|---|---|
| Giunzione 74, bundle V0 | `S323(L323*s,1)` | `S322(L322*s,0)` | `#207475` | `t=L322*s` |
| Giunzione 75, bundle V1 | `S321(L321*s,0)` | `S322(L322*s,1)` | `#207173` | `t=L321*s` |
| Rim qualificato, contratto acquisito distinto | `S323(L323*s,0)` | `S324(L324*s,1)` | `#207767` | `t=L323*s` |

Per ogni supporto `T=L*S_u`. La derivata laterale entrante M è `−S323_v` sulla 74 e `+S321_v` sulla 75. Il riferimento R è l'opposto della derivata entrante del supporto: `−S322_v` sulla 74 e `+S322_v` sulla 75. Si confrontano le normali orientate `T_laterale × M` e `T_supporto × R`. Con facce native `forward` riconfermate, queste normali hanno il segno **−** rispetto a `S_u × S_v` su entrambi i lati della 74, e **+** su entrambi i lati della 75.

Il limite `1e-8` sulla norma di `S_u` conserva le unità native. Per T il limite equivalente è `L*1e-8`, non lo stesso numero applicato dopo una riscalatura. Alla cucitura U si mantengono distinti `s=0+` e `s=1−`; la chiusura di posizione non elimina l'obbligo di verificare i due jet.

[experimentalCandidateJointDifferential.ts](experimentalCandidateJointDifferential.ts) usa la partizione comune dei nodi U normalizzati come rapporti razionali esatti. Le derivate sono calcolate su ciascuna campata nativa prima della restrizione; non si divide per una piccola cella comune per ricostruirle. La V lineare di 322 conserva il suo contratto di estrazione distinto dalla V quintica delle laterali.

Per vettori regolari A,B, prodotto scalare positivo e `0<c<1`, il limite sulla corda unitaria è verificato tramite:

```text
|A × B|² <= c²*(1-c²/4)*|A|²*|B|²
```

La verifica mantiene i prodotti Bernstein e la loro correlazione. La scala trasversa usa `lambda = ((T_laterale × M)·(T_laterale × R))/|T_laterale × R|²`, con denominatore positivo. Un limite inferiore numerico di λ viene pubblicato solo quando la sua costruzione è valida; il criterio effettivo resta la disuguaglianza polinomiale `numeratore−lambda_min*denominatore >= 0`.

La corda normale `1e-4` equivale a circa `0,005729577953695556°`; questa conversione è descrittiva. Il certificatore usa la corda dichiarata, non un angolo arrotondato. La qualifica entro tolleranza non viene denominata G1 esatta.

## 5. Regolarità, orientazione e cuciture

Si coprono i supporti candidati **321 e 323** e il supporto fisso **322**. Il confronto continuo sorgente/candidato deve dimostrare un prodotto scalare normale positivo su ogni cella nativa chiusa: ciò stabilisce la regolarità di entrambi i modelli e la concordanza relativa dell'orientazione. Il normale senso topologico di una faccia CAD non viene dedotto da questa prova.

[experimentalPeriodicSupportOrientation.ts](experimentalPeriodicSupportOrientation.ts) mantiene distinte le normali in coordinate di cella e quelle native. Se la cella ha ampiezze `DeltaU,DeltaV`, la norma del prodotto vettoriale locale è riscalata di `DeltaU*DeltaV`; il limite nativo viene pubblicato usando un limite superiore esterno del fattore positivo. Celle non visitate, budget esaurito o celle irrisolte impediscono una conclusione sull'intero dominio. Un testimone di prodotto scalare normale non positivo viola l'orientazione richiesta, ma non prova da solo degenerazione: in quel caso la regolarità resta inconclusiva, salvo una sua evidenza distinta.

I nodi interni e le cuciture hanno i propri limiti unilateri. La regolarità delle singole celle non dimostra da sola G1 attraverso la cucitura U. Su ciascuna cucitura occorre verificare chiusura di posizione, salto U assoluto, variazione del salto e direzioni normali. Per 322 la V è lineare; il relativo controllo non deve passare per un modello quintico inventato.

Le curve delle cuciture già salvate hanno queste identità:

| Laterale | Edge di cucitura | Curva 3D sorgente | Pcurve sorgenti |
|---|---|---|---|
| 321 | `#207440` | `#207442` | `#207455`, `#207462` |
| 323 | `#208034` | `#208036` | `#208039`, `#208046` |

Le curve candidate usano la colonna U0 dei poli effettivamente salvati, con la base V quintica originale e parametro `t=v ∈ [0,1]` crescente. La qualifica coefficientale deve riferirsi a tali curve. L'identità dei dati di pcurve recuperati non equivale alla verifica di un loro nuovo accoppiamento nativo.

## 6. Spostamenti e invarianti acquisiti

Il movimento è confinato a V in `[.95,1]` su 323 e `[0,.05]` su 321; le righe modificate sono rispettivamente 9/10 e 1/2, con 476 poli per laterale. I massimi euclidei osservati nella preparazione sono `0,10000000000000121 mm` e `0,06492088175293244 mm`; i limiti conservativi L1 sui poli sono `0,15486418971886284 mm` e `0,07458976953957834 mm`. Questi valori descrivono i coefficienti, non il massimo movimento della superficie.

La nuova evidenza di spostamento deve limitare continuamente `Delta S(u,v)` e, separatamente, ciascuna curva di cucitura. Il limite dichiarato è **0,05 mm** per entrambe le quantità. Un polo oltre 0,05 mm non implica automaticamente il superamento della superficie; un piccolo spostamento di alcuni campioni non dimostra il limite continuo.

Le identità acquisite delle righe protette, dei bordi naturali V e delle reti 322/324 restano legate all'hash dell'artefatto. Non si ripete la preparazione per ristabilirle. In particolare il rim **323/V0 ↔ 324/V1** mantiene il proprio contratto concluso a `1887859`. Questa relazione non sostituisce la nuova qualifica delle giunzioni 74 e 75; il bordo esterno 321/V1 verso edge `#204199` mantiene anch'esso un'identità distinta.

I residui acquisiti sono:

| Laterale | Residuo D1, mm/native-V | Variazione D2, mm/native-V² |
|---|---:|---:|
| 323 | ≤ `1,6539825065109432e-12` | ≤ `1,394440118929197e-12` |
| 321 | ≤ `1,701416785238053e-12` | ≤ `6,217248937900883e-13` |

La nuova qualifica li cita come evidenza acquisita dello stesso candidato. Non li ricalcola per produrre un nuovo PASS e non li usa al posto del limite 5 mm/V.

## 7. Classificazione e copertura delle evidenze

Ogni criterio della sezione 2 deve avere una voce propria nella ricevuta: identificatore del criterio, soglia/unità, helper e hash, input effettivi, copertura, risultato e testimone o limite numerico pertinente. Per una giunzione si registrano separatamente posizione, norme, concordanza delle tangenti/normali, corde e λ. Una violazione di un criterio non promuove né cancella le evidenze indipendenti degli altri.

Le classificazioni ammesse sono: **entro il criterio**, **violazione dimostrata**, **inconclusivo**. Un limite superiore conservativo oltre soglia non diventa automaticamente una violazione; occorre un testimone valido. L'esaurimento di un budget o un limite inferiore non risolto resta inconclusivo. Per contro, un margine esatto negativo del limite coefficientale è una violazione del relativo criterio, anche se piccola.

Il residuo normale campionato storico `1e-3 mm/native-V` conserva il suo significato. Il nuovo limite superiore continuo è registrato separatamente dal certificatore delle corde. Se risulta ≤ `1e-3`, è una prova sufficiente anche per qualunque campione. Se è maggiore, non dimostra una violazione del criterio campionato e quel criterio resta inconclusivo in assenza di un'altra evidenza applicabile. Le prove campionate già consumate non vengono ripetute.

### Esito della nuova esecuzione

Ricevuta: SHA-256 **`4c3694a521fafd83440c5434ede700ea5b717366219b84c23045dc14cb4eef4d`**, 126.563 byte; preflight finale **`7b0fde5ae637ea8f78b2550fba737a52d530b6da8e54ef9bc42ee53a1ef4d6bc`**. Esecuzione unica: 2026-11-09T22:16:40Z–22:17:23Z. Il candidato mantiene l'hash della sezione 1.

- **Cap target:** 238/238 coefficienti entro limite su entrambi i lati. **Cap memorizzato 323:** 237/238, con unico coefficiente fuori U=205 (indice da zero), norma in `[5.000000000000056, 5.000000000000057] mm/V`. Il margine esatto `25−||DeltaD||²` è `−1145015349844183/2028240960365170645274427025`, negativo. Cap memorizzato 321: 238/238 entro limite. Il piccolo residuo D1 acquisito non sana questo eccesso.
- **Corda normale delle giunzioni 74 e 75:** violazione dimostrata in entrambe da margini polinomiali con upper negativo e normali regolari concordi. Nessuna confusione con un upper conservativo non risolto.
- **Posizione, norme minime, orientazione e λ delle giunzioni:** entro criterio. Corda tangente della 75 entro criterio; della 74 inconclusiva su 8.192 foglie, senza testimoni di violazione.
- **Residuo normale del criterio campionato storico:** inconclusivo per questa nuova evidenza su entrambi i lati. I limiti continui aggiuntivi `0.026316328297860254` / `0.0018516255628473661 mm/V` sono maggiori di `1e-3`; non sono prove di violazione campionata e non vengono promossi a PASS.
- **Regolarità e orientazione relativa:** certificate su 708 celle di 321, 95 di 322, 708 di 323. Cuciture U dei tre supporti entro criterio.
- **Spostamento superficie:** upper 323 `0.04977416992187588 mm`, 321 `0.049214389679658105 mm`; **spostamento cuciture:** upper `0.009089103447495039` / `0.006818452451454857 mm`. Entrambi i limiti 0,05 mm rispettati. Gli upper dei poli `0.10000000000000124` / `0.06492088175293245 mm` rimangono grandezze distinte.

La [matrice delle 54 voci](evidence/candidate-qualification-20261109/criterion-matrix.json) collega ogni criterio alla sua evidenza: 44 entro, 3 violazioni dimostrate, 3 inconclusive, 4 informative. Una sola violazione è sufficiente a impedire il passaggio nativo. Nessun risultato della matrice è una qualifica del Tubo completo.

## 8. Passaggio al contratto nativo

Il nuovo collaudo nativo può essere eseguito **soltanto dopo un esito favorevole di tutti i criteri coefficientali richiesti**, legati al medesimo candidato. Un criterio violato o inconclusivo impedisce questo passaggio; non autorizza un rilassamento della soglia, una modifica silenziosa del candidato o la cancellazione di un marker.

Il contratto nativo rimane distinto e dovrà avere preflight, marker, input/hash e ricevuta propri. Costruisce in isolamento i supporti modificati, le curve 3D delle cuciture e l'associazione coerente delle due pcurve per cucitura; verifica intervalli, orientazioni, vertici, bordi V preservati e identità delle facce mediante provenienza/grafo. I criteri di consistenza già dichiarati sono **gap nativo curva/superficie ≤ `1e-7 mm`** e **corda direzionale nativo/modello ≤ `1e-8`**. La corda normale delle giunzioni del bundle resta `1e-4`.

La verifica nativa campionata non sostituisce le prove continue. I confronti di direzione devono applicare i segni della sezione 4 e la catena `S_u*u'(t)+S_v*v'(t)`. Le limitazioni dell'API installata sulle magnitudini D1 restano esplicite; non richiedono un aggiornamento autonomo del kernel.

## 9. Preservazione e limiti del risultato

Il lavoro rimane nel plugin e nei suoi artefatti isolati. CAD live, host/kernel/MCP e lavoro della chat Tubo non vengono modificati; nessun merge. La STOP storica **`reopened-own-support-mismatch`**, ricevuta SHA-256 `32f2b99c16c5f4ddf4177c5b8ec2431ebd9cc7c417dcf502595ed779b87fcc92`, e tutti i marker consumati restano invariati.

Le tolleranze dimensionali mancanti del Tubo completo non bloccano queste verifiche isolate. L'eventuale esito favorevole riguarda soltanto i criteri dichiarati del candidato e, separatamente, il successivo componente nativo collaudato. Non comporta automaticamente spessore, dettagli protetti, validità dell'intero solido, accettazione STEP o qualifica del Tubo completo.
