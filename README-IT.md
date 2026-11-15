# Sant'Albino Live — versione indipendente

Questa versione conserva la grafica e le funzioni di cronaca del file HTML originale e sostituisce la pubblicazione Claude con database Supabase e accesso amministratore. Facebook resta manuale.

## Componenti gratuiti
- GitHub Pages: hosting statico gratuito.
- Supabase Free: database, autenticazione e aggiornamenti realtime.
- Nessun token Facebook richiesto.

## 1. Crea il database Supabase
1. Crea un progetto su https://supabase.com/ (piano Free).
2. Apri SQL Editor e incolla `supabase-setup.sql`.
3. In Authentication → Providers → Email, lascia attivo Email e disattiva le registrazioni pubbliche (Disable signups).
4. In Authentication → Users, crea/invita l'utente amministratore con email e password. Solo gli utenti creati da te potranno accedere; RLS protegge gli aggiornamenti.
5. In Project Settings → API copia Project URL e anon/public key.
6. Incolla questi due valori in `config.js`. Non usare mai `service_role` o una chiave segreta nel browser.

## 2. Pubblica gratis con GitHub Pages
1. Crea un repository GitHub, per esempio `santalbino-live`.
2. Carica `index.html`, `config.js` e `supabase-setup.sql` nella cartella principale.
3. Apri Settings → Pages → Deploy from a branch → `main` → `/ (root)` → Save.
4. GitHub mostrerà un indirizzo pubblico `https://TUO-UTENTE.github.io/santalbino-live/`.

## 3. Uso
- I tifosi aprono il link pubblico: vedono solo cronaca, formazioni, statistiche e MVP.
- L'amministratore seleziona “Accesso regia” e inserisce le credenziali Supabase.
- Gli aggiornamenti vengono salvati online e inviati in tempo reale ai visitatori.
- Per Facebook, il modulo prepara testo e immagine; l'operatore li copia/salva e li pubblica manualmente.

## Note importanti
- Il progetto Supabase gratuito può avere limiti e può essere messo in pausa dopo inattività; verifica le condizioni correnti del piano.
- Il file `config.js` contiene soltanto la chiave anon pubblica: la sicurezza dipende dalle policy RLS nel file SQL.
- Le immagini caricate per eventi/loghi e le preferenze locali sono ancora memorizzate nel browser dell'amministratore. La sincronizzazione in database riguarda lo stato partita serializzato; immagini molto grandi possono superare i limiti del database. Ridimensionale prima dell'uso.
- La funzione di riconoscimento automatico delle formazioni dipendeva da Claude e non è disponibile nella versione indipendente; è possibile inserire i nomi manualmente.
- Prima dell'uso in una partita ufficiale, esegui un test con due browser/dispositivi.
