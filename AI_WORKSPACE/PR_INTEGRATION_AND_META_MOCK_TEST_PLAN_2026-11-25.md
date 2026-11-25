# SANTALive — piano di integrazione PR e contratto test social
Data: 2026-11-25
Stato: specifica preparatoria; nessun codice applicativo modificato.

## 1. Obiettivo
Fornire un percorso sicuro per integrare il lavoro delle PR #106 (editor post-partita) e #107 (editor testi social), mantenendo intatto il publisher Meta esistente e preparando test automatici senza traffico verso Facebook/Instagram.

## 2. Stato delle PR verificato
- PR #106: open, Draft, base main, mergeable=true al momento del controllo. Head branch `feat/postmatch-editorial-drafts`. La descrizione riporta CI #553: validazione, PostgreSQL effimero, Supabase locale e browser E2E superati; deploy saltato. Rimane una proposta SQL, non una migration applicata.
- PR #107: open, Draft, base main, mergeable=true al momento del controllo. Head branch `feat/social-copy-editor`. La descrizione riporta CI #563: validazione e UI guard superati; prova manuale browser ancora da completare. Le azioni Facebook/WhatsApp sono manuali, non pubblicazione automatica.
- PR #108: open, Draft; contiene il workspace AI e l'audit social. Nessuna PR è stata unita.
- #106 e #107 modificano entrambe `regia.html` e `.github/workflows/pages.yml`. Il fatto che GitHub segnali mergeable non sostituisce la revisione funzionale combinata.

## 3. Strategia di integrazione raccomandata
**Non unire #106 e #107 separatamente su main e non copiare un intero file da una PR sopra l'altra.**

Preparare un branch d'integrazione temporaneo a partire dal main aggiornato, ad esempio `integration/editorial-social-106-107`, e applicare entrambe le PR con merge a tre vie o cherry-pick controllato. Il branch deve essere creato e aggiornato solo dopo autorizzazione del coordinatore; questo documento non crea branch né modifica codice.

Ordine logico:
1. Importare #106 e verificare MATCH RESULT, snapshot, revisioni, approvazione, isolamento e test.
2. Integrare #107 mantenendo l'editor MATCH DAY/CONVOCATI, salvataggio bozze e condivisione manuale.
3. Riconciliare `.github/workflows/pages.yml`: conservare il job postmatch SQL, il job Supabase locale/browser e il job social-copy UI guard. Evitare job duplicati, nomi ambigui e condizioni che attivino deploy nei pull request.
4. Controllare i punti d'innesto in `regia.html`: rendering editor, delega eventi, nomi data-action, funzioni di commit, modalità test e apertura/chiusura dialog. Controllare che l'editor post-partita non venga sovrascritto dal vecchio flusso MATCH RESULT e che i testi social non vengano rigenerati al momento della condivisione dopo una modifica manuale.
5. Eseguire l'intera suite di entrambi i rami, non solo i test isolati di ciascuna PR.
6. Produrre una PR di integrazione Draft con tabella dei file, conflitti risolti, test CI, limiti residui e nessuna modifica a main.

Condizioni di stop:
- conflitto semantico non risolto in `regia.html`;
- job CI di una PR perso o disabilitato;
- test che usi il progetto Supabase live o account Meta reali;
- necessità di applicare SQL/bucket in produzione;
- regressione su modalità test, cronaca, FULL TIME, MVP o publisher eventi.

## 4. Vincoli specifici #106
La PR #106 introduce riferimenti a `santalbino_postmatch_editions` e bucket `santalbino-postmatch`, che non risultano presenti nell'inventario live verificato il 2026-11-25. La proposta SQL deve restare non applicata. L'integrazione deve:
- mantenere la separazione draft/approved e la snapshot immutabile;
- mantenere il controllo versione/revisione attesa;
- non consentire condivisione esterna in test mode;
- non collegare automaticamente l'editor al publisher Meta;
- non esporre immagini private tramite URL permanenti;
- non interpretare la presenza dei test locali come prova di readiness del backend live.

## 5. Vincoli specifici #107
La PR #107 aggiunge editor e bozze manuali. Deve restare chiaro che:
- WhatsApp apre un messaggio predisposto ma l'utente sceglie destinatari e invio;
- Facebook condivide il link e copia il testo da incollare;
- non è un'autorizzazione alla pubblicazione automatica editoriale;
- il testo personalizzato salvato come bozza non deve essere sovrascritto da un render o da una rigenerazione non richiesta;
- in test mode nessuna condivisione esterna deve aprirsi.

## 6. Contratto per test del publisher Meta in mock
Obiettivo: testare la Edge Function senza inviare richieste reali a Graph API.

### 6.1 Isolamento obbligatorio
- Il test deve iniettare un trasporto HTTP mock (o equivalente) al posto di `fetch`.
- Il mock deve intercettare tutte le chiamate Graph API e restituire fixture deterministiche.
- Il test deve fallire immediatamente se una richiesta tenta di raggiungere un host non incluso nella allowlist locale del mock.
- Nessun token Meta reale, nessun secret di produzione, nessun account Meta reale.
- Nessun test deve invocare la Edge Function live. Eseguire localmente o in CI con credenziali fittizie.
- Per le prove di upload asset, usare storage Supabase locale o un fake storage; mai il bucket live.

### 6.2 Matrice minima di casi
| ID | Scenario | Risultato atteso |
|---|---|---|
| MOCK-01 | funzione disabilitata lato server | rifiuto prima di qualunque chiamata Meta |
| MOCK-02 | utente non autenticato | 401; nessuna query publish/Meta |
| MOCK-03 | utente autenticato non admin | 403; nessuna chiamata Meta |
| MOCK-04 | test mode / ambiente test | nessun invio esterno; nessuna chiamata Graph |
| MOCK-05 | piattaforma non ammessa o evento non ammesso | validazione rifiutata |
| MOCK-06 | immagine non pubblica, MIME non valido o oltre limite | rifiuto prima della creazione post |
| MOCK-07 | Facebook e Instagram entrambi riusciti | stati e ID registrati per entrambe le piattaforme |
| MOCK-08 | Facebook riuscito, Instagram fallito | stato parziale; ID Facebook persistito; retry non ripubblica Facebook |
| MOCK-09 | Instagram riuscito, Facebook fallito | simmetrico a MOCK-08 |
| MOCK-10 | due richieste simultanee stesso contenuto/revisione | un solo claim valido; nessun doppio invio |
| MOCK-11 | processo cade dopo risposta Meta prima del salvataggio ID | stato ambiguo; niente retry automatico cieco |
| MOCK-12 | Meta risponde 429 | backoff controllato; rispetto Retry-After se presente |
| MOCK-13 | Meta risponde 5xx o timeout prima di esito certo | stato retryable solo se è dimostrabile che il post non è stato creato; altrimenti unknown |
| MOCK-14 | retry di un solo canale fallito | invia solo quel canale; non altera quello riuscito |
| MOCK-15 | stesso evento ma nuova revisione approvata | chiave idempotente distinta e nuova pubblicazione solo su esplicita approvazione |
| MOCK-16 | payload modificato dopo approvazione | snapshot/hash non combaciano; invio bloccato |
| MOCK-17 | segreto mancante o versione Graph non valida | status diagnostico sanificato; nessun secret nella risposta/log |
| MOCK-18 | risposta Meta malformata o priva di ID | esito non considerato pubblicato; stato da verificare |

### 6.3 Requisiti di implementazione testabile
- Separare la logica di orchestrazione dal trasporto Graph, consentendo l'iniezione di un adapter fake.
- Separare il repository DB dall'orchestrazione, consentendo test con DB locale e concorrenza riproducibile.
- Modellare lo stato per piattaforma, non soltanto uno stato globale.
- Usare una chiave idempotente per contenuto approvato + revisione + piattaforma.
- Implementare claim atomico con lease token/owner; una SELECT seguita da INSERT/UPDATE non è sufficiente.
- Persistire l'ID remoto non appena ricevuto e prima di operazioni secondarie.
- Trattare l'esito ambiguo come `unknown/reconciliation_required`; non ritentare automaticamente.
- Registrare errori sanificati e correlation ID; mai access token, URL firmate o header Authorization.
- Testare la concorrenza con due worker e barriera sincronizzata, non con due chiamate casuali sequenziali.

## 7. Test combinati editor + social
- Creazione bozza MATCH DAY e CONVOCATI; modifica manuale; salvataggio; reload; il testo resta identico.
- Rigenerazione esplicita; solo il contenuto scelto viene sostituito.
- Nessuna pubblicazione esterna da bozza.
- Contenuto approvato viene congelato in una snapshot; modifica della partita non modifica la snapshot.
- Modalità test: nessun link esterno, popup, upload al bucket ufficiale o invio Meta.
- Editor post-partita: salvataggio, storico, ripristino e approvazione; nessuna pubblicazione automatica.
- Eventi live già supportati: mantenere comportamento attuale e verificare che l'integrazione editor non lo attivi/disattivi accidentalmente.
- Nessuna regressione a FULL TIME, MVP, voto o timeline.

## 8. Gate di accettazione integrazione
Un branch combinato è candidabile a review solo quando:
- i diff #106 e #107 sono entrambi rappresentati integralmente;
- workflow contiene tutti i job previsti e deploy è skipped nei PR;
- tutti i test esistenti di entrambe le PR passano insieme;
- i test MOCK-01..MOCK-18 sono implementati o ogni omissione è motivata e accettata;
- test browser manuale in ambiente dimostrativo senza invii esterni è documentato;
- nessuna migrazione/bucket viene applicata al progetto live;
- nessuna modifica a main, merge, deploy o post social reale.

## 9. Incarico preparato per Claude (non inviato)
Task ID: `SANTALIVE-INTEGRATION-106-107-MOCK-001`.

Chiedere a Claude di:
1. confermare esattamente i commit head correnti di #106 e #107 e il commit main;
2. restituire una mappa di conflitto per `regia.html` e `.github/workflows/pages.yml`, con funzioni e righe;
3. proporre un piano di merge a tre vie senza applicarlo;
4. verificare se il publisher può essere testato con trasporto Graph iniettato e quali refactor minimi sarebbero necessari;
5. progettare i test MOCK-01..MOCK-18 con file e fixture previsti;
6. identificare i test combinati e i rischi di regressione;
7. non creare branch, non modificare file, non aprire PR, non applicare SQL e non contattare Meta finché non riceve approvazione.

Deliverable richiesto: audit con evidenze, mappa di integrazione, proposta test, blocchi/unknowns. Nessun “implementato” senza commit e test allegati.
