# Diagnosi mirata e contratto di correzione del candidato Tubo 6b

**Aggiornato il 10 novembre 2026, Europe/Rome. Diagnosi conclusa: il contratto con target T6b invariati e fedeltà D1 <=1e-9 mm/V è matematicamente incompatibile con la corda normale <=1e-4, su entrambe le giunzioni.** Nessun candidato corretto è stato materializzato. La proposta T2 della sezione dedicata cambia esplicitamente il target applicato; la sua fattibilità globale resta da accertare.

Una sola nuova esecuzione mirata è terminata il 9 novembre 2026 alle 23:08:52 UTC, cioè il 10 novembre alle 00:08:52 Europe/Rome. Tutti i sei scope sono conclusi senza errori tecnici. Sono stati eseguiti 32 nuovi test puri, tutti favorevoli, e controlli TypeScript mirati; nessuna prova acquisita è stata rieseguita. [Risultati e matrice di applicabilità](evidence/candidate-diagnosis-20261110/README.md).

## Identità e invarianti

Base acquisita `acf8b75a1a0b79d19d2ce100dc8215ebc5e9fc11`, ramo `codex/edit-surface-tubo-periodic`. Candidato 1 immutabile `tubo-6b-derivative-storage-candidate-1`, SHA-256 `4b1e81b166e373707a9e0df1063bf757de6303e71a02d9a818631b3036b4350a`. La qualifica è conclusa con STOP nella ricevuta `4c3694a521fafd83440c5434ede700ea5b717366219b84c23045dc14cb4eef4d`; nessun risultato successivo la modifica retroattivamente.

Bundle originale immutabile: SHA-256 `4e6bcf262c2897d45e1689ab0e72c19fd0f2aeb67ec76dcd2aa5a53a1cc75b37`. STEP sorgente: `6b711960fcded7972ded41ed1ceaa2f09e2dd8332fc7ee980b76d2514c94e8ae`. Ricevuta di preparazione acquisita: `9859fb45965821441fc8cd6a6e439ca21bad0c88843c9a672c008a04bcbf5777`. Campioni storici, recuperati dallo snapshot dei sistemi: `b1833ae29625324c7db9d2a419937135f6944c09a1525a7f0ab3f3e243dce54c`.

Nuovo baseline: 176 file protetti, verificati prima e dopo; SHA-256 `e08636521d43f5e43a2c2513f441917017b61a2ff3ca1b015fb4f63d76711baf`. Nuova richiesta diagnostica: `4a6e4384dd3aef9be381deaeca11957a1a6ffc37e2cc220eb5bc7154f30ab3ae`.

Preflight eseguito: `23e2747c766dc33f2e9f938e53c4fe93d88f228ca13d8b5210c941bef610d8f2`; nuova ricevuta privata, 954.048 byte: `28d0e77e9b59ae00051eee6d349940e68a4d86fa49d7764fcd917e034659a870`. I 13 input e i 19 file di codice/build vincolati dal preflight sono riportati in [input-manifest.json](evidence/candidate-diagnosis-20261110/input-manifest.json). Il nuovo marker `candidate-diagnosis-acf8b75.local/targeted-diagnosis-1.local.run-once` è consumato; non deve essere azzerato o riutilizzato.

## Domande diagnostiche distinte

1. Ai testimoni già salvati delle giunzioni 74 e 75, confrontare il campo dei target inward T6b con il campo inward M1 effettivamente realizzato nei poli di candidato 1. Usare gli stessi parametri esatti, tangenti, supporto centrale e orientazioni. Quantificare corde, residui e perturbazione target–stored. Un testimone comune alle due sottocelle conta come un solo punto.
2. Per 323/U205, cercare soltanto una patch locale di poli binary64 che soddisfi il cap esatto 5 mm/V, fedeltà D1 al target e variazione D2. Il successo locale non dimostra fattibilità delle giunzioni né autorizza la costruzione del candidato 2.
3. Risolvere la voce della corda tangente 74 con una nuova prova specializzata, senza rivalutare il resto della qualifica. La vecchia ricevuta non elenca tutte le celle associate alle foglie certificate: per questo la nuova prova riguarda l'intero dominio del solo criterio tangente. Una modifica delle derivate inward non cambia il bordo o la sua tangente.
4. Verificare soltanto i due residui normali storici sui parametri originari training/holdout, sul candidato identificato. Il significato matematico è il massimo di `abs(M dot unit(T_lateral cross R))` e `abs(M dot unit(T_support cross R))`. I due limiti della cucitura sono distinti. Nessun vecchio PASS è trasferito senza una dimostrazione di applicabilità.

## Risultati dei testimoni e incompatibilità dimostrata

La corrispondenza esatta degli indirizzi con la ricevuta precedente è verificata prima del nuovo marker. Sono state confrontate anche le partizioni normalizzate: SHA-256 `5d1abbc415955b600106addfa73435f61835027f6172595570dbbd4f80d1b6f3` per la 74 e `517590caf1c5cb5cb07cec0fd7fe8d419b8dbc3c560560b18acf88606c553744` per la 75. I due record di endpoint nella mezzeria di ciascuna cella rappresentano un unico punto; non sono stati cercati nuovi testimoni.

| Quantità | Giunzione 74, cella 49 a metà | Giunzione 75, cella 105 a metà |
|---|---:|---:|
| Corda normale del target, intervallo | `[0.0001277575802380674, 0.00012775758024605638]` | `[0.00011927966344900997, 0.00011927966345271496]` |
| Corda normale del campo salvato, intervallo | `[0.0001277575802720825, 0.00012775758028028597]` | `[0.00011927966348945138, 0.00011927966349326281]` |
| Upper norma target meno campo salvato, mm/V | `3.460539360856138e-13` | `6.14460121687973e-13` |
| Lower della corda per qualsiasi campo entro fedeltà D1 1e-9 | `0.0001277573801143619` | `0.00011927953008063825` |
| Lower della correzione D1 puntuale necessariamente richiesta, mm/V | `0.00013870211014614664` | `0.00014455948739709146` |

La soglia angolare resta la corda `1e-4`. Le due violazioni sono già nel campo T6b; lo scarto dovuto alla realizzazione nei poli è insufficiente a spiegarle. Le correzioni necessarie superano rispettivamente 138.702 e 144.559 volte la fedeltà consentita. Questi valori sono limiti inferiori necessari, non correzioni già risolte né quantità sufficienti a qualificare la giunzione.

La prova usa A=`T_laterale cross M_target`. Se ogni coefficiente inward può discostarsi dal target al massimo di epsilon, la base U non negativa con somma uno implica lo stesso limite puntuale. Con bordo, supporto e mappe fissi:

`||delta A|| <= ||T_laterale|| * epsilon`

`||unit(A+delta A) - unit(A)|| <= 2*||delta A||/||A||`.

La disuguaglianza triangolare inversa fornisce i lower della quarta riga, entrambi maggiori di 1e-4. Un normale nullo violerebbe comunque la regolarità; qui l'intera palla ammessa resta regolare. Basta uno dei due testimoni a escludere il contratto stretto, indipendentemente dagli altri criteri. Non occorre un nuovo solve per confermare questa esclusione.

### Perché U205 non può correggere i due testimoni

Il testimone della 74 è nella campata laterale U35. Per la cubica validata, con molteplicità iniziale 3 e ogni molteplicità interna compresa fra 1 e 3, i quattro coefficienti attivi sono k..k+3, con `k=sum(mu[0..35])-3`. Quindi `35<=k<=105` e `k+3<=108`, senza avvolgimento nel reticolo di 238 coefficienti. Il coefficiente U205 è nullo su quella campata. La patch locale di U205 lascia invariato il testimone 74; la 75 dipende esclusivamente dalle facce 321/322 e non è interessata da una patch sulla 323. Questa conclusione usa soltanto struttura della base e indici salvati, senza un'altra valutazione geometrica.

## Nuove evidenze per le tre voci inconclusive

**Tangente 74:** prova razionale esatta, dedicata al solo criterio tangente, su tutte le 330 celle della partizione; 330 foglie certificate, zero suddivisioni e zero irrisolte. Upper della corda unitaria `3.991146044755004e-12`, entro `1e-10`. Dot positivo e floor delle tangenti native hanno certificati propri; lower delle norme native `0.9607269686842241` e `0.9984725438449279 mm/U`. La nuova prova ha usato 345.627 operazioni esatte e al massimo 5.311 bit per intermedio.

La ricevuta precedente non consentiva di ricostruire tutte le celle delle foglie irrisolte: la copertura completa è nuova e riguarda esclusivamente la tangente. I bordi sorgente/candidato hanno fingerprint identici. Questa prova resta applicabile a un futuro candidato soltanto dopo aver dimostrato identità dei coefficienti di bordo, basi, pesi, mappe e convenzioni unilaterali. Non dipende dalle righe inward modificabili; una loro variazione non cambia la tangente del bordo.

**Residui storici:** nuova valutazione intervallare del candidato salvato sugli array originali, con il mapping affine esatto arrotondato nearest-ties-to-even già usato dal contratto storico. Training: omesso l'endpoint finale duplicato e mantenuti entrambi i limiti della cucitura iniziale. Holdout: omessi entrambi gli endpoint. Ogni punto ha verificato separatamente i due residui e il loro massimo.

| Giunzione | Training, punti / upper mm/V | Holdout, punti / upper mm/V | Esito rispetto a 1e-3 |
|---|---:|---:|---|
| 74 | 950 / `0.0001464244208069264` | 711 / `0.0006702716323938` | Tutti entro criterio |
| 75 | 946 / `0.00005493803218216299` | 708 / `0.00016349952982484567` | Tutti entro criterio |

Copertura completa dei 3.315 punti, zero punti irrisolti o fuori criterio. Le vecchie ricevute restano immutate e il vecchio PASS non viene trasferito. Il risultato non è continuo fra i campioni: nei due testimoni angolari il residuo massimo del campo salvato è rispettivamente almeno `0.0012767860729863975` e `0.0017887249004531686 mm/V`. Quei punti non sono i campioni storici; non costituiscono retroattivamente un FAIL del loro contratto. La corda normale continua rimane violata.

## Variabili e protezioni del contratto stretto

| Elemento | Variabile o vincolo |
|---|---|
| Laterale 323 | Modificabili soltanto le righe V 10 e 9, indici da zero, per tutte le colonne U |
| Laterale 321 | Modificabili soltanto le righe V 1 e 2 |
| Bordi naturali V | Poli e basi identici alla sorgente; nessuna modifica di posizione o tangente lungo U |
| Resto delle laterali | Tutti gli altri poli protetti; in particolare il jet del rim 323/V0 e quello del bordo opposto 321/V1 |
| Supporti 322 e 324 | Reti interamente protette |
| Rappresentazione | Gradi U3/V5 laterali, U3/V1 centrale; nodi, molteplicità, pesi unitari e periodicità invariati |
| Frame e parametri | Frame STEP originale in mm; mappe positive affine originali; nessun riallineamento |
| Target stretti | Gli array T6b già salvati nel candidato 1, con hash di preparazione acquisiti |
| U periodico | Chiusura di posizione condivisa; salti e corde normali verificati nei due limiti unilateri |

La giunzione 74 è 323/V1–322/V0, la 75 è 321/V0–322/V1. Il rim già qualificato 323/V0–324/V1 è una relazione diversa; il suo esito non qualifica nessuna delle due giunzioni del bundle.

Le mappe sono `U323=252.00932454753*s`, `U322=242.48253589446*s`, `U321=237.3422596445*s`, con s crescente in [0,1]. T=`L*Su`. Sulla 74, M=`-S323_v` e R=`-S322_v`; sulla 75, M=`+S321_v` e R=`+S322_v`. Le normali confrontate sono `T_laterale cross M` e `T_supporto cross R`. I limiti s=0+ e s=1- restano distinti. Il senso topologico di una faccia nativa richiede la propria verifica e non viene dedotto dal segno coefficientale.

## Realizzazione nei poli salvabili

Per ciascuna colonna, A è il polo di bordo protetto, B il primo interno, C il secondo. Con p=5 e prime distanze h1,h2 dal bordo nel vettore espanso:

`D_inward = p*(B−A)/h1`

`D2 = p*(p−1)/h1 * ((C−B)/h2 − (B−A)/h1)`.

I confronti devono usare i valori binary64 realmente salvabili di A,B,C e i nodi come numeri esatti. Il cap è `||D_candidate−D_source|| <= 5`, senza epsilon. D1 rispetto al target e variazione D2 rispetto alla sorgente sono verifiche separate, entrambe con limite 1e-9 nelle rispettive unità native. La verifica conservativa L1 dei residui, se utilizzata, deve essere esplicitata e non confusa con la norma euclidea del cap.

La diagnosi locale U205 esplora al massimo quattro vicini per asse di B verso il polo originale e un vicino per verso/asse di C dal polo salvato, con massimo 4096 coppie. La formula di conservazione D2 ordina i vicini di C; non autorizza salti fuori dal vicinato. Si pubblicano esattamente before/after, rappresentazioni binary64, passi, certificati dei tre criteri e motivo della selezione. Un fallimento della ricerca finita non è una prova generale di impossibilità.

Gli altri 237 coefficienti del lato possono riusare il cap acquisito soltanto se è dimostrato che restano identici. L'applicabilità di un esito su una patch non estende il risultato a superficie, cucitura, regolarità, tangenza o costruzione nativa.

### Proposta locale concreta ottenuta

Due coppie valutate: quella salvata e un vicino. Il solo asse Z del polo 323/U205/riga V10, indice piatto 2470, viene spostato di un passo binary64 verso la sorgente: delta `1.4210854715202004e-14 mm`. X/Y, il polo di bordo A e il secondo polo C rimangono invariati. Coordinate before/after e bit esatti sono salvati nella patch privata separata, SHA-256 `8e8017b33ffa243de2dac3b8aa042c160430205be425243cdb0a3d84bc5aaf0e`, 3.607 byte. **La patch non è applicata.**

| Certificato locale della patch | Risultato |
|---|---|
| Norma euclidea della variazione D1 memorizzata | `[4.99999999999992, 4.999999999999921] mm/V` |
| Margine quadratico esatto `25-norma²` | `1615916588480297/2028240960365170645274427025 > 0` |
| Fedeltà D1 al target T6b, upper L1 | `8.160670372482024e-13 mm/V`, entro 1e-9 |
| Variazione D2 rispetto alla sorgente, upper L1 | `2.2737367544323167e-10 mm/V²`, entro 1e-9 |

Il D2 passa da zero esatto locale a un valore non nullo entro tolleranza. Il cap non riceve alcuno slack. La composizione con i 237 coefficienti invariati sarebbe valida soltanto dopo applicazione esatta di questa patch a un artefatto distinto e verifica della sua identità. Il candidato 1 continua a contenere il suo coefficiente fuori limite. La patch dimostra una realizzazione locale possibile del cap; non è una soluzione al problema dei target e non qualifica un futuro candidato corretto.

## Criteri invariati

| Criterio | Soglia e riferimento |
|---|---|
| Target meno base del bundle, ogni coefficiente | Norma euclidea <=5 mm/native-V |
| Derivata memorizzata meno derivata sorgente esatta, ogni coefficiente | Norma euclidea <=5 mm/native-V, confronto esatto senza epsilon |
| Fedeltà D1 al target applicato | <=1e-9 mm/native-V; norma dichiarata, separata dal cap |
| Variazione D2 alla giunzione rispetto alla sorgente | <=1e-9 mm/native-V² |
| Posizione giunzioni 74 e 75 | Gap continuo <=1e-6 mm |
| Corda tangente / corda normale delle giunzioni | <=1e-10 / <=1e-4, con norme non nulle e prodotti scalari positivi |
| Scala trasversa lambda | >=0,0625; denominatore positivo nella definizione acquisita |
| Velocità nativa tangente / trasversa | >=1e-8 mm/native-U / >=1e-8 mm/native-V |
| Regolarità supporti 321, 322, 323 | `||Su cross Sv||>0` su tutte le celle native chiuse |
| Orientazione relativa dei supporti | Prodotto delle normali sorgente/candidato strettamente positivo su tutte le celle |
| Cuciture U di 321, 322, 323 | Chiusura di posizione; salto assoluto e variazione del salto firmato <=1e-9 mm/native-U; corda normale <=1e-4, per tutto V e sui due limiti unilateri |
| Spostamento continuo della superficie | <=0,05 mm rispetto alla sorgente originale, a parametri corrispondenti |
| Spostamento continuo delle curve di cucitura | <=0,05 mm rispetto alle curve sorgenti; verifica distinta |
| Movimento dei poli | Quantità descrittiva, senza applicazione automatica della soglia 0,05 mm |
| Due residui normali del contratto storico | <=1e-3 mm/native-V sui campioni e sulle mappe espliciti |

Il solo incremento candidato corretto meno candidato 1 non sostituisce lo spostamento totale dalla sorgente. Le magnitudini native non sono rimpiazzate da grandezze normalizzate. La scala è `lambda=((T_laterale cross M) dot (T_laterale cross R))/||T_laterale cross R||²`. Regolarità dei supporti, orientazione relativa e orientazione topologica nativa restano verifiche distinte.

Un upper oltre soglia resta inconclusivo, salvo un testimone valido. Un margine esatto negativo del cap per coefficiente dimostra la relativa violazione; per un criterio sul campo serve una valutazione puntuale certificata con i prerequisiti pertinenti. Un coefficiente Bernstein negativo del polinomio di margine, da solo, resta inconclusivo. Gli esiti devono riferirsi a un candidato specifico e mantenere separate evidenze continue e campionate.

## Proposta concreta dopo l'incompatibilità dei target

**Il contratto stretto è escluso da entrambe le nuove prove.** La proposta è introdurre nuovi target T2 in un artefatto distinto, mantenendo T6b come riferimento immutabile e registrando ogni scostamento `T2−T6b`. Questo è un cambiamento sostanziale del problema numerico: non viene applicato automaticamente nel mandato di diagnosi.

Le variabili geometriche resterebbero limitate alle medesime due righe per laterale. Nessun cambiamento di supporti protetti, bordi, grado, nodi o frame è incluso. La fedeltà D1 <=1e-9 sarebbe applicata alla realizzazione del nuovo T2; lo scostamento da T6b diventerebbe una grandezza distinta da minimizzare e dichiarare, non una tolleranza nascosta. Occorre riportare la correzione minima necessaria dimostrata dai testimoni e richiedere una nuova fattibilità globale: il loro superamento locale è necessario ma non sufficiente.

### Formulazione proposta e conseguenze

1. Le variabili del nuovo problema sono i 238 vettori inward T2 per ciascuna delle due laterali, con la stessa base U. La geometria ammette soltanto B/C nelle righe già autorizzate. Il riferimento rimane T6b. Nessuna riga protetta viene aggiunta ai gradi di libertà.
2. Obiettivo primario: minimizzare `tau=max(lato,u)||T2[lato,u]-T6b[lato,u]||`. Fra soluzioni equivalenti, minimizzare la somma dei quadrati delle deviazioni. Pubblicare per entrambi i lati tau, tutte le deviazioni e le componenti effettive. Il lower necessario sul campo derivativo realizzato resta quello dei testimoni; la fedeltà di realizzazione 1e-9 può ridurre di al massimo tale quantità il lower necessario sul target T2. Non si fissa arbitrariamente una deformazione in millimetri della superficie.
3. Imporre separatamente il cap target rispetto alla base del bundle e il cap della derivata realizzata rispetto alla sorgente esatta. Le direzioni normali devono soddisfare la corda e la concordanza su tutto s; lambda, D2, cuciture, regolarità, orientazione e spostamenti conservano i criteri della tabella. L'eventuale ottimizzazione su un insieme finito di parametri produce solo una proposta: il certificatore continuo deve coprire l'intero dominio e localizzare eventuali celle da correggere.
4. Congelare e hashare T2 prima della realizzazione nei poli. Non definire T2 a posteriori dai poli per rendere tautologica la fedeltà D1. Realizzare B/C con una ricerca dichiarata sui numeri binary64, verificando i confronti esatti dopo arrotondamento. La proposta U205 dimostra il principio su T6b ma non prequalifica i nuovi coefficienti T2, che richiedono proprie evidenze. Un margine interno scelto per rendere salvabili i poli non modifica la soglia normativa 5.
5. Conservare un nuovo risultato di fattibilità: un artefatto che soddisfi tutti i criteri con evidenze applicabili, oppure un conflitto quantificato. Il mancato successo di un ottimizzatore o di un vicinato finito non dimostra impossibilità globale. Nessun candidato può passare al nativo con criteri fuori limite o inconclusivi.

La conseguenza principale è che il candidato corretto non riprodurrà più i target 6b entro 1e-9: quella proprietà è dimostrata incompatibile. Manterrà invece la fedeltà di realizzazione al nuovo T2, se questa proposta viene adottata. Il cap 5 mm/V, i requisiti angolari/dimensionali, il reticolo, i supporti e le protezioni restano invariati. Non è dimostrato che esista una soluzione con queste restanti condizioni: la nuova fase dovrà accertarlo. La proposta non riapre il solve consumato e non sovrascrive il bundle originale.

La nuova prova tangente 74 soddisfa il criterio sui bordi protetti; non è quindi emersa una necessità di cambiarli. Qualsiasi futura richiesta di modificare bordo, rappresentazione o requisito dovrà avere una nuova incompatibilità dimostrata e una proposta propria, senza dedurla dal solo fallimento di una ricerca.

## Artefatto successivo e gate nativo

Un eventuale candidato corretto dovrà avere nuovo identificatore e hash, manifest di tutti gli input, target applicati distinti dal riferimento, delta completi dei poli salvati, curve delle cuciture coerenti e nuovi preflight/marker/ricevute. Gli input disponibili sono già vincolati per hash nel nuovo manifest; T2 e candidato corretto non esistono ancora e i loro hash non vengono inventati. [correction-contract.json](evidence/candidate-diagnosis-20261110/correction-contract.json) registra questi stati in forma strutturata.

Per ogni prova riutilizzata occorrono identità dei coefficienti/basi/parametri pertinenti oppure una dimostrazione di stabilità quantitativa applicabile. Le prove necessarie comprendono cap per tutti i coefficienti; residui D1/D2; tangenza continua delle giunzioni; supporti, orientazione e cuciture; spostamenti; residui campionati del relativo contratto. Il successivo contratto nativo resta distinto, con supporti, curve 3D e pcurve coerenti, e può iniziare solo dopo esito favorevole di tutti i criteri richiesti.

Il supporto 322 immutato e i bordi protetti consentono riusi limitati dopo le verifiche di identità. Le prove sulle superfici modificate, sui normali di giunzione e sui residui storici non passano automaticamente a T2. Le due curve 3D delle cuciture dovranno derivare dai nuovi poli U0 e usare le rispettive due pcurve, range, vertici e orientazioni coerenti.

Il futuro contratto nativo conserva gap curva/superficie <=1e-7 mm, corda direzionale nativo/modello <=1e-8, corda normale delle giunzioni <=1e-4 e la catena `Su*u'(t)+Sv*v'(t)`. Le osservazioni native campionate restano distinte dalle prove continue coefficientali. Il precedente STOP `reopened-own-support-mismatch` e i suoi marker rimangono conservati.

## Limiti operativi

Nessuna modifica al CAD live, aggiornamento host/kernel/MCP o merge. Candidato 1, bundle originale, WIP, STOP e marker restano congelati. Le bande dimensionali mancanti del Tubo completo non bloccano la presente diagnosi. Nessun esito locale costituisce accettazione del Tubo completo.
