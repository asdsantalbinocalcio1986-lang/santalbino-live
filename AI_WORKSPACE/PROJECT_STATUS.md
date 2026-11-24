# SANTALive — project status and fixed guardrails

Last verified context: 2026-11-24. This is a coordination snapshot, not a substitute for a fresh repository/database audit.

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
