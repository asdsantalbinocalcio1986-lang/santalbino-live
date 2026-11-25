# Current task — SANTALive post-match read-only audit

- **Task ID:** SANTALIVE-AUDIT-001
- **Status:** IN PROGRESS
- **Owner/coordinator:** ChatGPT
- **Primary analyst:** Claude
- **Independent reviewer:** Gemini
- **Scope:** read-only audit only
- **Baseline:** repository `main`; record the exact commit SHA used before inspecting files
- **Specification baseline:** the repository audit is independent of the full v3.1 document. Use `PROJECT_STATUS.md` and `DECISIONS.md` as the canonical project constraints. Do not ask the user to resend the old specification. ChatGPT will map verified repository findings to v3.1 after the audit.

## Objective

Verify whether the v3.1 post-match design is compatible with the actual repository and effective Supabase configuration, without changing code, schema, data, deployment or social channels.

## Required audit areas

1. Publication schema, indexes, constraints, RLS and related persistence needed for match/revision identity.
2. Event persistence and synchronization; how `S.events`, FULL TIME, result, scorers and dismissals are produced and updated.
3. Existing summary and graphic generation; whether text and graphic can be tied to the same immutable revision/content fingerprint.
4. Existing publisher contract, authorization, channel behavior, concurrency/idempotency, timeout and uncertain outcomes.
5. Protection against bypassing the approval flow while preserving existing FULL TIME auto-publication unchanged.
6. Actual roles/permissions for draft, approve, publish, manual publication recording and uncertain-outcome resolution.
7. Test isolation and server-side fail-closed behavior; `?test=1` alone is insufficient.
8. Internal notification mechanisms and access controls, if any.
9. Scheduler installation/configuration only as a deferred capability check; it is not a prerequisite for the first release.
10. Regression and perimeter check: no MVP candidates/votes/tallies/history; no real posts or supporter notifications.

## Required output

For each finding provide:
- ID;
- classification: VERIFIED / NOT FOUND / UNKNOWN / RISK;
- exact file path and line/function/schema reference, or exact database object;
- evidence (short excerpt or query result);
- impact on v3.1;
- recommended action;
- whether it blocks phase 1 or a later phase.

Clearly distinguish repository evidence from live Supabase evidence. If live database access is unavailable, mark it UNKNOWN; do not infer deployment state from migration files.

## Forbidden actions

- No code edits, commits, PR implementation, migrations, SQL writes, data updates or deletes.
- No production social posts, test posts to real accounts, notifications, or changes to match/voting records.
- No merge or deployment.
- No secrets or credentials in output.
- Do not design new tables before auditing existing schema and constraints.

## Acceptance criteria

The audit is complete only when:
- all ten areas are addressed;
- every material claim has a repository or database evidence reference;
- unknowns are explicitly listed with the exact access/evidence needed;
- conflicts with v3.1 are mapped to its sections;
- the output ends with blockers for phase 1, blockers for later phases, and a go/no-go recommendation. Do not require access to the v3.1 document to complete this repository audit; identify relevant code/database facts so ChatGPT can map them to v3.1.

## Handoff protocol

1. Claude first confirms task ID, baseline commit, and which sources it can actually access. It returns an evidence-based audit, not a proposed implementation.
2. Gemini receives this exact task plus Claude's complete audit and independently checks coverage, unsupported claims, missed risks and false positives. Gemini must state exactly what it received.
3. ChatGPT reconciles both outputs against repository/database evidence and updates the audit/decision record.
4. No implementation begins until the project owner explicitly approves the resulting specification and phase.


## Supplementary audit update — 2026-11-25

Completed by ChatGPT as read-only work while primary analyst/reviewer are unavailable:
- Hashtag and club-logo audit documented in `AI_WORKSPACE/HASHTAG_AND_CLUB_LOGO_AUDIT_2026-11-25.md`.
- Social queue schema/architecture proposal documented in `AI_WORKSPACE/SOCIAL_QUEUE_SCHEMA_DESIGN_DRAFT.md`.
- Current Supabase inventory confirms `santalbino_social_publications` exists with RLS and 0 rows; it is a live-event delivery log, not an editorial queue. Edge Function `santalive-social-publish` ACTIVE v2, JWT verification enabled. Migration list includes `scheduled_public_content` dated 2026-11-22.
- Main code findings: `saveMatch()` stores the typed hashtag without generating it; social/convocati/formation/graphic builders consume the stored hashtag. Logo storage is shared but keyed by home/away slot rather than club identity; renderers read the positional slots directly.
- PR #108 remains open, Draft, not merged at the latest check.
- No app code, database, storage, cron, secrets, social account, merge or deployment changed.

Remaining audit work: inspect the deployed SQL functions/policies and the complete Edge Function contract without invoking it; verify all logo renderers and initialization/reset flows; reconcile findings with Claude and an independent reviewer when available. This supplementary work does not complete the full v3.1 audit scope.


## Publisher contract addendum — 2026-11-25

Read-only verification of the deployed Edge Function and database policies is recorded in `AI_WORKSPACE/PUBLISHER_LIVE_CONTRACT_AUDIT_2026-11-25.md`. The deployed v2 source matches main byte-for-byte. Critical additional blockers: non-atomic processing claim (PUB-01), ambiguous Meta outcomes marked failed (PUB-02), and no exactly-once guarantee despite UNIQUE event_id (PUB-03). The status action itself calls Graph API and was not invoked. Existing social log RLS, media bucket policies and 8 MiB limit were inspected. No code/schema/data/storage/cron/secrets/social accounts were changed. Full v3.1 audit remains in progress.


## SQL/RLS/synchronization review — 2026-11-25

Completed read-only review of public SQL functions, ACLs, RLS, grants, cron and frontend synchronization. Key verified points: save RPCs retain optimistic concurrency via expected revision and SQLSTATE 40001; functions are SECURITY INVOKER and check admin. No custom triggers on public tables. Test mode uses separate state table/RPC and localStorage keys, but shares the same Supabase project and media bucket; cron updates both live and test state rows. State JSON validation has no schema version/whitelist/size cap. Added documents: `SQL_RLS_AND_SYNC_AUDIT_2026-11-25.md` and `IMPLEMENTATION_BLUEPRINT_CLUB_SOCIAL_2026-11-25.md`. No live changes. Continue with read-only audit of MVP vote pathways and verify all remaining match lifecycle/reset/create flows; then wait for Claude/Gemini independent review before implementation.


## SQL/RLS/sync and MVP lifecycle review — 2026-11-25
Read-only audit completed. Save RPCs preserve optimistic concurrency (40001); test uses separate state table/RPC/localStorage keys but same Supabase project and media bucket; cron updates live and test page state. State JSON lacks schema version/whitelist/size cap. MVP vote RPC enforces fulltime, 12-hour expiry, roster membership and one vote per client-supplied UUID, which is not robust person identity. `resetMatch()` preserves positional logos and old hashtag. New docs: SQL_RLS_AND_SYNC_AUDIT, MVP_VOTING_AND_MATCH_LIFECYCLE_AUDIT, IMPLEMENTATION_BLUEPRINT. No live mutation.


## Narrow corrective implementation authorization — 2026-11-25

The project owner explicitly authorized corrective work on the already-open social/editorial PRs, limited to defects found in the independent review. This is a narrow exception to the prior audit-only gate, not authorization for the broader v3.1 implementation.

### Changes applied on existing Draft PR branches
- PR #107 (`feat/social-copy-editor`): clear previous match-day/convocati drafts on reset; prevent duplicate hashtag in the share composition; correct Facebook popup detection and opener handling for both social-copy and event sharing; correct WhatsApp event fallback opener handling; add source guard tests.
- PR #106 (`feat/postmatch-editorial-drafts`): replace full-state snapshot fallback with reduced snapshot capture and shape validation; handle match-result graphic download errors locally; inspect Storage SDK cleanup errors and report a possible orphan object path; add guard tests.

### Current commit heads
- PR #106: `bc75b97690b867e279df5d68bef55b5890221b25`
- PR #107: `bb188086faa0c0328d6f73293c160a7e508eb9e6` (latest corrective HEAD; CI pending)

### Verification and remaining limits
- **Updated verification on 2026-11-25:** PR #106 HEAD `bc75b97690b867e279df5d68bef55b5890221b25` passed CI run #599 in full: application validation, ephemeral PostgreSQL SQL integration, isolated local Supabase integration (Auth/RLS/Storage/revision lifecycle), and Playwright control-room browser E2E. Pages deployment was skipped intentionally.
- **Updated verification on 2026-11-25:** PR #107 HEAD `588aaefcaac7b8bc79b081ea0726195dc08ffa7d` passed CI run #602: application validation and social-copy UI guard tests. Pages deployment was skipped intentionally.
- No manual browser smoke test of the social sharing flows or independent Gemini review has been completed.
- Client-computed SHA-256 is stored after SQL format validation only; server-side object-byte verification is not implemented.
- Publisher hardening remains untouched: atomic claim/lease, ambiguous Meta outcomes and reconciliation, per-platform idempotency, and safe retries remain blockers before automatic editorial publishing.
- Both PRs remain Draft/unmerged. No main, production, DB, Storage configuration, cron, secret, Meta account, deployment or real publication changes were made.

Independent review handoff: `AI_WORKSPACE/GEMINI_REVIEW_SOCIAL_FIXES_2026-11-25.md`.


## Verification refresh — 2026-11-25

GitHub Actions was rechecked against the exact current PR HEAD SHAs:
- PR #106: CI run #599 completed successfully. All three validation/integration jobs passed, including the local Supabase + Playwright browser E2E job. The Pages deploy job was skipped because this is a pull request.
- PR #107: CI run #602 completed successfully. Application validation and social-copy guard tests passed. The Pages deploy job was skipped because this is a pull request.
- PR descriptions were refreshed to record the current run IDs, exact HEAD SHAs and remaining limitations.
- Both PRs remain open Drafts and unmerged. No production deploy, merge, live Supabase mutation, Meta action or external social post was performed.

Next gates: (1) complete the social sharing manual smoke test in a controlled demo browser, with no final send to recipients; (2) obtain and reconcile the independent Gemini review against the exact HEADs; (3) only then decide whether any additional narrow fixes are warranted. Do not begin publisher hardening or automatic Meta publishing as part of this narrow corrective authorization.


## Social hashtag edge-case correction — 2026-11-25

On PR #107, the previous deduplication removed only a hashtag that occupied an entire line. It could still append a duplicate when the edited caption contained the same hashtag inline. The sharing composition now escapes the configured hashtag and removes matching hashtag tokens at whitespace/punctuation boundaries, then normalizes whitespace before appending the hashtag once. Guard assertions were updated. A small isolated JavaScript exercise covered standalone, inline, punctuation-adjacent and repeated occurrences. The latest HEAD is `bb188086faa0c0328d6f73293c160a7e508eb9e6`; no CI run is currently visible for this commit, so do not report it as CI-passed. PR #107 remains Draft. No share dialog was opened and no external service was contacted.
