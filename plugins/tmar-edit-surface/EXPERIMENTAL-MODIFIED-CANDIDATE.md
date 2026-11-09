# Candidato modificato del Tubo: contratto di preparazione coefficientale

Data: 9 novembre 2026. Base acquisita: `1887859163f8fd260189e5cbd218acdd007a9c91`, ramo `codex/edit-surface-tubo-periodic`.

## 1. Obiettivo e stato

Preparare una nuova coppia di reti laterali **323 e 321** applicando i target di derivata già determinati nel bundle 6b, con **322 invariata**. L'operazione è quella prevista dal precedente storage atomico: non richiede un nuovo fitting o una traslazione da scegliere. La preparazione salva coefficienti, delta e provenienza; non produce un'accettazione geometrica, nativa o del Tubo completo.

Il packet indica `estimate_not_requirement_mm = 5`. Tale stima non determina uno spostamento richiesto. Il distinto valore **5 mm/native-V** è il limite sulla variazione dei coefficienti di derivata. Lo spostamento richiesto in questo contratto è il campo `Delta S` determinato dai target e dall'operatore della sezione 4.

Stato dell'artefatto: **prepared-unqualified-coefficient-candidate; controlli di preparazione soddisfatti alle 18:52:05 UTC del 9 novembre 2026**. Ricevuta e manifest: **[preparation-summary.json](evidence/modified-candidate-20261109/preparation-summary.json); ricevuta privata SHA-256 `9859fb45965821441fc8cd6a6e439ca21bad0c88843c9a672c008a04bcbf5777`; preflight `1876d5e8ad5f1d76cdc2d606e02067d870cc73d5261297c57dcddcd7e86d4132`**.

## 2. Input congelati e provenienza

Le coordinate restano nel frame STEP originale, in millimetri, senza trasformazioni. I numeri 321–324 identificano le facce nella base congelata; una nuova enumerazione nativa non costituisce una corrispondenza automatica.

| Input | SHA-256 |
|---|---|
| `Tubo_BASE_COPIA.step`, 27.555.617 byte | `6b711960fcded7972ded41ed1ceaa2f09e2dd8332fc7ee980b76d2514c94e8ae` |
| `Tubo_BASE_COPIA.scanruler`, provenienza conservata | `cc64b9284f11f92093563325fe407a046a8d54dbb26c1cac3344d7047e491263` |
| Packet `dati_recuperati.json`, 8 novembre 2026 | `8d60108498ab64b76d296ae6062b45443b87dee776189031bf4e48e9f08908f5` |
| `bundle_storage_6b.json` | `4e6bcf262c2897d45e1689ab0e72c19fd0f2aeb67ec76dcd2aa5a53a1cc75b37` |
| `METADATI_SUPERFICI_74_75_BASE6B.json` | `98d9a185ff2c6650e57e4a8bb04da457733a5ad4840330bef6e4d20efbafa25d` |
| `METADATI_STEP_74_75_BASE6B.json` | `0b8a50047e0569d1e69cd321449e79702eedddd0da0592231378e9454fc4d5c1` |
| Cattura statica aggiuntiva dello STEP, 9 novembre 2026; percorso nel manifest | `02a34618425c96fe82e7355a9b31467a09399849b7cb3339d6b1fda89e7d1539` |
| `face-323.original.brep` | `be5d618395055efb262e53c200e435754a5675b870a9d19e8d422f2156ef2148` |
| `face-324.original.brep`, riferimento protetto | `d9dcfeda56d7c76d50ebb24c1a841bdb41ab83d94a8b70bd14d67d3c12059e64` |

Gli hash ancestrali del bundle restano vincolati: snapshot `b1833ae29625324c7db9d2a419937135f6944c09a1525a7f0ab3f3e243dce54c`, sistemi `093ee8ce1d883d779696e3aaca29ed43042f8056d985fe7d091dd3e7e42f5e55`, soluzione vincolata `28adcdc63627090ae28afe7a78525034adfa3bd6f59bdf7f16257cf75d1bfc83`. Non si riesegue il solve.

La ricevuta storica di storage `55b97acc4c4f5d2c09c477c8b49c8526352d3c3daf1aba27ff7ce9575682076a` documenta criteri e provenienza. Non contiene reti candidate persistite e non sostituisce nuove evidenze di questo artefatto. I contratti conclusi della coppia salvata rimangono quelli di [EXPERIMENTAL-SAVED-PAIR-DIFFERENTIAL.md](EXPERIMENTAL-SAVED-PAIR-DIFFERENTIAL.md) e [EXPERIMENTAL-SAVED-STEP-CHECKPOINT.md](EXPERIMENTAL-SAVED-STEP-CHECKPOINT.md).

Le reti raw STEP complete sono in `dati_recuperati.json#/surface_coefficients_raw_step`: 321/supporto `#204263` e 323/`#207539`, 239×12; 322/`#207237`, 98×2. La nuova conversione esatta ha preparato 321 in base periodica 238×12 e 322 in base 97×2. Per 323 è stato riusato il BREP originale, con identità dei coefficienti rispetto ai dati raw; il supporto post-STEP non è stato usato come base del bundle. I coefficienti delle derivate sorgenti delle due laterali coincidono esattamente con gli array base del bundle.

## 3. Facce, giunzioni e orientazioni

| Ruolo | Faccia STEP / supporto | Intervento |
|---|---|---|
| Laterale 323 | `#207763` / `#207539` | Modificare due righe vicino a V1 |
| Centrale 322 | `#207471` / `#207237` | Preservare l'intera rete |
| Laterale 321 | `#207169` / `#204263` | Modificare due righe vicino a V0 |
| Adiacente protetta 324 | `#208055` / `#207831` | Preservare l'intera rete e il rim qualificato |
| Adiacente al V1 di 321 | `#204195` / `#201289` | Preservare; indice nativo non riconfermato |

Le etichette **V0/V1 del bundle si riferiscono a 322**. Con `s` crescente in `[0,1]`, porre `L323=252.00932454753`, `L322=242.48253589446`, `L321=237.3422596445`, `L324=261.52535017517`.

| Relazione | Bordo e mappa sul primo supporto | Bordo e mappa sull'altro supporto | Edge STEP |
|---|---|---|---|
| Bundle V0, giunzione 74 | 323: `(L323*s,1)` | 322: `(L322*s,0)` | `#207475` |
| Bundle V1, giunzione 75 | 321: `(L321*s,0)` | 322: `(L322*s,1)` | `#207173` |
| Rim già qualificato | 323: `(L323*s,0)` | 324: `(L324*s,1)` | `#207767` |
| Bordo esterno di 321 | 321/V1 | Faccia STEP `#204195` | `#204199` |

I parametri originali degli edge sono `t=L322*s` per 74 e `t=L321*s` per 75. Le tangenti comuni sono `T=L*S_u`; le derivate di target conservano le unità native V. Per la giunzione 74: `M=-S323_v`, `Dsupport=+S322_v`. Per la 75: `M=+S321_v`, `Dsupport=-S322_v`. Il confronto orientato usa `R=-Dsupport`, quindi `unit(Tlaterale × M)` contro `unit(Tsupporto × R)`, con prodotto scalare positivo. Non si confrontano direttamente due derivate entrambe entranti come se avessero lo stesso verso. Dopo aver riconfermato facce native `forward`, il confronto delle normali usa il fattore **−1 su entrambi i lati della giunzione 74** rispetto alla normale nativa `S_u × S_v`, e **+1 su entrambi i lati della 75**. Un orientamento nativo diverso richiede il corrispondente fattore esplicito.

Le orientazioni delle facce e degli usi nei wire restano dati separati dalle mappe parametriche crescenti. I limiti sinistro/destro alla cucitura U vanno identificati esplicitamente. Una nuova lettura nativa deve verificare le associazioni per provenienza e coefficienti, senza affidarsi all'indice restituito dal kernel.

## 4. Modifica deterministica dei coefficienti

Ogni lato contiene 238 vettori `baseInwardDerivatives` e 237 `freeDerivativeChanges`, ordine U crescente e assi XYZ. Si ricostruiscono esattamente come nel runner acquisito:

```text
delta0 = seamNextWeight*free[0] + seamPreviousWeight*free[236]
target[0] = base[0] + delta0
target[u] = base[u] + free[u-1]                 per u=1..237
```

Hash richiesti dei target, serializzati come binary64 little-endian XYZ/U:

| Lato | Origine della soluzione | SHA-256 target |
|---|---|---|
| V0 / 323 | `V0 constrained exact cap` | `c78521dd5ac876bab43ea589003d488d552c8de0aafbc351da150d874921cce7` |
| V1 / 321 | `V1 unbounded SVD` | `522b667ae6cbe5bed96c16c3bff0d15ed8016fe8ddd125db6fa2aae068eb0730` |

Il materializzatore [experimentalPeriodicQuinticSide.ts](experimentalPeriodicQuinticSide.ts), `materializeExperimentalPeriodicQuinticCandidateCoefficients`, riusa l'operatore privato esistente `proposeQuinticRows`. Per ogni colonna U, A è il polo sul bordo scelto, B il primo polo interno, C il secondo; T è il target. `h1,h2` sono le distanze dal nodo di bordo ai nodi di indice 6 e 7 del knot vector V espanso, contando dal bordo verso l'interno e conservando le ripetizioni:

```text
step = h1 / 5
spread = 1 + h2 / h1
B_new = A + step * T
C_new = C + spread * (B_new - B)
```

Mantenere l'ordine delle operazioni binary64: la seconda assegnazione impiega il delta effettivamente memorizzato del primo polo. Per i nodi V `[0,.05,.95,1]`, molteplicità `[6,3,3,6]`, `spread=2`; `step=(1-.95)/5` su 323/V1 e `.05/5` su 321/V0. L'operatore preserva D2 al bordo entro il limite dichiarato, verificando separatamente il residuo D1 memorizzato e i lock.

| Faccia | Righe V modificabili, indice da 0 | Righe V identiche, in ogni colonna U | Supporto del cambiamento |
|---|---|---|---|
| 323 | 10 e 9 | 0–8 e 11 | V in `[.95,1]` |
| 321 | 1 e 2 | 0 e 3–11 | V in `[0,.05]` |

Nodi, gradi, pesi unitari e periodicità restano invariati. Per le funzioni di base periodiche U `N_i` e clamped quintiche V `M_j`, il campo di spostamento è:

```text
Delta S(u,v) = sum_i N_i(u) *
  ( M_first(v) * Delta P_i,first + M_second(v) * Delta P_i,second )
```

Le basi modificate hanno supporto soltanto nelle bande della tabella. Entrambi i bordi naturali V conservano la posizione; il bordo opposto conserva anche le righe necessarie ai propri jet. In particolare **323/V0 e 324 sono protetti**, mentre la derivata su 323/V1 cambia. La prova acquisita del rim non qualifica le giunzioni 74 e 75. Il campo `Delta S`, i delta dei poli e un limite sullo spostamento della superficie sono grandezze distinte; il limite conservativo sui poli non va interpretato come spostamento fisico massimo.

La cucitura U di ciascuna laterale può muoversi nella banda modificata. Gli estremi V fissi non rendono valida una vecchia curva 3D della cucitura sulla nuova superficie.

## 5. Vincoli e criteri locali dichiarati

Si adottano per il nuovo candidato i seguenti **criteri diagnostici**, derivati dal contratto storico. Nessun valore costituisce un requisito di fabbricazione del Tubo.

| Quantità | Criterio | Unità / applicazione |
|---|---|---|
| Variazione del coefficiente di derivata | ≤ 5 | mm/native-V, norma euclidea per coefficiente |
| Residuo D1 memorizzato | ≤ `1e-9` | mm/native-V |
| Variazione D2 memorizzata | ≤ `1e-9` | mm/native-V² |
| Spostamento superficie a parametri corrispondenti | ≤ 0,05 | mm, verifica continua distinta |
| Spostamento curva della cucitura U | ≤ 0,05 | mm, verifica continua distinta |
| Salto U assoluto e variazione del salto | ≤ `1e-9` | mm/native-U; non una prova G1 autonoma |
| Gap di posizione / corrispondenza sulle giunzioni | ≤ `1e-6` | mm |
| Residuo normale campionato | ≤ `1e-3` | mm/native-V; campioni non equivalgono a continuità globale |
| Scala trasversa `lambda` | ≥ 0,0625 | Adimensionale, nei parametri V qui fissati |
| Norma tangente nativa / velocità trasversa | ≥ `1e-8` | mm/native-U / mm/native-V |
| Corda tra tangenti unitarie concordi | ≤ `1e-10` | Adimensionale |
| Corda tra normali unitarie concordi | ≤ `1e-4` | Adimensionale, giunzioni bundle e cuciture |

Il vecchio runner controllava la norma di `S_u`. Se una verifica usa `T=L*S_u`, il limite equivalente è `L*1e-8` mm per `s`, non `1e-8` applicato senza conversione. La componente trasversa è quella perpendicolare alla tangente; le normali devono essere regolari e concordi prima della normalizzazione.

Per una corda unitaria `c`, l'angolo è `2*asin(c/2)`. La corda normale `1e-4` corrisponde a circa **0,00010000000004166667 rad = 0,005729577953695556°**; la corda tangente `1e-10` a circa `1e-10 rad`. La verifica usa il criterio di corda dichiarato, senza utilizzare un `asin` arrotondato come certificatore. Sono richieste nuove coperture continue per entrambe le giunzioni del bundle e per la regolarità dei supporti interessati; un'etichetta C1/C2 o un controllo su campioni non le sostituisce.

## 6. Artefatto da conservare e nuove evidenze

Il manifest deve contenere versione/hash del materializzatore e del driver, input effettivi, conversioni raw/periodico, hash delle reti sorgenti e candidate, target e delta completi, indici modificati, identità delle righe protette, identità di 322/324 e risultati dei soli controlli svolti. Le due laterali sono consegnate insieme; un fallimento su un lato non autorizza la promozione dell'altro.

| Evidenza nuova | Valore registrato dall'esecuzione |
|---|---|
| Rete candidata 323 e formato hash | **5dcb77de0ca0436cefd8939f2543715ab97a48b1fa2e0a53086e82a0acb9ff30; SHA-256 della rete JSON canonica, ordine dichiarato dal driver** |
| Rete candidata 321 e formato hash | **55192829323aa1052e76780e2b8eb8b193d9e9a4412a9ffe414bf5382e10c19a; stesso formato** |
| Delta completi, hash e indici | **`evidence/modified-candidate-1887859.local/candidate-1.coefficients.local.json`, 1.112.885 byte; SHA-256 `4b1e81b166e373707a9e0df1063bf757de6303e71a02d9a818631b3036b4350a`; 476 poli per lato, con before/after/delta XYZ e indici U,V** |
| Rappresentazione, immutabilità e righe protette | **321: 12 clamp esatti; 322: 2 clamp esatti; tutti con errore zero. 323 riusa il BREP originale con identità dei coefficienti raw. Righe protette e basi identiche; 322/324 invariate. Nessun replay dei contratti della coppia salvata** |
| Residui D1/D2 e controlli del nuovo helper | **323: D1 ≤ 1,6539825065109432e−12 mm/V, variazione D2 ≤ 1,394440118929197e−12 mm/V². 321: D1 ≤ 1,701416785238053e−12 mm/V, variazione D2 ≤ 6,217248937900883e−13 mm/V². Nove nuovi test PASS; TypeScript finale PASS** |

Lo stato del materializzatore è `prepared-unqualified-coefficient-candidate`. `continuousG1Certified`, `nativeCadCertified` e `tubeAccepted` restano `false`. Questa fase non richiama il vecchio storage wrapper completo, non ripete il solve o le prove della coppia salvata e non modifica le ricevute precedenti.

I massimi euclidei osservati sugli spostamenti dei poli memorizzati sono **0,10000000000000121 mm** per 323 e **0,06492088175293244 mm** per 321. Sono misure dei coefficienti calcolate in binary64; non sono bound dello spostamento della superficie. I limiti conservativi L1 dei poli sono rispettivamente 0,15486418971886284 e 0,07458976953957834 mm. I nuovi bound continui della superficie e delle cuciture restano da qualificare sul candidato identificato.

Sono già salvate le due curve 3D sostitutive, con la stessa base V quintica e i poli della colonna U0 candidata; le pcurve recuperate hanno verso crescente V e coordinate U0/Uend. Le associazioni native sono ancora da costruire.

## 7. Successivo contratto nativo, distinto e non ancora eseguito

L'input nativo sarà l'artefatto candidato identificato nella sezione 6, non il vecchio `pair-reopened.brep` usato come candidato modificato. Il futuro runner avrà preflight, limiti operativi, marker e ricevuta propri, dichiarati prima dell'esecuzione. Esso dovrà materializzare supporti e rappresentazioni di bordo coerenti in un contesto isolato, con le seguenti identità recuperate dallo STEP:

| Superficie mobile | Cucitura U | Curva 3D sorgente | Due pcurve sorgenti |
|---|---|---|---|
| 321 | Edge `#207440` | `#207442` | `#207455`, `#207462`, su U0/Uend |
| 323 | Edge `#208034` | `#208036` | `#208039`, `#208046`, su U0/Uend |

Per ciascuna cucitura, aggiornare la curva 3D in accordo con la superficie candidata e verificare entrambe le pcurve, intervalli, orientazioni, vertici ed estremi. Le pcurve possono conservare le coordinate parametriche soltanto se il nuovo accoppiamento superficie/curva è verificato. Preservare i bordi V, incluso `#204199` verso la faccia STEP `#204195`; questa identità statica non è una nuova qualificazione della relativa giunzione.

La verifica dovrà identificare le facce dal grafo e dalla provenienza, controllare validità e associazioni del componente costruito e confrontare le nuove letture native con il modello coefficientale. Si dichiarano gap curva/superficie **≤ `1e-7` mm** e corda direzionale nativo/modello **≤ `1e-8`** come criteri di consistenza; il criterio angolare delle due giunzioni bundle resta quello della sezione 5. Non si riutilizza come limite del bundle quello, distinto, del rim salvato.

I controlli continui del candidato devono coprire entrambe le giunzioni, limiti U unilateri, regolarità completa, orientazione rispetto alla sorgente e limiti di spostamento. I campioni nativi verificano la consistenza dell'implementazione senza diventare una prova continua. L'API già installata 5.7.1 espone direzioni di tangenti/normali, non misure complete delle magnitudini D1: il confronto nativo deve conservarne questa limitazione. Parametri, catena `S_u*u'(t)+S_v*v'(t)`, convenzioni ai nodi e conteggi delle osservazioni devono risultare nella nuova ricevuta.

La precedente STOP `reopened-own-support-mismatch`, ricevuta `32f2b99c16c5f4ddf4177c5b8ec2431ebd9cc7c417dcf502595ed779b87fcc92`, rimane invariata. Tutti i marker consumati e le relative prove sono preservati. Nessun aggiornamento host/kernel/MCP, nessuna operazione sul CAD live, nessun merge e nessun trasferimento automatico al Tubo completo fanno parte di questo contratto.

## 8. Requisiti del pezzo e limiti delle fonti

Il packet dell'8 novembre riporta riferimento esterno **±0,5 mm**, parete nominale interna **2 mm**, foro rivetto **4,75 mm**, larghezza blocchetto **17,09 mm**, conservazione dell'allineamento e dei dettagli squadrati, fori e blocchetto. Non riporta bande di tolleranza per le ultime tre quote né un requisito angolare globale. Questi dati mancanti non impediscono di determinare il candidato derivativo, ma non possono essere inventati per qualificare il pezzo completo. I budget locali 0,05 mm/`1e-4` non li sostituiscono.

Le fonti effettivamente recuperate sono il handoff integrale dell'8 novembre, il packet allegato e le relative fonti numeriche, gli estratti originali di comunicazioni archiviati nel packet, il codice/receipts acquisiti e la cattura statica dello STEP del 9 novembre. Non si rivendica l'accesso alla trascrizione completa della precedente chat. Le conclusioni del checkpoint `1887859` restano acquisite nel proprio perimetro.
