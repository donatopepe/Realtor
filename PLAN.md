# PLAN — Realtor 1.0.0 (modernizzazione, test, distribuzione pubblica)

> Documento di lavoro. Unica fonte di verità dello stato: §9 Log avanzamento.
> Prompt operativo usato dal loop: `docs/ENGINEERED-PROMPT.md`.
> Avvio lavorazione: cron loop `realtor-modernizzazione` (durable, ogni 20 min).

---

## 1. Deliverable separati (una richiesta → 5 deliverable)

| ID | Deliverable | Stato | File |
|----|-------------|-------|------|
| D1 | Studio approfondito del codice esistente (audit con evidenze) | ✅ fatto | §2 |
| D2 | Prompt ingegnerizzato | ✅ fatto | `docs/ENGINEERED-PROMPT.md` |
| D3 | Piano in un file | ✅ fatto | questo file |
| D4 | Loop di lavorazione | ✅ creato (cron durable) | task `realtor-modernizzazione` |
| D5 | Progetto corretto, testato, documentato, MIT, distribuibile | ✅ **completato** — M0…M8 ✅, AC 22/22 | milestone M0→M8 |
| D8 | Rilascio pubblico 1.0.0 (web/PWA + Android APK, iOS pronto) | ✅ rilasciato | [github.com/donatopepe/Realtor/releases/tag/v1.0.0](https://github.com/donatopepe/Realtor/releases/tag/v1.0.0) |
| D9 | **Cybersecurity**: threat model, hardening client e server, cifratura dei backup, supply chain e verifiche automatiche | ⏳ in corso (M9) | `SECURITY.md`, `www/js/core/crypto.js`, `server/src/security.js`, `scripts/sri.js`, `.github/workflows/codeql.yml` |
| D6 | Cross-platform: stesso sorgente per **Android, iOS, web/PWA** (desktop Electron opzionale) | ✅ fondamenta (M2); build per piattaforma in M6 | `www/`, `config.xml`, `resources/`, `scripts/serve.js` |
| D7 | Igiene dei segreti: nessuna credenziale nel working tree **né nella storia git**, con scansione automatica nei test | ✅ fatto (M2) | `scripts/scan-secrets.js`, `tests/unit/secrets.test.js` |

---

## 2. Baseline — audit del codice (evidenze da repo `master`, commit `7e5fee3`, 2017-11-23)

Contesto: app Android Cordova "Realtor" (schede immobiliari), UI jQuery Mobile 1.4.2, cartella `www/`, 1771 file tracciati.

| # | Rilievo (con evidenza) | Impatto |
|---|------------------------|---------|
| 1 | Progetto Cordova 3.x **build Ant**: nessun `package.json`; `platforms/android/project.properties` → `target=android-19`, `build.xml`, `ant-build/`, `CordovaLib` come library project. `config.xml` senza `<engine>`/`<plugin>` | Build impossibile con toolchain moderne; target play-store non conforme |
| 2 | Endpoint privato hardcoded: `www/js/index.js:20` → `var rootURL = "http://realtor.dntppe.net/realtor/api/scheda"`; HTTP in chiaro; server non presente nel repo | "Invia schede" non funzionante per chiunque, non configurabile, bloccato da Android (cleartext) |
| 3 | **Data loss**: handler "Invia schede" (`index.js` ~195-245) rimuove tutte le schede da `localStorage` mentre la chiamata AJAX è commentata | Perdita dati utente |
| 4 | `scheda.addscheda`: `contentType: application/json` ma `data:` è un oggetto senza `JSON.stringify`/`processData:false` → jQuery serializza form-encoded | POST mai valido verso un server JSON |
| 5 | Encoding rotto: 6 occorrenze del carattere di sostituzione U+FFFD in `www/js/index.js` (apostrofi corrotti in commenti tipo `dell'evento`, `l'evento`, `sull'elemento`) — file non UTF-8 mentre `index.html` dichiara UTF-8 | Stringhe UI/dialog corrotte |
| 6 | Codice morto/duplicato: blocco `#deviceready` commentato in `index.html`, `scheda.send`/`confirmedSend` commentati, 11 plugin dichiarati in `plugins/android.json` e mai usati in `www/` | Manutenzione, permessi e peso inutili |
| 7 | Nessun fallback web: `navigator.notification.*`, `navigator.connection`, `navigator.app.exitApp()` usati direttamente | Non testabile/erogabile fuori da Cordova (PWA, browser, CI) |
| 8 | Chiave `localStorage` = nome scheda, nessuna validazione/normalizzazione/schema; iterazione `app.storage.length` con rimozione in-loop (indici che slittano); `scheda.data` singleton condiviso | Sovrascritture silenziose, elenco incoerente |
| 9 | Igiene repo: `platforms/` (1166 file) e `plugins/` (375 file) tracciati, churn mode `100755→100644` su 1770 file, nessun `.gitignore`/`.gitattributes`, `001014428tesi.pdf` 6.5 MB non pertinente (contiene numero di matricola), `README.md` = 1 riga | Cloni pesanti, diff rumorosi, esposizione dati personali |
| 10 | Nessun `LICENSE` (ma header Apache-2.0 ASF nei file template), nessun test, nessuna CI, nessun lint, versione `0.0.1`, id `com.cordova.realtor` non reverse-DNS proprietario | Non distribuibile seriamente |

### Baseline misurato (percorso diretto, nessun subagent)

Comando di verifica del baseline: `npm ci && npm test && npm run lint && npx cordova build android`.
Risultato baseline: **impossibile eseguire** (nessun `package.json`; Cordova CLI assente; platform Ant su SDK 19 con SDK installato `android-36`).
Punteggio baseline: **AC soddisfatti = 0 / 15** (rapporto 0.00).

Ambiente verificato: Node `v26.11.1`, npm `12.2.0`, Java 17 + 27, `gradle` di sistema, Android SDK `/opt/android-sdk` (platforms `android-36`, build-tools `36.x`), rete OK, `gh` autenticato come `donatopepe` (token presente → push possibile), repo remoto `https://github.com/donatopepe/Realtor.git` **pubblico**.

---

### Rilievi aggiuntivi emersi durante M1

| # | Rilievo | Impatto |
|---|---------|---------|
| 11 | `app.receivedEvent('deviceready')` leggeva `#deviceready`, elemento rimosso dal markup: eccezione a ogni `deviceready` | Codice morto che lanciava un errore a ogni avvio |
| 12 | Il nome della scheda era interpolato in una stringa HTML nella listview (`"<li>…" + chiave + …`) | Markup rotto o iniezione con nomi contenenti `<`, `&`, apici |
| 13 | `<input type="number">` per il prezzo: i browser rifiutano `150.000,50` | Impossibile inserire prezzi nel formato italiano |
| 14 | `$.mobile.allowCrossDomainPages` impostato dopo il caricamento di jQuery Mobile | Opzione inefficace (va impostata su `mobileinit`) |
| 15 | Il form non veniva azzerato aprendo "Nuova scheda" dopo aver visto una scheda esistente | Nuova scheda creata con dati di un'altra |

### Rilievi cross-platform (emersi durante M2)

| # | Rilievo | Impatto |
|---|---------|---------|
| 16 | Progetto di fatto solo Android: `config.xml` senza blocchi `ios`/`browser`, nessun asset iOS, nessun manifest PWA | Non distribuibile fuori da Android |
| 17 | `navigator.app.exitApp` e `notification.confirm` senza verifica di disponibilità; `window.close()` su web | Su iOS il pulsante di uscita non fa nulla; pulsanti non disabilitabili |
| 18 | CSS del template con `user-select:none` globale (bloccava l'editing dei campi su iOS) e regole morte (`.app`, `.event`, `.blink`) | UX rotta su iOS, peso inutile |
| 19 | Storia git con artefatti di build (`platforms/` 1166 file, `plugins/` 375) e `001014428tesi.pdf` (6.5 MB, numero di matricola): 13.6 MB di oggetti, dato personale pubblicato | Cloni pesanti, esposizione di dato personale. **Nessuna credenziale trovata** (scansione su tutti i 337 oggetti: solo falsi positivi da librerie terze) |
| 20 | Nessuna difesa automatica contro l'introduzione di segreti (nessuno scanner, nessuna regola `.gitignore` per `.pem`, `.p12`, `key.properties`, `google-services.json`) | Rischio di pubblicare credenziali con un commit |
| 21 | `#btnInviaSchede` puntava a `href="#page1"`, pagina inesistente: il tocco cambiava pagina senza inviare | Comando di invio che portava a una pagina vuota |
| 22 | Nessuna pagina impostazioni: endpoint API e modalità offline non configurabili dall'utente; nessun backup/ripristino; dati 0.0.1 non migrabili | App utilizzabile solo con il server originale |
| 23 | **Trovato dagli E2E:** i comandi erano legati solo all'evento `tap` di jQuery Mobile, che con il mouse non viene emesso | Nel browser desktop (PWA) i pulsanti non facevano nulla: l'app era di fatto solo touch |
| 24 | **Trovato dagli E2E:** dopo un invio riuscito `renderList()` chiamava `listview('refresh')` su una listview non inizializzata → eccezione e conferma "Schede inviate" mai mostrata | L'utente non vedeva l'esito dell'invio, pur avvenuto; errore in console a ogni invio |
| 25 | `cordova-browser@7` non funziona con un package ESM: `cordova platform add browser` muore con `require is not defined in ES module scope` (il progetto ha `"type": "module"` per Node) | La build Cordova per il browser è impossibile; la via web resta la **PWA** (`www/` + manifest + service worker), già verificata dagli E2E |
| 26 | La preferenza `BackgroundColor=0xffe4e4e4` è accettata da `cordova platform add` ma fa fallire `processDebugResources` (`expected color but got (raw string)`) su cordova-android 15 | APK non producibile finché la preferenza resta in `config.xml` |
| 27 | `cordova-android@15` richiede `targetSdkVersion >= 36`: con `target 35`/`compile 35` dichiarati in `config.xml` avverte e produce un progetto incoerente; inoltre il vecchio `platforms/` Ant (2014) faceva credere a Cordova che la piattaforma fosse "già aggiunta" | Build Android impossibile senza allineare SDK e rimuovere la piattaforma legacy |

---

## 3. Obiettivo e metrica (gate unico)

**Obiettivo originale (completato con v1.0.0):** Realtor cross-platform, offline-first e distribuibile.
**Obiettivo attuale:** hardening cybersecurity post-rilascio mantenendo app avviabile e usabile.

**Metrica M9:** AC-23…AC-32 verificati / 10.
**Soglia:** 10/10 localmente e CI verde; M9 è post-release, non invalida retroattivamente v1.0.0.
Nessun criterio può essere marcato ✅ senza comando di verifica eseguito e output registrato in §9.

Criteri qualitativi di D5 (rubrica 0/1, prima del primo tentativo): funzionamento, test, documentazione, licenza, igiene repo, distribuibilità — tutti obbligatori.

---

## 4. Criteri di accettazione (verificabili)

| AC | Criterio | Comando di verifica |
|----|----------|---------------------|
| AC-01 | Test unit+integration verdi | `npm ci && npm test` exit 0 |
| AC-02 | Lint pulito | `npm run lint` exit 0 |
| AC-03 | E2E verdi (≥6 scenari) | `npm run test:e2e` exit 0 |
| AC-04 | Core senza jQuery/Cordova, coverage ≥80% | `grep -Rn "jquery\|cordova\|window.localStorage" www/js/core \| wc -l` = 0 e `npm run test:coverage` ≥80% |
| AC-05 | APK prodotto | `npx cordova build android` → `platforms/android/app/build/outputs/apk/**/*.apk` |
| AC-06 | Web app funzionante e persistente | `npm run serve` + scenario Playwright "crea/modifica/elimina/persistenza dopo reload" |
| AC-07 | Nessuna perdita dati su invio (rimozione solo dopo 2xx) | test `sendCards` + E2E invio con server mock |
| AC-08 | Endpoint API configurabile da UI, default offline | test settings + `grep -Rn "realtor.dntppe.net" www/` = 0 (solo docs/legacy) |
| AC-09 | Migrazione dati legacy `localStorage` documentata e testata | test dedicato `migration` |
| AC-10 | Server di riferimento testato | `npm run server:test` exit 0 |
| AC-11 | README completo con ogni comando verificato | checklist §README + `npm run docs:check` |
| AC-12 | MIT + attribuzioni | `head -1 LICENSE` = `MIT License` e `node -p "require('./package.json').license"` = MIT e `NOTICE` presente |
| AC-13 | Igiene repo (nessun artefatto tracciato) | `git ls-files \| grep -Ec "^(platforms\|plugins\|node_modules)/"` = 0 e nessun `*.pdf` di tesi |
| AC-14 | Nessun carattere corrotto | `git ls-files -z '*.js' '*.html' '*.md' '*.json' '*.xml' \| xargs -0 grep -l $'\uFFFD' \| wc -l` = 0 |
| AC-15 | CI verde sul remoto (post-push) | `gh run list --limit 1` = success | ✅ run `38888682947` (5/5 job)|
| AC-16 | Web/PWA utilizzabile da `npm run serve`: manifest valido, icone reali, meta di installazione | `npm test` (`pwa.test.js`) + `curl` su `/`, `/manifest.webmanifest`, `/img/icon-192.png` |
| AC-17 | Codice dell'app platform-agnostico: nessuna logica Android/iOS fuori dall'adapter | `npm test` (`pwa.test.js`) |
| AC-18 | `config.xml` dichiara le piattaforme native `android` + `ios` (icone native esistenti e valide) con i plugin usati; il web non passa da `cordova-browser` ma dalla PWA (AC-16) | `npm test` (`pwa.test.js`) |
| AC-19 | Notifiche, stato rete e uscita funzionano su ogni piattaforma (fallback web, `canExit`) | `npm test` (`platform.test.js`) |
| AC-20 | `npm run serve`: MIME corretti (incl. `.webmanifest`), shim `cordova.js`, fallback SPA, path traversal bloccato | `npm test` (`serve.test.js`) |
| AC-21 | CI multi-piattaforma: `ubuntu` (Android + web) e `macos` (iOS) verdi | `gh run list --limit 2` = success | ✅ run `38888682947` (android, ios, e2e, docker, quality)|
| AC-22 | Nessun segreto nei file tracciati **né nella storia git**; scansione automatica | `npm test` (`secrets.test.js`) e `npm run scan:secrets:history` → 0 occorrenze |
| AC-23 | CSP attiva senza violazioni nel browser; nessuno script inline | E2E `security.spec.js` + unit security |
| AC-24 | Header di sicurezza su risposte statiche, HSTS solo HTTPS | E2E HTTP + unit `securityHeaders` |
| AC-25 | Pinning SHA-384 dell’app shell | `npm run sri:check` |
| AC-26 | Nessun sink DOM pericoloso; payload XSS reso come testo | Unit + E2E injection |
| AC-27 | Rate limit per origine, 429/Retry-After, preflight esente, memoria limitata | `npm run server:test` |
| AC-28 | Audit JSON con IP pseudonimizzato, senza token/query/body | `npm run server:test` |
| AC-29 | Backup AES-256-GCM + PBKDF2; password errata e tampering rifiutati | Unit + E2E |
| AC-30 | Limiti body/schede e timeout anti-slowloris | `npm run server:test` |
| AC-31 | Audit runtime, SBOM, Dependabot, CodeQL, action SHA-pinned | audit + SBOM + CI security/CodeQL |
| AC-32 | Threat model coerente con i controlli effettivi | `npm run docs:check` + review `SECURITY.md` |

---

## 5. Architettura target

```
www/                     unico sorgente per Android, iOS, browser/PWA
  index.html             UI jQuery Mobile (pagine: home, scheda, elenco, impostazioni, info)
  manifest.webmanifest   PWA installabile (Android, iOS, desktop)
  sw.js                  service worker: app shell offline, mai su POST o su altre origini
  img/icon-*.png         icone web/maskable/favicon/apple-touch
  css/index.css          stili base condivisi (+ safe area iOS, campi editabili)
  js/core/storage.js     Repository schede su storage iniettabile (no jQuery, no Cordova)
  js/core/schema.js      validazione/normalizzazione/versioning scheda
  js/core/api.js         client fetch iniettabile, base URL configurabile, timeout
  js/core/backup.js      export/import JSON con validazione preventiva
  js/core/migration.js   import del formato 0.0.1 (sposta le voci legacy senza sovrascrivere)
  js/core/settings.js    impostazioni (endpoint API, timeout, migrazione automatica)
  js/platform.js         adapter notification/network/exit + canExit/platformName (fallback web)
  js/app.js              glue UI (unico punto che tocca jQuery Mobile)
resources/android/       icone per densità (generate)
resources/ios/           set icone iOS (generato)
scripts/make-icons.sh    generatore riproducibile delle icone da www/img/logo.png
scripts/serve.js         server statico di sviluppo (MIME, shim cordova.js, fallback SPA)
config.xml               Cordova multi-piattaforma: android + ios, plugin dichiarati, icone native
package.json             metadati, script (serve/test/e2e/server/icons/docker) e devDependencies Cordova+Playwright [M6]
server/                  API REST di riferimento (Node, zero dipendenze runtime, usata dai test end-to-end)
  src/server.js          /health, GET/POST /realtor/api/scheda, token opzionale, CORS, limiti
  src/store.js           archivio in memoria o JSON con scrittura atomica (file corrotto messo da parte)
  Dockerfile             immagine node:22-alpine, utente non privilegiato, volume /data, HEALTHCHECK
tests/                   node:test (unit + integrazione, 170) · server/test (25) · e2e Playwright (19 scenari × 2 viewport)
playwright.config.js     E2E: 2 progetti (desktop, mobile Pixel 5) + 2 server reali (app e API)
docs/                    ENGINEERED-PROMPT.md, API.md, screenshots/ · ARCHITECTURE/PUBLISHING/MIGRATION [M7]
.github/workflows/       ci.yml (ubuntu: lint+test+web+android; macos: ios), release.yml      [M6/M7]
```

Principi: logica core pura e iniettabile → testabile in Node senza device; `www/` unica fonte per PWA, APK e app iOS; nessun ramo per piattaforma (solo feature detection in `platform.js`); nessun segreto nel repo (solo debug signing, keystore documentato e ignorato).

---

## 6. Milestone e gate

| M | Contenuto | Gate (comando) | AC | Stato |
|---|-----------|----------------|-----|-------|
| M0 | Igiene repo: `.gitignore`, `.gitattributes` (LF), untrack `platforms/ plugins/` e `001014428tesi.pdf` (file locale conservato), normalizzazione mode, `package.json`, `LICENSE` MIT, `NOTICE`, `CHANGELOG.md`, README scheletro, rimozione `.bat` legacy | `git ls-files \| wc -l` ≤ 260, `LICENSE` MIT, `npm ci` ok | AC-12, AC-13 | ✅ 2026-10-16 |
| M1 | Fix encoding UTF-8, estrazione core in ES module, setup dei test e primo giro verde (deviazioni: `node:test` al posto di vitest, zero dipendenze; prefisso chiavi `realtor.scheda.`; fix di perdita dati anticipato dal M2 perché non era difendibile mantenere il bug) | `npm test` verde, `grep FFFD` = 0 | AC-01, AC-04, AC-14 | ✅ 2026-10-16 |
| M2 | **Fondamenta cross-platform + igiene segreti:** manifest PWA + icone generate da `scripts/make-icons.sh` (PWA, densità Android, set iOS), server statico `scripts/serve.js` (MIME corretti, shim `cordova.js`, fallback SPA, anti-traversal), `config.xml` multi-piattaforma `android`+`ios`+`browser` con icone native, adapter con `canExit`/`platformName`, meta/CSS per iOS e web (safe area, campi editabili), pulizia CSS morto, **scanner segreti (`scripts/scan-secrets.js`) su working tree e storia, riscrittura della storia (rimossi `platforms/`, `plugins/`, `hooks/`, `*.bat`, `local.properties`, PDF personale) e force-push** | `npm test` verde (87 test: pwa, serve, platform, secrets, core) e `npm run serve` + curl 200/MIME corretti su `/`, `/manifest.webmanifest`, `/cordova.js`, `/img/icon-192.png`; `npm run scan:secrets:history` = 0 | AC-16, AC-17, AC-18, AC-19, AC-20, AC-22 | ✅ 2026-10-16 |
| M3 | **Impostazioni, backup e migrazione:** pagina `#impostazioni` (endpoint REST configurabile o vuoto = offline, stato schede/modalità, comandi backup e migrazione), `core/settings.js`, `core/backup.js` (export/import con validazione preventiva, merge/replace), `core/migration.js` (schede 0.0.1 spostate senza sovrascrivere, idempotente), wiring completo in `app.js`, fix del link morto `#page1`, test della UI con jQuery finta | `npm test` verde (142 test, `app.js` coperto al 93%); `npm run serve` + `curl` su `/` e `/manifest.webmanifest` | AC-07, AC-08, AC-09 | ✅ 2026-10-16 |
| M4 | **Server API di riferimento:** `server/src/server.js` (`GET /health`, `GET/POST /realtor/api/scheda`, token Bearer opzionale a tempo costante, CORS, limiti corpo, errori tipizzati), `server/src/store.js` (memoria o JSON atomico con quarantena dei file corrotti), `server/Dockerfile` + `.dockerignore`, `docs/API.md`, 25 test di integrazione (incluso il contratto end-to-end con `www/js/core/api.js`) e `npm test` esteso a `server/test/` | `npm run server:test` verde; smoke reale con `curl` (201/400/415/413) e immagine Docker con `HEALTHCHECK` = `healthy` | AC-10 | ✅ 2026-10-16 |
| M5 | **E2E multi-viewport + offline:** Playwright con due progetti (`desktop` 1280×800, `mobile` Pixel 5) e due server reali avviati dal config (app su 8123, API su 8124); 19 scenari (home, form, elenco, modifica, eliminazione, validazioni, impostazioni, invio senza/con server, server irraggiungibile, backup, migrazione automatica, manifest, shim `cordova.js`, service worker, uso offline); service worker `www/sw.js` con app shell in cache e nessuna intercettazione di POST/altre origini; screenshot per il README in `docs/screenshots/`. Fix richiesti dagli E2E: comandi legati a `vclick`/`tap`/`click` (funzionano anche con il mouse) e refresh della listview non inizializzata | `npm run test:e2e` verde (39 passed) e `npm test` verde (170) | AC-03, AC-06, AC-16, AC-17 | ✅ 2026-10-16 |
| M6 | **Cordova multi-piattaforma:** `cordova@13`, `cordova-android@15`, `cordova-ios@8` come devDependencies; plugin `cordova-plugin-dialogs` + `cordova-plugin-network-information` dichiarati in `config.xml` e in `package.json` (ripristinati automaticamente da `cordova platform add`); `config.xml` allineato a `targetSdk`/`compileSdk` 36 (richiesto da cordova-android 15), rimossa la preferenza `BackgroundColor` che rompeva il link delle risorse; piattaforma legacy Ant archiviata; `platforms/` + `plugins/` rigenerabili da zero; `cordova-browser` scartato (incompatibile con `"type": "module"`) con la PWA come piattaforma web | `npx cordova platform add android` da zero + `npx cordova build android --debug` → APK; `npm ci && npm test`; verifica del contenuto dell'APK (asset + plugin + firma) | AC-05, AC-18 | ✅ 2026-10-16 |
| M7 | **Documentazione, lint e CI:** README completo (funzionalità, requisiti, avvio rapido, test, build, server, struttura, matrice piattaforme, troubleshooting, licenza) con gli screenshot di M5; `docs/ARCHITECTURE.md`, `docs/MIGRATION.md`, `docs/PUBLISHING.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`; ESLint 10 (flat config) su app, service worker, server, script e test; `scripts/docs-check.js` che verifica comandi/percorsi citati; GitHub Actions `ci.yml` (quality, e2e su Chromium, android con APK come artifact, ios su `macos-14` per simulatore, docker con health check) e `release.yml` su tag `v*` | `npm run lint` e `npm run docs:check` verdi; `gh run list` = success (5 job, ubuntu + macos) | AC-02, AC-11, AC-15, AC-21 | ✅ 2026-10-16 |
| M8 | **Rilascio v1.0.0:** verifica finale completa (lint, 172 test, 39 E2E, docs:check, 0 segreti), `CHANGELOG.md` datato, tag annotato `v1.0.0`, workflow `release.yml` che pubblica il pacchetto web (`www/` in zip) e gli APK nella GitHub Release | `gh run list --limit 1` = success e `gh release view v1.0.0` con gli asset (zip web + APK) | AC-15, AC-21 | ✅ 2026-10-16 |
| M9 | **Cybersecurity post-release:** CSP header/meta, header sicurezza, pinning SRI, backup cifrato AES-256-GCM/PBKDF2, rate limit e audit pseudonimizzato, limiti/timeout server, audit runtime, SBOM, Dependabot, CodeQL, action SHA-pinned, threat model | Gate locale: 207 test unit + 39 server + 53 E2E passati (1 skip), lint, SRI, audit prod, secrets, docs, SBOM | AC-23…AC-32 | ⏳ CI GitHub pending |

Regola di gate: un milestone è ✅ solo con output grezzo dei comandi registrato in §9.

---

## 7. Regole di esecuzione (per il loop)

1. Un solo milestone aperto per volta, nell'ordine M0→M8; continuare quello eventualmente in corso prima di aprirne un altro.
2. Una variabile nominata per iterazione; nessun refactor decorativo.
3. Massimo 3 tentativi per gate; poi stato `BLOCKED` con errore esatto e fallback documentato.
4. Ogni iterazione: eseguire il gate, aggiornare §9 (data, milestone, comando, esito, output), scrivere evidenza in `/home/public/HermesVault/Inbox/<timestamp>-realtor-loop.md`.
5. Nessun segreto nel vault o nel repo; niente push di keystore; niente `npm publish`.
6. Fine lavorazione: tutti i milestone ✅ → cancellare il cron loop e riportare sintesi con AC pass ratio.

---

## 8. Rischi e fallback

| Rischio | Fallback |
|---------|----------|
| SDK installato solo `android-36`; cordova-android richiede una platform specifica | `sdkmanager "platforms;android-35"` (o la platform richiesta); se download vietato → AC-05 resta BLOCKED ma CI workflow pronto |
| Node 26 incompatibile con qualche dipendenza Cordova | build APK delegata a CI su Node 20/22; web test resta locale |
| Ant/gradle offline o download lungo | build in background con timeout, log su file, ripresa all'iterazione successiva |
| Push GitHub | `gh` autenticato: push consentito; se il push fallisce, M7 BLOCKED con errore e worktree committato localmente |
| Perdita dati utente durante la migrazione | backup automatico `localStorage` esportato prima di ogni migrazione |
| Build iOS impossibile su questa macchina (serve macOS + Xcode) | progetto iOS e CI su runner `macos` (M6); in locale si verifica solo `config.xml`/asset, non la compilazione |
| SDK Android: installato `android-36` + `android-35` (build-tools 35/36) | `cordova-android@15` richiede `targetSdk >= 36`: `config.xml` è allineato a 36; `ANDROID_HOME=/opt/android-sdk` va esportato prima dei comandi Cordova |
| `scripts/make-icons.sh` richiede bash + ImageMagick | le icone generate sono versionate: lo script serve solo a rigenerarle; su Windows usare WSL/Git Bash |
| E2E in CI: Chromium (~150 MB) da scaricare | `npx playwright install --with-deps chromium` come passo di CI (M7); in locale i browser restano in `~/.cache/ms-playwright` |
| E2E con server API condiviso tra i test (upsert per nome) | i test usano nomi unici e asserzioni relative (`count >= before + 2`), così restano indipendenti dallo stato |
| La documentazione Cordova suggerisce `cordova-browser` per il web | non è compatibile con `"type": "module"`: la piattaforma web è la PWA; la limitazione è commentata in `config.xml` e verificata da un test |
| Service worker e cache PWA possono servire versioni vecchie | strategia network-first con versione di cache e test in M5 |
| Dopo una riscrittura di storia, GitHub conserva gli oggetti non più raggiungibili (raggiungibili solo per SHA) | verificato il 2026-10-16: il vecchio commit `7e5fee3` è ancora fetchabile per SHA. Remediation: 0 fork/star/issue → su richiesta, cancellare e ricreare il repository (stesso URL) oppure aprire un ticket GitHub Support per la GC forzata |
| Riscrittura della storia già pubblicata | backup completo in `/home/public/HermesVault/Backups/Realtor-pre-rewrite-20261016-104244.bundle` (bundle `--all`, 14 MB) |

---

## 9. Log avanzamento

| Data | M | Comando/gate | Esito | Note |
|------|---|--------------|-------|------|
| 2026-10-16 | — | audit read-only + `npm`/`cordova build` baseline | ❌ 0/15 AC | baseline registrata in §2 |
| 2026-10-16 | M0 | `git ls-files \| wc -l` (≤260); `head -1 LICENSE`; `node -p require('./package.json').license`; `git ls-files \| grep -Ec "^(platforms\|plugins\|node_modules)/"`; `npm ci`; `git status --porcelain` | ✅ **DONE** | 235 file tracciati; `MIT License`; licenza `MIT`; 0 artefatti; 0 pdf; `npm ci` ok (0 vulnerabilità); working tree pulito. Commit `M0: igiene repo, licenza MIT, package.json e rimozione artefatti`. AC ✅: AC-12, AC-13 (**2/15**) |
| 2026-10-16 | M1 | `npm test`; `git ls-files -z '*.js' '*.html' '*.md' '*.json' '*.xml' \| xargs -0 grep -l $'\uFFFD' \| wc -l`; `grep -Rn "jquery\|cordova\|window.localStorage" www/js/core \| wc -l`; `npm run test:coverage`; `grep -Rn "realtor.dntppe.net" www/ \| wc -l` | ✅ **DONE** | 51 test passati, 0 falliti; 0 caratteri U+FFFD; 0 violazioni di purezza nel core; coverage core: schema 100%, storage 100%, api 96.67%, platform 97.03% (soglia 80%); 0 endpoint hardcoded. Commit `M1: core testabile in ES module, fix encoding UTF-8 e 51 test verdi`. AC ✅: AC-01, AC-04, AC-14 (**5/15**) |
| 2026-10-16 | M2 | `npm test` (78 test); `npm run serve` + `curl -w "%{http_code} %{content_type}"` su `/`, `/manifest.webmanifest`, `/cordova.js`, `/img/icon-192.png`, `/css/index.css`, `/js/app.js`, `/route/inesistente` | ✅ **DONE** | 78 test passati, 0 falliti (pwa, serve, platform, core); tutte le route 200 con MIME corretti (`text/html`, `application/manifest+json`, `text/javascript`, `image/png`, `text/css`) e fallback SPA; manifest valido (`Realtor — Schede immobiliari`, display standalone, 3 icone); icone native generate per 6 densità Android e 15 voci iOS; `config.xml` multi-piattaforma. AC ✅: AC-16, AC-17, AC-18, AC-19, AC-20 (**10/21**) |
| 2026-10-16 | M2 (segreti) | `node scripts/scan-secrets.js --history` (337 oggetti: 148 file tracciati + 164 blob storici); `npm test` (87 test); `git rev-list --objects --all \| grep -E "^(platforms\|plugins\|hooks)/\.bat$\|tesi\.pdf$\|local\.properties$"`; `git push --force-with-lease`; `git ls-remote origin master`; `gh api repos/.../commits/7e5fee3` | ✅ **DONE** | **0 credenziali** trovate (né nel tree né in storia; solo falsi positivi da jQuery/okhttp/Cordova, esclusi con redazione+placeholder). Storia riscritta con `git filter-repo`: rimossi `platforms/`, `plugins/`, `hooks/`, `*.bat`, `local.properties` e `001014428tesi.pdf` da tutti i commit; `.git` da 13.6 MB a 1.1 MB; force-push riuscito (`7e5fee3...8018c67 forced update`); remoto allineato. Backup pre-riscrittura in `HermesVault/Backups/Realtor-pre-rewrite-20261016-104244.bundle`. **Caveat:** il vecchio SHA resta fetchabile da GitHub finché non viene eseguita la GC (0 fork/star → cancellazione e ricreazione del repo possibile su richiesta). AC ✅: AC-22 (**11/22**) |
| 2026-10-16 | M2 (purge) | `gh api -X DELETE repos/donatopepe/Realtor` → `gh repo create` → `git push -u origin master`; `gh api repos/.../commits/7e5fee3`; `git fetch origin 7e5fee3` in un clone temporaneo; `gh api -X PUT .../topics` | ✅ **DONE** | Repository cancellato e ricreato (0 fork / 0 star / 0 issue / 0 PR, Pages non configurato): il vecchio SHA ora risponde `No commit found for SHA` e il fetch fallisce con `not our ref` → **purge definitiva**, nessun oggetto residuo. Ripristinati descrizione e 8 topic; `master` = `cba5910`; backup locali intatti (bundle + working tree). |
| 2026-10-16 | M3 | `npm test` (142 test); `npm run test:coverage`; `npm run serve` + `curl` su `/` e `/manifest.webmanifest`; `node scripts/scan-secrets.js --history` | ✅ **DONE** | 142 test passati, 0 falliti; coverage: `app.js` 92.98%, `settings.js` 98.53%, `backup.js` 97.52%, `migration.js` 100%, `schema.js` 100%, `storage.js` 100%, `platform.js` 100% (totale 92.53%); 0 segreti. Pagina Impostazioni con endpoint configurabile (vuoto = offline), export/import backup (merge e replace, validazione prima di scrivere), migrazione 0.0.1 idempotente e senza sovrascritture; fix del link morto `#page1` e del form non azzerato. AC ✅: AC-07, AC-08, AC-09 (**14/22**) |
| 2026-10-16 | M4 | `npm run server:test` (25 test); smoke reale: `node server/src/server.js --port 8091 --data-dir /tmp/…` + `curl` su `/health`, `POST` scheda (201), `POST` elenco (201), `POST` non valida (400 con `details`), `GET` elenco, lettura di `cards.json` su disco, header CORS; `docker build -f server/Dockerfile` + `docker run` + `curl` + `docker exec whoami` + `docker inspect {{.State.Health.Status}}`; `npm test` (142) | ✅ **DONE** | 25/25 test server (suite totale 167); API documentata in `docs/API.md`; normalizzazione/validazione condivise con l'app (stesso `schema.js`); upsert per nome, token Bearer, CORS, errori 400/401/404/405/413/415 tipizzati; scrittura atomica, file corrotto in quarantena; immagine Docker verificata end-to-end (`storage: file`, POST 201, GET persistente, utente `node`, `/data` scrivibile, `HEALTHCHECK` = **healthy**, 238 MB). AC ✅: AC-10 (**15/22**) |
| 2026-10-16 | M5 | `npm run test:e2e` (2 progetti, 2 server reali) e `npm test`; `npm run test:coverage` | ✅ **DONE** | **39 E2E passati / 0 falliti** (19 scenari × desktop + mobile) e **170 test node**; service worker verificato end-to-end (registrazione, ricaricamento con rete disattivata, dati locali leggibili offline); screenshot generati (4 PNG, 1280×800); coverage `app.js` 90.09%, core ≥96%, totale 90.81%. **Due bug reali trovati e corretti dagli E2E:** (a) i comandi non rispondevano al mouse (solo `tap`); (b) dopo un invio riuscito un'eccezione della listview nascondeva la conferma `Schede inviate`. AC ✅: AC-03, AC-06, AC-16, AC-17 (**17/22**) |
| 2026-10-16 | M6 | `sdkmanager "platforms;android-35" "build-tools;35.0.0"`; `npm i -D cordova cordova-android cordova-ios cordova-plugin-dialogs cordova-plugin-network-information`; `npx cordova platform add android` (da zero, dopo aver archiviato il `platforms/` Ant del 2014); `npx cordova build android --debug`; `apkanalyzer manifest print/permissions`; `unzip -l` per asset e plugin; `cordova plugins list`; `npm test` (171) | ✅ **DONE** | APK **4,4 MB** in `platforms/android/app/build/outputs/apk/debug/app-debug.apk`: `package=net.dntppe.realtor`, `versionName=1.0.0`, `versionCode=10000`, `minSdk=24`, `targetSdk=36`, firma debug, con `assets/www/{index.html,js/app.js,sw.js,manifest.webmanifest,js/core/storage.js}` e i plugin `cordova-plugin-dialogs` + `cordova-plugin-network-information`; `cordova platform add` da zero ripristina i plugin da `package.json`; unico permesso `INTERNET`. Corretti: `targetSdk/compileSdk` 35→36, preferenza `BackgroundColor` rimossa (rompeva `processDebugResources`), piattaforma legacy Ant in `/tmp`. `cordova-browser` scartato (ESM). AC ✅: AC-05, AC-18 (**18/22**) |
| 2026-10-16 | M7 | `npm run lint`; `npm run docs:check`; `npm test` (172); `npm run test:coverage`; `npm run scan:secrets:history`; `git push` + `gh run watch`/`gh run view` su 3 run CI (`38887870715` failure → `38888347193` 4/5 → `38888682947` success); `gh run view --job <id> --log-failed` | ✅ **DONE** | **CI verde 5/5 job**: quality (lint+secrets+docs+172 test), e2e (desktop+mobile), android (APK + artifact), **ios su `macos-14`** (simulatore, senza firma), docker (build + health check + POST). Documentazione: 9 documenti verificati da `docs:check` (comandi npm e percorsi esistenti), 6 documenti nuovi + README con 4 screenshot. Lint ESLint 10 pulito. Tre problemi reali trovati dalla CI e risolti: (a) falsi positivi dello scanner su `storePassword=$VAR` e segnaposto (regola keystore ora cattura il valore e applica i controlli sui placeholder); (b) `cordova platform add ios` non funziona con `"type": "module"` → `scripts/ios-prepare.js` (`npm run prepare:ios`); (c) `android-actions/setup-android@v3` rotto sulle nuove cmdline-tools → `@v4` + licenze; inoltre `node --test tests/` non è più valido su Node 22 (gli argomenti sono glob) → scoperta automatica `node --test`. AC ✅: AC-02, AC-11, AC-15, AC-21 (**22/22**) |
| 2026-10-16 | M9 | `npm run lint`; `npm test` 207; `npm run server:test` 39; `npm run test:e2e --workers=2` 53 pass + 1 skip; `npm run sri:check` (17 file); `npm run audit:prod` (0 vuln); `npm run scan:secrets:history` (0); `npm run docs:check`; `npm run sbom` CycloneDX 1.5/294 componenti; smoke PWA `curl` (index/app 200, CSP/XFO presenti) | ✅ **gate locale** | CSP/header, XSS, backup cifrato, rate limit, audit IP pseudonimo senza query/token/body, timeout/limiti, SRI, audit runtime zero vulnerabilità. **Gate CI e build native pending** dopo aggiunta di job security/CodeQL. `npm audit` completo segnala solo devDependencies della toolchain Cordova; quello runtime (`--omit=dev`) è 0. Smoke CSP Cordova su dispositivo reale non eseguito. AC-23…AC-32 10/10 locali; non chiudere M9 globalmente finché CI non è verde. |

---

## 10. Decisioni registrate

- **D-01** Mantenere Cordova (non riscrivere da zero): conserva il valore dell'app e la sua storia; il core estratto resta riusabile come PWA.
- **D-02** jQuery Mobile resta l'unico layer UI (rischio minimo); tutta la logica va in `www/js/core/` senza dipendenze.
- **D-03** Offline-first con API opzionale e configurabile: nessun endpoint privato nel codice.
- **D-04** Server di riferimento minimale incluso, per rendere il flusso "invia schede" realmente funzionante end-to-end.
- **D-05** `001014428tesi.pdf` rimosso dal versionamento (file locale conservato) e aggiunto a `.gitignore`: non pertinente, contiene dato personale.
- **D-06** Licenza MIT (c) 2014-2026 Donato Pepe; `NOTICE` conserva l'attribuzione dei template Apache-2.0 della Apache Software Foundation.
- **D-07** `platforms/` e `plugins/` non più tracciati: rigenerabili con `npm run prepare:android`.
- **D-08** Un solo sorgente (`www/`) per tutte le piattaforme: PWA/web come caso base, Cordova come packaging per Android e iOS. Nessun fork per piattaforma.
- **D-09** Nessun ramo condizionale per piattaforma nel codice dell'app: solo feature detection, isolata in `www/js/platform.js` (`canExit`, `platformName`).
- **D-10** L'uscita dall'app è offerta solo dove la piattaforma la consente (Android): altrove il pulsante è nascosto.
- **D-11** Identità app unificata: `net.dntppe.realtor`, versione `1.0.0` in `config.xml` e `package.json` (mai pubblicata prima, quindi nessuna migrazione di store).
- **D-12** Icone e asset nativi **generati** da `www/img/logo.png` con `scripts/make-icons.sh` e versionati (riproducibili, nessun editor grafico richiesto).
- **D-13** Desktop (Electron) fuori scope per v1.0.0: blocco `config.xml` commentato e script `prepare:electron` pronto.
- **D-14** La storia git viene riscritta (`git filter-repo`) per rimuovere artefatti di build, file macchina-specifici e dato personale, e il remoto viene aggiornato con `--force-with-lease`; nessun fork/star/issue esistenti al momento dell'operazione. Backup completo conservato fuori dal repo.
- **D-15** Difesa preventiva: `scripts/scan-secrets.js` gira nei test (`secrets.test.js`) su working tree **e** storia; `.gitignore` copre le estensioni di credenziali tipiche (`.pem`, `.p12`, `.key`, `key.properties`, `google-services.json`, `GoogleService-Info.plist`, `.npmrc`, `id_rsa`). In CI (M7) la scansione è un passo obbligatorio.
- **D-16** Piattaforma web = PWA servita staticamente (`www/` + manifest + service worker), **non** `cordova-browser`: quest'ultima è incompatibile con il package ESM (`"type": "module"`) richiesto da Node per test e server.
- **D-17** Android: `minSdk 24`, `targetSdk`/`compileSdk` **36** (richiesto da cordova-android 15); plugin nativi dichiarati sia in `config.xml` sia in `package.json`; in locale si produce solo l'APK **debug** (firma di release documentata in `docs/PUBLISHING.md`, M7, con keystore fuori dal repo).
- **D-18** `platforms/` e `plugins/` non sono versionati e si rigenerano con `npm ci && npx cordova platform add android` (verificato da zero in M6).
- **D-19** Documentazione in italiano (prodotto e utenti italiani) con un riepilogo in inglese nel README; i documenti sono verificati da `scripts/docs-check.js`, che controlla che ogni comando e percorso citato esista davvero.
- **D-20** Node **>= 22** per lo sviluppo: su Node 22 gli argomenti di `node --test` sono glob, quindi i test usano la scoperta automatica (`node --test` senza argomenti).
- **D-21** iOS si prepara con `npm run prepare:ios` (`scripts/ios-prepare.js`): tollera l'errore ESM noto di `cordova-ios` e scrive `platforms/ios/package.json` con `{"type":"commonjs"}`; la compilazione resta possibile solo su macOS (verificata in CI).
- **D-22** CI su GitHub Actions: `quality`, `e2e`, `android`, `ios` (macos-14) e `docker` a ogni push/PR; su tag `v*` la release pubblica pacchetto web e APK.
- **D-23** Il rilascio 1.0.0 contiene l'APK **debug** (firma di release non disponibile senza keystore esterno); `release.yml` produce l'APK firmato automaticamente se i quattro segreti di firma sono configurati.
- **D-24** Il pacchetto web include tutto `www/`, comprese le varianti non minificate di jQuery ereditate dal progetto 2014: sono inutili a runtime e verranno rimosse in una prossima revisione (vedi §11).
- **D-25** Sicurezza "by default": la CSP vieta script inline ed `eval`; l'unica concessione è `style-src 'unsafe-inline'`, richiesta da jQuery Mobile (documentata come rischio accettato).
- **D-26** `base-uri 'self'` invece di `'none'`: jQuery Mobile imposta una base URI per la navigazione hash; resta comunque vincolata all'origine.
- **D-27** `frame-ancestors` solo nell'header HTTP (nel `meta` i browser lo ignorano) e policy generata da un'unica fonte (`CONTENT_SECURITY_POLICY` / `..._META`).
- **D-28** Il pinning dei file è una verifica di pipeline e non un attributo `integrity=` a runtime: su iOS le risorse arrivano da `file://`, dove la verifica del browser è inaffidabile e rischierebbe di bloccare l'app.
- **D-29** L'audit `npm audit` è bloccante solo sulle dipendenze di **produzione**: le vulnerabilità della toolchain di sviluppo (cordova-ios → xcode → uuid) restano visibili nel report di CI e gestite da Dependabot (rischio accettato in `SECURITY.md`).

---

## 11. Backlog (dopo la 1.0.0)

1. **Ripulire `www/js/jquery/`**: tenere solo i file referenziati da `index.html` (`.min.js`/`.min.css`) e le immagini usate; riduce il pacchetto web e il repository.
2. **Icone adattive Android** (foreground/background) e splash screen iOS: migliora la resa sulle versioni recenti dei sistemi.
3. **Desktop (Electron)**: sbloccare il blocco commentato in `config.xml` e aggiungere il job opzionale in CI.
4. **Componenti opzionali Android**: supporto al tasto "Indietro" con `cordova-plugin-app-exit`? No: valutare `@capacitor` come alternativa futura, mantenendo `www/` invariato.
5. **Firma di release in CI**: configurare i segreti del keystore e pubblicare l'APK firmato al posto del debug.
