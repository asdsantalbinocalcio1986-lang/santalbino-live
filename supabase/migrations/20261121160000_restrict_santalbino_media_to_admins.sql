-- Restrict SANTA Live media mutations to designated club administrators.
-- Public reads remain available; existing admin-only policies continue to authorize writes.
drop policy if exists "Authenticated upload santalbino media" on storage.objects;
drop policy if exists "Authenticated update santalbino media" on storage.objects;
drop policy if exists "Authenticated delete santalbino media" on storage.objects;
