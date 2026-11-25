# Audit hashtag automatico e logo club persistente — 2026-11-25

## Stato e perimetro
Audit read-only del file `regia.html` sul branch `main`, più verifica dello schema Supabase attualmente collegato. Nessun codice, database, storage, cron, segreto, account social, merge o deploy è stato modificato.

**Classificazione:** evidenza diretta del repository per i comportamenti client; evidenza live limitata agli oggetti/colonne restituiti da Supabase. Il file `regia.html` è molto esteso e contiene JavaScript inline; i riferimenti sotto sono identificati per funzione/blocco, non per linee stabili.

## 1. Hashtag partita

### H-01 — Generazione automatica al salvataggio: NOT FOUND
- **Evidenza:** `saveMatch()` legge `#s-tag` e assegna direttamente `S.match.hashtag = g('#s-tag')`, poi chiama `commit(true)`.
- **Evidenza UI:** l'editor mostra il campo `Hashtag nei post` con il valore già presente nello stato; il salvataggio non deriva l'hashtag dal nome avversario.
- **Evidenza stato iniziale:** l'oggetto JSON `app-state` contiene `#SantAlbinoTerme`; i default runtime includono `#SANTALive`. I valori non sono coerenti fra seed HTML e default runtime.
- **Impatto:** l'utente deve correggere/inserire manualmente il tag e può ritrovarsi valori diversi secondo il percorso di inizializzazione.

### H-02 — Consumo hashtag nei contenuti: VERIFIED
- `buildText()` aggiunge `S.match.hashtag` agli eventi social.
- Il generatore convocati inserisce `m.hashtag`.
- Il generatore formazioni inserisce `S.match.hashtag`.
- Le grafiche match/evento e il riepilogo post-partita leggono lo stesso valore.
- **Rischio collegato:** PR #107 può aggiungere il tag già presente nel testo MATCH DAY una seconda volta durante la composizione della condivisione. Il finding SC-03 è già documentato nell'audit PR.

### H-03 — Regola di generazione raccomandata
Generare al momento della creazione/salvataggio della partita, usando il nome avversario e il nome canonico breve del club:
1. prefisso fisso `#SantAlbino`;
2. suffisso derivato dal nome avversario;
3. normalizzazione Unicode NFD, rimozione dei segni diacritici, rimozione di spazi, apostrofi e punteggiatura;
4. mantenere lettere e numeri, senza spazi;
5. se il nome avversario è vuoto, usare un fallback esplicito e stabile (es. `#SantAlbinoPartita`), non il solo `#SANTALive`;
6. deduplicare hashtag equivalenti in fase di composizione dei testi, senza duplicare il token se è già nel testo;
7. aggiornare automaticamente il valore se cambia il nome avversario **solo quando il tag è ancora marcato come generato**; conservare un override manuale esplicito.
Esempio: `Radicofani` → `#SantAlbinoRadicofani`.

**Dato da aggiungere allo stato:** `hashtagSource: 'auto' | 'manual'` (o equivalente), così il sistema distingue il tag generato da quello personalizzato. La funzione di normalizzazione deve essere pura e testabile.

## 2. Logo del club

### L-01 — Modello attuale posizionale casa/trasferta: VERIFIED
- Stato seed: `logos: { home: './assets/logo-home.png', away: './assets/logo-away.png' }`.
- Default runtime: `logos: { home: '', away: '' }`.
- Upload: `S.logos[ds.logo] = await uploadSharedImage(..., 'loghi', ...)`, seguito da `commit(true)`.
- `uploadSharedImage()` richiede regia amministratore, salva l'immagine nell'archivio condiviso e rifiuta gli upload in `TEST_MODE`.
- La UI espone upload/rimozione per i due slot di squadra.
- **Impatto:** il logo è associato allo slot `home` o `away`, non all'identità persistente del club.

### L-02 — Dipendenza da ourSide: VERIFIED
- `S.match.ourSide` distingue se Sant'Albino gioca in casa o in trasferta.
- La grafica convocati seleziona `S.logos[S.match.ourSide || 'home']`.
- Altri renderer leggono direttamente `S.logos.home` e `S.logos.away` per le due squadre.
- Il tabellone e le grafiche sono quindi coerenti solo se l'asset del club è caricato nello slot corrispondente alla posizione della squadra in quella partita.
- **Impatto:** quando si crea una nuova partita e Sant'Albino cambia lato, non esiste nel modello attuale un unico riferimento canonico al logo del club che venga automaticamente collocato nel lato corretto.

### L-03 — Persistenza attuale e limite: VERIFIED / PARTIALLY VERIFIED
- `commit()` serializza lo stato e, se l'utente è amministratore e la connessione è disponibile, lo invia al backend condiviso.
- `uploadSharedImage()` usa lo storage condiviso; il messaggio UI conferma che il logo è salvato e condiviso.
- `resetMatch()` azzera eventi, cronaca, convocati, rose, voti e dati temporali, ma non azzera esplicitamente `S.logos`.
- **Limite:** la persistenza del file e dello stato è già presente, ma la persistenza come proprietà del club indipendente dalla posizione casa/trasferta non è implementata. Non è stato verificato qui il comportamento completo del bucket/policy live per i loghi.

### L-04 — Modello dati raccomandato
Introdurre un riferimento canonico `clubLogo` (URL/path Storage) persistito nella configurazione del club, indipendente dalla partita. Per la partita mantenere un riferimento separato `opponentLogo` o un mapping derivato.
- Helper unico `logoForSide(side)`: se `side === S.match.ourSide`, restituisce `clubLogo`; altrimenti restituisce il logo avversario della partita.
- Tutti i renderer devono usare l'helper, non leggere direttamente `S.logos.home/away`.
- In migrazione, se `clubLogo` è vuoto, tentare una sola volta il recupero da `S.logos[S.match.ourSide]`; non sovrascrivere il logo avversario.
- L'asset canonico deve essere salvato a livello club, non soltanto nello stato della partita; l'URL deve puntare a un oggetto Storage persistente.
- L'amministratore può sostituire o rimuovere il logo del club. L'operazione deve essere distinta dalla rimozione del logo avversario.
- Il rendering deve funzionare per `ourSide=home` e `ourSide=away`, senza duplicare il logo del club nei due slot.

## 3. Rischi e decisioni aperte
- Il progetto ha stato live e stato test distinti a livello di tabella, ma il test usa lo stesso progetto Supabase. Il logo ufficiale non deve essere modificabile dal test.
- I valori seed/default di hashtag e loghi non sono allineati; va scelta una sola fonte di default.
- Va chiarito se il nome avversario da usare nell'hashtag sia il nome visualizzato completo o una forma breve canonica. Proposta: usare il nome visualizzato, rimuovendo prefissi societari generici configurabili (`ASD`, `USD`, ecc.) senza eliminare parole distintive.
- Il logo del club dovrebbe vivere in una configurazione club dedicata, non essere copiato su ogni nuova partita. Non è stata proposta/applicata alcuna migration.

## 4. Test di accettazione
| ID | Scenario | Risultato atteso |
|---|---|---|
| TAG-01 | Creazione partita Sant'Albino–Radicofani | `#SantAlbinoRadicofani` generato automaticamente |
| TAG-02 | Avversario con spazi, apostrofo, accenti e trattini | Tag normalizzato, senza caratteri invalidi |
| TAG-03 | Avversario vuoto | Fallback esplicito e non vuoto |
| TAG-04 | Modifica avversario con tag auto | Tag rigenerato |
| TAG-05 | Modifica avversario con override manuale | Override conservato |
| TAG-06 | Generazione MATCH DAY, convocati, formazione, cronaca, post-partita | Stesso tag canonico, una sola occorrenza |
| LOGO-01 | Club in casa | Logo club sul lato casa |
| LOGO-02 | Club in trasferta | Logo club sul lato trasferta |
| LOGO-03 | Cambio lato fra due partite | Logo club invariato, logo avversario indipendente |
| LOGO-04 | Reload su altro dispositivo autorizzato | Logo club disponibile senza nuovo upload |
| LOGO-05 | Reset/nuova partita | Logo club conservato; logo avversario gestito secondo policy nuova partita |
| LOGO-06 | Sostituzione/rimozione logo club | Aggiorna solo il logo club |
| LOGO-07 | Test mode | Nessun upload o modifica dell'asset ufficiale |
| LOGO-08 | Renderer tabellone, timeline, convocati, formazioni, MATCH DAY, post-partita | Tutti usano la risoluzione canonica del lato |
| LOGO-09 | Errore Storage o URL non raggiungibile | Fallback grafico, nessuna perdita del riferimento salvato |

## 5. Conclusione
Il requisito hashtag è **parzialmente supportato** (il tag viene consumato dai generatori, ma non viene generato automaticamente e presenta default incoerenti). Il logo è **già caricato e condiviso**, ma resta **associato alla posizione home/away** e non all'identità del club. Entrambi i requisiti richiedono un intervento applicativo; questo audit non lo ha eseguito.


## Addendum — renderer coverage and reset behavior
- Conteggio sul file main: 5 letture dirette di `S.logos.home`, 5 di `S.logos.away`, 9 accessi indicizzati `S.logos[...]`. I renderer coinvolti includono tabellone/graphic summary, grafiche matchday e formazioni, convocati legacy/premium e badge UI.
- I renderer principali di formazione e matchday continuano a leggere separatamente gli slot home/away; il renderer convocati legge `S.logos[S.match.ourSide]`. Non è presente un helper centralizzato che risolva il logo del club in base a `ourSide`.
- `resetMatch()` non azzera `S.logos`, quindi conserva i due URL posizionali anche quando si crea la partita successiva. Questo conserva gli asset ma può associare il logo del club al lato sbagliato quando `ourSide` cambia: rischio concreto, non solo mancanza di comodità.
- Il JSON seed incorpora due path statici distinti `./assets/logo-home.png` e `./assets/logo-away.png`, mentre i default runtime dichiarano `logos: { home: '', away: '' }`. Da uniformare durante l'intervento, evitando che seed e default divergano.
