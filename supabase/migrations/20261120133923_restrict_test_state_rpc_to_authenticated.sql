-- La funzione di scrittura della simulazione è riservata agli utenti autenticati.
revoke all on function public.save_santalbino_test_state(bigint, jsonb) from public, anon;
grant execute on function public.save_santalbino_test_state(bigint, jsonb) to authenticated;
