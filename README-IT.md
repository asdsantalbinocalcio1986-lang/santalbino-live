# Sant'Albino Live — guida di installazione e gestione

Sant'Albino Live è una pagina pubblica per seguire la partita e una regia privata per l'unico amministratore autorizzato. Hosting statico su GitHub Pages, database e autenticazione su Supabase.

## Componenti
- GitHub Pages: hosting statico.
- Supabase: database, autenticazione, aggiornamenti Realtime e archivio immagini.
- Facebook: pubblicazione manuale tramite testi e grafiche preparati dalla regia.

## 1. Configura l'unico amministratore in Supabase

1. Crea o apri il progetto su https://supabase.com/.
2. Vai in **Authentication → Users** e crea l'unico utente che dovrà amministrare Sant'Albino Live.
3. Vai in **Authentication → Providers → Email** e disattiva le registrazioni pubbliche (**Disable signups**). In questo modo non si potranno creare account dalla pagina.
4. Apri il file `supabase-setup.sql` in GitHub e sostituisci il testo `INSERISCI_EMAIL_AMMINISTRATORE` con l'indirizzo email esatto dell'utente appena creato. Mantieni gli apici singoli.
5. Apri **SQL Editor** in Supabase, incolla il contenuto aggiornato del file SQL ed eseguilo.
6. Lo script crea/aggiorna le tabelle per lo stato partita e i voti MVP, configura il bucket immagini e assegna i permessi di scrittura esclusivamente all'utente indicato. Se l'email non corrisponde a un solo utente, lo script si interrompe.
7. Se in futuro devi cambiare amministratore, modifica l'email nel blocco SQL e riesegui lo script: l'utente precedente viene rimosso dall'elenco degli amministratori.

**Importante:** il controllo non si limita a nascondere i pulsanti. La pagina verifica il ruolo con Supabase e le policy RLS bloccano anche le scritture dirette al database e all'archivio immagini. Non inserire mai la chiave `service_role` nel sito.

## 2. Collega il sito a Supabase

1. In Supabase apri **Project Settings → API**.
2. Copia **Project URL** e la chiave pubblica **anon / publishable**.
3. Inserisci i valori in `config.js` nei campi `supabaseUrl` e `supabaseAnonKey`.
4. Non usare una secret key o la `service_role`: il browser deve contenere esclusivamente la chiave pubblica.

## 3. Pubblica con GitHub Pages

1. Il repository deve contenere `index.html`, `config.js`, `supabase-setup.sql` e questa guida.
2. In GitHub apri **Settings → Pages**.
3. Seleziona **Deploy from a branch**, branch `main`, cartella `/ (root)`, quindi salva.
4. Apri l'indirizzo GitHub Pages del repository.

## 4. Utilizzo

- I visitatori aprono il link pubblico e consultano tabellone, cronaca, formazioni, statistiche, classifica e votazione MVP.
- L'unico amministratore seleziona **Accesso regia** e usa le credenziali create in Supabase.
- Un account autenticato ma non autorizzato viene disconnesso e non può accedere alla regia.
- Le modifiche vengono salvate su Supabase; la pagina segnala lo stato della sincronizzazione.
- Le grafiche e i loghi caricati dalla regia sono salvati nel bucket pubblico in lettura e privato in scrittura.
- Il motore OCR viene scaricato solo quando viene avviata la lettura di una distinta, per ridurre il caricamento iniziale.
- Per Facebook, il modulo prepara testo e immagine; l'operatore li pubblica manualmente.

## 5. Verifiche prima della prima partita

1. Apri la pagina pubblica da un browser non autenticato.
2. Verifica che la cronaca e le formazioni siano visibili.
3. Prova l'accesso con l'account amministratore: deve aprirsi la regia.
4. Prova con un eventuale altro account Supabase: non deve ottenere l'accesso alla regia.
5. Da due dispositivi, pubblica un evento di prova e verifica che compaia sull'altro.
6. Carica un logo e un'immagine evento, poi controlla che siano visibili anche sul secondo dispositivo.
7. Prova a votare l'MVP da una finestra anonima.

## Note operative e limiti

- Il piano gratuito Supabase ha limiti di utilizzo e può sospendere i progetti inattivi: controlla periodicamente lo stato del progetto.
- I voti MVP sono pubblici e l'app limita a un voto per identificativo browser e partita. La votazione anonima non può impedire in modo assoluto voti multipli da dispositivi/browser diversi o da utenti che cancellano i dati locali.
- Le immagini caricate sono ridimensionate prima dell'invio; il bucket accetta JPEG, PNG e WebP fino a 8 MB.
- Se il database non è configurato o la connessione manca, la pagina non deve essere considerata una regia online affidabile. Verifica sempre l'indicatore di sincronizzazione prima di proseguire.
- Prima di usare il sistema in una gara ufficiale, esegui un test completo con due dispositivi e una partita di prova.


## 6. Proprietà intellettuale e protezione

Sant'Albino Live è pubblicato con **tutti i diritti riservati**. Il codice originale, la struttura applicativa, l'interfaccia e le grafiche originali non possono essere copiati, modificati, ridistribuiti o riutilizzati senza autorizzazione scritta dei rispettivi titolari. Consulta [COPYRIGHT.md](./COPYRIGHT.md) e [LICENSE](./LICENSE).

Il diritto d'autore non impedisce tecnicamente che un repository pubblico venga visualizzato o scaricato. Il repository è attualmente pubblico per consentire la pubblicazione tramite GitHub Pages: chiunque può quindi leggere il codice. L'avviso di copyright riserva i diritti di riutilizzo, ma non nasconde il sorgente. Per rendere privato anche il codice occorre valutare un repository privato e un piano GitHub che supporti GitHub Pages da repository privati, prima di cambiare la visibilità.

**Misure di sicurezza operative:**
- non inserire mai password, token amministrativi o chiavi segrete di servizio nel repository o nel browser;
- la chiave anon/publishable presente in config.js è pubblica per progettazione: la protezione effettiva dipende da autenticazione, autorizzazioni e policy RLS di Supabase;
- mantenere disabilitate le registrazioni pubbliche e limitare le scritture al solo amministratore autorizzato;
- conservare copie di backup periodiche del repository e del database/archivio Supabase;
- verificare periodicamente le policy RLS, gli utenti autorizzati e i log di accesso.

L'avviso di copyright non sostituisce gli accordi scritti con gli eventuali autori o collaboratori e non attribuisce all'associazione diritti su componenti, loghi o materiali di terzi.