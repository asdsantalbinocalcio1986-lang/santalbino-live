# SANTA Live — notifiche MVP e push

## Funzionalità incluse

- Votazione MVP limitata a quattro candidati selezionati dalla regia, con almeno un candidato per squadra.
- Apertura della votazione dopo il Full Time e chiusura dopo 12 ore.
- Invito MVP in pagina, grafica condivisibile con link diretto e notifica MVP facoltativa.
- Notifiche in-app via Supabase Realtime e Web Push per dispositivi che hanno dato il consenso.
- Tipologie predefinite: Kick Off, Half Time, Full Time e Goal attive; ammonizioni, espulsioni, sostituzioni e MVP disattivate.
- Registrazione di un evento, approvazione della notifica e invio sono operazioni separate. L'invio richiede un'azione esplicita della regia.

## Attivazione sul progetto Supabase

Queste modifiche non applicano automaticamente migrazioni né distribuiscono funzioni sul progetto di produzione.

1. Dopo la revisione e il test del branch, applicare le migrazioni nell'ordine indicato dai timestamp. Prima verificare anche eventuali migrazioni precedenti ancora pendenti.
2. Generare una coppia VAPID, ad esempio con `npx web-push generate-vapid-keys`.
3. Configurare i segreti nel progetto Supabase, senza inserirli nel repository:

   ```sh
   supabase secrets set VAPID_PUBLIC_KEY="..." VAPID_PRIVATE_KEY="..." VAPID_SUBJECT="mailto:indirizzo-di-contatto-della-societa"
   ```

4. Distribuire la funzione:

   ```sh
   supabase functions deploy santalive-push --project-ref iedjwctzdvinapwsbwua
   ```

5. Verificare l'iscrizione e la disiscrizione su Android/Chrome e su iOS/iPadOS con la PWA aggiunta alla schermata Home (iOS/iPadOS 16.4 o successivo).
6. Eseguire una partita dimostrativa: verificare l'invio manuale dalla regia, la ricezione push, il messaggio in-app e l'assenza di invii quando un evento viene soltanto registrato.

## Sicurezza e privacy

- Le sottoscrizioni push sono conservate in tabelle con RLS e senza accesso diretto da anon/authenticated; la Edge Function usa il service role.
- La registrazione della sottoscrizione avviene soltanto dopo il consenso del browser.
- L'invio è riservato all'amministratore autenticato e controlla di nuovo lo stato ufficiale della partita e le preferenze salvate dalla regia.
- Il registro impedisce di inviare due volte la stessa notifica per lo stesso ID evento.
- Il payload contiene titolo, riepilogo, link alla partita e un identificativo evento; non contiene dati personali del votante MVP.
- Il browser può disattivare le notifiche revocando il permesso o usando il comando di disiscrizione in SANTA Live.

## Note operative

Le notifiche Web Push non sono operative finché migrazioni, chiavi VAPID e Edge Function non sono configurate. Le notifiche in-app richiedono la migrazione della tabella Realtime e il salvataggio delle preferenze. La modalità di prova resta esclusa dall'invio.
