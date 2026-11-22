# WeSec 0.2 – Guida di installazione

Tempo: circa 20 minuti, una volta sola. Tutto gratuito, senza carta su Firebase.

## 1. GitHub (la pagina)
1. Crea un repository **pubblico** con un nome neutro, per esempio `note`.
   ⚠ L'indirizzo sarà `https://TUONOME.github.io/note/` e compare nelle notifiche su Android.
   Se non vuoi che si veda il tuo nome utente, usa un account GitHub con un nome anonimo.
2. Carica tutti i file dello zip **tranne la cartella `worker`** (quella va su Cloudflare).
3. Settings → Pages → Source: *Deploy from a branch* → `main` / `root` → Save.

## 2. Firebase (messaggi cifrati)
1. https://console.firebase.google.com → **Aggiungi progetto** (nome qualsiasi, Analytics disattivato).
2. **Build → Authentication → Inizia → Anonimo → Attiva.**
3. **Build → Firestore Database → Crea database** → posizione `eur3 (europe)` → modalità *produzione*.
4. Firestore → scheda **Regole** → cancella tutto, incolla il contenuto di `firestore.rules` → **Pubblica**.
5. ⚙ Impostazioni progetto → *Le tue app* → icona `</>` (Web) → registra l'app (niente Hosting).
   Copia `apiKey`, `authDomain`, `projectId`, `appId` dentro `config.js`.

## 3. Cloudflare (notifiche e foto)
1. **R2 → Crea bucket** → nome `wesec-media`.
2. **Workers & Pages → KV → Crea namespace** → nome `wesec-kv`.
3. **Workers & Pages → Crea → Worker** → nome neutro (es. `note-sync`) → Deploy.
4. **Modifica codice** → cancella tutto → incolla `worker/worker.js` → Deploy.
5. Worker → **Settings → Bindings**:
   - KV namespace: nome variabile `KV` → `wesec-kv`
   - R2 bucket: nome variabile `R2` → `wesec-media`
6. Worker → **Settings → Variables and Secrets** (tipo testo):
   - `ALLOWED_ORIGIN` = `https://TUONOME.github.io` (senza `/note` e senza `/` finale)
   - `CONTACT` = `mailto:tua@email.it`
7. Copia l'indirizzo del Worker (es. `https://note-sync.tuonome.workers.dev`) in `config.js` → `worker`.
8. Ricarica `config.js` su GitHub.

## 4. Primo avvio
- **Android:** apri l'indirizzo in Chrome → crea il PIN → Attiva notifiche.
  Facoltativo: menu ⋮ → *Aggiungi a schermata Home* (compare come "Note").
- **iPhone (iOS 16.4 o successivo):** apri in Safari → Condividi ⬆︎ → *Aggiungi alla schermata Home* →
  apri **Note dall'icona** → crea il PIN → Attiva notifiche.
- Non usare la navigazione in incognito: alla chiusura cancella le chiavi.

## 5. Aggiungere un contatto
1. Tu: **+ → Il mio invito** (QR e codice validi 10 minuti, una volta sola).
2. L'altro: **+ → Ho un codice**, oppure inquadra il QR (Android).
3. Date un nome, un colore e la **frase in codice** per le notifiche.
4. Di persona, **Verifica il codice**: le 12 emoji devono essere identiche sui due telefoni.

## Foto
- Tocca **＋**, scegli la foto: con la spunta **"Visibile anche a …"** la vedete in due; senza spunta resta **solo tua** (bordo tratteggiato 🔒).
- Una foto solo tua si può rendere visibile più tardi: aprila e tocca **Rendi visibile**.

## Da sapere
- Se dimentichi il PIN o cancelli i dati del browser, le chat su quel telefono non si recuperano
  (il backup cifrato delle chiavi arriva in una prossima versione).
- Il server vede solo dati cifrati e un identificativo casuale per ogni chat: niente nomi, testi o foto in chiaro.
