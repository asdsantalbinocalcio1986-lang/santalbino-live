# Social editorial audit status — 25 November 2026

This note records the state of the isolated validation branch. It does not authorize deployment, hosted migrations, Meta API calls, or real publication.

## Findings and code changes

- **A1–A7:** revision supersession, fenced claims, bounded retries and reconciliation, typed revision keys, signed preview before approval, admin-only mutations, and JPEG validation are implemented in the editorial queue proposal and UI/worker paths.
- **M2/M3/M5/M8:** pre-publication asset failures, Instagram container expiry/reconciliation, asset immutability, and shared publisher adapter tests are represented in the branch.
- **M4 — Meta error classification:** explicit permanent rejections now become terminal `failed`; documented throttling/transient codes and HTTP 429 are retryable; ambiguous write outcomes and write-side 5xx remain `unknown`; read-only 5xx remain retryable. Tests cover code 32, code 100, code 190, transient flags, and ambiguous writes.
- **M6 — stale live publication claims:** expired leases are fenced, in-flight platform results become `unknown`, and the record moves to `reconciliation_required`; the SQL test verifies this path.
- **M7 — editor form preservation:** the editorial draft form captures text, content type, logical key, selected channels, and the selected File object before full UI renders, then restores them afterward. The save path can use the retained File object if the browser cannot restore `input.files`.
- **JPEG SQL parsing:** the Instagram JPEG check uses the psql-safe `[.]jpe?g$` expression; a regression guard prevents reintroducing the backslash-dot form.

## Open policy / verification items

- **M1 — stale scheduled content expiry:** the queue currently publishes any due scheduled item when the worker next runs. A safe expiry rule needs an explicit product policy by content type (for example, when MATCH DAY, convocati, and formation become stale); no arbitrary expiry duration has been imposed.
- The current head needs a full CI run including ephemeral PostgreSQL and isolated local Supabase browser tests.
- Android Chrome/PWA and desktop Back-button behavior still needs manual verification.
- Public MVP voting still accepts a client-supplied voter hash; stronger anonymous abuse resistance needs a separate design decision and must preserve public voting.
- Supabase Auth compromised-password protection and hosted migration alignment remain configuration/release tasks; no hosted project has been changed.

## Safety boundary

All changes remain on feature/validation branches. No production data, hosted Supabase project, Meta account, or real publication was touched.

Validation note: this branch is used only to run the isolated integration CI; the Pages deployment job must remain skipped for pull requests.
