# SANTA Live — social editorial queue foundation

**Status:** draft proposal and isolated SQL tests only. This is not deployed and does not alter the live Supabase project, Storage, cron jobs, Edge Functions, Meta secrets or social accounts.

## Why a separate queue

The existing `santalbino_social_publications` table is the live-match event delivery log. It is intentionally not reused for MATCH DAY, convocati, formations, post-match graphics or club notices. Editorial content has revisions, human approval and scheduling semantics that are different from a live goal/card event.

## What this proposal contains

- `santalbino_editorial_posts`: immutable approved content snapshots, revision history, author/approver, schedule, timezone, claim and publication state.
- `santalbino_editorial_deliveries`: independent Facebook and Instagram state, attempt count, remote container/post IDs and sanitized errors.
- Admin-only RLS for editorial content; delivery records are readable by admins and writable only by the service role.
- Admin RPCs for saving a new draft revision, approving a specific current revision, scheduling it, and cancelling it before claim.
- Service-role RPCs for claiming due work, recording an Instagram container ID and completing one platform delivery.
- A server-side dispatch parameter that defaults to OFF. With dispatch disabled, the claim function returns no work.
- Conservative lease expiry: in-flight deliveries become `unknown`; a timeout or abandoned worker never triggers a blind retry.
- A stale claim token cannot complete or overwrite a later claim.
- Europe/Rome is explicit for editorial schedule semantics; the stored schedule is a timestamptz.

## What is deliberately not included yet

- No Edge Function worker is deployed or implemented in this proposal.
- No cron job is created. The existing `santalbino-publish-scheduled-content` job remains dedicated to the public live page and is not reused.
- No Meta API call is made by these SQL functions.
- No UI is wired to these RPCs yet.
- No cross-club authorization model is activated; `logical_key` is stable per editorial item, while multi-club tenancy remains a later phase.
- The browser-provided SHA-256 is metadata, not proof of server-side asset integrity. Before a worker publishes, a server-side asset fetch/hash verification must be added.

## Required next implementation phase

1. Extend the existing hardened Meta publisher contract to accept only an approved editorial post ID/revision, then load its immutable caption, asset path/hash and platform snapshot server-side. Do not trust client-supplied caption or image URLs for scheduled dispatch.
2. Implement a service-to-service queue worker that calls the existing Meta adapter rather than creating a second Meta client. The worker must pass a server-side kill switch and claim token.
3. Add server-side asset validation and hashing, platform-level retries, reconciliation and safe error redaction.
4. Schedule the worker independently of the browser. Supabase documents `pg_cron` + `pg_net` for periodic Edge Function invocation and recommends storing the service key and project URL in Vault; configure this only after the worker exists and in a separate test project first.
5. Add the admin UI for revision history, approval, scheduled state, edit/cancel before claim and per-platform delivery history.
6. Test concurrent claims, lease expiry, browser closed, Europe/Rome DST, partial FB/IG success, ambiguous timeouts, kill switch OFF, and non-admin/anonymous RLS.

## Isolated validation

The proposal is exercised in CI against a disposable PostgreSQL instance using the same SANTA Live admin helper shape. Tests cover revision supersession, approval immutability, stale approval rejection, schedule/cancel, default-off dispatch, service-role claim, per-platform completion, preservation of a successful Facebook delivery when Instagram is unknown, and admin-only reads.

A successful CI run does not authorize applying this SQL to the live project. Convert it to a timestamped migration with the Supabase CLI only after reviewing the full local Supabase stack and the worker contract. Keep the feature disabled until the user explicitly authorizes activation.
