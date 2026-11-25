# Gemini independent review — social/editorial corrective commits — 2026-11-25

## Review scope

Please review only the corrective changes currently present in PR #106 and PR #107. This is an independent technical review, not an authorization to edit code, merge, deploy, apply SQL or contact Meta.

Repository: https://github.com/asdsantalbinocalcio1986-lang/santalbino-live

- PR #106: https://github.com/asdsantalbinocalcio1986-lang/santalbino-live/pull/106
- PR #107: https://github.com/asdsantalbinocalcio1986-lang/santalbino-live/pull/107
- PR #106 diff: https://github.com/asdsantalbinocalcio1986-lang/santalbino-live/pull/106.diff
- PR #107 diff: https://github.com/asdsantalbinocalcio1986-lang/santalbino-live/pull/107.diff

Current head commits at preparation:
- PR #106 `bc75b97690b867e279df5d68bef55b5890221b25`
- PR #107 `bb188086faa0c0328d6f73293c160a7e508eb9e6`

## Corrections to review

### PR #107 — social copy and sharing
- New match reset clears `S.socialDrafts.matchDay` and `S.socialDrafts.convocati`.
- Share text removes an existing standalone match hashtag before appending the hashtag to the composed text.
- MATCH DAY/convocati Facebook sharing opens the Facebook share dialog without `noopener` in the `window.open` feature string, then immediately sets `popup.opener = null`; this avoids treating a successfully opened popup as blocked due to noopener return semantics.
- The event Facebook share action has the same popup handling correction.
- WhatsApp event-share fallbacks now open without `noopener` and immediately sever `opener`.
- UI guard tests were extended for reset, hashtag deduplication and popup handling.

Please inspect all other `window.open`/Facebook/WhatsApp paths in the changed branch, especially paths not covered by the new guards. Verify there is no regression in test-mode blocking, user-gesture popup behavior, text copy, image sharing and cancellation handling.

### PR #106 — post-match editorial
- A missing editor snapshot now falls back to `capturePostmatchSnapshot()`, not a deep clone of the full application state.
- Snapshot shape is checked before upload/persistence.
- Match-result graphic download errors are caught locally and shown to the operator.
- Cleanup after failed revision save now inspects the Supabase Storage SDK's returned `error` as well as thrown errors. If cleanup fails, the operator is shown the remaining object path and instructed to have an administrator remove it.
- UI guard tests were extended for these cases.

Please inspect error propagation, cleanup behavior, recordSaved timing, snapshot completeness and any possibility of leaving unreported orphaned objects.

## Important known limitation — SHA-256
The client computes SHA-256 and passes it to the SQL function. SQL validates the 64-character hex format but does not download/re-hash the Storage object. Therefore this is a client-supplied digest, not server-side verification of object integrity. Confirm this description against the diff and recommend a safe server-side verification design for a later isolated phase; do not implement it.

## Verification status known to coordinator
- PR #107 CI #594 passed application validation and social UI guard tests before the latest event-popup corrections. The latest head commit does not yet have a completed CI run visible.
- PR #106 earlier CI reached successful validation and PostgreSQL SQL/UI guard steps, but later jobs were cancelled during rapid commit updates. The latest head commit does not yet have a completed full CI run visible.
- No final manual browser test has been completed.
- Both PRs remain Draft and unmerged. Deploy jobs were skipped/cancelled. No production deployment, database migration or Meta call was performed.

## Required review output

For each finding report:
1. ID and severity (BLOCKER / HIGH / MEDIUM / LOW / INFO).
2. VERIFIED / NOT VERIFIED / FALSE POSITIVE.
3. Exact file, function and line or code excerpt.
4. Reproduction scenario and user impact.
5. Whether it blocks merging the relevant PR.
6. Smallest safe correction or test that would resolve it.

Also provide:
- independent review of all new changes;
- missed adjacent call sites and edge cases;
- whether the added tests genuinely protect behavior or merely match source text;
- test cases still missing;
- a clear separate verdict for PR #106 and PR #107.

Do not claim to have run tests unless you actually ran them. Do not infer CI status from old runs. Do not edit the repository. Do not call Supabase or Meta.