# SANTA Live — social editorial queue and worker

**Status:** implementation proposal on a feature branch, validated only in isolated CI. The SQL is still under `supabase/proposals/`; no hosted migration, Edge Function deployment, cron job, secret, Meta account or social publication has been changed.

## Scope

The editorial queue is separate from `santalbino_social_publications`, which remains the live-match event delivery log. It covers MATCH DAY, convocati, formations, post-match graphics, club notices and custom editorial content.

- `santalbino_editorial_posts`: immutable approved snapshots, revisions, author/approver, schedule, Europe/Rome timezone, claim and overall state.
- `santalbino_editorial_deliveries`: independent Facebook and Instagram delivery state, attempt count, remote container/post IDs and sanitized errors.
- Admin-only RLS for editorial posts and delivery history; service-role-only queue claims and delivery writes.
- Admin RPCs for new draft revisions, approval of the current revision, scheduling and cancellation before claim.
- Service-role RPCs for due-work claim, Instagram container persistence and per-platform completion.
- Exponential retry delay for explicit retryable rejections (2, 4, 8 … up to 64 minutes). Ambiguous outcomes and expired leases become `unknown` and are never automatically retried.
- Fencing tokens prevent a stale worker from overwriting a later claim.

## Worker implemented (not deployed)

`supabase/functions/santalive-editorial-worker/index.ts` is a service-to-service Edge Function. It reuses the Graph API adapter exported by `santalive-social-publish`; it does not introduce a second Meta client.

The worker:
1. accepts POST only and requires the exact Supabase service-role bearer secret (the Edge gateway JWT verification must remain enabled);
2. requires both `SOCIAL_EDITORIAL_DISPATCH_ENABLED=true` and `META_PUBLISH_ENABLED=true`; absent values mean OFF;
3. claims only approved/due queue rows and loads caption, platform selection, asset path and expected hash from the claimed immutable database snapshot;
4. downloads the source asset server-side, validates JPEG/PNG/WebP magic bytes, MIME, 8 MB size limit and SHA-256;
5. creates a 10-minute signed URL from the private `santalbino-editorial` Storage bucket for Meta to fetch;
6. persists an Instagram container ID before polling or publishing it;
7. records each platform independently using the active fencing token; network timeouts, malformed responses and other ambiguous POST outcomes become `unknown`.

The queue proposal provisions `santalbino-editorial` as a private bucket with an 8 MB limit and JPEG/PNG/WebP allowlist. Only the SANTA Live admin can manage its objects; the service role accesses it server-side. This prevents unapproved editorial originals from being publicly readable. The existing public `santalbino-media` bucket is not reused.

### Required server secrets / flags (not configured)

- Existing: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN`, `META_IG_USER_ID`.
- Optional: `META_GRAPH_API_VERSION` (defaults to `v27.0`), `SOCIAL_EDITORIAL_STORAGE_BUCKET` (defaults to `santalbino-editorial`).
- Kill switch: `SOCIAL_EDITORIAL_DISPATCH_ENABLED` must be explicitly `true`; `META_PUBLISH_ENABLED` must also be `true`.

No values have been set. Do not enable either flag until the user explicitly authorizes live publication.

## Still not implemented / not activated

- No Edge Function deployment and no hosted SQL migration.
- No `pg_cron` / `pg_net` schedule or Vault secrets. Scheduling is deliberately postponed until worker validation and user authorization; the existing `santalbino-publish-scheduled-content` job remains dedicated to the public live page.
- No admin UI connected to these RPCs yet: revision history, approval, scheduled state, edit/cancel before claim and per-platform delivery history remain to be wired.
- No multi-club tenancy model. `logical_key` is currently scoped to the single SANTA Live installation.
- No real Meta calls in CI; worker tests inject mocked Graph transport.

## Isolated validation

The disposable PostgreSQL suite covers revision supersession, approval immutability, stale approval rejection, schedule/cancel, dispatch OFF, concurrent/service-role claims, per-platform completion, Instagram container persistence, preserving Facebook success when Instagram is unknown, unknown-state no-retry, retry backoff and admin-only reads.

The Deno worker suite uses mocked Meta transport and covers asset path confinement, MIME and SHA-256 validation, Facebook/Instagram success, ambiguous network failure, container persistence fencing and the dispatch kill switch. No live Meta page or account is contacted.

A green CI run does not authorize applying the SQL to the hosted project. Before activation, run the complete local Supabase Auth/RLS/Storage integration, review the worker logs and secret handling, connect the admin UI, and explicitly authorize each hosted change separately.
