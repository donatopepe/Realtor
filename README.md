# Realtor

Applicazione di statistica e stime immobiliari: creazione, gestione e invio di
**schede immobiliari** (nome, indirizzo, descrizione, prezzo) con funzionamento
**offline-first**, distribuita sia come **PWA/web** sia come **app Android**
(Cordova).

> **Stato: v1.0.0 in preparazione.** L'app 0.0.1 (Cordova 3.x, 2014) non è più
> buildabile con le toolchain moderne e conteneva un bug di perdita dati su
> "Invia schede". Il piano di modernizzazione, i criteri di accettazione e lo
> stato di avanzamento sono in [PLAN.md](PLAN.md); il log delle verifiche è nella
> §9 dello stesso file.

---

## Funzionalità previste (v1.0.0)

- Creazione, modifica, elenco ed eliminazione di schede immobiliari.
- Persistenza locale offline (localStorage) con schema validato.
- Invio delle schede a un endpoint REST **configurabile dalla pagina Impostazioni**
  (nessun server cablato nel codice); le schede vengono rimosse localmente solo
  dopo una risposta 2xx.
- Backup: esportazione/importazione JSON, più import del formato storico 0.0.1.
- Modalità web (PWA installabile) e app Android firmabile.

## Requisiti

- Node.js >= 20 (verificato con 26.x)
- Per il build Android: JDK 17+, Android SDK (build-tools + platform) e Gradle
  (fornito dal wrapper della platform Cordova)

## Avvio rapido (web)

```bash
npm ci
npm run serve        # apre www/ su http://localhost:8080
```

## Test

```bash
npm test             # unit + integration
npm run test:e2e     # end-to-end (Playwright)
npm run lint         # stile codice
npm run server:test  # API di riferimento
```

## Server di riferimento (opzionale)

```bash
npm run server       # API REST locale su http://localhost:3000
```

Imposta l'URL (`http://localhost:3000/realtor/api/scheda`) nella pagina
Impostazioni dell'app. Contratto dell'API: `docs/API.md`.

## Build Android

```bash
npm ci
npx cordova platform add android   # rigenera platforms/ (non versionato)
npm run build:android              # APK debug
```

L'APK viene prodotto in `platforms/android/app/build/outputs/apk/`.
Le firme di release non sono versionate: vedi `docs/PUBLISHING.md`.

## Struttura del progetto

```
www/            sorgente unico dell'app (UI + core testabile, PWA)
server/         API REST di riferimento (Node, zero dipendenze runtime)
tests/          unit/integration (node:test) ed e2e (Playwright)
docs/           architettura, API, migrazione, pubblicazione, prompt operativo
PLAN.md         piano di modernizzazione, criteri di accettazione, log verifiche
```

## Licenza

[MIT](LICENSE) © 2014-2026 Donato Pepe. Attribuzioni di terze parti in
[NOTICE](NOTICE).

## Roadmap

Vedi `PLAN.md` (§6 Milestone): igiene repo e licenza, estrazione del core con
test, correzione dei bug funzionali, server di riferimento, e2e, Cordova
moderno con APK, documentazione completa, rilascio v1.0.0.
