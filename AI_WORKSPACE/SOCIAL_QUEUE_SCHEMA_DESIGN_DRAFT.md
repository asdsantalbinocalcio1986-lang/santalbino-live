# Design draft — coda editoriale social server-side

**Stato:** proposta tecnica non approvata, non implementata. Basata sull'inventario Supabase read-only del 25 novembre 2026 e sull'audit PR #106/#107. Non è una migration pronta per l'applicazione.

## 1. Confine con il sistema esistente
La tabella live `public.santalbino_social_publications` esiste, RLS è attiva, il controllo restituisce 0 righe. Campi verificati: `event_id` (UNIQUE), `match_id`, `event_type` con vincolo limitato a goal/red/halftime/fulltime, caption, image_url, platforms JSONB, overall_status (processing/published/partial/failed), stati Facebook/Instagram (pending/processing/published/failed/skipped), ID post/container, errori e timestamp.

**Conclusione:** è un registro di pubblicazione per eventi live, non una coda editoriale. Non estenderla in modo implicito a MATCH DAY/convocati/formazioni/post-partita: il vincolo event_type e l'unicità event_id riflettono il modello eventi live. Non sovrapporre una seconda tabella di log agli esiti già registrati.

La Edge Function `santalive-social-publish` è attiva v2 e richiede JWT. Il job pg_cron esistente `santalbino-publish-scheduled-content` è dedicato allo slot di pubblicazione della pagina live, non alla consegna Meta.

## 2. Architettura proposta
- **Editorial queue:** conserva contenuto, approvazione, schedule e stato del lavoro.
- **Per-platform delivery:** conserva stato/ID/errore per ciascun canale e ciascuna revisione.
- **Publisher unico:** riutilizzare l'Edge Function esistente come adapter Meta, dopo hardening e solo tramite chiamata interna autenticata server-side. Non creare un secondo client Meta.
- **Mock adapter:** in test l'unico adapter ammesso è un mock locale/fake; fail closed se environment non è esplicitamente `test`.

## 3. Modello dati concettuale (da validare con schema completo e RLS)
### `santalbino_editorial_posts`
- `id` UUID PK
- `match_id` text nullable (identificatore partita; valutare FK/identità già esistente)
- `content_type` enum/check: match_day, convocati, formation, post_match, club_notice
- `revision` integer, unique per contenuto logico
- `status`: draft, pending_approval, approved, scheduled, publishing, published, partial, failed, unknown, cancelled
- `caption_snapshot` text; `asset_path_snapshot` text nullable; `asset_sha256` text nullable
- `platforms_snapshot` JSONB (solo piattaforme approvate)
- `scheduled_at` timestamptz nullable; `timezone` text default Europe/Rome
- `created_by`, `approved_by` UUID; `created_at`, `approved_at`, `updated_at`
- `idempotency_key` text unique, calcolata per revisione approvata
- `claimed_at`, `lease_until`, `claim_token` nullable; `attempt_count` integer
- `last_error_code` text nullable; `last_error_safe` text nullable
- `published_at` timestamptz nullable; `cancelled_at` timestamptz nullable
- `snapshot_hash` text NOT NULL; il server deve calcolarlo/verificarlo sui byte/contenuti effettivi, non fidarsi di un hash client dichiarato.

### `santalbino_editorial_deliveries`
Una riga per post/revisione/piattaforma:
- `id` UUID PK; `post_id` UUID FK; `platform` facebook|instagram
- `status`: pending, processing, published, failed, skipped, unknown
- `idempotency_key` unique per post/revisione/piattaforma
- `external_container_id`, `external_post_id` nullable
- `attempt_count`, `last_attempt_at`, `published_at`
- `error_code`, `error_safe` nullable
- UNIQUE(post_id, platform)

### `santalbino_editorial_audit` (facoltativa, da valutare)
Event log append-only: actor, action, post_id, revision, timestamp, metadata sanificati. Evitare di replicare risposte Meta grezze o segreti.

## 4. State machine e invarianti
`draft → pending_approval → approved → scheduled → publishing → published | partial | failed | unknown`
- `cancelled` consentito solo prima del claim del worker.
- Una modifica dopo approvazione crea una nuova revisione e richiede nuova approvazione.
- Snapshot approvata immutabile: caption, asset, hash, piattaforme, schedule e riferimenti partita.
- Facebook e Instagram hanno delivery indipendenti. Successo di una piattaforma non deve essere ripetuto se l'altra fallisce.
- Timeout dopo richiesta esterna = `unknown`, non retry automatico. Riconciliazione amministrativa tramite verifica dell'esistenza del post; poi mark published o autorizzazione retry.
- `failed` solo per errore certamente non pubblicato e non recuperabile; retry controllato per errore transitorio certo.
- Un contenuto pubblicato non può essere riaperto o sovrascritto: correzione = nuova revisione.

## 5. Claim e scheduler
- RPC server-side transazionale seleziona job eleggibili con `FOR UPDATE SKIP LOCKED` o claim atomico equivalente.
- Imposta `claim_token`, `claimed_at`, `lease_until`, incrementa attempt e passa a publishing.
- Il worker deve possedere il claim token per aggiornare lo stato; un worker scaduto non può sovrascrivere l'esito di un worker successivo.
- Lease e heartbeat devono essere dimensionati sul timeout massimo Meta; recupero automatico della lease scaduta solo se non c'è un esito esterno ambiguo.
- Scheduler server-side, browser-independent. Prima di scegliere pg_cron + HTTP, verificare supporto e gestione sicura delle credenziali; non riutilizzare il cron esistente della pagina live.
- Kill switch server-side globale e per piattaforma/content type. Default OFF in ogni nuovo ambiente.

## 6. Sicurezza e RLS
- Solo admin autenticato può creare/aggiornare bozze, approvare e cancellare prima del claim.
- Worker/service role opera esclusivamente server-side; nessuna chiave service role nel browser.
- Utenti pubblici non possono leggere bozze, caption private, errori o stato della coda.
- RLS e grants devono essere verificati da test anon/authenticated/admin, non solo dedotti dalla UI.
- Verificare il ruolo approvatore e impedire approvazione da identità non autorizzata.
- Validare allowlist piattaforme, content type, URL Storage e MIME/dimensioni degli asset.
- Nessun secret o token Meta nei log, nella UI o nelle risposte client.
- `?test=1` non è un confine di sicurezza. Test in progetto Supabase separato/locale e publisher mock; non installare schema sperimentale sul progetto live.

## 7. Compatibilità e migrazione
1. Non modificare la tabella `santalbino_social_publications` finché non è completato l'audit di funzioni, indici, trigger, RLS e chiamanti.
2. Conservare il registro esistente per eventi live; la nuova coda editoriale orchestra i contenuti editoriali.
3. Riutilizzare il publisher solo dopo che il suo contratto supporta un input approvato/snapshot e idempotenza per piattaforma.
4. Definire come il nuovo delivery log si collega ai log esistenti senza doppio conteggio. Possibile collegamento tramite correlation_id, ma da decidere dopo l'audit.
5. Migrazione reversibile, feature flag OFF, nessun backfill dei vecchi eventi senza una specifica.
6. Prima release: MATCH DAY, convocati, formazioni, post-partita solo approvazione umana; nessun auto-post editoriale senza decisione separata.

## 8. Acceptance tests
- Q-01: bozza non invia nulla.
- Q-02: approvazione crea snapshot immutabile e registra approvatore.
- Q-03: due worker concorrenti acquisiscono un job una sola volta.
- Q-04: claim scaduto non consente aggiornamenti da worker obsoleto.
- Q-05: FB success + IG failure → retry solo IG.
- Q-06: timeout ambiguo → unknown, nessun retry cieco.
- Q-07: retry idempotente non duplica un post già pubblicato.
- Q-08: modifica dopo approvazione richiede nuova revisione/approvazione.
- Q-09: annullamento prima del claim impedisce l'invio; dopo il claim non è garantito.
- Q-10: kill switch OFF e test mode bloccano ogni chiamata reale.
- Q-11: browser/telefono chiusi non impediscono lo scheduling.
- Q-12: timezone Europe/Rome corretto su DST.
- Q-13: utenti anonimi/non admin non leggono né modificano la coda.
- Q-14: segreti assenti o invalidi producono fail-closed senza leak.
- Q-15: eventi live già funzionanti conservano comportamento invariato.

## 9. Gate prima di implementare
- Audit completo di schema, funzioni SQL, RLS, Edge Function, invocazioni e cron.
- Risolvere i finding PM-01/PM-02 e i finding publisher su idempotenza/timeout.
- Completare merge di #106/#107 solo dopo revisione combinata e autorizzazione; mantenere i test esistenti.
- Definire ambiente Supabase separato per test.
- Approvazione esplicita della specifica e del piano di rilascio.
