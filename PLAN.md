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
| D5 | Progetto corretto, testato, documentato, MIT, distribuibile | ⏳ in corso — M0 ✅, AC 2/15 | milestone M0→M7 |

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

## 3. Obiettivo e metrica (gate unico)

**Obiettivo (una frase):** rendere Realtor un progetto Cordova+PWA moderno, offline-first, senza perdita di dati, con API configurabile e server di riferimento, coperto da test automatici, documentato e rilasciabile con licenza MIT.

**Metrica:** rapporto criteri di accettazione soddisfatti / criteri totali (`AC pass ratio`).
**Soglia:** ≥ **0.95** con **AC-01…AC-12 obbligatori** (hard gate: se uno è rosso il progetto non è "funzionante").
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

---

## 5. Architettura target

```
www/
  index.html            UI jQuery Mobile (pagine: home, scheda, elenco, impostazioni, info)
  css/index.css
  js/core/storage.js     Repository schede su storage iniettabile (no jQuery, no Cordova)
  js/core/schema.js      validazione/normalizzazione/versioning scheda
  js/core/api.js         client fetch iniettabile, base URL configurabile, timeout/retry
  js/core/backup.js      export/import JSON (round-trip testato)
  js/core/migration.js   import formato legacy 0.0.1
  js/platform.js         adapter notification/network/exit con fallback web
  js/app.js              glue UI (unico punto che tocca jQuery Mobile)
  manifest.webmanifest   PWA installabile
server/                  API di riferimento Node (zero dipendenze runtime)
  src/server.js          GET/POST /realtor/api/scheda, GET /health, CORS
  src/store.js           persistenza JSON con scrittura atomica
  test/*.test.js         integration via fetch reale su porta effimera
  Dockerfile
tests/                   vitest (unit/integration) + playwright (e2e) + fixtures
docs/                    ENGINEERED-PROMPT.md, ARCHITECTURE.md, API.md, PUBLISHING.md, MIGRATION.md
.github/workflows/       ci.yml (lint+test+e2e+build android), release.yml (tag v* → APK)
```

Principi: logica core pura e iniettabile → testabile in Node senza device; `www/` unica fonte per PWA e APK; nessun segreto nel repo (solo debug signing, keystore documentato e ignorato).

---

## 6. Milestone e gate

| M | Contenuto | Gate (comando) | AC | Stato |
|---|-----------|----------------|-----|-------|
| M0 | Igiene repo: `.gitignore`, `.gitattributes` (LF), untrack `platforms/ plugins/` e `001014428tesi.pdf` (file locale conservato), normalizzazione mode, `package.json`, `LICENSE` MIT, `NOTICE`, `CHANGELOG.md`, README scheletro, rimozione `.bat` legacy | `git ls-files \| wc -l` ≤ 260, `LICENSE` MIT, `npm ci` ok | AC-12, AC-13 | ✅ 2026-10-16 |
| M1 | Fix encoding UTF-8, estrazione core in ES module senza cambio di comportamento, setup vitest + primo giro di test | `npm test` verde, `grep FFFD` = 0 | AC-01, AC-04, AC-14 |
| M2 | Fix funzionali: validazione/schema, invio senza data loss, POST JSON corretto, pagina Impostazioni con URL API e modalità offline, export/import backup, fallback web platform | `npm test` verde | AC-06, AC-07, AC-08, AC-09 |
| M3 | Server di riferimento + test integration + Dockerfile + `docs/API.md` | `npm run server:test` verde | AC-10 |
| M4 | E2E Playwright (≥6 scenari) + PWA manifest + screenshot per README | `npm run test:e2e` verde | AC-03, AC-06 |
| M5 | Cordova moderno: `cordova-android@^14`, `config.xml` (id `net.dntppe.realtor`, v1.0.0, engine+plugin dichiarati, preference, minSdk/targetSdk), platform ricreato, plugin ridotti ai soli usati, build APK | `npx cordova build android` → APK | AC-05 |
| M6 | Documentazione completa (README EN + quick start IT, ARCHITECTURE, MIGRATION, PUBLISHING, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT) + lint + CI | `npm run lint` verde, `npm run docs:check` verde | AC-02, AC-11 |
| M7 | Rilascio: commit, push, tag `v1.0.0`, GitHub Release con APK, CI verde | `gh run list --limit 1` = success | AC-15 | ⏳ |

Regola di gate: un milestone è ✅ solo con output grezzo dei comandi registrato in §9.

---

## 7. Regole di esecuzione (per il loop)

1. Un solo milestone aperto per volta, nell'ordine M0→M7; continuare quello eventualmente in corso prima di aprirne un altro.
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

---

## 9. Log avanzamento

| Data | M | Comando/gate | Esito | Note |
|------|---|--------------|-------|------|
| 2026-10-16 | — | audit read-only + `npm`/`cordova build` baseline | ❌ 0/15 AC | baseline registrata in §2 |
| 2026-10-16 | M0 | `git ls-files \| wc -l` (≤260); `head -1 LICENSE`; `node -p require('./package.json').license`; `git ls-files \| grep -Ec "^(platforms\|plugins\|node_modules)/"`; `npm ci`; `git status --porcelain` | ✅ **DONE** | 235 file tracciati; `MIT License`; licenza `MIT`; 0 artefatti; 0 pdf; `npm ci` ok (0 vulnerabilità); working tree pulito. Commit `M0: igiene repo, licenza MIT, package.json e rimozione artefatti`. AC ✅: AC-12, AC-13 (**2/15**) |

---

## 10. Decisioni registrate

- **D-01** Mantenere Cordova (non riscrivere da zero): conserva il valore dell'app e la sua storia; il core estratto resta riusabile come PWA.
- **D-02** jQuery Mobile resta l'unico layer UI (rischio minimo); tutta la logica va in `www/js/core/` senza dipendenze.
- **D-03** Offline-first con API opzionale e configurabile: nessun endpoint privato nel codice.
- **D-04** Server di riferimento minimale incluso, per rendere il flusso "invia schede" realmente funzionante end-to-end.
- **D-05** `001014428tesi.pdf` rimosso dal versionamento (file locale conservato) e aggiunto a `.gitignore`: non pertinente, contiene dato personale.
- **D-06** Licenza MIT (c) 2014-2026 Donato Pepe; `NOTICE` conserva l'attribuzione dei template Apache-2.0 della Apache Software Foundation.
- **D-07** `platforms/` e `plugins/` non più tracciati: rigenerabili con `npm run prepare:android`.
