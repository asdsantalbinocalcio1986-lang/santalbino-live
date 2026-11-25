# SANTALive — master plan condivisione e pubblicazione social

**Data:** 2026-11-25  
**Stato:** piano operativo consolidato, pronto per essere assegnato; non è autorizzazione a implementare, configurare account, modificare Supabase o pubblicare.  
**Branch documentazione:** `ai-workspace/bootstrap`

## 1. Risultato che vogliamo ottenere

Quando si deciderà di attivare i social, il lavoro tecnico e funzionale dovrà essere già concluso. Dovranno restare soltanto:
1. collegamento/validazione degli account ufficiali;
2. inserimento dei segreti Meta in Supabase, senza condividerli in chat o repository;
3. scelta delle opzioni operative (piattaforme e tipi di contenuto da abilitare);
4. test finale autorizzato e attivazione graduale.

Il sistema dovrà gestire in modo coerente Facebook e Instagram, ma distinguere chiaramente:
- **condivisione manuale**: l'operatore apre la piattaforma e conferma personalmente l'invio;
- **pubblicazione automatica immediata**: il server pubblica dopo aver superato tutti i controlli;
- **pubblicazione programmata**: il server pubblica all'orario impostato, anche con regia e telefono chiusi.

Queste tre modalità non devono essere confuse né dipendere l'una dall'altra.

## 2. Perimetro funzionale

### 2.1 Tipi di contenuto

| Contenuto | Origine | Modalità iniziale |
|---|---|---|
| MATCH DAY | editor partita | bozza, anteprima, condivisione manuale; predisposto per approvazione e programmazione |
| Convocati | editor partita | bozza, anteprima, condivisione manuale; approvazione prima dell'automatico |
| Formazione | dati partita/editor | bozza, anteprima, condivisione manuale; approvazione prima dell'automatico |
| Gol, espulsione, intervallo, fine gara | cronaca live | mantenere il flusso automatico esistente solo dove già abilitato, dopo hardening |
| Risultato/post-partita | dati gara + editor | bozza modificabile; approvazione umana obbligatoria nella prima release |
| Comunicazioni societarie/eventi | contenuto manuale/editor | bozza e approvazione umana |
| Correzioni di contenuti già pubblicati | nuova revisione | mai sovrascrivere o ripubblicare automaticamente; nuova approvazione |

### 2.2 Piattaforme e contenuti

- Facebook Pagina ufficiale.
- Instagram professionale collegato alla Pagina, se il collegamento e i permessi Meta sono validi.
- Testo, immagine/grafica e hashtag devono essere coerenti tra editor, anteprima e contenuto effettivamente inviato.
- Il testo deve poter essere modificato senza che un successivo render lo sovrascriva.
- Il contenuto approvato deve essere congelato: nessuna modifica successiva alla partita o all'editor può cambiare ciò che è già in coda.

### 2.3 Identità del club e partita

- Hashtag partita generato automaticamente alla creazione, ad esempio `#SantAlbinoRadicofani`; normalizzare accenti, spazi e punteggiatura.
- Conservare la distinzione tra hashtag automatico e override manuale; aggiornare quello automatico se cambia l'avversario, senza alterare quello manuale.
- Evitare hashtag duplicati in preview, copia, WhatsApp e invio.
- Logo ufficiale del club persistente come configurazione club, caricato/selezionato una sola volta; deve apparire sul lato corretto in casa/trasferta senza diventare il logo avversario.
- Logo e hashtag ufficiali devono essere riutilizzati in tutte le tipologie di contenuto, senza richiedere un nuovo caricamento a ogni partita.

## 3. Esperienza operatore desiderata

Ogni contenuto deve mostrare:
- tipo contenuto e partita di riferimento;
- piattaforme destinatarie;
- testo modificabile;
- anteprima per piattaforma;
- grafica/asset associato;
- hashtag applicato una sola volta;
- stato, data/ora e autore;
- azioni disponibili coerenti con lo stato.

Stati minimi e significato:
- **Bozza**: salvata, non approvata, nessun invio possibile.
- **Pronta**: contenuto completo, in attesa di approvazione.
- **Approvata**: snapshot immutabile autorizzata.
- **Programmata**: approvata e in attesa dell'orario.
- **In pubblicazione**: worker server-side ha acquisito il lavoro.
- **Pubblicata**: conferma registrata per la piattaforma.
- **Parziale**: almeno una piattaforma riuscita e un'altra non riuscita.
- **Fallita**: errore certo che impedisce la pubblicazione.
- **Da verificare**: esito esterno incerto; vietato retry automatico cieco.
- **Annullata**: annullata prima che il worker acquisisca il lavoro.

Regole:
- Modificare un contenuto approvato crea una nuova revisione e richiede nuova approvazione.
- Annullare una programmazione è consentito prima del claim; dopo l'avvio l'interfaccia deve dichiarare che l'invio potrebbe essere già partito.
- Il retry deve essere per piattaforma: se Facebook è riuscito e Instagram no, non ripubblicare Facebook.
- Per un contenuto pubblicato, mostrare il riferimento/URL remoto quando disponibile.

## 4. Architettura tecnica da completare

### 4.1 Un solo publisher Meta

Riutilizzare `santalive-social-publish` come unico adapter verso Meta. Non creare un secondo publisher Facebook/Instagram. L'attuale funzione copre gli eventi live goal/red/halftime/fulltime; l'estensione ai contenuti editoriali deve essere esplicita e controllata.

### 4.2 Separazione delle responsabilità

- **Editor/UI**: genera e modifica bozze; non custodisce token Meta e non effettua chiamate Graph dirette.
- **Coda editoriale**: conserva approvazione, revisione, programmazione e snapshot.
- **Delivery per piattaforma**: registra tentativi, stato, ID esterno ed errori distinti per Facebook e Instagram.
- **Worker/scheduler server-side**: acquisisce il lavoro in modo atomico e lo consegna anche se il browser è chiuso.
- **Publisher**: adapter unico, autenticato e autorizzato, verso Meta.
- **Audit trail**: registra chi ha creato, modificato, approvato, programmato, annullato e riconciliato.

La tabella live `santalbino_social_publications` è un registro degli invii eventi live, non una coda editoriale. Non estenderla implicitamente: verificare schema, vincoli e compatibilità prima di decidere il modello definitivo. Il job cron attuale pubblica lo slot della pagina live e **non** invia post Meta.

### 4.3 Sicurezza e affidabilità bloccanti

Prima di estendere l'automazione:
1. sostituire il controllo SELECT-then-UPDATE del publisher con claim atomico/lease e token di proprietà;
2. introdurre idempotenza per contenuto, revisione e singola piattaforma;
3. distinguere errore certo da esito incerto; timeout dopo richiesta Meta deve produrre `unknown/reconciliation_required`, non un retry automatico;
4. impedire che worker scaduti o duplicati sovrascrivano l'esito di un altro worker;
5. registrare subito gli ID esterni restituiti da Meta;
6. retry solo del canale fallito in modo certo;
7. sanificare log e risposte; mai token, header Authorization, URL firmate o payload sensibili;
8. mantenere kill switch server-side globale e per piattaforma/tipo contenuto, default OFF;
9. validare server-side ruoli, contenuto, piattaforme, asset, MIME e dimensioni;
10. verificare che test e preview non possano raggiungere Meta reale.

Non promettere exactly-once: la garanzia realistica è ridurre duplicazioni con idempotenza e sospendere gli esiti ambigui per riconciliazione umana.

### 4.4 Test isolato

- Preferire progetto Supabase test dedicato o Supabase locale.
- `?test=1` non è una sandbox: usa lo stesso progetto Supabase e Storage.
- Iniettare un trasporto Graph mock; test fallisce se tenta di uscire verso host esterni.
- Usare credenziali fittizie, fake storage e fixture deterministic.
- Vietato invocare la Edge Function live come test.
- Il pulsante di condivisione manuale in test non deve aprire piattaforme esterne.

## 5. Difetti già individuati da correggere

### PR #107 — social copy editor

1. **Reset delle bozze non completo (confermato):** `resetMatch()` azzera `L.social`, ma non `S.socialDrafts.matchDay` e `S.socialDrafts.convocati`. Le bozze della partita precedente possono contaminare la nuova. Aggiungere reset selettivo e test di regressione.
2. **Hashtag duplicato (confermato):** `buildMatchDayText()` inserisce già l'hashtag e `shareSocialDraft()` lo aggiunge di nuovo. Normalizzare una sola volta nel punto di composizione finale.
3. **Falso popup bloccato (confermato):** `window.open(..., 'noopener')` può restituire `null` anche se la finestra è stata aperta. Correggere la rilevazione senza rimuovere la protezione `noopener`.
4. **Modalità test:** verificare che non apra Facebook/WhatsApp e non avvii azioni esterne.
5. **Bozza persistente:** testare creazione, modifica manuale, salvataggio, reload, rigenerazione esplicita e reset nuova partita.
6. **Condivisione reale:** test browser controllato con utente che conferma manualmente; nessun invio automatico.

### PR #106 — contenuti post-partita

1. Rimuovere il fallback che salva l'intero stato `S` quando manca lo snapshot specifico; validare subset, schema e dimensione.
2. Gestire esplicitamente errori nel download della grafica in `saveMatchResultGraphic`.
3. Verificare cleanup degli upload se la persistenza della revisione fallisce; documentare e testare gli eventuali orfani.
4. Correggere la semantica SHA: un hash dichiarato dal client non dimostra da solo l'integrità dei byte effettivamente archiviati; verifica server-side o descrizione corretta della garanzia.
5. Aggiornare snapshot e renderer per il logo club canonico, non solo slot posizionali home/away.
6. Mantenere l'approvazione editoriale distinta dalla pubblicazione Meta.

### Integrazione PR #106/#107

- Non unire separatamente su `main`.
- Branch combinato temporaneo solo dopo approvazione, merge a tre vie di `regia.html` e workflow.
- Conservare tutti i job CI delle due PR.
- Correggere i difetti sopra prima della review finale.
- Test combinati su editor, bozze, reset, partita nuova, logo, hashtag, post-partita e modalità test.
- Nessuna migrazione/bucket post-match in produzione senza review e autorizzazione indipendenti.

## 6. Roadmap con gate di completamento

### Fase 0 — chiusura specifica e backlog
- [x] Audit read-only del publisher, RLS, cron, hashtag/logo e PR.
- [x] Architettura proposta di coda e delivery.
- [ ] Registrare questo master plan nel workspace condiviso.
- [ ] Claude: correggere i difetti verificati su branch autorizzato, senza toccare main.
- [ ] Gemini: review indipendente del diff e dei test.
- [ ] ChatGPT: riconciliare evidenze, test e decisione go/no-go.

**Uscita:** backlog senza ambiguità e incarico di sviluppo completo.

### Fase 1 — condivisione manuale affidabile
- [ ] Completare #107 e i fix sopra.
- [ ] Anteprima esatta testo/immagine/hashtag per ogni piattaforma.
- [ ] Copia testo, apertura dialogo Facebook/link, messaggio WhatsApp precompilato; l'utente conferma l'invio.
- [ ] Nessuna duplicazione hashtag o bozza tra partite.
- [ ] Test browser desktop/mobile e test mode bloccato.
- [ ] Nessun token o accesso Meta necessario per la condivisione manuale.

**Uscita:** operatore può condividere contenuti editoriali senza configurare il publisher automatico.

### Fase 2 — hardening publisher esistente
- [ ] Claim atomico e lease.
- [ ] Idempotenza per revisione/piattaforma.
- [ ] Stato unknown e riconciliazione.
- [ ] Retry parziale sicuro.
- [ ] Mock adapter e test concorrenza/timeout/crash.
- [ ] Regressione eventi live: goal, rosso, intervallo, full time.
- [ ] Kill switch e audit trail.

**Uscita:** publisher sicuro per una attivazione limitata, senza ampliare ancora le tipologie editoriali.

### Fase 3 — coda editoriale e programmazione
- [ ] Schema finale e RLS revisionati; migration reversibile.
- [ ] Worker server-side indipendente dal browser.
- [ ] Scheduling Europe/Rome, DST, annullamento/modifica pre-claim.
- [ ] Snapshot immutabile e revisioni.
- [ ] Stati e log per piattaforma.
- [ ] Dashboard operatore e gestione errori/unknown.
- [ ] Test su progetto Supabase separato/locale.

**Uscita:** un post approvato può essere programmato e consegnato a browser chiuso.

### Fase 4 — collegamento degli editor
- [ ] MATCH DAY e convocati.
- [ ] Formazioni.
- [ ] Risultato/post-partita.
- [ ] Comunicazioni societarie.
- [ ] Un solo flusso approvazione → coda → worker → publisher.
- [ ] Le bozze non inviano; le modifiche post-approvazione creano nuova revisione.

**Uscita:** tutti i contenuti social passano da un flusso uniforme.

### Fase 5 — preconfigurazione e attivazione Meta
Da svolgere solo quando le fasi precedenti sono chiuse:
- [ ] Verificare che la Pagina Facebook ufficiale sia amministrata dall'associazione e che l'utente/ruolo autorizzato possa gestire le integrazioni.
- [ ] Verificare che Instagram sia account professionale e correttamente collegato alla Pagina Facebook.
- [ ] Verificare Meta Business/App, modalità, permessi e requisiti di accesso alla Graph API aggiornati alla data di attivazione.
- [ ] Definire chi nell'associazione è titolare degli accessi e chi può ruotare/revocare token.
- [ ] Inserire i segreti richiesti esclusivamente in Supabase Secrets: `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN`, `META_IG_USER_ID`, `META_PUBLISH_ENABLED`, `META_GRAPH_API_VERSION` (nomi da ricontrollare sul contratto effettivo prima di configurare).
- [ ] Verificare scadenza/rotazione dei token e procedura di rinnovo.
- [ ] Eseguire diagnostica Meta solo con autorizzazione esplicita, sapendo che l'azione `status` contatta Graph API.
- [ ] Abilitare inizialmente una sola piattaforma e una sola tipologia, con kill switch pronto.
- [ ] Pubblicazione di prova reale solo su richiesta esplicita, contenuto concordato e controllo immediato del risultato.
- [ ] Monitorare i primi invii e documentare stop/rollback.

**Uscita:** configurazione account e attivazione limitata completate; non si abilita tutto in un'unica volta.

## 7. Decisioni già fissate e decisioni ancora da prendere

### Fissate
- Un solo publisher Meta.
- Bozza non equivale ad approvazione.
- Prima release editoriale con approvazione umana.
- Programmazione server-side, non dipendente dal browser.
- Stati FB e IG separati.
- Nessun retry cieco su esito ambiguo.
- Test senza traffico Meta reale.
- Nessuna pubblicazione reale durante sviluppo/test.
- Eventi live esistenti non devono essere regressi.

### Da decidere prima dell'attivazione
- Quali tipologie live restano automatiche e quali richiedono approvazione.
- Facebook, Instagram o entrambi per ciascun tipo.
- Orari standard e anticipo per MATCH DAY/convocati/formazione.
- Chi può approvare e chi può attivare/disattivare il publisher.
- Se e quando valutare contenuti editoriali senza approvazione umana (non incluso nella prima release).

Non serve decidere ora ogni orario editoriale: si possono predisporre valori configurabili e lasciare la scelta alla configurazione operativa finale.

## 8. Checklist finale “solo configurazione”

Questa checklist deve essere l'unico lavoro residuo quando il progetto è pronto:
1. Account/Pagina/Instagram collegati e ruoli corretti.
2. App e permessi Meta verificati.
3. Segreti inseriti e token validi.
4. Piattaforme e tipi contenuto abilitati secondo decisione dell'associazione.
5. Test finale autorizzato su un contenuto concordato.
6. Verifica post remoto e registrazione ID/stato.
7. Kill switch e procedura di revoca provati.
8. Attivazione graduale confermata.

**Non dichiarare “pronto per la configurazione” finché le fasi 1–4 non hanno superato i rispettivi test.**

## 9. Incarico coordinato per le IA

**Claude — implementazione**
- Lavorare esclusivamente sul branch di integrazione autorizzato, non su main.
- Prima consegnare mappa file/funzioni e piano; poi implementare i fix approvati.
- Allegare commit, test eseguiti, test non eseguiti e screenshot browser.
- Nessuna chiamata Meta reale, nessuna modifica a segreti, DB live, storage live o deploy.

**Gemini — revisione indipendente**
- Ricevere il diff completo e la matrice test.
- Cercare duplicazioni, race condition, reset incompleti, popup, bypass test, leakage, timezone e retry per piattaforma.
- Classificare ogni finding con prova, severità e riproducibilità.
- Non limitarsi a confermare il rapporto di Claude.

**ChatGPT — coordinamento**
- Mantenere backlog e decisioni.
- Verificare il codice contro i finding e le prove.
- Non dichiarare completato ciò che non ha commit/test verificabili.
- Preparare il pacchetto finale di configurazione Meta quando il software è pronto.

## 10. Vincoli permanenti

Questo piano non autorizza:
- merge su main;
- deploy GitHub Pages;
- migrazioni o scritture sul progetto Supabase live;
- lettura o condivisione di segreti;
- chiamate alla funzione live `status` o `publish`;
- post reali o notifiche;
- cambiamenti agli account Meta.

Ogni azione di questo tipo richiede autorizzazione specifica e separata.
