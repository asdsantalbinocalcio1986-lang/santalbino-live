grant delete on table public.match_archive to authenticated;

create policy "Only SantAlbino admin can delete archived matches"
on public.match_archive
for delete
to authenticated
using (public.is_santalbino_admin());
