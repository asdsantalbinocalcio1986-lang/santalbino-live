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


## Stato implementazione — 25 novembre 2026

È stata avviata l'implementazione sul branch dedicato della PR #110.

### Implementato nel branch
- Migration additiva con `claim_token`, `lease_expires_at`, stati `unknown`, `failed_retryable` e `reconciliation_required`.
- RPC `claim_santalbino_social_publication`: acquisizione transazionale su `event_id`, con lock della riga esistente; un claim attivo o un esito incerto blocca ogni nuovo invio.
- Le scritture del publisher sono condizionate al `claim_token`, così un worker con token obsoleto non può sovrascrivere lo stato.
- Timeout sulle richieste Graph; gli errori di rete, le risposte illeggibili e i 5xx sulle POST sono classificati `unknown`; le risposte 4xx esplicite sono `failed_retryable`.
- Persistenza dell'ID del container Instagram prima del polling; i retry riprendono il container già creato. Un container esplicitamente fallito viene scartato prima di un nuovo tentativo.
- Trasporto HTTP iniettabile e test Deno con risposte simulate, senza account o pagina Facebook di prova.
- Test SQL per claim ripetuto, retry dopo rifiuto certo, fencing del token obsoleto e blocco degli esiti incerti; agganciati al test harness Supabase locale effimero.

### Verifiche eseguite — 25 novembre 2026

Run GitHub Actions sul commit `2ea39f25d117236e61db572768421846bce47618`:
- **Validate application:** successo; include validazione progetto, guard UI social e test Deno con trasporto Meta simulato.
- **Post-match SQL integration tests (ephemeral PostgreSQL):** successo; migration social e hardening applicate, test permessi RPC/tabella, stati incerti, retry consentito, fencing del token, estensione piattaforme e claim concorrenti su due sessioni PostgreSQL.
- **Post-match integration tests (isolated local Supabase):** successo; stack Supabase locale usa-e-getta avviato, migration applicate, test Auth/RLS/Storage, lettura admin-only del registro social, invocazione RPC via PostgREST con service_role, secondo claim bloccato e test browser Playwright completati.
- **Deploy GitHub Pages:** skipped, come previsto per un branch di lavoro.

### Limiti residui e cautele
- I test Meta sono mock: nessuna chiamata Graph API, nessuna Pagina Facebook/account Instagram reale e nessuna pubblicazione effettiva. Non è stata verificata la risposta reale di Meta a un timeout dopo accettazione.
- I test Deno esercitano il trasporto Graph e la classificazione degli esiti; non costituiscono un collaudo end-to-end della funzione con Meta reale.
- La migrazione tratta i vecchi stati `failed` come `unknown`, perché la versione precedente non distingueva un rifiuto certo da un timeout ambiguo.
- Un record rimasto `processing` dopo un crash non viene riacquisito automaticamente, anche se la lease è scaduta. È intenzionale: prima occorre riconciliare l'esito remoto.
- La RPC usa `SECURITY INVOKER`, `search_path = ''` e grants limitati a `service_role`; il ruolo di servizio dispone già dei privilegi necessari sulla tabella.
- Nessun deploy, migrazione hosted, lettura/modifica dei segreti, invocazione della funzione hosted o chiamata Meta è stato eseguito.

### Procedura prudenziale per un esito incerto
1. Non premere nuovamente "Riprova invio": la UI nasconde il pulsante per gli stati incerti e il backend blocca comunque il claim.
2. Verificare manualmente la Pagina/account Meta e cercare il contenuto per evento, testo e orario.
3. Se il contenuto esiste, annotare l'ID remoto e riconciliare il registro senza ripubblicare.
4. Se non è possibile stabilire l'esito con certezza, lasciare il record bloccato e chiedere verifica tecnica. La scadenza della lease, da sola, non autorizza un nuovo invio.

**Gate prima di domenica:** revisione indipendente del SQL e del publisher, verifica finale dell'allineamento con il sorgente hosted e autorizzazione esplicita prima di installazione/attivazione. L'attivazione Meta e il primo invio reale restano passaggi separati.


