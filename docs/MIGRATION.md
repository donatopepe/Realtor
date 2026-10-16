# Migrazione dalla 0.0.1 alla 1.0.0

Realtor 0.0.1 era un progetto Cordova 3.x (build Ant, `android-19`) con un endpoint privato
cablato nel codice e un bug che cancellava le schede durante l'invio. La 1.0.0 è una
riscrittura della stessa app con la stessa interfaccia, ma con dati, endpoint e build
sotto il controllo dell'utente. Riferimenti: [ARCHITECTURE.md](ARCHITECTURE.md),
[CHANGELOG.md](../CHANGELOG.md), [PLAN.md](../PLAN.md).

## Cosa cambia per chi usava l'app

| Aspetto | 0.0.1 | 1.0.0 |
|---------|-------|-------|
| Dove vivono le schede | `localStorage` con il **nome** come chiave | `localStorage` sotto `realtor.scheda.<nome>` |
| Endpoint di invio | fisso, `http://realtor.dntppe.net/...` | scelto dall'utente in **Impostazioni**; vuoto = solo offline |
| Dopo l'invio | schede cancellate subito (anche in caso di errore) | schede rimosse **solo** dopo risposta `2xx` |
| Backup | assente | esportazione/importazione JSON |
| Offline | non previsto | funziona sempre: l'invio è opzionale |
| Identità app | `com.cordova.realtor` | `net.dntppe.realtor` |

## Migrazione automatica delle schede

Al primo avvio la 1.0.0 cerca le schede 0.0.1 (voci di `localStorage` **fuori** dal prefisso
`realtor.scheda.`, riservate a parte), le converte nello schema corrente e le sposta sotto il
prefisso nuovo:
- scrive la scheda nuova, **verifica** la scrittura e solo dopo rimuove la voce vecchia;
- se esiste già una scheda con lo stesso nome salva la voce migrata come `Nome (2)`,
  `Nome (3)`, … senza sovrascrivere nulla;
- ignora le voci che non sono schede (per esempio le impostazioni) e le chiavi di altre app;
- è idempotente: rieseguirla non cambia nulla.

Si può forzare manualmente da **Impostazioni → Cerca e importa schede vecchie**.
Per disattivare la migrazione automatica, in `localStorage`:
`realtor.settings` → `{"version":1,"apiBaseUrl":"","apiTimeoutMs":10000,"migrateLegacyOnStart":false}`.

Prima di qualunque migrazione conviene comunque fare un backup manuale: **Impostazioni →
Esporta backup JSON** e conservare il file.

## Migrazione per chi sviluppa

| Da | A |
|----|----|
| Il precedente entry point `index.js` (script globale con jQuery) | `www/js/app.js` (modulo ES) + i moduli in `www/js/core/` |
| `var rootURL = "http://realtor.dntppe.net/..."` | `core/settings.js` + pagina Impostazioni |
| `scheda.data` singleton | schede normalizzate con `version` e validate |
| Cordova 3.x con `platforms/` e `plugins/` versionati | Cordova 13+ con `package.json`; `platforms/` e `plugins/` si rigenerano |
| Build Ant (`build.xml`, `android-19`) | Gradle via `cordova-android@15` (minSdk 24, targetSdk 36) |
| Nessun test | 171 test Node + 39 E2E Playwright |
| Nessuna licenza | MIT (`LICENSE`) con attribuzioni in `NOTICE` |

Comandi equivalenti:

```bash
# prima (non più funzionanti)
cordova build

# ora
npm ci
npm test
npm run serve           # web/PWA
npm run build:android   # APK debug
```

Le cartelle `platforms/` e `plugins/` non sono più versionate: ricrearle è la norma
(`rm -rf platforms plugins && npx cordova platform add android`).

## Passaggio a un server proprio

1. Avvia il server di riferimento: `npm run server` (o `npm run docker:build && npm run docker:run`).
2. Nell'app: **Impostazioni** → Endpoint REST → `http://<host>:3000/realtor/api/scheda` → *Salva impostazioni*.
3. Prova con una scheda: **Invia schede**. Le schede spariscono in locale solo se il server risponde `2xx`.
4. Contratto completo, autenticazione e limiti: [API.md](API.md).

Il vecchio endpoint (`realtor.dntppe.net`) non è supportato e non è più presente nel codice.
