# Post-match phase 1 — design draft (not approved)

**Date:** 2026-11-25  
**Status:** Draft for technical review; not implementation authorization  
**Repository baseline:** `main` at `8166deeb4b70397af9b021b9420f93afdab2501f`  
**Related proposals:** PR #106 (`feat/postmatch-editorial-drafts`, head `a993d5bfcc282acfc849ab45084d570524d6725b`); PR #107 (`feat/social-copy-editor`, head `81cc441328b413aa79217fcf91079c0a28362bf1`); PR #108 (`ai-workspace/bootstrap`, head `960aecd36ada1842b8f1b50f9408aa17942e5120`).

This document records design work that can be done without changing application code, database schema, live data, external services or production. It is not approval to merge either feature PR or apply SQL.

## 1. Fixed product decisions

- Preserve the existing automatic FULL TIME flow unchanged.
- The new editorial post-match summary is a separate flow.
- A human administrator must explicitly approve the exact revision before external publication.
- The summary includes teams, final score, scorers and essential match information; include dismissals when present. Bookings and other details are optional.
- Never include the complete formation in the standard post-match message.
- Text remains editable before approval.
- Initial internal notifications are only for administrators/operators, never supporters.
- Every automation has a manual fallback.
- Reuse the existing Meta publisher if and only if its safety and idempotency can be established; do not create a second Facebook publisher.
- Corrections after publication create a new revision and require a new explicit approval. Never auto-correct or auto-republish.
- Web Push is out of phase 1.
- Scheduling is deferred until a backend scheduler independent of an operator browser is verified.
- MVP voting, candidates, votes, tallies, proclamation and voting history are completely out of scope.
- No real social post or supporter notification during tests.
- No implementation or database changes before the read-only audit and explicit owner approval of the resulting specification.

## 2. Verified repository facts (not live deployment claims)

At the recorded `main` baseline:
- The existing publisher is `supabase/functions/santalive-social-publish/index.ts`; it authenticates the caller, checks membership in `santalbino_admins`, checks `META_PUBLISH_ENABLED`, and accepts the existing event types goal/red/halftime/fulltime.
- Its publication ledger is `santalbino_social_publications`, with a unique `event_id`, per-platform statuses and external IDs.
- The publisher currently uses a read-then-write 120-second processing check. This is not an atomic claim/lease. Concurrent retries and ambiguous timeouts need a deeper idempotency review before reuse for a new editorial action.
- The existing scheduled-content migration runs a minute-level pg_cron job for `live_state` and `live_test_state`; repository presence does not prove the job is installed/enabled in the effective production project.
- PR #106 is an open Draft, not merged. It contains an editor, immutable content snapshots, JPEG storage, revision history and explicit editorial approval, plus a SQL proposal. Its own description states that `?test=1` shares the production Supabase project and is not a hard isolation boundary.
- PR #107 is an open Draft, not merged. It contains editable MATCH DAY and CONVOCATI copy with manual share flows. It reports automated checks passed, but manual browser testing remains.
- PR #106 and #107 both change `regia.html` from separate branches based on main. Do not merge them independently without rebasing/reconciling the shared file and rerunning the combined test suite.
- PR #108 is an open Draft documentation-only collaboration workspace.

These are Git repository facts. Effective Supabase schema, RLS, Edge Function deployment/version, secrets, cron job state and Meta configuration remain unverified unless separately evidenced by read-only live queries.

## 3. Proposed phase-1 user journey

1. FULL TIME occurs; the existing automation continues exactly as today.
2. An administrator opens the separate MATCH RESULT editorial workflow.
3. The application captures one immutable match snapshot and generates both the initial caption and image from that same snapshot.
4. The administrator edits the caption and previews the exact image.
5. Save creates a new draft revision. The saved caption, snapshot, image bytes and SHA-256 are tied together.
6. The administrator reopens the editor and sees the saved revision exactly as saved; no silent regeneration.
7. The administrator explicitly approves the displayed revision. Approval is editorial only and does not itself publish.
8. A separately authorized publish action may publish only that exact approved revision, through a safe, auditable path. If publisher safety cannot be proven, phase 1 falls back to manual download/copy/share and does not invoke automated Meta publishing.
9. The UI records per-channel outcomes and any uncertain result. It must not blindly retry an ambiguous Meta request.
10. A correction creates a new revision; the previous approved/published content and its audit trail remain available. A new approval is required before any corrected publication.

## 4. Required state model

Editorial revision states:
- `draft`: editable; not externally publishable.
- `approved`: exact content approved; immutable.
- `superseded`: retained for history; not publishable.

Publication attempt states (separate from editorial status):
- `not_requested`
- `queued` (only if a reliable backend queue is approved later)
- `processing` with a unique claim/lease and expiry
- `published` per channel, with provider object ID and timestamp
- `failed_retryable` only when provider outcome is known to be no post created
- `unknown` when the request may have succeeded but confirmation was lost; requires reconciliation, never blind retry
- `partial` when one channel succeeded and another did not

Do not conflate approval with publication. Do not represent an uncertain provider outcome as a definite failure.

## 5. Acceptance and safety test matrix

| Area | Required test | Pass condition |
|---|---|---|
| Summary content | Goals, own goals if represented, scorers, dismissals, score and teams | Correct facts; no full formation; no MVP data |
| Snapshot consistency | Change match state after opening editor | Caption/image/revision remain based on one captured state |
| Draft persistence | Save, close, reopen, reload | Exact caption and same image bytes/hash return |
| Revision history | Save multiple drafts and start a new match | Prior revisions remain accessible and correctly associated |
| Approval | Approve current draft; attempt stale approval | Exact expected revision only; stale request rejected |
| Immutability | Attempt to edit approved/superseded content | Rejected; correction creates a new revision |
| Authorization | Anonymous, ordinary authenticated user, admin | Only admin can read/create/approve/publish as specified |
| Storage | Guess URL, access another user's object, overwrite/delete referenced object | Private access; no overwrite/delete of referenced content |
| Test isolation | Exercise test mode and inspect backend target | Test cannot reach production tables, storage or Meta accounts |
| Publisher concurrency | Two simultaneous requests for same approved revision | One atomic claim; no duplicate external post |
| Publisher timeout | Provider accepts request but response is lost | State becomes unknown; no blind duplicate retry |
| Partial channel result | Facebook succeeds, Instagram fails (and reverse) | Per-channel outcomes retained; retry targets only safe channel |
| Bypass protection | Call publisher without approved revision / with modified caption | Server rejects; client-side checks are not trusted |
| FULL TIME regression | Run existing event test fixtures | Existing behavior and configuration unchanged |
| Manual fallback | Publisher unavailable or disabled | Admin can export/copy approved text and image without accidental post |
| Audit trail | Draft, approval, publish, retry, correction | Actor, time, revision, content hash and provider IDs recorded |

All integration/E2E tests must use disposable local services or a genuinely separate test project. The deployed `?test=1` mode is not proof of isolation. No test may send to real Meta accounts.

## 6. Technical review points for Claude and Gemini

1. Review the PR #106 SQL proposal for RLS, SECURITY DEFINER search paths, grants, race safety, status transitions, storage policies, orphan cleanup and migration ordering.
2. Verify whether approval should preserve the prior approved revision as `approved` rather than changing it to `superseded`; history semantics must not erase the fact that it was previously approved/published.
3. Verify that a revision's identity and publish eligibility are enforced server-side, not only by the browser.
4. Design an atomic idempotency/claim strategy for a *new editorial publish operation* without changing the existing FULL TIME path. Include the provider-accepted/response-lost case.
5. Confirm whether Meta APIs offer a reliable way to reconcile an ambiguous publish before retry. If not, require operator reconciliation.
6. Determine whether PR #106 and #107 can be combined safely and in what sequence; both modify `regia.html`.
7. Identify the minimum live read-only queries needed to verify deployed schema, RLS, function version, cron and environment separation. Mark unavailable facts UNKNOWN; do not infer from repository migrations.

## 7. Phase boundaries

**Phase 1 candidate:** durable editorial draft, exact snapshot/image, revision history, explicit approval, administrator-only internal indication, manual export/share fallback, audit trail, and tests in isolated infrastructure.

**Conditional / not assumed in phase 1:** automated Meta publication of the new approved summary. It is allowed only if the audit proves that server-side approval gating, atomic idempotency, per-channel outcome tracking and safe reconciliation can be implemented without altering the existing FULL TIME publisher behavior. Otherwise keep publication manual.

**Later:** backend scheduling, internal notification expansion, Web Push, analytics/metrics and any MVP-related work (MVP remains separately governed and is not part of this specification).

## 8. Go/no-go gates

- Gate A — read-only audit completed by Claude with evidence and explicit UNKNOWNs.
- Gate B — independent Gemini review identifies missed evidence, unsupported claims and security gaps.
- Gate C — ChatGPT reconciles findings and produces final technical specification.
- Gate D — project owner explicitly approves the phase-1 scope.
- Gate E — Claude implements on one isolated branch/PR; Gemini reviews read-only; ChatGPT checks diff, tests and regressions.
- Gate F — owner explicitly approves any merge/deploy. No automatic merge or production action.

Until Gate D, this draft supports planning and test design only.

## 9. Additional owner requirements — 2026-11-25

These two requirements apply across match creation, match persistence and social/editorial content. They are product requirements, not implementation authorization.

### 9.1 Automatic match hashtag

- When a new match is created, the application must automatically generate and store a match-specific hashtag.
- Example: Sant'Albino vs Radicofani produces `#SantAlbinoRadicofani`.
- Generate it deterministically from the two participating team names, using the club's canonical short name for Sant'Albino; remove spaces, punctuation and diacritics, and use stable capitalization.
- The hashtag must be available immediately after match creation and reused consistently in match-day, convocati and post-match social copy wherever a match hashtag is included.
- Do not append duplicate copies when a template already contains the hashtag.
- If the opponent/team names change after creation, regenerate the hashtag only while it is still system-generated; preserve an explicit administrator override if the product supports manual editing. The UI should make the generated value visible.
- Add acceptance tests for home/away ordering, accented names, punctuation, name changes, manual override and duplicate suppression.

### 9.2 Persistent club crest independent of home/away status

- The club's own team crest/logo must be uploaded or selected once and remain available across page reloads and newly created matches; the operator must not need to upload it again for every match.
- Store it as a persistent club-level asset/reference, not as a transient match-only image or browser-only state.
- The rendering logic must identify the club as "our team" independently of whether it is the home or away side.
- For each match, place/use the club crest on the correct home/away side based on the match's actual team assignment. Do not accidentally replace the club crest with the opponent's crest when home/away order changes.
- Keep the selected crest stable across match creation, editing, reload and switching between home and away fixtures. Provide an explicit replace/remove action for an administrator.
- Add acceptance tests: upload once → reload → create home match → create away match → verify the same club crest is retained and displayed on the correct side; verify opponent crest remains distinct; verify test mode cannot overwrite production assets.

### 9.3 Scope and safety

- These requirements must be reviewed against the existing logo persistence model, match data model, hashtag/social-copy builders and PR #106/#107 shared `regia.html` changes.
- Do not implement them in production as part of the audit. Claude and Gemini must assess current support, required changes, persistence/security implications and regression tests.


## 10. Preliminary implementation comparison against current `main`

Read-only inspection of `regia.html` at the current main ref (SHA `e1517806a0f6d49ebfd884600ebe7b5fe0058a64`) found:

- **Hashtag — partial / not compliant yet:** the application state has a default hashtag and the match editor saves the manually entered value (`S.match.hashtag = g('#s-tag')`). No automatic generation from home/away team names was identified in the inspected match-save path. Social event text appends the current hashtag; the convocati builder also uses it. The new requirement therefore needs automatic generation at match creation/save, normalization, duplicate prevention and consistent reuse in the #106/#107 builders.
- **Logo persistence — partial / identity model gap:** logo uploads use `uploadSharedImage(..., 'loghi', ...)`, store the resulting URL in `S.logos[side]`, and persist the application state through the existing shared state save flow. This means the URL can persist across sessions, but the model is keyed by the positional slots `home` and `away`, not by the club identity. The app therefore needs a canonical "our club logo" reference independent of `ourSide`, then a rendering adapter that places it on the correct home/away side for each match. Do not simply swap or overwrite opponent and club logo slots.
- **Persistence caveat:** current state persistence is the shared application state and public media bucket, not a dedicated club-profile record. Audit whether this is acceptable for one-club deployment, how it is protected from accidental replacement, and how reset/new-match operations preserve the club asset.
- **Test isolation:** the existing test-mode restrictions prevent official media upload from test mode; retain this protection and test it explicitly.

These are preliminary code observations, not a complete audit of all rendering paths. Claude/Gemini must verify all usages and line-level evidence before implementation.


## 11. Follow-up read-only audit — hashtag and club crest (2026-11-25)

Baseline: `main` commit `8166deeb4b70397af9b021b9420f93afdab2501f`; `regia.html` blob SHA `e1517806a0f6d49ebfd884600ebe7b5fe0058a64`. Findings below are repository evidence unless explicitly marked live Supabase.

### 11.1 Hashtag — confirmed gap

Evidence in current `regia.html`:
- Initial embedded state has a fixed `#SantAlbinoTerme` value (line 1357); runtime defaults use `#SANTALive` (line 1377). This creates two different defaults depending on state initialization.
- Match editor exposes an editable hashtag field (line 4400); `saveMatch()` copies it directly from `#s-tag` to `S.match.hashtag` (line 4823). No deterministic team-name generator is present in this save path.
- Existing event social text appends `S.match.hashtag` (line 1547); the convocati text builder uses it (around line 1601); formation text also appends it (around line 1633); the post-match summary footer includes it (around line 4032).
- Some share actions append the hashtag separately (around line 4688), so duplication must be tested at the composed output level, not only in individual templates.
- `resetMatch()` clears events, rosters, date/time and match-specific publication/chronicle fields but retains `S.match` and `S.logos` (line 4805). New-match flow therefore currently retains the previous match's hashtag unless the operator changes it.

Requirement interpretation:
- Generate the hashtag from the two team identities, not merely from whichever side is home. Canonicalize Sant'Albino to `SantAlbino`, then append the opponent's normalized name; use a deterministic rule for other pairings.
- Normalize Unicode diacritics, whitespace, punctuation and repeated separators; define stable casing and a safe fallback for empty/duplicate names.
- Track provenance (system-generated vs explicit manual override). A plain string cannot reliably tell whether an existing value is an override.
- On a team-name change, regenerate only system-generated values. Preserve explicit overrides.
- Use one composition helper that guarantees a single hashtag in each final text/graphic/share payload.

### 11.2 Club crest — persistence exists, identity is positional

Evidence in current `regia.html`:
- Runtime state stores `logos: { home: '', away: '' }` (line 1378), and state hydration/merge restores those two positional properties (lines 1398 and 2149).
- The settings UI labels and uploads one logo for each current home/away team (lines 4403–4405); upload stores the returned URL in `S.logos[side]` and commits the shared state (line 4857).
- `uploadSharedImage()` blocks all official media uploads in test mode, requires an authenticated administrator, uploads with `upsert: false`, and returns a public URL (lines 2010–2022).
- The media bucket is `santalbino-media` (line 1648). Live read-only Supabase query confirms it exists, is public, has an 8 MiB limit and allows JPEG/PNG/WebP. Storage object policies observed: authenticated Sant'Albino admins can INSERT/UPDATE/DELETE; public/anonymous and authenticated users can SELECT objects in this bucket.
- Several renderers read the positional logo slots directly: event/phase graphics (e.g. lines 2554, 2807), formation graphic (3032–3033), MATCH DAY graphic (3265), convocati graphics (3341 and 3402), UI badge helper (3550), and match result graphic (4042). This is a cross-cutting change, not a single-screen swap.
- `resetMatch()` does not clear `S.logos` (line 4805), so existing URLs persist across a normal new-match reset. This is positive evidence for persistence, but not proof of correct club identity after home/away changes.
- Test-mode state initializes test logos separately (lines 1386–1390), and the upload guard blocks writing to the official media bucket from test mode. However, `?test=1` uses a separate state table in the same Supabase project; it is not a separate storage/backend security boundary.

Confirmed conclusion:
- The existing media storage and shared-state mechanism can retain image URLs across reloads and normal match reset.
- The product requirement is **not fully met**: the application models logos by home/away slot, not by club identity. The operator must currently manage the two slots manually; the code does not establish that one canonical club crest follows Sant'Albino from home to away.
- A dedicated club-profile table is not automatically required. A canonical club-logo reference in the shared club configuration may be sufficient for this single-club application, provided it is admin-protected, persistent, and not reset with match state. Claude must compare the least-complex safe option with the existing architecture before proposing schema changes.
- Public read access to the bucket is expected for public graphics, but uploaded logos are not private. Admin-only write/delete policies and test-mode guard must remain intact.

### 11.3 Required regression matrix

| Scenario | Expected result |
|---|---|
| Sant'Albino home vs Radicofani | `#SantAlbinoRadicofani`; club crest on home side |
| Radicofani home vs Sant'Albino away | same canonical pair hashtag; club crest on away side |
| Opponent name contains accents/punctuation | normalized deterministic hashtag |
| Team name edited after creation | regenerate only system-generated hashtag |
| Admin manually overrides hashtag | override remains unchanged after save/reload |
| Generate event, convocati, formation and post-match copy | exactly one match hashtag in each final payload |
| Upload club crest once, reload, create home fixture | same crest retained on Sant'Albino |
| Create away fixture after home fixture | same crest follows Sant'Albino to away slot; opponent logo remains separate |
| Replace/remove club crest | only canonical club crest reference changes; opponent asset is untouched |
| Normal match reset | club-level crest remains; match-specific data is reset according to defined policy |
| Test mode upload attempt | official storage write rejected; production state/assets unchanged |
| Backup/export/import | documented behavior; no accidental loss or positional misassignment |

### 11.4 Additional review tasks for Claude/Gemini

1. Confirm all references listed above and inspect every `S.logos` use, including public HTML, canvas renderers, editor previews, archive/restore and backup/import paths.
2. Trace `resetMatch()`, `startNewMatch`, `saveMatch()`, `mergeState()`, state RPC and backup/import behavior; identify whether any path clears, overwrites or misassigns logos/hashtags.
3. Confirm all final social-text composition paths and hashtag duplication cases, including PR #106/#107 code paths.
4. Verify the live bucket policies and the exact admin predicate. Do not attempt upload/update/delete tests against production.
5. Recommend a minimal data model and migration/rollback only as a proposal. No code, SQL, storage, state, PR merge or deploy changes.
6. Add automated tests for pure normalization/generation and renderer mapping; specify isolated integration tests for persistence and test-mode separation.

### 11.5 Current PR/workspace state checked

- PR #106: open Draft, head `a993d5bfcc282acfc849ab45084d570524d6725b`, base `8166deeb4b70397af9b021b9420f93afdab2501f`.
- PR #107: open Draft, head `81cc441328b413aa79217fcf91079c0a28362bf1`, same base.
- PR #108: open Draft, head `9f1924f5c63039ab390984e5f08121a9553f4c0d`, same base. It currently contains six documentation files; no application runtime file is in its changed-file list.
- #106 and #107 both change `regia.html`; their integration still requires a single reconciled branch and combined tests. No merge is recommended by this audit.

This follow-up is read-only evidence and does not authorize implementation.
