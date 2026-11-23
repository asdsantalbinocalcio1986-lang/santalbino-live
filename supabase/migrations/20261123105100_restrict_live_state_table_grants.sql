-- Correzione least-privilege per la tabella dello stato live.
-- RLS resta attivo: anon può leggere; authenticated può leggere/scrivere
-- solo quando la policy is_santalbino_admin() lo autorizza.
-- service_role e postgres non vengono modificati.
revoke all on table public.live_state from public, anon, authenticated;
grant select on table public.live_state to anon, authenticated;
grant insert, update on table public.live_state to authenticated;
