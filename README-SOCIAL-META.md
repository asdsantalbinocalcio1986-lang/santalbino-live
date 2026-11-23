# Pubblicazione automatica Meta — SANTA Live

Questa integrazione pubblica su una Pagina Facebook e su un account Instagram professionale collegato. La pubblicazione è **bloccata lato server per impostazione predefinita**: finché `META_PUBLISH_ENABLED` non è impostato esplicitamente a `true`, la Edge Function rifiuta ogni richiesta di pubblicazione. Non sbloccare il flag prima dei test tecnici su account di prova e dell'autorizzazione esplicita.

## Eventi automatici

Per impostazione iniziale vengono pubblicati soltanto:
- gol;
- espulsioni;
- intervallo;
- fine partita.

La regia genera la grafica dell'evento, la carica nel bucket pubblico `santalbino-media` e invoca la Edge Function. La modalità Partita di prova non chiama mai la funzione.

## Prerequisiti Meta

1. La destinazione Facebook deve essere una **Pagina**, non un profilo personale.
2. Instagram deve essere un account **Business o Creator** collegato alla Pagina Facebook (la verifica tecnica confronta l'ID Instagram restituito dalla Pagina con quello configurato).
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
| `META_GRAPH_API_VERSION` | Versione Graph API attiva; il codice usa `v27.0` come default | 
| `META_PUBLISH_ENABLED` | Lasciare assente o impostare `false`; impostare `true` soltanto dopo test completati e autorizzazione esplicita |

I token non devono essere inseriti in `config.js`, nel browser, in GitHub o in chat. La funzione usa il token solo lato server e controlla che la chiamata provenga dall'amministratore registrato in `santalbino_admins`. Il controllo di stato legge anche `connected_instagram_account` dalla Pagina e verifica che il relativo ID coincida con `META_IG_USER_ID`. La verifica dell'account Instagram legge soltanto ID e username: non dipende dal campo `account_type`.

## Attivazione

1. Aprire la regia ufficiale e accedere come amministratore.
2. In **Impostazioni → Pubblicazione automatica Facebook e Instagram**, premere **Verifica collegamento Meta**: deve mostrare la Pagina e l'account Instagram corrispondente.
3. Finché `META_PUBLISH_ENABLED` è assente o `false`, l'interfaccia non consente di attivare la pubblicazione e la Edge Function rifiuta le richieste con HTTP 403.
4. Solo dopo test tecnici completati su account Meta di prova e autorizzazione esplicita, impostare `META_PUBLISH_ENABLED=true`; quindi verificare nuovamente il collegamento e attivare le piattaforme desiderate.
5. Verificare il registro degli invii.

La funzione è idempotente per ID evento: una richiesta ripetuta non ripubblica un evento già completato. Gli esiti Facebook e Instagram sono registrati separatamente; se una piattaforma fallisce, un nuovo tentativo non ripubblica quella già riuscita.

## Test e sicurezza

- Non usare eventi reali per collaudare l'invio.
- La Partita di prova non esegue pubblicazioni.
- Eseguire prima il controllo `status`, che è di sola lettura e non crea post.
- Verificare la relazione Pagina↔Instagram tramite il campo Meta `connected_instagram_account`; in caso di ID non corrispondenti la funzione deve restare non pronta.
- Collaudare la generazione delle grafiche in Partita di prova: questa modalità non chiama la Edge Function.
- Per un test end-to-end di pubblicazione usare una Pagina Facebook e un account Instagram Business dedicati ai test, non gli account ufficiali. Solo in un progetto Supabase di test impostare temporaneamente `META_PUBLISH_ENABLED=true`.
- Mantenere il flag assente/`false` nel progetto ufficiale fino a conclusione dei test e autorizzazione esplicita.
- Se Meta richiede Page Publishing Authorization (PPA), completarla prima di tentare la pubblicazione Instagram.
- Il token Page deve essere mantenuto valido e rinnovato quando necessario.
- Per il percorso Facebook Login, le autorizzazioni richieste sono `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic` e `instagram_content_publish`; Meta può richiedere ulteriori accessi in base ai ruoli e alla configurazione dell'app.
- La Graph API attualmente documentata da Meta usa `v27.0`; ricontrollare la versione prima di futuri aggiornamenti.
- Instagram richiede che l'immagine sia raggiungibile pubblicamente durante la pubblicazione.
- La funzione accetta immagini esclusivamente dal percorso pubblico `santalbino-media/social/` del progetto Supabase.
