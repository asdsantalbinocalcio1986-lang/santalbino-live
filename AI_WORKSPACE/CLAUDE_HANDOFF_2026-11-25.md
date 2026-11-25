# Claude handoff — SANTALive post-match audit and PR review

**Task:** SANTALIVE-AUDIT-001  
**Date:** 2026-11-25  
**Mode:** READ ONLY — do not implement  
**Repository:** `asdsantalbinocalcio1986-lang/santalbino-live`  
**Baseline main:** `8166deeb4b70397af9b021b9420f93afdab2501f`

## Files to read first
1. `AI_WORKSPACE/PROJECT_STATUS.md`
2. `AI_WORKSPACE/DECISIONS.md`
3. `AI_WORKSPACE/CURRENT_TASK.md`
4. `AI_WORKSPACE/POSTMATCH_PHASE1_DESIGN_DRAFT.md`

## Pull requests to inspect
- PR #106 — `feat/postmatch-editorial-drafts`, head `a993d5bfcc282acfc849ab45084d570524d6725b`. Review all changed files, SQL proposal, UI behavior, test fixtures and CI evidence.
- PR #107 — `feat/social-copy-editor`, head `81cc441328b413aa79217fcf91079c0a28362bf1`. Review all changed files, test coverage and manual-test gaps.
- PR #108 — `ai-workspace/bootstrap`, head `960aecd36ada1842b8f1b50f9408aa17942e5120`. Documentation-only workspace; verify task and decision consistency.

Do not assume these branches have been updated after the recorded SHAs. Confirm the current PR head SHA before reviewing and state it in the report.

## Work required
A. Audit the current `main` implementation against the fixed decisions and phase-1 draft.  
B. Review PR #106 for SQL/RLS/storage safety, revision lifecycle, race conditions, stale approval, snapshot consistency, test isolation, UI regressions and exact content immutability.  
C. Review PR #107 for persistence, editing/regeneration semantics, share actions, test-mode guards, popup handling and manual test coverage.  
D. Analyze the shared-file conflict: both #106 and #107 change `regia.html` from branches based on main. Recommend a safe integration order and identify any overlapping handlers/state/functions that need reconciliation.  
E. Audit the existing publisher at `supabase/functions/santalive-social-publish/index.ts`: atomic claim/idempotency, concurrency, stale processing, uncertain provider outcomes, partial channel success, retry safety and authorization. Do not change the existing FULL TIME behavior.  
F. Audit the scheduled-content migration only as context; do not expand phase 1 into scheduling.  
G. Separate repository evidence from live Supabase evidence. If the effective production project cannot be queried read-only, mark deployment facts UNKNOWN and list the exact safe queries/access needed.

## Mandatory output format
For every finding:
- Finding ID
- Severity: BLOCKER / HIGH / MEDIUM / LOW / INFO
- Status: VERIFIED / NOT FOUND / UNKNOWN / RISK
- Exact file + line/function/schema object, or exact PR/diff location
- Evidence (short excerpt or test output)
- User/product impact
- Recommended correction or follow-up
- Phase-1 blocker? YES/NO

Then provide:
1. PR #106 assessment: accept / request changes / hold, with reasons.
2. PR #107 assessment: accept / request changes / hold, with reasons.
3. Integration plan for #106 and #107 that avoids losing either branch's changes.
4. Publisher safety verdict: safe for approved post-match content / manual-only until fixed.
5. Confirmed facts vs unknown live configuration.
6. Missing tests, including concurrency and ambiguous Meta timeout.
7. Phase-1 go/no-go recommendation.

## Absolute prohibitions
- No edits, commits, branches, PR changes, migrations, SQL writes, database mutations, configuration changes or deploys.
- No real Meta posts, WhatsApp sends or notifications.
- No changes to live match, event, roster or MVP data.
- No secret/credential extraction or disclosure.
- Do not merge PRs or apply the proposed SQL.
- Do not treat `?test=1` as a separate backend or security boundary.
- Do not invent evidence. Unknown means UNKNOWN.

## Handoff after Claude
Return the complete report to ChatGPT. Gemini then receives this exact handoff plus Claude's complete report and independently checks omissions, unsupported claims, false positives and security gaps. ChatGPT reconciles both reviews against the repository evidence. Implementation remains blocked until the owner explicitly approves the final specification and phase.

## Additional owner requirements received 2026-11-25

Include these two requirements in the audit and report; do not implement during this read-only task:

1. **Automatic match hashtag:** create and store a deterministic match hashtag automatically when a match is created (example `#SantAlbinoRadicofani`). Reuse it consistently in match-day, convocati and post-match copy; prevent duplicates; assess behavior if teams change and if an admin override exists.
2. **Persistent club crest:** the club's own logo must remain saved after one upload/selection, across reloads and future matches. Its display must follow the club's home/away assignment, not be confused with the opponent logo. Assess storage location, persistence, permissions, replacement/removal and test isolation.

For both, report current implementation evidence, gaps, exact files/functions, risks, and acceptance tests. No code, database, storage or production changes.


## Preliminary code observations for the new requirements

Current `main` (`regia.html`, SHA `e1517806a0f6d49ebfd884600ebe7b5fe0058a64`):
- Match save reads the hashtag field into `S.match.hashtag`; automatic generation from team names was not found in that save path.
- Social event text and the convocati builder already consume `S.match.hashtag`, so generated value should flow through these existing builders without duplicate appending.
- Logo upload stores a shared media URL in `S.logos[home|away]` and saves app state. Persistence exists at state level, but the identity is currently positional (home/away), not a canonical club-logo property. Review all graphic renderers and new-match/reset flows before proposing a migration.


## Follow-up audit evidence — 2026-11-25 (read-only)

ChatGPT independently inspected current `main` (`8166deeb4b70397af9b021b9420f93afdab2501f`; `regia.html` blob `e1517806a0f6d49ebfd884600ebe7b5fe0058a64`) and queried the connected Supabase project read-only.

Please independently verify these points and report exact corrections/omissions:

### Hashtag paths
- Embedded state default: `regia.html:1357`; runtime default: `1377`.
- UI field: `4400`; match-save assignment: `4823`.
- Event social text appends hashtag around `1547`; convocati builder around `1601`; formation text around `1633`; post-match summary footer around `4032`; one share action appends separately around `4688`.
- Reset/new-match: `resetMatch()` around `4805` retains `S.match`, so it also retains the previous hashtag.
- No team-name-driven generator was found in current main. Confirm this across all relevant functions and PR diffs.

### Logo paths and persistence
- State shape: `logos: {home, away}` around `1378`; hydration/merge around `1398` and `2149`.
- Settings UI: `4403–4405`; upload handler: `4857`; shared upload guard/function: `2010–2022`.
- Reset: `4805` retains logo URLs.
- Direct renderer reads include around `2554`, `2805`, `3032`, `3262`, `3341`, `3402`, `3550`, `4039`. Search every remaining use, including archive/restore/import.
- `MEDIA_BUCKET = 'santalbino-media'` around `1648`.
- Live read-only Supabase evidence: bucket exists, public=true, 8 MiB limit, JPEG/PNG/WebP; storage policies allow authenticated admins (via `is_santalbino_admin()`) to insert/update/delete and public/anon/authenticated users to read. No storage writes were made.
- Test mode blocks `uploadSharedImage()`; however test mode uses a separate state table in the same project, not a separate storage environment.

### PR state and integration
Current PR heads at the time of this handoff:
- #106: `a993d5bfcc282acfc849ab45084d570524d6725b`
- #107: `81cc441328b413aa79217fcf91079c0a28362bf1`
- #108: open Draft, six documentation-only files at the time of the check; verify its live head SHA in GitHub because this handoff update itself changes that SHA.
All are open Drafts; #106/#107 both modify `regia.html`. #108 has six documentation-only changed files.

Please do not treat these observations as settled without checking exact branch content. Do not write to production or modify any branch/PR. Update the report with VERIFIED/UNKNOWN distinctions and line-level evidence.
