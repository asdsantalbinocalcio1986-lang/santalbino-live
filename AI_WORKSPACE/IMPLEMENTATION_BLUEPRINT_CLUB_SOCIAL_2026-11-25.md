# Blueprint di implementazione — identità club, hashtag partita e pubblicazione editoriale

**Stato:** specifica di lavoro consolidata, non approvata per il rilascio e non implementata. Raccoglie i precedenti audit hashtag/logo, social queue, publisher Meta e sincronizzazione SQL.

## Obiettivi e confini
1. Il club ha un'identità persistente: logo canonico e nome breve.
2. Ogni partita ha hashtag automatico, modificabile manualmente e riutilizzato senza duplicazioni.
3. I contenuti editoriali possono essere creati, revisionati, approvati e programmati; il browser non deve rimanere aperto.
4. La pubblicazione Meta deve essere sicura rispetto a concorrenza, retry e timeout ambigui.
5. Le gare live e la sincronizzazione esistente non devono regredire.

## Fase A — modello identità club e match

### Configurazione club
Proprietà concettuali:
- `club_id` stabile (es. `santalbino`);
- `club_name` canonico;
- `club_short_name` (Sant'Albino);
- `club_logo_path` (Storage path, non base64 o URL temporaneo);
- `club_logo_updated_at`, `updated_by`.
Configurazione unica a livello club, non replicata su ogni partita. Accesso modifica solo admin; lettura pubblica solo per asset destinati alla pagina pubblica.

### Partita
- `match_id/pollId` stabile;
- `home`, `away`, `ourSide`;
- `hashtag`;
- `hashtagSource = auto | manual`;
- `hashtagGeneratedFrom` o fingerprint del nome avversario;
- `stateSchemaVersion`.
Non rinominare/rigenerare il pollId esistente in questa fase.

### Algoritmo hashtag
- Prefisso fisso `#SantAlbino`.
- Suffisso da nome avversario normalizzato Unicode NFD, segni diacritici rimossi, lettere/numeri mantenuti, spazi e punteggiatura rimossi.
- Esempio `Radicofani` → `#SantAlbinoRadicofani`.
- Prefissi societari generici (ASD, USD, A.S.D.) rimossi solo se configurati e senza rimuovere parole distintive.
- Avversario vuoto → fallback esplicito `#SantAlbinoPartita`.
- Se source=auto e cambia l'avversario, rigenerare; se source=manual, conservare il testo.
- Un solo helper compone/deduplica gli hashtag nel testo, anche se il body contiene già il token.
- Generare al create/save match, non durante la renderizzazione; persistere subito.

## Fase B — risoluzione logo
- Helper unico `logoForSide(side, match)`: restituisce il logo club se side=ourSide; altrimenti il logo avversario associato al match.
- Tutti i renderer e badge devono smettere di leggere direttamente `S.logos.home/away`.
- Il logo avversario resta specifico della partita; non sovrascrivere il logo club.
- Migrazione compatibile: se `club_logo_path` è vuoto, proporre all'admin una migrazione del logo nello slot `ourSide`; non assumere in automatico quale asset sia corretto se il match storico non è coerente.
- `resetMatch()` conserva la configurazione club e cancella/azzera solo i dati specifici della partita secondo regola esplicita.
- Upload, sostituzione e rimozione logo club admin-only; test mode non può modificare la configurazione ufficiale.

## Fase C — coda editoriale

### Tabelle concettuali
- `santalbino_editorial_posts`: contenuto logico, revisioni, snapshot approvato, schedule, stato generale, autore/approvatore.
- `santalbino_editorial_deliveries`: una riga per post/revisione/piattaforma, stati, attempt, ID esterno, errore sanificato.
- audit append-only per chi/che cosa/quando, se necessario.
Non estendere la tabella `santalbino_social_publications` per farle contenere bozze editoriali: è il registro per eventi live.

### Stati
`draft → pending_approval → approved → scheduled → publishing → published | partial | failed | unknown`
- `cancelled` solo prima del claim.
- Modifica dopo approvazione = nuova revisione e nuova approvazione.
- Snapshot approvato immutabile.
- Facebook e Instagram indipendenti.
- Timeout ambiguo = unknown + riconciliazione; mai retry cieco.

### Worker
- Claim transazionale con lock/lease e token proprietario.
- Aggiornamenti accettati solo dal claim token corrente.
- Idempotency key univoca per revisione/piattaforma.
- Retry solo quando è certo che il post non sia stato creato.
- Kill switch server-side globale e per piattaforma; default OFF.
- Browser chiuso non interrompe la programmazione.
- Timezone Europe/Rome, gestione DST.

## Fase D — publisher Meta hardening
Bloccanti già documentati:
- PUB-01 claim non atomico;
- PUB-02 timeout esterno classificato failed anziché unknown;
- PUB-03 assenza garanzia idempotenza esterna;
- SC-01 bozza client-only;
- SC-03 hashtag duplicabile.
Prima di riutilizzare il publisher: test mock di richieste concorrenti, risposta persa dopo successo, FB success/IG fail, retry, stale lease, segreti assenti e kill switch.
L'Edge Function attuale accetta solo goal/red/halftime/fulltime: estendere il contratto con allowlist editoriale e snapshot approvato solo dopo test.
Non chiamare l'azione status durante test isolati: contatta Graph API.

## Fase E — ambiente e sincronizzazione
- Conservare le RPC `save_santalbino_live_state` e `save_santalbino_test_state` con optimistic concurrency 40001.
- Aggiungere `stateSchemaVersion` e validazione backward-compatible.
- Ambiente di test preferito: Supabase locale/progetto separato, Storage separato, mock Meta.
- `?test=1` e tabella separata nello stesso progetto non sono confine di sicurezza.
- Il cron attuale aggiorna pagina live e pagina test; non è scheduler Meta. Non riutilizzarlo per coda social.
- Test locali per RLS, Realtime, refresh, riconnessione, recovery bozza e conflitti due sessioni.

## Ordine raccomandato
1. Creare test harness isolato e test di regressione per live sync.
2. Implementare schema versionato e modello clubLogo/hashtag con migrazione compatibile.
3. Centralizzare i renderer con `logoForSide`; aggiungere i test TAG/LOGO.
4. Risolvere publisher claim/unknown/idempotency su mock.
5. Implementare la coda editoriale e approvazione.
6. Programmazione server-side, kill switch e osservabilità.
7. Revisione indipendente Claude e Gemini, test end-to-end su ambiente separato.
8. Approvazione utente prima di qualsiasi merge, migration live o deploy.

## Acceptance suite aggiuntiva
- SYNC-01: due admin salvano contemporaneamente; uno riceve 40001, nessuna sovrascrittura silenziosa.
- SYNC-02: Realtime e refresh convergono alla stessa revisione.
- SYNC-03: local draft prod e test hanno chiavi separate.
- SYNC-04: test schedule non modifica il contenuto live e viceversa.
- CLUB-01: logo club rimane identico cambiando home/away e creando nuova partita.
- CLUB-02: logo avversario non viene mai sovrascritto dal logo club.
- CLUB-03: test mode non può caricare/modificare asset ufficiali.
- TAG-01..06 e LOGO-01..09 come definiti in `HASHTAG_AND_CLUB_LOGO_AUDIT_2026-11-25.md`.
- QUEUE-01..15 come definiti in `SOCIAL_QUEUE_SCHEMA_DESIGN_DRAFT.md`.
- PUB-01..08 come definiti in `PUBLISHER_LIVE_CONTRACT_AUDIT_2026-11-25.md`.

## Stato del lavoro
Questa blueprint è un documento consolidato, non codice eseguibile e non autorizzazione al rilascio. Nessun cambiamento a produzione è stato eseguito.
