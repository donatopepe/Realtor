# API Realtor — contratto di riferimento

Server HTTP minimale (Node, **zero dipendenze runtime**) per ricevere le schede
immobiliari raccolte dall'app. L'app punta a questo servizio tramite il campo
**Endpoint REST** nella pagina *Impostazioni*; con il campo vuoto l'app resta in
modalità solo offline e nessuna scheda viene inviata.

- Base URL predefinita: `http://localhost:3000`
- Endpoint schede: `/realtor/api/scheda`
- Health check: `/health`
- Versione API: `1.0.0`

La validazione riusa lo stesso modulo dell'app (`www/js/core/schema.js`), quindi
client e server non possono divergere nelle regole.

---

## Avvio

```bash
# locale, archivio JSON in ./data/cards.json
npm run server

# archivio in memoria (demo, nessuna scrittura su disco)
node server/src/server.js --memory

# porta e archivio personalizzati
node server/src/server.js --port 8081 --data-dir /var/lib/realtor

# con token di accesso
REALTOR_API_TOKEN='cambiami' node server/src/server.js

# Docker
docker build -f server/Dockerfile -t realtor-api .
docker run --rm -p 3000:3000 -v realtor-data:/data realtor-api
```

### Configurazione

| Variabile | Default | Descrizione |
|-----------|---------|-------------|
| `PORT` / `REALTOR_PORT` | `3000` | porta di ascolto |
| `HOST` / `REALTOR_HOST` | `0.0.0.0` | interfaccia |
| `REALTOR_DATA_DIR` | `./data` | cartella dell'archivio |
| `REALTOR_DATA_FILE` | `<data dir>/cards.json` | file dell'archivio |
| `REALTOR_API_TOKEN` | *(vuoto)* | se impostato richiede `Authorization: Bearer <token>` |
| `REALTOR_CORS_ORIGIN` | `*` | valore di `Access-Control-Allow-Origin` |
| `REALTOR_MAX_BODY_BYTES` | `1048576` | dimensione massima del corpo (1 MiB) |

Opzioni CLI equivalenti: `--port`, `--host`, `--data-dir`, `--data-file`,
`--memory`, `--token`, `--cors`, `--help`.

---

## `GET /health`

```bash
curl -s http://localhost:3000/health
```

```json
{
  "status": "ok",
  "version": "1.0.0",
  "cards": 2,
  "storage": "file",
  "uptimeMs": 1234,
  "time": "2026-10-16T09:00:00.000Z"
}
```

`storage` vale `file` oppure `memory`. Usato anche dall'`HEALTHCHECK` di Docker.

---

## `GET /realtor/api/scheda`

Elenco completo delle schede salvate.

```bash
curl -s http://localhost:3000/realtor/api/scheda
```

```json
{
  "count": 2,
  "cards": [
    {
      "version": 1,
      "nome": "Attico Centro",
      "indirizzo": "Via Roma 1",
      "descrizione": "Vista sul parco",
      "prezzo": "250.000,50"
    }
  ]
}
```

## `POST /realtor/api/scheda`

Salva una scheda o un elenco di schede. **Il nome è la chiave**: una scheda con
lo stesso nome aggiorna quella esistente invece di duplicarla.

```bash
# scheda singola
curl -s -X POST http://localhost:3000/realtor/api/scheda \
  -H 'Content-Type: application/json' \
  -d '{"nome":"Attico Centro","indirizzo":"Via Roma 1","descrizione":"Vista sul parco","prezzo":"250.000,50"}'

# elenco (formato usato dall'app)
curl -s -X POST http://localhost:3000/realtor/api/scheda \
  -H 'Content-Type: application/json' \
  -d '{"cards":[{"nome":"Villa A","prezzo":"500.000"},{"nome":"Villa B","prezzo":"600.000"}]}'
```

Sono accettati anche `{"cards":[…]}` e un array puro, così l'app può inviare
direttamente l'elenco delle schede.

Risposta `201`:

```json
{
  "received": 2,
  "saved": 2,
  "created": ["Villa A", "Villa B"],
  "updated": [],
  "invalid": 0,
  "errors": [],
  "count": 4
}
```

Le schede non valide vengono **scartate e segnalate**, le valide vengono salvate
(`invalid` > 0 con `errors` compilato). Se nessuna è valida la risposta è `400`
`invalid_cards` e **nulla** viene scritto.

### Normalizzazione

Prima del salvataggio i valori sono normalizzati come nell'app: spazi compattati,
caratteri di controllo rimossi, simbolo `€` e spazi eliminati dal prezzo. Sono
accettati prezzi come `150000`, `150.000`, `150.000,50`, `1500.50`.

### Validazione

| Campo | Regola |
|-------|--------|
| `nome` | obbligatorio, massimo 80 caratteri |
| `indirizzo` | massimo 160 caratteri |
| `descrizione` | massimo 2000 caratteri |
| `prezzo` | opzionale; interi, separatore migliaia `.`, decimali `,` o `.` (max 2 cifre) |

---

## Autenticazione

Se `REALTOR_API_TOKEN` è impostato, **tutte** le rotte (incluso `/health`)
richiedono l'header:

```
Authorization: Bearer <token>
```

Token mancante o errato → `401 unauthorized` (confronto a tempo costante, token
mai scritto nei log). L'app non invia token: usa questo server su una rete
fidabile o mettilo dietro un reverse proxy autenticato.

---

## CORS

Le risposte includono sempre `Access-Control-Allow-Origin` (default `*`) e
`Vary: Origin`; il preflight `OPTIONS` risponde `204` con metodi
`GET, POST, OPTIONS` e header `Content-Type, Authorization`. Imposta
`REALTOR_CORS_ORIGIN` sull'origine esatta in produzione.

---

## Errori

| HTTP | `error` | Quando |
|------|---------|--------|
| 400 | `invalid_json` | corpo non è JSON |
| 400 | `invalid_payload` | né elenco né oggetto scheda |
| 400 | `invalid_cards` | nessuna scheda valida (`details` con i motivi) |
| 401 | `unauthorized` | token mancante o errato |
| 404 | `not_found` | percorso sconosciuto |
| 405 | `method_not_allowed` | metodo non previsto su una rotta esistente |
| 413 | `payload_too_large` | corpo oltre `REALTOR_MAX_BODY_BYTES` |
| 415 | `unsupported_media_type` | `Content-Type` diverso da `application/json` |
| 500 | `internal_error` | errore imprevisto |

---

## Persistenza

Archivio JSON con scrittura **atomica** (file temporaneo + `rename`) per non
lasciare file parziali:

```json
{ "version": 1, "updatedAt": "2026-10-16T09:00:00.000Z", "count": 2, "cards": [] }
```

Un file corrotto non viene sovrascritto: è rinominato in
`cards.json.corrupt-<timestamp>` e il server riparte da un archivio vuoto.

Per produzione su larga scala sostituire lo store con un database: l'interfaccia
richiesta è `list()`, `count()`, `upsert(cards)`, `clear()`.

---

## Versionamento e compatibilità

- Il contratto è stabile all'interno della major `1.x`; campi nuovi saranno
  aggiunti, quelli esistenti non rimossi.
- Il client dell'app (`www/js/core/api.js`) considera riuscito l'invio **solo**
  con risposta `2xx` e rimuove le schede locali soltanto in quel caso.
- Il percorso legacy `http://realtor.dntppe.net/realtor/api/scheda` della
  versione 0.0.1 non è più supportato: l'endpoint è configurato dall'utente.
