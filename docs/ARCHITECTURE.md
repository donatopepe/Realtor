# Architettura

Documento per chi modifica Realtor: come è organizzato il codice, perché è diviso così e
quali regole vanno rispettate. Il piano di lavoro e i criteri di verifica sono in
[PLAN.md](../PLAN.md); il contratto HTTP del server in [API.md](API.md).

## Obiettivo

Una sola base di codice (`www/`) che funzioni identica su **web/PWA**, **Android** e **iOS**,
salvi le schede sul dispositivo e le invii solo quando l'utente configura un endpoint.

## Strati

```text
┌──────────────────────────────────────────────────────────────┐
│ UI — www/index.html + jQuery Mobile                          │
│   pagine: home, scheda, elenco, impostazioni                 │
└───────────────▲──────────────────────────────────────────────┘
                │ unico punto di contatto: www/js/app.js
┌───────────────┴──────────────────────────────────────────────┐
│ Core — www/js/core/*.js (nessuna dipendenza esterna)         │
│   schema.js   validazione e normalizzazione                  │
│   storage.js  schede su storage iniettabile                  │
│   settings.js endpoint, timeout, migrazione automatica       │
│   api.js      POST JSON con fetch iniettabile                │
│   backup.js   esportazione/importazione JSON                 │
│   migration.js import delle schede 0.0.1                     │
└───────────────▲──────────────────────────────────────────────┘
                │ dipendenze iniettate
┌───────────────┴──────────────────────────────────────────────┐
│ Piattaforma — www/js/platform.js                             │
│   dialoghi, stato rete, uscita: Cordova se presente,         │
│   altrimenti fallback web (window.alert/confirm, onLine)     │
└──────────────────────────────────────────────────────────────┘
```

## Regole di progettazione

1. **Il core non conosce la piattaforma.** Nessun riferimento a `cordova`, `jQuery`,
   `window.localStorage` o a un ramo Android/iOS dentro `www/js/core/`; questi vincoli sono
   verificati da un test (`tests/unit/page.test.js`).
2. **Dipendenze iniettate.** Storage, `fetch` e jQuery arrivano come parametri: i moduli si
   importano in Node senza DOM e si testano con doppi (`tests/helpers/`).
3. **Nessun dato distrutto.** Una lettura corrotta restituisce `null` senza cancellare; la
   migrazione scrive la nuova voce e verifica prima di rimuovere la vecchia; un import non
   valido non tocca lo storage; l'invio rimuove le schede solo dopo `2xx`.
4. **Un solo evento utente, una sola azione.** I comandi passano da `bindActivate`
   (`vclick` + `tap` + `click` con deduplica): funzionano con touch e con mouse.
5. **Gli errori si vedono.** Ogni fallimento mostra un messaggio all'utente e viene registrato
   in console; nessuna eccezione silenziosa nelle operazioni di salvataggio/invio.
6. **Sicurezza "by default".** CSP senza script inline, header di sicurezza su ogni risposta,
   pinning SRI dei file dell'app, cifratura opzionale dei backup, rate limiting e audit log
   pseudonimizzato lato server. Dettagli e verifiche in [SECURITY.md](../SECURITY.md).
7. **Nessun segreto nel repository.** Endpoint e token non sono mai cablati; la scansione
   `scripts/scan-secrets.js` gira nei test su working tree e storia.

## Flussi principali

### Salvataggio di una scheda
`#btnSalva` → `app.readForm()` → `storage.save()` → `schema.normalizeCard()` +
`schema.validateCard()` (nome obbligatorio, prezzi in formato italiano) → `localStorage`
sotto la chiave `realtor.scheda.<nome>` → conferma all'utente. In caso di errore di
validazione il messaggio è specifico e nulla viene scritto.

### Invio delle schede
`#btnInviaSchede` → controllo connessione (`platform.isOnline()`) → endpoint configurato?
(`settings.apiBaseUrl`) → conferma → `api.sendCards(cards)` (`POST` JSON) → **solo con
risposta `2xx`** le schede vengono rimosse in locale e l'utente vede l'esito. Con endpoint
vuoto, con rete assente o con errore HTTP i dati restano sul dispositivo.

### Backup e migrazione
`settings` → `backup.toJson()` per l'esportazione; all'importazione `backup.parse()` valida
tutto, poi `importJson` scrive in modalità *aggiungi* o *sostituisci*. All'avvio
`migration.migrateLegacy()` riconosce le schede 0.0.1 (chiave = nome, senza `version`),
le sposta sotto il prefisso nuovo e in caso di nome già occupato rinomina (`Nome (2)`)
invece di sovrascrivere.

### Uso offline (PWA)
`www/sw.js` mette in cache l'app shell in modalità cache-first e **non** intercetta `POST`
né richieste verso altre origini (l'API dell'utente resta fuori). La registrazione avviene
in `www/js/app.js` solo su `http/https`.

## Server di riferimento

`server/src/server.js` espone `GET /health` e `GET|POST /realtor/api/scheda` riusando lo
stesso modulo di validazione dell'app (`www/js/core/schema.js`): client e server non possono
divergere. `server/src/store.js` offre archivio in memoria o su file con scrittura atomica
(file temporaneo + `rename`) e mette in quarantena i file corrotti. Il pacchetto Docker è in
`server/Dockerfile`.

## Compatibilità fra piattaforme

| Aspetto | Web/PWA | Android (Cordova) | iOS (Cordova) |
|---------|---------|-------------------|---------------|
| Dialoghi | `window.alert/confirm` | `cordova-plugin-dialogs` | `cordova-plugin-dialogs` |
| Stato rete | `navigator.onLine` | `cordova-plugin-network-information` | idem |
| Uscita dall'app | pulsante nascosto | `navigator.app.exitApp()` | pulsante nascosto |
| Service worker | attivo | non necessario (asset locali) | non necessario |

## Verifiche automatiche

| Livello | Comando | Cosa copre |
|---------|---------|------------|
| Unit/integrazione | `npm test` | core, UI con jQuery finta, struttura pagina/PWA, segreti, server |
| End-to-end | `npm run test:e2e` | app reale su desktop e mobile, invio verso il server, offline |
| Stile | `npm run lint` | app, service worker, server, script, test |
| Documentazione | `npm run docs:check` | comandi e percorsi citati nei documenti |
| Sicurezza (segreti) | `npm run scan:secrets:history` | assenza di credenziali nel working tree e nella storia |
| Sicurezza (integrità) | `npm run sri:check` | hash dei file dell'app shell invariati |
| Sicurezza (dipendenze) | `npm run audit:prod` | nessuna vulnerabilità nelle dipendenze di produzione |
| Sicurezza (offensiva) | `npm run test:e2e` | CSP attiva senza violazioni, payload XSS reso come testo, backup cifrato |

La matrice di build e le pipeline sono in `.github/workflows/`.
