# Sicurezza

Documento di riferimento su minacce, controlli implementati, verifiche ripetibili e
rischi accettati. Riferimenti: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) per il codice,
[docs/API.md](docs/API.md) per il server, [docs/PUBLISHING.md](docs/PUBLISHING.md) per la messa in produzione.

## Versioni supportate

| Versione | Supporto |
|----------|----------|
| 1.x | ✅ aggiornamenti di sicurezza |
| 0.0.1 (Cordova 3.x, 2014) | ❌ non supportata, non buildabile, con perdita dati su "Invia schede" |

## Come segnalare una vulnerabilità

Non aprire una issue pubblica. Scrivi a **dnt.ppe@gmail.com** indicando:

- descrizione del problema e impatto;
- passi per riprodurlo o prova di concetto;
- versione/commit, piattaforma (web, Android, iOS, server) e ambiente.

Risposta attesa entro pochi giorni lavorativi; priorità massima se sono coinvolti dati o
credenziali. Riconoscimento pubblico solo se lo desideri.

## Modello di minacce (sintesi)

| Asset | Minaccia principale | Contromisura |
|-------|---------------------|--------------|
| Schede immobiliari (dati personali) | Lettura da parte di terzi sul dispositivo o nel backup | Dati solo locali; backup JSON esportabile **anche cifrato** con password; nessuna telemetria |
| Contenuti dell'app serviti dal web/CDN | Manomissione di HTML/JS (supply chain del sito) | **Pinning SRI** dei file dell'app (`www/sri.json`, verificato in CI); header di sicurezza; service worker che non mette in cache origini esterne |
| Browser/WebView dell'utente | XSS, clickjacking, esfiltrazione verso origini esterne | **CSP** senza script inline/eval, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `base-uri 'self'`, `form-action 'none'`; nomi scheda sempre resi come testo |
| Endpoint REST configurato dall'utente | Invio di dati a un server sbagliato, intercettazione | Endpoint scelto dall'utente (vuoto = offline); nessun URL cablato; HTTPS consigliato e HSTS emesso dietro proxy TLS |
| Server API di riferimento | Abuso (flood), accesso non autorizzato, inj ection nel corpo | **Rate limiting** per origine, token Bearer a confronto costante, limiti di corpo e di schede, timeout anti-slowloris, validazione condivisa con l'app |
| Repository e pipeline | Credenziali committate, dipendenze vulnerabili, action compromesse | Scansione segreti su working tree **e storia**, `npm audit` bloccante sui runtime, SBOM CycloneDX, Dependabot, CodeQL, action pinnate a SHA |
| Disponibilità dei dati locali | Perdita per errore dell'utente o bug | Rimozione locale solo dopo `2xx`; scritture atomiche lato server; file corrotto messo in quarantena; migrazione senza sovrascritture |

## Controlli implementati

### Applicazione (web/PWA, Android, iOS)

- **Content-Security-Policy** identica come header HTTP e come `meta`, con `script-src 'self'`
  (nessuno script inline, nessun `eval`), `object-src 'none'`, `form-action 'none'`,
  `worker-src 'self'`. `frame-ancestors 'none'` è presente nell'header (nel `meta` sarebbe ignorato).
- **Header di sicurezza** su ogni risposta del server statico: `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy` senza geolocalizzazione,
  fotocamera, microfono, pagamenti e USB, `Cross-Origin-Opener-Policy: same-origin`,
  `Cross-Origin-Resource-Policy: same-origin` e `Strict-Transport-Security` solo su HTTPS.
- **Pinning SRI**: `www/sri.json` contiene gli hash SHA-384 dei file dell'app shell; `npm run sri:check`
  (in CI) fallisce se un file cambia senza aggiornare il manifest.
- **Nessuna iniezione di markup**: i nomi delle schede sono scritti con `.text()` e un test E2E verifica
  che un payload `<img onerror=…><script>…</script>` resti testo e non generi elementi né dialoghi.
- **Nessun segreto nel client**: endpoint e token non sono mai cablati; la password del backup non
  viene salvata né conservata nel DOM.
- **Uscita e permessi**: niente permessi nativi richiesti; l'APK dichiara solo `INTERNET`.

### Backup cifrato

- `www/js/core/crypto.js`: **PBKDF2-SHA256** (salt casuale 16 byte, 310 000 iterazioni predefinite) per
  derivare la chiave e **AES-256-GCM** (IV casuale 12 byte) per cifrare e autenticare.
- Password minima di 8 caratteri imposta dalla UI; password errata o file manomesso producono un errore
  esplicito (`wrong_password`) e **nessun dato parziale**.
- Formato autoconsistente (`format: realtor.backup.enc`, parametri KDF e cifrario dichiarati), così un
  backup resta leggibile in futuro senza indovinare i parametri.

### Server API

- **Rate limiting** a finestra scorrevole per origine (default 120 richieste/minuto, configurabile), con tetto massimo alle chiavi memorizzate (nuove origini rifiutate a memoria piena),
  risposta `429` con `Retry-After` e header `X-RateLimit-*`; il preflight CORS non consuma budget.
- **Token Bearer opzionale** con confronto a tempo costante; con `REALTOR_API_TOKEN` vuoto il server
  avvisa se è raggiungibile da rete.
- **Limiti**: corpo massimo 1 MiB (`REALTOR_MAX_BODY_BYTES`), massimo 500 schede per richiesta
  (`REALTOR_MAX_CARDS`), `Content-Type` obbligatorio, JSON non valido rifiutato.
- **Timeout**: `headersTimeout` 20 s, `requestTimeout` 30 s, `keepAliveTimeout` 5 s, massimo 100 header
  (difese contro slowloris e header abnormi).
- **Audit log** in JSON per ogni richiesta: metodo, percorso, stato, durata, numero di schede e
  **hash salato dell'IP** (correlazione senza conservare l'indirizzo); token e corpi non vengono mai
  registrati (test dedicato).
- **Proxy**: `x-forwarded-for`/`-proto` considerati solo con `--trust-proxy`/`REALTOR_TRUST_PROXY=1`,
  altrimenti un client potrebbe falsificare l'origine e aggirare i limiti.
- **CORS** configurabile; con origine `*` e server pubblico viene emesso un avviso all'avvio.

### Pipeline e supply chain

- `npm run scan:secrets:history`: 12 famiglie di pattern (chiavi private, token AWS/GitHub/Google/Slack/Stripe,
  `.npmrc`, credenziali in URL, keystore, JWT, bearer) su working tree **e** tutta la storia git; i valori
  trovati sono redatti e variabili d'ambiente/segnaposto non generano falsi positivi.
- `npm run audit:prod`: `npm audit --omit=dev --audit-level=high`, **bloccante** in CI.
- **SBOM** CycloneDX generato in CI (`npm run sbom`) e conservato come artifact.
- **Dependabot** settimanale per npm e GitHub Actions, mensile per l'immagine Docker.
- **CodeQL** (`security-and-quality`) su app, service worker, server, script e test.
- **GitHub Actions pinnate a SHA** di commit (con commento della versione), così un tag spostato non
  può cambiare il codice eseguito dalla pipeline.
- Permessi minimi nei workflow (`contents: read`, `security-events: write` solo per CodeQL).

### Dati e integrità

- Scritture atomiche (file temporaneo + `rename`) e quarantena dei file corrotti lato server.
- In locale: lettura corrotta → `null` senza cancellare; migrazione che scrive, verifica e solo dopo
  rimuove la voce vecchia; import di backup validato **prima** di toccare lo storage.
- Nessuna rimozione di schede se il server non risponde `2xx`.

## Verifiche ripetibili

Tutto quanto sopra è verificabile con comandi nel repository:

```bash
npm test                  # 207 test, inclusi sicurezza client, server e cifratura
npm run test:e2e          # 53 test end-to-end passati (CSP, XSS, backup cifrato, offline; 1 skip)
npm run lint
npm run sri:check         # integrità dei file dell'app
npm run scan:secrets:history
npm run audit:prod        # 0 vulnerabilità runtime (gate CI)
npm run sri:update       # rigenera il pinning SHA-384 dopo modifiche all'app shell
npm run sbom              # CycloneDX/SBOM in sbom.cdx.json
npm run docs:check
```

In CI la stessa sequenza gira su `ubuntu` (qualità, sicurezza, E2E, Android, Docker) e `macos` (iOS),
insieme a CodeQL.

## Rischi accettati e limiti (dichiarati)

| Limite | Motivo e mitigazione |
|--------|----------------------|
| `npm audit` segnala vulnerabilità **nelle dipendenze di sviluppo** (toolchain Cordova, ad es. `xcode`→`uuid`) | Non entrano nell'app distribuita né nel server: il gate bloccante è solo sulle dipendenze di produzione (`--omit=dev`), il report completo resta visibile in CI e Dependabot apre PR di aggiornamento |
| Dati locali non cifrati a riposo | `localStorage` non è cifrato dal sistema; per spostare o conservare le schede usare il **backup cifrato** |
| Il server di riferimento non gestisce utenti né sessioni | È un esempio funzionante: in produzione usare token, HTTPS e un reverse proxy; l'autorizzazione va gestita a monte |
| `style-src 'unsafe-inline'` | Richiesto da jQuery Mobile 1.4.2, che applica stili inline a runtime; gli **script** restano vincolati a `'self'` |
| `connect-src` consente `http:` e `https:` | L'endpoint REST è scelto dall'utente; sono esclusi schemi pericolosi (`data:`, `blob:`, `file:`) |
| SRI verificato in CI, non a runtime nel WebView | Su iOS le risorse arrivano da `file://`, dove la verifica del browser è inaffidabile e rischierebbe di bloccare l'app: il pinning resta un controllo ripetibile di pipeline |
| APK di release firmato solo se i segreti sono configurati | La keystore non è nel repo per scelta; vedi [docs/PUBLISHING.md](docs/PUBLISHING.md) |

## Risposta a un incidente

1. **Contenere**: revocare token/chiavi coinvolti (GitHub, registry, firma) e, se necessario, ruotare la keystore.
2. **Rimuovere**: se un segreto è finito in un commit, eliminarlo dal working tree **e** dalla storia
   (`git filter-repo`), fare `push --force-with-lease` e documentare il backup usato.
3. **Verificare**: `npm run scan:secrets:history`, `npm run audit:prod`, riesecuzione dei test di sicurezza.
4. **Comunicare**: aprire una nota nel `CHANGELOG.md` e, per i dati degli utenti, informare chi è coinvolto.
5. **Imparare**: aggiungere un test che avrebbe intercettato l'errore prima che si ripetesse.

## Requisiti per chi contribuisce

- Esegui `npm run scan:secrets`, `npm run sri:check`, `npm test` e `npm run audit:prod` prima di ogni pull request.
- Non inserire dati reali di clienti in test, screenshot o issue.
- Aggiorna `www/sri.json` con `npm run sri:update` quando modifichi un file dell'app shell.
- Segnala subito qualunque credenziale finisca in un commit, anche se poi rimossa.
