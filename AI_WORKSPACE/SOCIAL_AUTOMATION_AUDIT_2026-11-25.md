# SANTALive — audit e preparazione condivisione automatica social
Data: 2026-11-25
Ambito: audit read-only su main e Supabase; proposta di prodotto/architettura, non implementazione.

## 1. Obiettivo
Preparare una condivisione automatica affidabile dei contenuti SANTALive verso la Pagina Facebook del club e l'account Instagram professionale collegato, senza dipendere dal browser dell'operatore. La pubblicazione deve essere tracciabile, idempotente per quanto tecnicamente possibile, recuperabile e subordinata alle regole di approvazione definite per ciascun tipo di contenuto.

Nessuna pubblicazione reale, chiamata di prova verso Meta, modifica di segreti, scrittura DB/storage, deploy o modifica di codice è stata eseguita durante questo audit.

## 2. Stato verificato nel codice main
Baseline frontend: `regia.html`, blob SHA `e1517806a0f6d49ebfd884600ebe7b5fe0058a64`.
Edge Function sorgente main: `supabase/functions/santalive-social-publish/index.ts`, blob SHA `b9349c9d128115f29d17141ee61a3321b8c525fb`.

### 2.1 Publisher Meta già esistente
- Esiste la Supabase Edge Function `santalive-social-publish`, attiva in produzione come versione 2 con JWT obbligatorio.
- La funzione usa credenziali server-side: `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN`, `META_IG_USER_ID`, `META_PUBLISH_ENABLED` e `META_GRAPH_API_VERSION`.
- La funzione autentica l'utente e verifica la presenza del suo ID in `santalbino_admins`; il percorso publish non è destinato a utenti pubblici.
- L'azione `status` controlla i segreti Meta e interroga la Pagina Facebook per verificare l'account Instagram collegato e la corrispondenza dell'ID.
- L'azione `publish` è bloccata se `META_PUBLISH_ENABLED` non è esattamente `true`.
- Sono supportate le piattaforme Facebook e Instagram e le tipologie evento ammesse sono attualmente solo `goal`, `red`, `halftime`, `fulltime`.
- La grafica deve essere un'immagine pubblica nel percorso del bucket `santalbino-media/social/`; il publisher verifica raggiungibilità, MIME image e dimensione massima di 8 MiB.
- La funzione crea/aggiorna un record in `santalbino_social_publications`, conserva ID dei post/container, stato separato per piattaforma, errori e timestamp.
- Il bucket media è pubblico in lettura; scrittura/aggiornamento/cancellazione sono limitati agli amministratori secondo le policy osservate. Il client impedisce upload media ufficiali in test mode.

### 2.2 Attivazione automatica attuale
- `addEvent()` richiama `autoPublishSocialEvent(ev)`.
- Il client pubblica automaticamente solo gli eventi in `SOCIAL_AUTO_EVENT_TYPES = ['goal','red','halftime','fulltime']`.
- Il client interrompe il flusso se test mode, utente non editor, DB non pronto, configurazione locale disabilitata/non pronta o flag server disabilitato.
- La configurazione locale parte da `enabled: false`; l'operatore deve verificare il collegamento Meta e attivare l'opzione nelle impostazioni. La verifica aggiorna `ready` e `publishingEnabled`.
- Il client genera la grafica evento, la carica in `santalbino-media/social/<match>/<event>.jpg` e invoca la Edge Function con testo e piattaforme selezionate.
- È presente una funzione manuale di nuovo tentativo che rilegge il record e reinvoca il publisher.

Conclusione: esiste già un'automazione per alcuni eventi della cronaca, ma non equivale ancora a un sistema generale di programmazione e distribuzione automatica dei contenuti editoriali.

## 3. Stato verificato in Supabase (sola lettura)
Progetto: `iedjwctzdvinapwsbwua`.
- Edge Function `santalive-social-publish`: ACTIVE, versione 2, `verify_jwt=true`.
- Tabella `public.santalbino_social_publications`: esiste, RLS attiva, al momento del controllo 0 righe.
- Campi disponibili: `event_id` (unique), `match_id`, `event_type`, `caption`, `image_url`, `platforms`, stato complessivo, stato/errori per Facebook e Instagram, ID post/container e timestamp.
- Policy RLS osservata sulla tabella: solo amministratori possono leggere il registro; non sono state individuate policy client per scrittura diretta. La Edge Function usa service role dopo aver autorizzato l'amministratore.
- È attivo il job pg_cron `santalbino-publish-scheduled-content`, ogni minuto, che esegue `public.publish_santalbino_scheduled_content()`.
- ATTENZIONE: la funzione cron attualmente aggiorna `live_state` e `live_test_state`, spostando `publication.pending.content` a `publication.published` quando `scheduledAt` è scaduto. Non chiama Meta e non inserisce record nel registro social. Il nome del job non prova una programmazione social.
- L'estensione `pg_cron` è presente. Nell'elenco estensioni consultato non risulta `pg_net`; non progettare invocazioni HTTP da Postgres finché non viene verificata e autorizzata una soluzione sicura.
- Le tabelle pubbliche esistenti non includono una coda social editoriale dedicata. Il solo registro delle pubblicazioni non è una coda di bozze/prenotazioni.

I valori dei segreti Meta non sono stati letti né esposti e non è stata eseguita l'azione `status` della Edge Function: la prontezza effettiva degli account non è quindi certificata da questo audit.

## 4. Rischi tecnici da chiudere prima di abilitare più automazioni
1. **Acquisizione non atomica:** il publisher fa SELECT per `event_id`, poi INSERT o UPDATE. La unique constraint evita due righe, ma due richieste concorrenti possono entrambe superare il controllo prima di tentare la pubblicazione. La gestione del conflitto 23505 non costituisce un lock atomico dell'intero flusso.
2. **Lease temporaneo:** lo stato `processing` recente viene trattato come duplicato per 120 secondi. Scaduto il periodo, un secondo tentativo può riprendere un evento mentre il primo è ancora in corso o dopo un timeout ambiguo.
3. **Esito Meta incerto:** se Meta accetta il post ma la risposta si perde, oppure il salvataggio del post ID fallisce, un retry può creare un duplicato. La piattaforma non offre una garanzia generale di exactly-once; progettare stati `unknown/reconciliation_required` e una verifica manuale prima di ritentare casi ambigui.
4. **Stato per piattaforma:** Facebook può riuscire e Instagram fallire (o viceversa). Il retry deve riprendere solo la piattaforma non pubblicata e non alterare il contenuto già pubblicato.
5. **Contenuto mutabile:** testo e immagine sono generati dal client a partire dallo stato corrente. Congelare una snapshot approvata (caption, asset, piattaforme, hash/versione) al momento dell'approvazione, in modo che un cambiamento successivo della partita non modifichi il contenuto in coda.
6. **Scheduler non social:** il job pg_cron esistente aggiorna soltanto lo stato di pubblicazione della pagina live. Non usarlo come prova che i post Meta siano schedulati.
7. **Controllo duplicati e correzioni:** una pubblicazione già completata non deve essere sovrascritta o ripubblicata in automatico. Le correzioni devono creare una nuova revisione esplicitamente approvata.
8. **Test isolation:** `?test=1` usa una tabella diversa nello stesso progetto Supabase; il blocco client sugli upload non è un confine di sicurezza completo. I test social devono usare un publisher mock/sandbox che non contatti Meta.

## 5. Flusso prodotto raccomandato
Un unico flusso editoriale condiviso, non un secondo publisher Facebook:
1. **Bozza:** genera testo e grafica; nessun invio esterno.
2. **Pronta per approvazione:** contenuto completo, piattaforme e orario proposti; preview esatta per Facebook/Instagram.
3. **Approvata / programmata:** l'amministratore approva una snapshot immutabile, seleziona una o entrambe le piattaforme e un orario locale Europe/Rome.
4. **In coda:** scheduler server-side acquisisce il lavoro con lock/lease atomico e registra tentativi.
5. **In pubblicazione:** invio indipendente per piattaforma, salvando subito gli ID restituiti.
6. **Pubblicata / parziale / fallita / esito da verificare:** stati distinti, errori leggibili, nessun retry automatico nei casi di esito ambiguo.
7. **Annullata:** consentito solo prima che il worker abbia acquisito il job.

La UI deve distinguere chiaramente bozza, pronta, programmata, in pubblicazione, pubblicata, parziale, fallita, da verificare e annullata. Deve essere sempre possibile pubblicare manualmente tramite il medesimo flusso controllato.

## 6. Tipologie di contenuto e policy iniziale
| Contenuto | Generazione | Pubblicazione iniziale raccomandata |
|---|---|---|
| Gol / espulsione / intervallo / fine gara | automatica dalla cronaca | automatica solo se l'amministratore abilita esplicitamente il tipo; log e blocco duplicati |
| MATCH DAY | testo e grafica da editor | approvazione umana + eventuale orario programmato |
| Convocati | testo/grafica da editor | approvazione umana + eventuale orario programmato |
| Formazione | testo/grafica da editor | approvazione umana + eventuale orario programmato |
| Risultato finale / post-partita editoriale | bozza generata dai dati gara | approvazione umana obbligatoria nella prima fase |
| Comunicazioni societarie / eventi | editor dedicato o contenuto manuale | approvazione umana obbligatoria |

La pubblicazione automatica editoriale senza revisione potrà essere valutata solo dopo una fase di funzionamento stabile e con policy esplicita per tipologia.

## 7. Architettura da valutare (proposta, non approvata)
- Riutilizzare `santalive-social-publish` come unico adapter Meta; non creare un secondo publisher.
- Separare la **coda editoriale** dal **registro degli invii**. La coda deve conservare contenuto approvato, orario, timezone, piattaforme, stato, chi ha approvato, snapshot/hash e chiave idempotente. Il registro continua a conservare gli esiti API per piattaforma.
- Introdurre acquisizione atomica del job (ad esempio RPC/SQL con `FOR UPDATE SKIP LOCKED` o claim atomico equivalente) e lease con token di proprietà, numero tentativi, heartbeat e scadenza.
- Il worker deve essere server-side e indipendente dal browser. Prima di scegliere pg_cron + HTTP, verificare la disponibilità e la sicurezza dell'estensione/servizio di invocazione e la gestione dei segreti; alternativa: scheduler esterno già disponibile e autorizzato. Nessuna dipendenza dal telefono o dal browser aperto.
- La chiave idempotente deve essere stabile per revisione e piattaforma, non solo per l'evento; mantenere vincoli univoci nel DB.
- Salvare snapshot immutabile di caption e asset approvati; non rigenerare la grafica al momento dell'invio.
- Trattare separatamente gli esiti Facebook e Instagram; retry solo per piattaforme fallite in modo certo. Per esito incerto, sospendere e chiedere riconciliazione.
- Conservare audit trail: autore, approvatore, data approvazione, data programmata, tentativi, risposte API sanificate, URL/ID post.
- Configurazione per piattaforma e per tipologia, con interruttore globale server-side OFF come kill switch.
- Non esporre token Meta nel client, log, errori o risposte; usare solo segreti server-side e rotazione controllata.
- Non usare il job `publish_santalbino_scheduled_content()` esistente per inviare social senza prima progettarne esplicitamente la responsabilità e il perimetro.

## 8. Piano di rilascio proposto
**Fase A — hardening publisher esistente**
- test concorrenti sullo stesso evento e sullo stesso evento con due richieste simultanee;
- test crash/timeout dopo risposta Meta e prima del salvataggio ID;
- test Facebook riuscito + Instagram fallito e viceversa;
- retry idempotente per piattaforma;
- validazione MIME/dimensioni/URL e snapshot immutabile;
- mock Meta obbligatorio in ambiente di test.

**Fase B — programmazione social**
- definire tabella/queue e policy RLS;
- implementare claim atomico, lease e worker server-side;
- supportare timezone Europe/Rome, annullamento e modifica prima del claim;
- dashboard admin e log degli stati;
- test di scheduler con orari simulati, senza chiamate Meta.

**Fase C — integrazione editor**
- collegare MATCH DAY, convocati, formazioni e post-partita al medesimo flusso;
- preview per piattaforma, approvazione e pianificazione;
- mantenere un solo publisher e un unico registro coerente.

**Fase D — attivazione graduale**
- verifica amministrativa del collegamento Meta;
- test controllato su ambiente mock;
- prima attivazione reale con un singolo tipo e una sola piattaforma, dopo approvazione esplicita;
- monitoraggio e procedura di stop/rollback.

## 9. Test di accettazione minimi
- Nessun post esterno in bozza, in test mode o con kill switch OFF.
- Un contenuto approvato non viene acquisito due volte da due worker concorrenti.
- Un timeout ambiguo non causa un retry cieco.
- Il retry di Instagram non duplica il post Facebook già riuscito.
- Modifiche successive al contenuto originale non alterano la snapshot approvata.
- Una modifica/annullamento prima del claim impedisce la pubblicazione programmata.
- Il job funziona anche a browser e telefono chiusi.
- Orari e visualizzazione sono corretti in Europe/Rome, inclusi cambi ora legale/solare.
- Ogni post pubblicato restituisce un riferimento verificabile e lo stato è aggiornato per piattaforma.
- Nessuna pubblicazione di test raggiunge account reali.

## 10. Incarichi per Claude e revisore indipendente
Claude:
1. Verificare ogni finding con riferimenti file/funzione/righe aggiornati.
2. Audit completo del publisher e del percorso client, inclusi tutti gli eventi, i retry, la gestione degli errori e il registro.
3. Analizzare migrazioni, policy RLS, job cron e funzione SQL effettivamente distribuiti; distinguere repo da live.
4. Proporre il più piccolo hardening compatibile con l'architettura; niente implementazione finché non approvata.
5. Fornire test riproducibili per concorrenza, timeout ambiguo, retry parziale e snapshot.

Gemini:
1. Revisione indipendente della sicurezza e del flusso end-to-end.
2. Cercare duplicazioni, race condition, pubblicazioni involontarie, segreti esposti, bypass test e problemi timezone.
3. Contestare le assunzioni e indicare i casi limite non coperti.

## 11. Limiti e autorizzazioni
- Questo documento è una specifica di audit e proposta, non una richiesta di deploy.
- Non leggere, copiare o stampare valori dei segreti Meta.
- Non invocare `action: status` o `action: publish` verso la funzione live senza autorizzazione specifica: status contatta Graph API e publish crea contenuti esterni.
- Non modificare codice, database, storage, cron, segreti, PR di feature, merge o deploy in questa fase.
- Non pubblicare contenuti reali durante test o simulazioni.
