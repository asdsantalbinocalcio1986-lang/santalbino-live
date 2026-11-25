# SANTALive — project status and fixed guardrails

Last verified context: 2026-11-25 (read-only repository and Supabase checks). This is a coordination snapshot, not a substitute for a fresh repository/database audit.

## Project architecture

- Repository: `asdsantalbinocalcio1986-lang/santalbino-live`
- Production branch: `main`
- Frontend hosting: GitHub Pages
- Backend: Supabase
- Production app: https://asdsantalbinocalcio1986-lang.github.io/santalbino-live/
- Live control room: https://asdsantalbinocalcio1986-lang.github.io/santalbino-live/regia.html
- Test control room: https://asdsantalbinocalcio1986-lang.github.io/santalbino-live/regia.html?test=1
- Supabase production project ref: `iedjwctzdvinapwsbwua`
- Important: `?test=1` uses `live_test_state` in the same Supabase project as production. It is not a separate database and is only partial isolation.
- The other known Supabase project `djqcxqsruouoiwdqnouj` is not the test environment.

## Existing verified application features (repository audit already performed)

- FULL TIME updates match phase to `ft` and sets `finishedAt`.
- `buildMatchSummary()` builds a summary using match events and related match data.
- `renderMatchResultGraphic()` creates the result graphic.
- `openMatchResult()` presents the graphic and editable text, with copy/share options.
- Existing social publisher: Supabase Edge Function `santalive-social-publish`, supporting Facebook and Instagram.
- Publication log table: `santalbino_social_publications`.
- `addEvent()` calls `autoPublishSocialEvent(ev)`; FULL TIME is among auto-publish event types, subject to configuration.
- A pg_cron scheduling migration exists in the repository, but its installation and active configuration in the effective Supabase project have not been verified.
- The publisher has potential concurrency/idempotency and uncertain-outcome risks requiring audit.
- No ready-made internal notification flow for the post-match editorial process was identified in the repository audit.

These facts must be rechecked against the exact branch/commit before implementation. Repository code does not prove deployed database/function configuration.

## Fixed post-match requirements

- FULL TIME automation already in production must remain unchanged unless separately authorized.
- The new post-match summary is a distinct editorial flow and requires explicit human approval before any external publication.
- Summary minimum: result, teams, scorers and essential match information.
- Include dismissals when present. Bookings and other detail are optional.
- Never include the complete formation in the standard post-match message.
- The text must be editable before approval.
- Initial internal notifications go only to administrators/operators, not supporters.
- Every automation needs a usable manual alternative.
- No second Facebook publisher: reuse/adapt the existing publisher if technically safe.
- No automatic correction/republication after an already published post. Corrections require a new, explicitly approved revision.
- Web Push is excluded from the first release.
- Scheduling is deferred until a reliable backend scheduler independent of an operator browser is verified.
- MVP voting is out of scope: no candidates, votes, tally, proclamation, or historical voting data.
- No real social publication or supporter notification during testing.

## Safety and authorization boundaries

- Read-only repository/database audit is allowed for the current planning phase.
- No code implementation, schema migration, database write, production-data mutation, merge, deploy, real social publication, or notification is authorized by this status document.
- Existing general permission for technical corrective work does not override the current post-match gate: complete the audit and approve the implementation specification first.
- Tests must use a genuinely isolated test setup or a controlled demonstration. The `?test=1` parameter alone is not proof of isolation.


## Additional fixed product requirements — 2026-11-25

- On match creation, automatically generate and persist a match-specific hashtag (example `#SantAlbinoRadicofani`), reuse it in relevant social copy and avoid duplicates.
- Persist the club's own crest/logo as a club-level asset after one upload/selection. It must survive reloads and new matches and render on the correct side according to whether the club is home or away, independently of opponent identity.
- These are requirements for audit/specification first. They do not authorize production code, database, storage, merge or deploy changes.


## Read-only follow-up — 2026-11-25

- Current `main` commit remains the PR base `8166deeb4b70397af9b021b9420f93afdab2501f`; current `regia.html` blob SHA: `e1517806a0f6d49ebfd884600ebe7b5fe0058a64`.
- Hashtag generation from team names is not present in the inspected current-main save path; the editor saves the manual field. Several social/graphic builders already consume the stored hashtag. New-match reset currently retains the match object and hashtag.
- Club logo URLs persist in shared state and survive normal `resetMatch()`, but are stored by home/away position rather than club identity. Multiple renderers read these positional slots directly.
- Connected Supabase read-only checks confirm `santalbino-media` exists and is public; admin-only insert/update/delete policies use `is_santalbino_admin()`, while public read is allowed. Test-mode official media uploads are blocked in the client, but test mode is not a separate storage/backend project.
- PR #106 and #107 remain separate open Drafts and both modify `regia.html`; no merge/integration has been performed. PR #108 remains Draft with six documentation-only files.
- Detailed line references and acceptance matrix are in `POSTMATCH_PHASE1_DESIGN_DRAFT.md` section 11.
- No production code, schema, data, storage, external communication, merge or deploy was changed.


## Social automation audit — 2026-11-25

- Read-only audit completed against current `main` and connected Supabase project. Existing Meta publisher supports Facebook/Instagram for goal, red card, halftime and full-time events; automatic trigger remains disabled by default and requires admin/configuration gates.
- The active pg_cron job `santalbino-publish-scheduled-content` runs every minute but only moves scheduled `live_state` / `live_test_state` content to the live published slot. It does not publish to Meta.
- The live social publication log table exists and was empty at audit time; Edge Function `santalive-social-publish` is ACTIVE v2 with JWT verification. Meta secret values and account readiness were not inspected or tested.
- A dedicated editorial social queue/scheduler is not present in the current public table inventory. The current system needs publisher hardening (atomic claim, ambiguous-outcome handling, per-platform retry) before broadening automatic posting.
- Full findings, proposed workflow, release phases and acceptance tests: `AI_WORKSPACE/SOCIAL_AUTOMATION_AUDIT_2026-11-25.md`.
- No production code, database, storage, cron, secrets, social accounts, merges or deployments were changed.


## Integrazione PR e test publisher mock — 2026-11-25

- PR #106 e #107 sono entrambe open/Draft e risultano mergeable al controllo; condividono modifiche a `regia.html` e `.github/workflows/pages.yml`. Nessuna merge effettuata.
- Le descrizioni PR riportano CI #553 per #106 (PostgreSQL effimero, Supabase locale, browser E2E) e CI #563 per #107 (validazione e UI guard). Per #107 resta indicata una prova manuale browser dimostrativa.
- Preparato `AI_WORKSPACE/PR_INTEGRATION_AND_META_MOCK_TEST_PLAN_2026-11-25.md`: strategia branch combinato, gate di stop, test MOCK-01..MOCK-18 e incarico Claude non ancora inviato.
- La strategia non crea branch né modifica codice: merge a tre vie controllato solo dopo mappa conflitti e approvazione. Il publisher va testato con adapter Graph mock e blocco esplicito di ogni traffico esterno.
- Nessun codice, workflow, database, storage, cron, segreto, account social, merge o deploy è stato modificato.


## Revisione indipendente PR #106/#107 — 2026-11-25

- Confronto GitHub: entrambe le PR condividono la stessa base main `8166deeb4b70397af9b021b9420f93afdab2501f`; #106 è 58 commit ahead, #107 17 commit ahead, entrambe 0 behind. I due file sovrapposti restano `regia.html` e `.github/workflows/pages.yml`.
- Aggiunto audit indipendente `AI_WORKSPACE/INDEPENDENT_REVIEW_PR106_PR107_2026-11-25.md` con 5 finding post-match e 4 social-copy. Finding chiave: SHA-256 grafica non verificato server-side sui byte Storage; environment test/prod è solo namespace logico nello stesso progetto; bozze social #107 sono nello stato applicativo locale e non una coda server-side; popup Facebook con noopener può dare falso negativo; possibile hashtag duplicato.
- PR #106 non collega approvazione post-match al publisher Meta; PR #107 realizza condivisione manuale, non pubblicazione automatica né scheduling.
- Nessun codice modificato, branch d'integrazione creato, merge, deploy, modifica Supabase o invio social effettuato.


## Audit hashtag e logo club — 2026-11-25

- Audit read-only di `regia.html` main: `saveMatch()` salva il valore digitato in `#s-tag`, non genera un hashtag dall'avversario; i generatori di cronaca, convocati, formazioni e grafiche consumano già `S.match.hashtag`.
- Il modello loghi è posizionale `S.logos.home/away`; upload e persistenza condivisa esistono già, ma il logo del club non è ancora una proprietà canonica indipendente da casa/trasferta. `resetMatch()` non azzera esplicitamente `S.logos`.
- Creato `AI_WORKSPACE/HASHTAG_AND_CLUB_LOGO_AUDIT_2026-11-25.md` con finding, modello proposto e 17 test di accettazione.
- Nuovo controllo Supabase: `santalbino_social_publications` esiste, RLS attiva, 0 righe; contiene schema di log per eventi live (goal/red/halftime/fulltime), non una coda editoriale. Edge Function `santalive-social-publish` ACTIVE v2, JWT verification attiva. Migrations elencate fino a `scheduled_public_content` (2026-11-22).
- Creato `AI_WORKSPACE/SOCIAL_QUEUE_SCHEMA_DESIGN_DRAFT.md`: proposta separazione coda editoriale / delivery per piattaforma, snapshot immutabile, claim atomico, lease, stati unknown e kill switch. Non è migration pronta né approvata.
- PR #108 resta open/Draft/non merged al controllo; i due nuovi documenti sono nel branch `ai-workspace/bootstrap` e quindi nel perimetro della PR.
- Nessuna modifica a codice applicativo, schema/dati/storage/cron, segreti, account social, merge o deploy.


## Publisher live contract audit — 2026-11-25

- Verificata la sorgente Edge Function distribuita: identica byte-per-byte al file su main; nessuna invocazione e nessun contatto Meta.
- Confermati JWT + verifica admin lato server e gate `META_PUBLISH_ENABLED`.
- Nuovi finding bloccanti per l'estensione: PUB-01 claim non atomico (SELECT/UPDATE con finestra processing 120s), PUB-02 timeout/errore Meta sempre classificato failed anche se l'esito esterno può essere incerto, PUB-03 UNIQUE event_id evita righe duplicate ma non garantisce exactly-once esterno.
- Retry per piattaforma esiste parzialmente; resta il rischio di duplicati in caso di risposta Meta persa. Aggiungere claim RPC/lease e stato unknown/reconciliation_required prima di ampliare.
- L'azione `status` della Edge Function contatta Graph API: non è stata invocata durante audit.
- Policy live: social log con SELECT per admin autenticati; bucket `santalbino-media` pubblico, max 8 MiB, upload/update/delete admin-only. Migrazione cron conferma che il job pubblica soltanto il contenuto della pagina live.
- Creato `AI_WORKSPACE/PUBLISHER_LIVE_CONTRACT_AUDIT_2026-11-25.md`.
- Nessuna modifica a codice, schema, dati, storage, cron, segreti, account Meta, merge o deploy.
