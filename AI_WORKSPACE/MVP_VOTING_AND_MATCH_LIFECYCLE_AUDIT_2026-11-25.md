# Audit votazione MVP e ciclo partita — 2026-11-25

## Votazione MVP — percorso verificato
- `cast_santalbino_mvp_vote(p_candidate_key, p_voter_hash)` è SECURITY DEFINER, search_path fissato `public, pg_temp`; EXECUTE è concesso ad anon, authenticated e service_role.
- La funzione legge esclusivamente lo stato partita live, richiede evento fulltime, rifiuta voti dopo 12 ore e dopo evento MVP, valida il lato/candidato contro la rosa, applica `ourOnly` e inserisce una riga in `mvp_votes`.
- La PK/unique `(match_key, voter_hash)` impedisce più voti con lo stesso identificativo nella stessa partita.
- `get_santalbino_mvp_vote_counts` è SECURITY INVOKER, richiede admin e restituisce i conteggi solo per il pollId corrente.
- RLS su `mvp_votes`: SELECT solo admin; la scrittura pubblica passa dalla funzione SECURITY DEFINER. Non è stato eseguito alcun voto di test.

## Finding MVP-01 — identificativo votante controllato dal client
Il frontend genera UUID con `crypto.randomUUID()` e lo conserva in localStorage. La RPC riceve `p_voter_hash` dal client; la funzione valida il formato UUID ma non prova che il chiamante sia la stessa persona che ha generato l'identificativo. Un utente può cancellare/modificare lo storage o chiamare la RPC con UUID differenti. Il vincolo unique impedisce duplicati per UUID, non voti multipli della stessa persona/dispositivo.
**Valutazione:** è un meccanismo anti-duplicazione di base, non un sistema robusto di identità o anti-frode. Non va descritto agli utenti come "un voto per persona" garantito. Se si vuole aumentare l'affidabilità: rate limit server-side (es. IP hash con retention minima e protezione privacy), CAPTCHA/risk control, oppure login/identità verificata; nessuna di queste opzioni va aggiunta senza decisione prodotto/privacy.

## Ciclo partita — punti rilevanti
- `saveMatch()` aggiorna i campi match e salva `hashtag` esattamente come inserito; non genera tag dall'avversario.
- `resetMatch()` pulisce eventi, cronaca, pollId, orologio, rose, convocati, date, voti e social draft; conserva `S.logos`, i nomi squadre, `ourSide` e hashtag correnti.
- Conservare il logo club al reset è corretto come obiettivo; il problema è che il modello attuale conserva due slot posizionali, non un riferimento club canonico.
- Conservare l'hashtag corrente al reset può lasciare il tag della partita precedente quando viene inserito un nuovo avversario. Il nuovo flusso deve rigenerare il tag se la sorgente è auto; se manuale, deve chiedere/preservare override secondo UX definita.
- La local draft è separata fra test e produzione via chiavi `cronaca-live-test-draft-v1` e `cronaca-live-draft-v2`; recupero locale è per dispositivo.

## Requisiti aggiuntivi
- MVP: descrivere il limite del voto pubblico; non cambiare schema in questa attività.
- Reset nuova partita: mantenere clubLogo e impostazioni club, azzerare i dati specifici match; azzerare hashtag auto precedente e rigenerare appena noto il nuovo avversario; non cancellare override manuale senza avviso.
- Aggiungere test per reset, cambio avversario, cambio ourSide, votazione MVP e protezione contro chiamate RPC anon non valide.

## Limiti
Audit di definizioni SQL e codice main, read-only. Nessun dato MVP letto in chiaro oltre al conteggio righe della tabella, nessuna identità votante, nessun voto, nessuna chiamata RPC pubblica eseguita.
