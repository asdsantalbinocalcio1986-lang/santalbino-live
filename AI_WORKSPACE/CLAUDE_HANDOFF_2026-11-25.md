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
