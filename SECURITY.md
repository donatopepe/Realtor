# Sicurezza

## Versioni supportate

| Versione | Supporto |
|----------|----------|
| 1.x | ✅ aggiornamenti di sicurezza |
| 0.0.1 (Cordova 3.x, 2014) | ❌ non supportata, non buildabile e con perdita dati su "Invia schede" |

## Come segnalare una vulnerabilità

Non aprire una issue pubblica. Scrivi a **[PRIVATE_EMAIL]** con:

- descrizione del problema e impatto;
- passi per riprodurlo o prova di concetto;
- versione/commit, piattaforma (web, Android, iOS, server) e ambiente.

Risposta attesa entro pochi giorni lavorativi. Se il problema riguarda dati degli utenti o
credenziali, indicalo nell'oggetto: la priorità è massima. Il riconoscimento nei crediti è
offerto solo se lo desideri.

## Modello di sicurezza (cosa protegge il progetto)

- **I dati restano sul dispositivo.** Le schede sono in `localStorage` (`realtor.scheda.<nome>`);
  nessuna telemetria, nessun analytics, nessun account.
- **Il server è opzionale.** L'invio avviene solo verso l'endpoint configurato dall'utente
  (Impostazioni); con campo vuoto l'app è del tutto offline. Il server di riferimento non è
  cablato nel codice.
- **Nessun segreto nel repository.** Niente token o chiavi cablate; i test includono
  `scripts/scan-secrets.js`, che cerca credenziali note nel working tree **e** in tutta la
  storia git (`npm run scan:secrets:history`). La storia è già stata ripulita dagli artefatti
  di build e da un documento personale.
- **Keystore fuori dal repo.** `.gitignore` esclude `*.keystore`, `*.jks`, `*.pem`, `*.p12`,
  `key.properties`, `google-services.json`, `GoogleService-Info.plist`, `.npmrc`, `id_rsa`,
  `.env`. Le firme di release vanno tenute in un gestore di segreti o nei GitHub Secrets
  (vedi [docs/PUBLISHING.md](docs/PUBLISHING.md)).
- **Token del server.** `REALTOR_API_TOKEN` è opzionale e viene confrontato a tempo costante;
  il token non compare nei log. L'app non invia token: esponi il server solo su rete fidata o
  dietro un reverse proxy autenticato.
- **Input non fidato.** Validazione e normalizzazione avvengono su client e server con lo
  stesso modulo (`www/js/core/schema.js`); il nome della scheda è scritto nell'elenco come
  testo (non come HTML), i corpi delle richieste sono limitati a 1 MiB
  (`REALTOR_MAX_BODY_BYTES`) e le risposte usano `X-Content-Type-Options: nosniff`.
- **Integrità dei dati.** Scritture atomiche con file temporaneo + `rename` lato server;
  file corrotti messi in quarantena invece di essere sovrascritti; in locale le schede si
  rimuovono solo dopo risposta `2xx`.
- **HTTPS.** Il service worker e l'installazione PWA richiedono HTTPS; per il server in
  produzione usa un reverse proxy TLS. L'app non contiene più URL `http://` privati.

## Rischi noti e limiti dichiarati

| Limite | Nota |
|--------|------|
| Nessuna cifratura dei dati locali | `localStorage` non è cifrato: chi ha accesso al dispositivo può leggerlo. Usa il backup JSON per spostare i dati e la cancellazione di sistema per rimuoverli. |
| Backup JSON in chiaro | Contiene i dati delle schede: conserva il file in un luogo sicuro. |
| Nessuna autenticazione degli utenti nell'app | Il progetto non gestisce account; l'autorizzazione è a livello di rete/server. |
| Server di riferimento minimale | Non pensato per esposizione pubblica senza proxy, token e backup del volume `/data`. |
| API senza versionamento nell'URL | Il contratto è stabile nella major `1.x` (vedi [docs/API.md](docs/API.md)). |

## Requisiti per chi contribuisce

- Esegui `npm run scan:secrets` prima di ogni pull request.
- Non inserire dati reali di clienti in test, screenshot o issue.
- Segnala subito qualunque credenziale finisca in un commit, anche se poi rimossa.
