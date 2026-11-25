# SANTA Live — Social Publisher Hardening

Data: 25 novembre 2026  
Branch base: `integration/social-postmatch-2026-11-25`  
Stato: specifica tecnica e piano di implementazione; nessuna modifica al publisher distribuito.

## Obiettivo

Rendere sicura la pubblicazione automatica Facebook/Instagram prima di collegare account Meta o abilitare invii reali. Il lavoro deve essere sviluppato e verificato esclusivamente con test isolati e mock HTTP.

## Evidenze verificate sul codice Edge Function distribuito (slug `santalive-social-publish`, versione 2)

1. **Claim non atomico.** La funzione esegue SELECT per `event_id`, controlla `overall_status`/età di `processing`, poi UPDATE o INSERT. Il controllo e l'acquisizione non sono un'unica operazione transazionale. L'indice UNIQUE su `event_id` protegge l'INSERT concorrente, ma non il percorso UPDATE/riacquisizione.
2. **Lease implicita e takeover per età.** Uno stato `processing` viene considerato occupato per 120 secondi; dopo tale soglia un'altra richiesta può sovrascrivere lo stato e ripartire, anche se il primo worker è ancora attivo.
3. **Esito remoto ambiguo trattato come errore certo.** Gli errori di `fetch()` verso Meta impostano la piattaforma su `failed`. Un timeout/errore di rete può però verificarsi dopo che Meta ha accettato la richiesta; un retry può creare un duplicato.
4. **Retry non sufficientemente distinto.** I record non `published` possono essere aggiornati e riprocessati. Non esiste una fase esplicita di riconciliazione per un esito sconosciuto.
5. **Facebook e Instagram sono due operazioni remote indipendenti.** Il registro salva stati e ID per piattaforma, ma un esito parziale o perso durante la persistenza finale richiede riconciliazione prima di ripetere l'operazione.

Schema osservato su `public.santalbino_social_publications`: `event_id` è UNIQUE; sono presenti `overall_status`, `facebook_status`, `instagram_status`, `facebook_post_id`, `instagram_container_id`, `instagram_media_id`, errori per piattaforma e timestamp. La tabella distribuita non è stata modificata.

## Correzione richiesta

### A. Acquisizione atomica

- Introdurre una RPC PostgreSQL transazionale di claim per `event_id`, chiamata dalla Edge Function prima di qualsiasi richiesta Meta.
- La RPC deve creare o acquisire il record in un'unica transazione, con controllo della versione/lease e token di claim univoco.
- Solo il worker che possiede il token di claim può aggiornare lo stato o completare il tentativo.
- Un secondo worker deve ricevere un risultato esplicito `already_processing`/ `already_published`/ `reconciliation_required`, senza invocare Meta.
- Il recupero di lease scadute deve essere esplicito e conservativo: non riavviare automaticamente operazioni remote dall'esito incerto.

### B. Stati e riconciliazione

Separare gli stati per piattaforma almeno in:
- `pending`
- `processing`
- `published`
- `failed_retryable` (solo errore sicuramente avvenuto prima dell'accettazione remota)
- `unknown` (richiesta inviata ma risposta/riscontro non affidabile)
- `skipped`

Non trattare `unknown` come retry automatico. Prevedere riconciliazione mediante identificatori remoti già persistiti, endpoint di lettura Meta ove disponibili e/o revisione amministrativa. Se non è possibile determinare l'esito, mantenere il blocco e richiedere decisione manuale.

### C. Timeout e rete

- Usare `AbortSignal.timeout` o un timeout equivalente per ogni chiamata esterna, con timeout differenziati e documentati.
- Distinguere errori di validazione/risposta esplicita (eventualmente retryable) da timeout, connessione interrotta e risposta illeggibile (esito potenzialmente `unknown`).
- Non implementare retry ciechi su `media_publish` o creazione post Facebook.
- Persistire ogni identificatore remoto appena disponibile, prima di procedere allo step successivo.
- Se la persistenza di un ID fallisce dopo la risposta Meta, registrare/ritornare esito incerto e non ripetere automaticamente la creazione.

### D. Sicurezza e concorrenza

- Mantenere verifica JWT, verifica utente, controllo admin server-side e service role esclusivamente lato Edge Function.
- Non esporre segreti Meta o service role al client.
- Non cambiare `verify_jwt` e non introdurre endpoint pubblici.
- Limitare i log: mai token, URL con token, payload sensibili o messaggi grezzi Meta non sanitizzati.
- Validare input e piattaforme in modo server-side; mantenere separati gli esiti Facebook/Instagram.
- Considerare un worker concorrente e un crash tra ogni coppia di passaggi come scenari obbligatori.

## Test obbligatori (mock, senza rete Meta)

1. Due richieste simultanee per lo stesso `event_id`: un solo claim vince e una sola invocazione mock per piattaforma.
2. Claim occupato: la seconda richiesta non chiama il mock Meta.
3. Lease scaduta mentre il primo worker è ancora in corso: nessun takeover distruttivo; il vecchio token non può completare dopo la revoca.
4. Facebook pubblicato + Instagram fallito: retry/reconciliation non ripubblica Facebook.
5. Timeout dopo accettazione simulata da Meta: stato `unknown`, nessun retry automatico.
6. Risposta esplicita di rifiuto prima della creazione: stato `failed_retryable` solo se è dimostrabile che non è stato creato alcun contenuto.
7. Instagram container creato e ID persistito, poi crash: ripresa dal container, senza crearne un secondo.
8. Meta restituisce ID ma il salvataggio DB fallisce: nessun retry automatico della creazione.
9. Doppio completamento con claim token differente: il secondo update è rifiutato.
10. Token e credenziali assenti nei log e nelle risposte client.
11. Test modalità dry-run/mock: nessuna chiamata HTTP esterna.
12. Migrazioni applicate solo su Postgres locale effimero; test Edge Function su mock server.

## Sequenza di lavoro

1. Recuperare nel repository il sorgente versionato della funzione e confrontarlo con la versione distribuita; non copiare alla cieca il sorgente hosted.
2. Ispezionare constraint, RLS, grants, migration history e chiamanti prima di definire la RPC.
3. Preparare proposta SQL e implementazione Edge Function sul branch corrente.
4. Aggiungere test SQL di concorrenza e test Deno/mock HTTP.
5. Eseguire CI e revisione indipendente.
6. Aggiornare la PR con evidenze e limiti residui.

## Vincoli non negoziabili

- Nessuna modifica a `main`.
- Nessun deploy o modifica alla Edge Function hosted.
- Nessuna migration applicata al progetto Supabase reale.
- Nessuna lettura o modifica dei segreti.
- Non invocare la funzione hosted, neppure con `action=status`: il ramo status effettua una richiesta Graph API a Meta.
- Nessuna chiamata Graph API, collegamento account, pubblicazione o test con contenuti reali.
- Mantenere questa PR in Draft fino a completamento di tutti i test.
