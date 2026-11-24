# SANTA Live — persistent post-match editorial revisions

**Status:** implementation foundation / review required. This proposal is not deployed and does not change production.

## Why this exists

The current `openMatchResult()` builds a caption from the live `S` state and renders the graphic separately. The textarea is editable, but the edited caption and the generated image are not saved as one editorial object. Reopening the dialog regenerates both from the then-current match state.

The post-match editor needs a durable revision that survives closing the control room and starting another match.

## Data contract

Each revision stores together:

- `environment`: `production` or `test`; test data remains isolated even though both environments share the Supabase project.
- `match_id` and monotonically increasing `revision`.
- `snapshot`: immutable JSON copy of the relevant match facts used for the caption and graphic (teams, score, scorers, cards, competition, date, venue, logo references and source state revision).
- `caption`: exact editable social text.
- `graphic_path` and SHA-256 digest: the exact JPEG produced for this revision, in a dedicated private Storage bucket.
- author and approval audit fields.

Saving creates a new revision. Any previous unapproved draft becomes `superseded`; previous revisions remain available. Approval accepts only the current draft revision and does not regenerate any content. Approved content is immutable; a later correction is a new revision and a new explicit approval.

## Security and separation

- No public access to the edition table or private graphic bucket.
- Admin-only read access via the existing `is_santalbino_admin()` authorization check.
- Revision creation and approval happen through authenticated, admin-checked database functions; direct table writes are not granted.
- Separate `production` and `test` namespaces in both row identity and Storage paths.
- No call to `santalive-social-publish` is added here. Approval is editorial approval only; social dispatch remains a separately scoped phase.
- Existing automatic FULL TIME publication and MVP flow are not changed.

## Proposed UI flow

1. Open MATCH RESULT after full time.
2. Capture a match snapshot once; generate the caption and JPEG from that same capture.
3. Edit the caption; preview the JPEG.
4. Save draft: upload JPEG to the private bucket, calculate its SHA-256, then call `save_santalbino_postmatch_revision`.
5. On reopen, load the latest draft/revision and display its saved caption and exact image. Do not regenerate silently.
6. Approve the displayed revision with its expected revision number. If another revision exists, reject and reload.
7. Any edit after approval creates a new draft revision; the approved revision is retained for audit.

## Important implementation note

The SQL in `supabase/proposals/postmatch_editorial_revisions.sql` is a review proposal, not a migration. Before it can be applied, generate the real timestamped migration using the Supabase CLI, inspect it, apply it only to an isolated development database, and run the Supabase security advisors and integration tests. Do not run it against production as part of this PR.

## Acceptance checks for the UI phase

- Close/reopen the editor: caption and image remain byte-for-byte the saved revision.
- Change match state after saving: saved revision remains unchanged.
- Reset/start a new match: prior post-match editions remain accessible.
- Save twice: second revision supersedes the earlier unapproved draft; history remains.
- Approve stale revision: operation fails without changing approval state.
- Edit after approval: creates a new draft; approved content remains immutable.
- Test mode can only load/save test revisions; production can only load/save production revisions.
- No network call to the social publisher occurs on save or editorial approval.
- No MVP vote, candidate, or result data is read or changed by the editor.
