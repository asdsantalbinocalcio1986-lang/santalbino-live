# SANTA Live — persistent post-match editorial revisions

**Status:** implementation foundation / review required. This proposal is not deployed and does not change production.

## Why this exists

The current `openMatchResult()` builds a caption from the live `S` state and renders the graphic separately. The textarea is editable, but the edited caption and the generated image are not saved as one editorial object. Reopening the dialog regenerates both from the then-current match state.

The post-match editor needs a durable revision that survives closing the control room and starting another match.

## Data contract

Each revision stores together:

- `environment`: `production` or `test`; this is a logical namespace used by the UI and queries. Because the current test mode shares the production Supabase project, it is **not a security boundary**: an authenticated admin able to call the RPCs directly can specify either namespace. Hard isolation requires a separate Supabase project and separate credentials.
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

## UI implementation in this branch

The regia editor now has a first implementation on the feature branch:

- Opens the current generated result preview and loads saved revisions for the current environment.
- Shows the latest revision for the current match, and a history selector spanning previous matches (so a match reset does not hide old editions).
- Saves the exact caption, a reduced match snapshot (match metadata, logos and event facts only; no MVP votes/candidates or roster payload), the JPEG and its SHA-256 as one revision record.
- Reloads the exact saved JPEG via a short-lived signed URL; it does not regenerate an already-saved graphic.
- Allows explicit approval of the selected draft revision. Approval is not connected to the social publisher.
- Disables external WhatsApp sharing in test mode and permits sharing only for an explicitly approved revision; it also rejects caption edits that differ from the approved text.
- If the proposed table/bucket is not installed, the preview remains available and the editor reports that persistent saving is not yet configured.

This is code on an unmerged feature branch. It cannot persist anything until the proposal is reviewed, converted to a migration, and installed in a separate Supabase test project. The current `?test=1` mode shares the production Supabase project and is not suitable for installing or validating this schema.

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
- The UI in test mode loads/saves only test revisions, and production UI loads/saves only production revisions. This client-side namespace filter is not a security boundary; validate hard isolation only in a separate Supabase project.
- No network call to the social publisher occurs on save or editorial approval.
- No MVP vote, candidate, or result data is read or changed by the editor.
