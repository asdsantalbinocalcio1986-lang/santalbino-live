# Pubblicazione automatica Meta — SANTA Live

Questa integrazione pubblica automaticamente su una Pagina Facebook e su un account Instagram professionale collegato. La funzione server-side è disattivata fino alla configurazione dei segreti e alla verifica dalla regia.

## Eventi automatici

Per impostazione iniziale vengono pubblicati soltanto:
- gol;
- espulsioni;
- intervallo;
- fine partita.

La regia genera la grafica dell'evento, la carica nel bucket pubblico `santalbino-media` e invoca la Edge Function. La modalità Partita di prova non chiama mai la funzione.

## Prerequisiti Meta

1. La destinazione Facebook deve essere una **Pagina**, non un profilo personale.
2. Instagram deve essere un account **Business o Creator** collegato alla Pagina Facebook.
3. Creare una Meta App e abilitare il percorso Instagram Graph API con Facebook Login.
4. Ottenere un Page Access Token per la Pagina e l'ID dell'account Instagram professionale.
5. Autorizzazioni necessarie per il percorso Facebook Login: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`. La disponibilità effettiva dipende dai ruoli dell'app e dall'eventuale App Review richiesta da Meta.

## Migrazione database

Applicare `supabase/migrations/20261123160000_santalbino_social_publications.sql` al progetto Supabase collegato a SANTA Live (`iedjwctzdvinapwsbwua`). La tabella è vuota e contiene soltanto il registro degli invii; RLS consente la lettura all'amministratore SANTA Live, mentre le scritture sono riservate al backend.

## Edge Function e segreti

Distribuire `supabase/functions/santalive-social-publish/index.ts` con JWT verification attiva:

```sh
supabase functions deploy santalive-social-publish --project-ref iedjwctzdvinapwsbwua
```

Configurare in **Supabase → Edge Functions → Secrets**:

| Segreto | Valore |
|---|---|
| `META_PAGE_ID` | ID della Pagina Facebook |
| `META_PAGE_ACCESS_TOKEN` | Page Access Token con i permessi di pubblicazione |
| `META_IG_USER_ID` | ID dell'account Instagram professionale collegato |
| `META_GRAPH_API_VERSION` | Versione Graph API attiva, ad esempio `v27.0` |

I token non devono essere inseriti in `config.js`, nel browser o nel repository. La funzione usa il token solo lato server e controlla che la chiamata provenga dall'unico amministratore registrato in `santalbino_admins`.

## Attivazione

1. Aprire la regia ufficiale e accedere come amministratore.
2. In **Impostazioni → Pubblicazione automatica Facebook e Instagram**, premere **Verifica collegamento Meta**.
3. Attivare le piattaforme desiderate e salvare.
4. Verificare il registro degli invii.

La funzione è idempotente per ID evento: una richiesta ripetuta non ripubblica un evento già completato. Gli esiti Facebook e Instagram sono registrati separatamente; se una piattaforma fallisce, un nuovo tentativo non ripubblica quella già riuscita.

## Test e sicurezza

- Non usare eventi reali per collaudare l'invio.
- La Partita di prova non esegue pubblicazioni.
- Prima dell'attivazione, verificare il collegamento con Meta e usare un ambiente/app Meta di test.
- Il token Page deve essere mantenuto valido e rinnovato quando necessario.
- Instagram richiede che l'immagine sia raggiungibile pubblicamente durante la pubblicazione.
- La funzione accetta immagini esclusivamente dal percorso pubblico `santalbino-media/social/` del progetto Supabase.
