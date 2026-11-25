# Audit publisher Meta live — contratto, concorrenza e RLS — 2026-11-25

## Perimetro
Confronto read-only fra codice Edge Function distribuito su Supabase e file `main`, catalogo PostgreSQL live, policy RLS e migration repository. La funzione non è stata invocata: nessuna chiamata Graph API, nessun post, nessun controllo account Meta. Nessun segreto è stato letto o riportato.

## Evidenze verificate
- Edge Function `santalive-social-publish`: ACTIVE v2, `verify_jwt=true`.
- Sorgente distribuita `index.ts` lunga 14.016 caratteri; confronto byte-per-byte con `supabase/functions/santalive-social-publish/index.ts` su `main`: **identica**.
- Tabella `public.santalbino_social_publications`: RLS attiva, 0 righe al controllo.
- Vincoli: PK `id`; UNIQUE `event_id`; `event_type` limitato a goal/red/halftime/fulltime; stati overall processing/published/partial/failed; stati piattaforma pending/processing/published/failed/skipped.
- Indici: PK, unique event_id, created_at DESC.
- Policy pubblica della tabella: solo SELECT per authenticated admin; nessuna policy anon/utente ordinario emersa nella query `pg_policies`. La Edge Function usa service role lato server dopo aver verificato il bearer JWT e la presenza dell'utente in `santalbino_admins`.
- Bucket `santalbino-media`: pubblico, limite 8 MiB. Policy Storage: upload/update/delete solo admin; lettura pubblica.
- La migration `20261122174518_scheduled_public_content.sql` crea `publish_santalbino_scheduled_content()` e cron ogni minuto, ma la funzione aggiorna solo `live_state` e `live_test_state` spostando publication.pending in publication.published. Non invia a Meta.

## Finding

### PUB-01 — Claim non atomico / race su stato processing — RISK, BLOCCA ampliamento
La funzione esegue SELECT per `event_id`, controlla `overall_status` e `updated_at`, poi esegue UPDATE o INSERT. Il controllo "processing da meno di 120 secondi" non è atomico con il successivo UPDATE. Due richieste simultanee possono entrambe leggere uno stato non processing/scaduto e proseguire; l'UNIQUE su event_id evita due righe, ma non impedisce due worker di elaborare la stessa riga. Il caso INSERT concorrente è gestito dal conflitto 23505; il caso UPDATE concorrente no.
**Azione:** RPC transazionale di claim/lease, lock riga e token proprietario. Il worker deve verificare il claim token su ogni aggiornamento. Non affidarsi a SELECT seguito da UPDATE condizionale non protetto.

### PUB-02 — Esito esterno ambiguo classificato failed — RISK, BLOCCA ampliamento
Facebook e Instagram sono chiamati dentro try/catch; qualunque errore diventa `failed`. Se Meta crea il post ma la risposta si perde/va in timeout, il database non sa se il post esista. Un successivo retry può creare un duplicato. Non esiste stato `unknown` o procedura di riconciliazione.
**Azione:** distinguere errore certo da esito incerto; stato `unknown/reconciliation_required`; non ripetere automaticamente un invio ambiguo. Salvare gli ID appena disponibili e fornire procedura admin di verifica.

### PUB-03 — Protezione duplicati non equivalente a idempotenza exactly-once — RISK
Il controllo `existing.overall_status === published` protegge il caso già concluso; `processing` usa una finestra temporale di 120 secondi; il vincolo UNIQUE su event_id impedisce righe duplicate ma non garantisce un solo effetto esterno. Non c'è una chiave idempotente Meta per piattaforma né un claim per singolo tentativo.
**Azione:** idempotency key per evento/revisione/piattaforma, claim atomico e riconciliazione.

### PUB-04 — Retry per piattaforma già parzialmente supportato — VERIFIED, ma insufficiente
La funzione conserva gli stati e gli ID Facebook/Instagram separatamente. Se una piattaforma risulta già `published`, il successivo tentativo la salta e prova l'altra. Instagram salva il container prima della pubblicazione, così può riutilizzare il container nei retry.
**Limite:** se la chiamata di publish è andata a buon fine ma la risposta si è persa prima di persistere l'ID, il sistema può marcare failed e ripetere un'operazione già avvenuta. Manca lo stato unknown.

### PUB-05 — Immagine validata su origine/percorso, MIME e dimensione — VERIFIED / LIMIT
La funzione accetta solo URL sulla stessa origine Supabase e sotto `/storage/v1/object/public/santalbino-media/social/`, esegue HEAD, verifica `image/*` e rifiuta dimensioni note superiori a 8 MiB. Se il server non restituisce Content-Length, il limite dimensionale non può essere confermato. Il controllo non restringe a un set MIME specifico.
**Azione:** download/stream controllato lato server o limite robusto; allowlist MIME e verifica effettiva dei byte. Nessun URL esterno accettato.

### PUB-06 — Autorizzazione amministratore lato server — VERIFIED
La funzione richiede bearer JWT, valida l'utente con `auth.getUser`, poi cerca lo stesso user ID in `santalbino_admins`. Rifiuta utenti non admin (403) e manca configurazione Supabase (503). `META_PUBLISH_ENABLED` è un gate server-side obbligatorio prima di publish. Il controllo è positivo, ma non sostituisce il claim atomico.

### PUB-07 — Azione status non è read-only locale — VERIFIED
`body.action === "status"` chiama Graph API per leggere la Pagina e l'account Instagram collegato. Per questo audit non è stata invocata. Non usare status come test innocuo se si vuole evitare qualsiasi contatto con Meta.

### PUB-08 — Log e risposte — LIMIT
Gli errori sono limitati a 500 caratteri e il page token viene oscurato quando passato a `safeError`. Restano da verificare tutti i percorsi di eccezione e la sanificazione di dati Graph; non inviare output raw a UI o log. CORS è `*`, ma la funzione richiede comunque JWT valido e admin; rivalutare allowlist CORS se la UI diventa multi-origin.

## Conseguenze per la coda editoriale
- Non riutilizzare il publisher per post editoriali programmati finché PUB-01/02/03 non sono risolti e testati.
- L'attuale tabella resta registro per eventi live; non ha stato unknown, lease, revisioni, approvazione o scheduled_at.
- La coda proposta in `SOCIAL_QUEUE_SCHEMA_DESIGN_DRAFT.md` deve introdurre un claim transazionale prima di invocare la funzione publisher.
- La funzione attuale accetta solo quattro eventType. Non è compatibile direttamente con match_day, convocati, formation o post_match: estensione del contratto solo dopo revisione e test mock.
- Il job cron della pagina live non deve essere usato come prova o base implicita per la programmazione Meta.

## Gate bloccanti
1. Implementare e testare claim atomico e lease.
2. Gestire esito incerto e riconciliazione senza retry cieco.
3. Test concorrenti reali su adapter mock (stesso eventId, due richieste; stale claim; timeout dopo creazione esterna).
4. Test separati Facebook/Instagram con successo parziale e retry.
5. Ambiente Supabase test separato/local, mock Meta fail-closed.
6. Conservare il comportamento corrente per eventi live fino a rilascio controllato e autorizzato.

## Limiti
Questo documento non è una review di codice eseguita da Claude o Gemini. È un audit tecnico read-only di ChatGPT basato sulla sorgente live e sul repository. Non dichiara che i finding siano stati corretti. Nessun test di rete verso Meta è stato eseguito.
