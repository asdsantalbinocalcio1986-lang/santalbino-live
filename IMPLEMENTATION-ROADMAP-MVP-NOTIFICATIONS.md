# SANTALive — MVP e notifiche partita

Questo documento accompagna la prima implementazione della votazione MVP a quattro candidati e definisce il completamento tecnico del sistema notifiche.

## MVP — comportamento richiesto

- La regia seleziona quattro giocatori dalle formazioni ufficiali.
- La selezione deve contenere almeno un giocatore per squadra; il sistema verifica esattamente quattro chiavi distinte.
- La selezione è salvata nello stato della partita e sincronizzata come gli altri contenuti della regia.
- La votazione si apre dopo il Full Time e resta aperta 12 ore.
- Il pubblico vede esclusivamente i quattro candidati, divisi per squadra.
- È consentito un voto per identificativo browser e partita, come nel sistema esistente.
- La regia può modificare i candidati finché la votazione non è aperta; una volta aperta, la selezione si blocca.
- Il backend valida nuovamente la lista: non è sufficiente nascondere gli altri giocatori nell'interfaccia.
- La simulazione resta isolata e non scrive nella votazione ufficiale.

## Notifiche — specifica funzionale

### Tipologie predefinite

| Evento | Predefinito |
|---|---|
| Kick Off | Attivo |
| Half Time | Attivo |
| Full Time | Attivo |
| Goal | Attivo |
| Ammonizione | Disattivo |
| Espulsione | Disattivo |
| Sostituzione | Disattivo |
| Infortunio | Disattivo |
| Apertura voto MVP | Disattivo |

Le preferenze sono predefinite, non un'autorizzazione all'invio automatico. Un evento registrato o sincronizzato non deve generare da solo una notifica.

### Flusso editoriale obbligatorio

1. La regia registra o modifica l'evento.
2. Il pannello mostra se quel tipo di evento è abilitato nelle preferenze e permette un override per il singolo evento.
3. La regia visualizza l'anteprima e sceglie esplicitamente **Invia notifica** oppure lascia l'evento senza notifica.
4. Solo l'approvazione esplicita crea un elemento nell'outbox.
5. L'outbox invia una sola volta la notifica, registra esito/errore e impedisce duplicati.
6. Correzioni successive all'evento non devono reinviare automaticamente una notifica già spedita.

### Canali

- **In-app / Realtime:** messaggio o banner nella pagina della partita per gli utenti collegati. Non richiede il permesso browser Push.
- **Web Push:** notifica anche quando il sito non è aperto, solo dopo consenso esplicito del visitatore e sottoscrizione del browser/dispositivo.
- **Iscrizione:** l'utente può iscriversi a una squadra o a una singola partita e revocare il consenso in modo semplice.
- **Preferenze:** le preferenze personali filtrano ulteriormente le tipologie consentite dalla regia.

### Componenti tecnici da completare

- Tabella privata delle sottoscrizioni Push (endpoint e chiavi cifrate/protette; nessuna lettura pubblica).
- Tabella outbox con stato pending/sent/failed/cancelled, riferimento univoco all'evento e timestamp di approvazione/invio.
- Funzioni server-side che verificano l'amministratore prima di approvare/inviare e che non accettano invii generici dal client pubblico.
- Edge Function di invio Web Push con VAPID, gestione delle sottoscrizioni scadute e registrazione degli esiti.
- Service Worker: gestione evento push, visualizzazione notifica e apertura del link corretto alla partita.
- Interfaccia pubblica per consenso, iscrizione/disiscrizione e preferenze.
- Interfaccia regia per preferenze predefinite, override per evento, anteprima e invio esplicito.

### Configurazione e collaudo

Prima dell'attivazione Web Push occorrono chiavi VAPID (pubblica, privata e subject) configurate come segreti Supabase, non nel repository e non nel browser. La chiave pubblica può essere esposta al client per la sottoscrizione.

Collaudo obbligatorio in partita di prova:
- consenso negato, concesso e revocato;
- browser Android e PWA iOS compatibile;
- utente iscritto e non iscritto;
- evento registrato senza approvazione (zero notifiche);
- invio approvato una sola volta;
- evento modificato dopo l'invio (nessun reinvio);
- errore endpoint scaduto e relativa disattivazione;
- verifica che nessun dato della partita ufficiale venga modificato durante i test.

## Principi di sicurezza e prodotto

- Mai esporre service-role o VAPID privata nel frontend.
- RLS su tutte le tabelle esposte; sottoscrizioni e outbox non sono leggibili pubblicamente.
- L'utente deve poter revocare il consenso.
- La regia mantiene il controllo editoriale: registrazione, pubblicazione e notifica sono operazioni distinte.
- Le notifiche predefinite Kick Off, Half Time, Full Time e Goal sono selezionate come impostazione iniziale, ma l'invio richiede comunque l'azione esplicita della regia.


## Stato implementazione tecnica (branch di sviluppo)

- Preparato lo script `supabase-phase3-notifications-setup.sql` con tabelle private per impostazioni partita, sottoscrizioni e outbox; RLS attiva e accesso diretto anon/authenticated revocato.
- Preparata la Edge Function `supabase/functions/santalive-notifications/index.ts` per consenso/sottoscrizione, revoca, preferenze, impostazioni regia e invio esplicitamente approvato.
- Preparata la gestione Push nel Service Worker; versione cache incrementata.
- Le chiavi VAPID non sono presenti e non sono state configurate; il Web Push non è attivabile. Il canale in-app Realtime è predisposto nel codice ma richiede il deploy della Edge Function.
- L'interfaccia pubblica di iscrizione/revoca e il pannello regia per preferenze e invio/override sono presenti nel branch.
- Lo script SQL e la funzione Edge non sono stati applicati/distribuiti nel progetto Supabase di produzione.
- Il controllo MVP lato database usa la rosa pubblicata quando disponibile, in coerenza con i candidati mostrati dalla pagina pubblica, e normalizza il marcatore GK.


### Note operative Edge Function

- La funzione gestisce endpoint pubblici di iscrizione/revoca e azioni amministrative nello stesso handler: va distribuita con verifica JWT del gateway disattivata (`--no-verify-jwt`) e controllo della chiave applicativa `apikey` nel codice. Le azioni amministrative verificano comunque il JWT utente e la RPC `is_santalbino_admin()`.
- Segreti server richiesti: `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. La service role e la chiave VAPID privata non devono mai essere inserite nel client o nel repository.
- La sottoscrizione è distinta per coppia partita/endpoint: lo stesso browser può seguire più partite.
- Le tabelle non concedono accesso diretto al browser; tutte le operazioni passano dall'Edge Function.


### Interfacce aggiunte nel branch

- La pagina pubblica mostra il comando di opt-in per la singola partita solo quando la chiave VAPID pubblica è configurata e il browser supporta Push.
- La regia dispone di una scheda Notifiche per leggere e salvare le categorie abilitate e di un pulsante esplicito "Invia notifica" sugli eventi supportati della cronaca.
- Se una categoria è disattivata, l'override richiede una seconda conferma esplicita. La stessa notifica non può essere inviata due volte.
- Il browser mantiene una sottoscrizione Push riutilizzabile tra partite; disattivare una singola partita revoca solo quella relazione e non le altre partite.

### In-app Realtime

- La Edge Function invia un broadcast su un topic derivato da hash (senza esporre il codice partita nel nome del canale), esclusivamente dopo l'approvazione esplicita della regia.
- La pagina pubblica ascolta il canale della partita e mostra il messaggio mentre l'utente sta seguendo la diretta.
- Il broadcast non richiede il permesso browser Push; il Web Push resta un canale separato per chi non ha la pagina aperta.
- L'outbox registra separatamente il flag `in_app_sent`.
- Se VAPID non è ancora configurata, l'invio approvato può comunque raggiungere gli utenti collegati tramite Realtime; il risultato segnala che il canale Push non è ancora attivo.
