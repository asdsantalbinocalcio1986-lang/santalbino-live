-- Riduce i privilegi SQL espliciti della tabella di simulazione.
revoke all on table public.live_test_state from public, anon, authenticated;
grant select on table public.live_test_state to anon, authenticated;
grant update on table public.live_test_state to authenticated;
