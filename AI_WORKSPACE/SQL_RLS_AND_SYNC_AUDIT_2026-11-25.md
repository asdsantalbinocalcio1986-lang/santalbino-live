# Audit SQL, RLS e sincronizzazione — 2026-11-25

## Perimetro e metodo
Ispezione read-only del progetto Supabase collegato e di `main/regia.html`, migration SQL e Edge Function. Sono state eseguite esclusivamente query SELECT/catalogo. Nessun dato, schema, policy, funzione, cron, Storage, segreto o account social è stato modificato o invocato.

## 1. Funzioni SQL live

### `is_santalbino_admin()`
- SQL STABLE, SECURITY INVOKER, search_path fissato `public, pg_temp`.
- Verifica che `auth.uid()` esista in `santalbino_admins`.
- EXECUTE concesso a authenticated; non a anon.
- La tabella admin ha RLS e policy SELECT limitata al record con `user_id = auth.uid()`.
- Il frontend verifica il risultato via RPC e poi abilita la regia.

### `save_santalbino_live_state(p_expected_rev, p_state)`
- SECURITY INVOKER; EXECUTE a authenticated e service_role, non anon.
- Controlla admin, JSON object e che `p_state.rev = p_expected_rev + 1`.
- UPDATE condizionale su id=1 e revisione remota uguale a expected; se nessuna riga aggiornata solleva SQLSTATE 40001.
- Il controllo revisione è una buona protezione contro la sovrascrittura concorrente. Da preservare.
- **Limite:** non verifica schema/whitelist/limite byte del JSON completo; qualsiasi admin può salvare un object con chiavi aggiuntive o payload eccessivo. Valutare whitelist e limite ragionevole senza rompere backward compatibility.

### `save_santalbino_test_state(p_expected_rev, p_state)`
- Stesso modello di revisione e autorizzazione, scrive solo `live_test_state`.
- SECURITY INVOKER; EXECUTE ad authenticated e service_role, non anon.
- Il test resta isolato logicamente dal live ma nello stesso progetto Supabase.

### `archive_santalbino_match()`
- SECURITY INVOKER; EXECUTE ad authenticated e service_role, non anon.
- Richiede admin, stato live a full time, evento fulltime e pollId.
- Archivia una sola volta per poll_id; rimuove i conteggi MVP dallo snapshot.
- Non legge lo stato test. La chiamata frontend archivio è disabilitata in TEST_MODE secondo il codice ispezionato.

### `publish_santalbino_scheduled_content()`
- SECURITY INVOKER; EXECUTE solo postgres/service_role; non anon/authenticated.
- Cron la esegue ogni minuto.
- Aggiorna sia `live_state` sia `live_test_state`: sposta publication.pending.content in publication.published quando status=scheduled e scheduledAt è passato; incrementa rev.
- **Non invia a Facebook o Instagram.** È uno scheduler della pagina live e del suo ambiente test, non un publisher Meta.
- Il cast di `scheduledAt` a timestamptz presuppone una data valida. La UI deve validare il formato prima di scrivere lo stato.

## 2. RLS, grants e trigger
- RLS attiva su tutte le tabelle pubbliche esaminate.
- `live_state`: SELECT pubblico; INSERT/UPDATE policy solo authenticated admin. I grants SQL anon/authenticated sono ampi, ma le policy RLS non danno a anon alcun INSERT/UPDATE. L'autorizzazione effettiva va considerata come combinazione grants + RLS, non dai grants isolati.
- `live_test_state`: SELECT pubblico; UPDATE solo authenticated admin. Nessuna policy anon per scrittura.
- `match_archive`: SELECT pubblico; INSERT/DELETE admin.
- `mvp_votes`: SELECT solo admin; le policy anon per inserimento non compaiono nell'inventario, il voto pubblico sembra gestito da RPC/altro percorso da verificare in un audit specifico.
- `santalbino_social_publications`: SELECT admin; INSERT/UPDATE/DELETE via service_role (Edge Function); 0 righe al controllo.
- Nessun trigger su tabelle public restituito da `information_schema.triggers`; la sincronizzazione principale è RPC + Realtime.
- La tabella `santalbino_admins` ha un record; nessuna identità è inclusa in questo documento.

## 3. Sincronizzazione frontend

### Flusso verificato
1. `TEST_MODE` seleziona `live_test_state` e `save_santalbino_test_state`; altrimenti `live_state` e `save_santalbino_live_state`.
2. Stato remoto caricato con SELECT della riga id=1.
3. `commit()` incrementa rev locale, salva bozza locale, aggiorna UI e pianifica `publishNow()`.
4. `publishNow()` imposta expectedRev=remoteRev e invia lo snapshot via RPC.
5. Se la RPC restituisce 40001, il client mostra conflitto e non sovrascrive lo stato remoto.
6. Realtime ascolta UPDATE della tabella selezionata; aggiorna solo quando la revisione remota è maggiore e il client è in stato sync ok.
7. Refresh periodico, riconnessione e ritorno alla pagina tentano un riallineamento.
8. Bozza localStorage e stash sessionStorage hanno chiavi separate per test e produzione.

### Finding SYNC-01 — isolamento test non fisico
Il frontend usa tabelle e RPC distinte, e le chiavi localStorage sono distinte; tuttavia:
- stesso progetto Supabase;
- stesso bucket Storage `santalbino-media`;
- il test importa intenzionalmente riferimenti sponsor dalla riga live;
- il cron aggiorna sia la riga live sia quella test.
Questo è un isolamento applicativo, non una sandbox. Il blocco upload in TEST_MODE è utile ma non equivale a progetto/credenziali/storage separati.
**Raccomandazione:** ambiente Supabase locale o progetto dedicato per test con mock publisher. Non creare/aggiornare tabelle ufficiali o asset club in test. Non confondere la pagina pubblica di prova con un ambiente backend isolato.

### Finding SYNC-02 — salvataggio JSON senza schema stretto
Le RPC verificano tipo object e revisione, ma non un contratto versionato o whitelist delle proprietà. I nuovi campi `clubLogo`, `hashtagSource` e configurazione club devono essere validati e introdotti con migrazione backward-compatible, non accettati in modo arbitrario.
**Raccomandazione:** definire `stateSchemaVersion` e normalizzazione client/server; evitare di respingere vecchi stati durante rollout graduale.

### Finding SYNC-03 — reset partita conserva i loghi posizionali
`resetMatch()` non azzera `S.logos`; ciò evita di perdere gli asset, ma il modello attuale conserva URL home/away e può presentare il logo club sul lato errato quando `ourSide` cambia. La soluzione è una proprietà club canonica, non cancellare i loghi nel reset.

### Finding SYNC-04 — bozza locale dispositivo-specifica
La bozza principale usa localStorage; il recupero viene offerto all'admin se la revisione locale è più recente. È una rete di sicurezza per lo stesso browser/dispositivo, non una coda multi-device e non sostituisce il salvataggio remoto. Va mantenuta distinta dalla coda editoriale social.

## 4. Rischi e decisioni
- Non sono emersi trigger SQL pubblici; Realtime non è alimentato da trigger applicativi custom.
- RLS e SECURITY INVOKER sono presenti sulle RPC di salvataggio; evitare di trasformarle in SECURITY DEFINER senza necessità e revisione.
- Il cron pagina live non deve essere riutilizzato per Meta.
- Il test non deve scrivere asset ufficiali né essere considerato isolato dal progetto live.
- Il nuovo logo club va salvato in configurazione club persistente; il riferimento deve essere leggibile dai renderer senza duplicarlo in home/away.
- Il tag partita deve essere generato e salvato dentro lo stesso flusso di creazione/salvataggio match, distinguendo auto/manuale.

## 5. Gate prima di sviluppo
1. Specifica schema versionato e migrazione compatibile per `clubLogo`, `hashtagSource`.
2. Progetto Supabase test/local separato per prove che richiedono schema, Storage e publisher.
3. Test optimistic concurrency su due sessioni; mantenere 40001 e recovery esplicito.
4. Test che il cron test non possa mai provocare pubblicazioni reali; verificare che le due righe state restino separate.
5. Test RLS anon/authenticated admin per tutte le RPC e tabelle toccate.
6. Nessuna migration o modifica live finché non approvata e integrata nel branch autorizzato.

## 6. Limiti
Non sono state eseguite prove con sessioni browser, token admin o Graph API. Le conclusioni sul client derivano dal codice main; quelle DB dalle definizioni e policy restituite dal catalogo live. Questo audit non sostituisce la revisione indipendente Claude/Gemini.
