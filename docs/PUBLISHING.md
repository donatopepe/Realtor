# Pubblicazione

Come si distribuisce Realtor su web, Android, iOS e come si rilascia una versione.
Riferimenti: [API.md](API.md) per il server, [ARCHITECTURE.md](ARCHITECTURE.md) per il codice,
[PLAN.md](../PLAN.md) per lo stato del progetto.

## Identità dell'app (da non cambiare senza motivo)

| Campo | Valore |
|-------|--------|
| Application id | `net.dntppe.realtor` |
| Nome | `Realtor` |
| Versione | `1.0.0` in `package.json`, `config.xml` e `CHANGELOG.md` (vanno tenuti allineati) |
| Licenza | MIT (`LICENSE`), attribuzioni in `NOTICE` |

## Web / PWA — la via più semplice

`www/` è già la build: non serve compilare nulla.

1. Pubblica il contenuto di `www/` su un hosting statico (GitHub Pages, Netlify, nginx, S3…).
2. Verifica che il sito sia servito in **HTTPS**: service worker e installazione PWA lo richiedono.
3. Prova da telefono: il browser deve proporre "Aggiungi a schermata Home" e l'app deve aprirsi anche offline.

Nota: **non** usare `cordova platform add browser` — `cordova-browser` non è compatibile con
questo package ESM (`"type": "module"`); la piattaforma web è la PWA.

## Android

### APK/AAB di debug (per provare)

```bash
export ANDROID_HOME=/percorso/android-sdk
npm ci
npx cordova platform add android
npm run build:android
# APK in platforms/android/app/build/outputs/apk/debug/app-debug.apk
```

### Release firmata

1. Crea una keystore **fuori dal repository** (mai committarla: `.gitignore` copre `*.keystore`, `*.jks`):

   ```bash
   keytool -genkeypair -v -keystore ~/realtor-release.keystore -alias realtor \
     -keyalg RSA -keysize 2048 -validity 10000
   ```

2. Crea `platforms/android/release-signing.properties` (anch'esso ignorato da git):

   ```properties
   storeFile=/percorso/realtor-release.keystore
   storePassword=...
   keyAlias=realtor
   keyPassword=...
   ```

3. Compila:

   ```bash
   npm run build:android:release
   # AAB/APK firmati in platforms/android/app/build/outputs/
   ```

4. Conserva la keystore e le password in un gestore di segreti: senza di esse non potrai più
   aggiornare l'app pubblicata.

### Google Play

- Carica l'**AAB** (`bundleRelease`) come nuova release; `targetSdk` 36 è quello richiesto dalle policy attuali.
- Compila la scheda con: descrizione, categorie, privacy policy (l'app non raccoglie dati: le schede restano sul dispositivo).
- La prima pubblicazione richiede la verifica dell'account; le successive sono più rapide.

## iOS

Serve **macOS con Xcode**; su Linux/Windows la compilazione non è possibile.

```bash
npm ci
npx cordova platform add ios
cordova build ios --emulator      # build senza firma, per prova
```

Per installare su dispositivi/TestFlight:

1. Apri il progetto in Xcode (`platforms/ios/Realtor.xcworkspace`).
2. Imposta il team di sviluppo e il bundle identifier `net.dntppe.realtor`.
3. Archivia e distribuisci (App Store Connect / TestFlight).
4. Le icone sono già generate (`resources/ios/`) da `npm run icons`.

Senza un account Apple Developer si può comunque verificare la build per il simulatore.

## Server API

```bash
docker build -f server/Dockerfile -t realtor-api .
docker run --rm -p 3000:3000 -v realtor-data:/data realtor-api
```

- In produzione mettilo dietro un reverse proxy con **HTTPS** e, se è raggiungibile da Internet,
  imposta `REALTOR_API_TOKEN` (l'app non invia token: valuta l'accesso solo da rete fidata o
  un proxy autenticato).
- Il volume `/data` contiene `cards.json` (scrittura atomica). Esegui un backup periodico del volume.
- Health check per gli orchestratori: `GET /health` (già usato dall'`HEALTHCHECK` dell'immagine).

## Rilascio di una nuova versione

1. Aggiorna la versione in `package.json`, `config.xml` e `CHANGELOG.md` (e `APP_VERSION` in
   `www/js/app.js`, verificata da un test).
2. Se cambi l'app shell, incrementa `CACHE_VERSION` in `www/sw.js`.
3. Esegui tutti i controlli:

   ```bash
   npm ci
   npm run lint
   npm test
   npm run test:e2e
   npm run docs:check
   npm run scan:secrets:history
   ```

4. Commit, poi tag e push:

   ```bash
   git commit -am "Release v<x.y.z>"
   git tag v<x.y.z>
   git push origin master --tags
   ```

5. Il workflow `.github/workflows/release.yml` compila e allega gli artefatti (APK debug e
   pacchetto web) alla GitHub Release del tag; per la release firmata servono i segreti
   `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEY_ALIAS`, `ANDROID_STORE_PASSWORD`, `ANDROID_KEY_PASSWORD`.
6. Verifica l'esito: `gh run list --limit 5` e `gh release view v<x.y.z>`.

## Checklist prima di pubblicare

- [ ] `npm run lint`, `npm test`, `npm run test:e2e`, `npm run docs:check` verdi.
- [ ] `npm run scan:secrets:history` senza occorrenze e nessun keystore/token nel repository.
- [ ] Versione allineata in `package.json`, `config.xml`, `CHANGELOG.md`, `www/js/app.js`.
- [ ] `CACHE_VERSION` incrementata se è cambiata l'app shell.
- [ ] Endpoint REST vuoto di default (nessun server cablato) e nessun URL privato nel codice.
- [ ] Screenshot e README aggiornati; `docs/screenshots/` rigenerato con `npm run test:e2e`.
- [ ] Backup/ripristino provati su un dispositivo reale (esportazione e importazione JSON).
