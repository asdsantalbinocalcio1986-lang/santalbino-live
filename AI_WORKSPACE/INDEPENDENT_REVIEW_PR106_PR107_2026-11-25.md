# SANTALive — revisione indipendente preliminare PR #106/#107
Data: 2026-11-25
Perimetro: lettura delle patch GitHub e dei documenti/test di ramo. Nessun checkout, modifica codice, test runtime o contatto con Meta eseguito.

## 1. Baseline e relazioni Git
- Main osservato nel confronto GitHub: `8166deeb4b70397af9b021b9420f93afdab2501f`.
- PR #106 branch `feat/postmatch-editorial-drafts`: 58 commit ahead, 0 behind; 9 file modificati.
- PR #107 branch `feat/social-copy-editor`: 17 commit ahead, 0 behind; 3 file modificati.
- Entrambe le PR condividono esattamente la stessa base main e non includono i commit dell'altra. Il loro stato mergeable non dimostra che il merge funzionale combinato sia privo di regressioni.
- I due file condivisi sono `regia.html` e `.github/workflows/pages.yml`. La patch workflow #107 aggiunge un singolo step UI guard al job principale; #106 aggiunge due job di test post-match separati.
- Non sono stati rilevati commenti/review GitHub nelle timeline consultate.

## 2. PR #106 — editor post-partita
### Aspetti positivi osservati
- La proposta SQL non è presentata come migration pronta: commenti e documentazione la qualificano come proposal only.
- L'editor salva caption, snapshot, percorso grafica e hash; approvazione separata dal publisher.
- Le funzioni SQL usano SECURITY DEFINER con search_path vuoto, controllano l'amministratore, e limitano execute agli utenti autenticati.
- Lock advisory per partita/ambiente serializza la creazione e l'approvazione delle revisioni.
- Il bucket proposto è privato, immagini JPEG limitate a 8 MiB; URL firmate per la lettura.
- La UI non collega l'approvazione editoriale alla Edge Function social e blocca WhatsApp in test mode.
- I test proposti usano PostgreSQL effimero e Supabase locale, non il progetto live.

### Finding PM-01 — hash dichiarato ma non verificato sui byte
**Severità: media / integrità contenuto.**
La RPC `save_santalbino_postmatch_revision` verifica che `p_graphic_sha256` abbia formato esadecimale a 64 caratteri e che l'oggetto Storage esista, ma non ricalcola né confronta SHA-256 dei byte effettivamente memorizzati. Il client calcola l'hash prima dell'upload, ma la RPC non dimostra che il contenuto remoto corrisponda. Per un controllo forte, calcolare/verificare i byte in un ambiente trusted (Edge Function con service role o processo server-side) oppure documentare esplicitamente che l'hash è una dichiarazione del client e non un controllo d'integrità server-side. Aggiungere test mismatch.

### Finding PM-02 — isolamento test/prod solo logico
**Severità: alta se usato come ambiente di test condiviso.**
La colonna `environment` e il prefisso Storage separano le query e i percorsi, ma entrambi sono nello stesso progetto Supabase e le RPC permettono a un admin di indicare entrambi i valori. La documentazione lo ammette correttamente. Non installare né validare il nuovo schema nel progetto live per provare la modalità test. Usare un progetto Supabase separato con credenziali indipendenti oppure un database locale effimero.

### Finding PM-03 — test locale Supabase e migration chain
**Severità: media / CI.**
Il workflow sposta `supabase/migrations` fuori dal percorso e avvia Supabase locale, poi lo script di test crea/usa il proprio schema. Va verificato che il test sia davvero indipendente dalle migration richieste dal progetto e che il comando `supabase init` non sovrascriva file del repository in modo inatteso. Eseguire CI combinata e verificare che nessun job deploy parta per pull_request.

### Finding PM-04 — snapshot dimensionale
**Severità: bassa-media.**
La RPC verifica che `snapshot` sia un oggetto JSON ma non impone un limite dimensionale o una whitelist di chiavi. La UI produce una snapshot ridotta, ma una chiamata RPC diretta admin può salvare payload molto grandi o campi non previsti. Considerare limite byte/chiavi lato DB e test per payload anomalo.

### Finding PM-05 — upload orfano e cleanup
**Severità: bassa.**
La UI tenta la rimozione dell'upload se il salvataggio RPC fallisce. Se la richiesta RPC va in timeout dopo il commit, il client può interpretare il risultato come fallimento e provare a eliminare un file che è già referenziato; la policy delete dovrebbe bloccarlo. Verificare che il fallimento cleanup venga gestito senza mascherare l'esito originale e che esista un processo admin per gli orfani effettivi.

## 3. PR #107 — editor testi social
### Aspetti positivi osservati
- MATCH DAY e convocati diventano modificabili e salvabili in `S.socialDrafts`.
- Rigenerazione è esplicita; il testo esatto della textarea viene copiato.
- La modalità test blocca l'apertura dei canali esterni nelle azioni introdotte.
- La UI distingue condivisione manuale Facebook/WhatsApp dall'autopublisher Meta.

### Finding SC-01 — persistenza locale e semantica "bozza"
**Severità: media / aspettativa prodotto.**
La patch salva `S.socialDrafts` tramite `commit(true)`, cioè nello stato applicativo condiviso/locale già usato dal controllo regia; non introduce una coda editoriale server-side con autore, approvatore, revisione, pianificazione o audit. Il nome "bozza" non deve essere interpretato come contenuto multi-dispositivo o programmabile. La futura coda social deve avere una persistenza server-side separata e snapshot immutabile.

### Finding SC-02 — popup Facebook con noopener
**Severità: bassa / UX.**
La patch chiama `window.open(..., 'noopener')` e poi usa il valore restituito per mostrare l'eventuale messaggio "popup bloccato". In alcuni browser/modalità, `noopener` può rendere nullo il riferimento anche quando la finestra è stata aperta; il toast può quindi segnalare falsamente un popup bloccato. Meglio aprire con `noopener,noreferrer` ma verificare il successo con un pattern compatibile, oppure non dedurre il blocco dal valore restituito quando si usa noopener.

### Finding SC-03 — contenuto condiviso e link
**Severità: bassa / qualità editoriale.**
Il testo MATCH DAY include hashtag e la condivisione aggiunge nuovamente `S.match.hashtag` o `#SANTALive`; è possibile avere hashtag ripetuto. Quando si integra il generatore automatico hashtag, definire un'unica funzione di composizione e deduplicare token senza alterare il testo manuale.

### Finding SC-04 — nessuna programmazione né invio automatico editoriale
**Severità: informativo / scope.**
La PR #107 implementa apertura dialog Facebook e WhatsApp precompilato, non Graph API publish, coda server-side, schedulazione, retry o approvazione. Non è la funzionalità di condivisione automatica richiesta. Riutilizzare gli editor come producer di bozze, ma collegarli in una fase successiva al flusso editoriale server-side e al publisher Meta già esistente.

## 4. Integrazione #106 + #107
1. La base comune è confermata, quindi non occorre prima aggiornare un ramo rispetto all'altro.
2. Integrare #106 e #107 in un branch temporaneo con merge a tre vie; conservare tutte le funzioni social-copy e post-match.
3. Riconciliare workflow preservando i due job #106 e lo step guard #107, senza duplicare installazioni o cambiare il deploy gate.
4. Eseguire test UI guard di entrambe le PR sul file combinato; eseguire SQL e Supabase local test #106; eseguire browser E2E #106 e prova browser manuale #107.
5. Aggiungere i finding PM-01..05 e SC-01..04 ai criteri di accettazione o motivare le eccezioni.
6. Non installare la proposta SQL su Supabase live e non collegare l'approvazione post-match alla pubblicazione automatica.
7. Nessun merge su main o deploy finché non esiste una PR combinata revisionata.

## 5. Gate per automazione social
Prima di programmare MATCH DAY/convocati/formazioni/post-match:
- coda server-side distinta dal log degli invii;
- approvazione esplicita e snapshot immutabile;
- scheduler server-side che funzioni a browser chiuso;
- claim atomico e lease;
- chiave idempotente per revisione e piattaforma;
- stato `unknown/reconciliation_required` per esiti Meta ambigui;
- retry limitato alla piattaforma certamente fallita;
- kill switch server-side;
- test Meta mock senza traffico esterno;
- readiness account verificata solo dopo autorizzazione esplicita, senza esporre token.

## 6. Raccomandazione
PR #106 e #107 sono una base utile, ma non vanno considerate pronte per merge/produzione senza revisione combinata. #106 ha un buon impianto di revisioni e approvazione; #107 risolve la composizione e condivisione manuale. L'automazione editoriale resta un progetto distinto, da realizzare riutilizzando il publisher e introducendo la coda server-side.

