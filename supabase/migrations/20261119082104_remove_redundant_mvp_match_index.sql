-- The primary key already starts with match_key, so this standalone index is redundant.
-- Dropping it preserves query semantics and reduces write/storage overhead.
drop index if exists public.mvp_votes_match_key_idx;
