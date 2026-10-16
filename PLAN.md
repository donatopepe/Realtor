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
| D5 | Progetto corretto, testato, documentato, MIT, distribuibile | ⏳ in corso — M0, M1, M2 ✅, AC 11/22 | milestone M0→M8 |
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

---

## 3. Obiettivo e metrica (gate unico)

**Obiettivo (una frase):** rendere Realtor un progetto **cross-platform** (Android, iOS, web/PWA) moderno, offline-first, senza perdita di dati, con API configurabile e server di riferimento, coperto da test automatici, documentato e rilasciabile con licenza MIT.

**Metrica:** rapporto criteri di accettazione soddisfatti / criteri totali (`AC pass ratio`, 22 criteri).
**Soglia:** ≥ **0.95** (≥ 21/22) con **AC-01…AC-12 obbligatori** (hard gate: se uno è rosso il progetto non è "funzionante").
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
| AC-15 | CI verde sul remoto (post-push) | `gh run list --limit 1` = success |
| AC-16 | Web/PWA utilizzabile da `npm run serve`: manifest valido, icone reali, meta di installazione | `npm test` (`pwa.test.js`) + `curl` su `/`, `/manifest.webmanifest`, `/img/icon-192.png` |
| AC-17 | Codice dell'app platform-agnostico: nessuna logica Android/iOS fuori dall'adapter | `npm test` (`pwa.test.js`) |
| AC-18 | `config.xml` dichiara `android` + `ios` + `browser` con icone native esistenti e valide | `npm test` (`pwa.test.js`) |
| AC-19 | Notifiche, stato rete e uscita funzionano su ogni piattaforma (fallback web, `canExit`) | `npm test` (`platform.test.js`) |
| AC-20 | `npm run serve`: MIME corretti (incl. `.webmanifest`), shim `cordova.js`, fallback SPA, path traversal bloccato | `npm test` (`serve.test.js`) |
| AC-21 | CI multi-piattaforma: `ubuntu` (Android + web) e `macos` (iOS) verdi | `gh run list --limit 2` = success |
| AC-22 | Nessun segreto nei file tracciati **né nella storia git**; scansione automatica | `npm test` (`secrets.test.js`) e `npm run scan:secrets:history` → 0 occorrenze |

---

## 5. Architettura target

```
www/                     unico sorgente per Android, iOS, browser/PWA
  index.html             UI jQuery Mobile (pagine: home, scheda, elenco, impostazioni, info)
  manifest.webmanifest   PWA installabile (Android, iOS, desktop)
  img/icon-*.png         icone web/maskable/favicon/apple-touch
  css/index.css          stili base condivisi (+ safe area iOS, campi editabili)
  js/core/storage.js     Repository schede su storage iniettabile (no jQuery, no Cordova)
  js/core/schema.js      validazione/normalizzazione/versioning scheda
  js/core/api.js         client fetch iniettabile, base URL configurabile, timeout
  js/core/backup.js      export/import JSON (round-trip testato)   [M3]
  js/core/migration.js   import formato legacy 0.0.1             [M3]
  js/platform.js         adapter notification/network/exit + canExit/platformName (fallback web)
  js/app.js              glue UI (unico punto che tocca jQuery Mobile)
resources/android/       icone per densità (generate)
resources/ios/           set icone iOS (generato)
scripts/make-icons.sh    generatore riproducibile delle icone da www/img/logo.png
scripts/serve.js         server statico di sviluppo (MIME, shim cordova.js, fallback SPA)
config.xml               Cordova multi-piattaforma: android + ios + browser (+ electron opzionale)
server/                  API di riferimento Node (zero dipendenze runtime)  [M4]
tests/                   node:test (unit) + Playwright (e2e)                 [M5 per e2e]
docs/                    ENGINEERED-PROMPT.md, ARCHITECTURE.md, API.md, PUBLISHING.md, MIGRATION.md
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
| M3 | Fix funzionali: pagina Impostazioni con URL API e modalità offline, invio senza data loss (già in M1), POST JSON, export/import backup, migrazione dati legacy, collegamento configurazione ↔ `app.js` | `npm test` verde | AC-06, AC-07, AC-08, AC-09 | ⏳ |
| M4 | Server di riferimento (API REST, persistenza JSON atomica, Dockerfile) + test integration + `docs/API.md` | `npm run server:test` verde | AC-10 | ⏳ |
| M5 | E2E Playwright multi-viewport (mobile/desktop) + service worker per l'uso offline + screenshot per README | `npm run test:e2e` verde | AC-03, AC-06, AC-16, AC-17 | ⏳ |
| M6 | Cordova multi-piattaforma: `cordova-android@^14` + `cordova-ios@^7` + `cordova-browser` (Electron opzionale), engine/plugin dichiarati in `package.json`, build APK/AAB, progetto iOS avviabile, CI matrix `ubuntu`+`macos` | `npx cordova build android` → APK; `npx cordova build browser`; iOS su runner macOS | AC-05, AC-18, AC-21 | ⏳ |
| M7 | Documentazione completa (README EN + quick start IT, ARCHITECTURE, MIGRATION, PUBLISHING, matrice piattaforme) + lint + CI | `npm run lint` verde, `npm run docs:check` verde | AC-02, AC-11 | ⏳ |
| M8 | Rilascio: commit, push, tag `v1.0.0`, GitHub Release con APK e build web, CI verde | `gh run list --limit 1` = success | AC-15, AC-21 | ⏳ |

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
| SDK Android: presente solo `android-36`, il target dichiarato è 35 | `sdkmanager "platforms;android-35"` in M6, oppure allineamento a 36 se supportato da `cordova-android` |
| `scripts/make-icons.sh` richiede bash + ImageMagick | le icone generate sono versionate: lo script serve solo a rigenerarle; su Windows usare WSL/Git Bash |
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
