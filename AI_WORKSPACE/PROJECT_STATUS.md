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
