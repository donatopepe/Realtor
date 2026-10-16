#!/usr/bin/env node
/**
 * Realtor — API REST di riferimento per l'invio delle schede immobiliari.
 *
 * Implementa il contratto usato dall'app (`docs/API.md`):
 *   GET  /health                  stato del servizio
 *   GET  /realtor/api/scheda      elenco delle schede
 *   POST /realtor/api/scheda      salva una scheda o un elenco di schede
 *
 * Nessuna dipendenza runtime: solo moduli Node. La validazione riusa lo stesso
 * schema dell'app (`www/js/core/schema.js`), così client e server non possono
 * divergere.
 *
 * Configurazione (variabili d'ambiente):
 *   PORT / REALTOR_PORT             porta (default 3000)
 *   HOST / REALTOR_HOST             interfaccia (default 0.0.0.0)
 *   REALTOR_DATA_DIR                cartella dell'archivio JSON (default ./data)
 *   REALTOR_DATA_FILE               file dell'archivio (default <data dir>/cards.json)
 *   REALTOR_API_TOKEN               se impostato, richiede Authorization: Bearer <token>
 *   REALTOR_CORS_ORIGIN             origine consentita per CORS (default *)
 *   REALTOR_MAX_BODY_BYTES          dimensione massima del corpo (default 1 MiB)
 *
 * MIT License — Copyright (c) 2014-2026 Donato Pepe (vedi LICENSE).
 */

import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { normalizeCard, validateCard } from '../../www/js/core/schema.js';
import {
  apiSecurityHeaders,
  clientKey,
  createAuditLog,
  createRateLimiter,
  isSecureRequest,
} from './security.js';
import { createFileStore, createMemoryStore } from './store.js';

/** Percorso dell'endpoint delle schede (contratto pubblico). */
export const API_PATH = '/realtor/api/scheda';

/** Percorso di health check. */
export const HEALTH_PATH = '/health';

/** Versione dell'API/servizio. */
export const SERVER_VERSION = '1.0.0';

/** Limite predefinito del corpo: 1 MiB. */
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

/** Numero massimo di schede accettate in una singola richiesta. */
export const DEFAULT_MAX_CARDS_PER_REQUEST = 500;

/** Limite di richieste predefinito per finestra (per origine). */
export const DEFAULT_RATE_LIMIT = Object.freeze({ windowMs: 60000, max: 120 });

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

/** Confronto a tempo costante, per non rivelare il token carattere per carattere. */
function sameSecret(expected, received) {
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(received));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Legge il corpo della richiesta rispettando il limite.
 * Oltre il limite smette di accumulare e segnala l'errore **senza distruggere la
 * connessione**, così il chiamante può ricevere la risposta 413.
 */
function readBody(request, limit) {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks = [];
    let size = 0;
    let exceeded = false;
    request.on('data', (chunk) => {
      if (exceeded) return;
      size += chunk.length;
      if (size > limit) {
        exceeded = true;
        chunks.length = 0;
        rejectPromise(Object.assign(new Error('corpo troppo grande'), { code: 'TOO_LARGE' }));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (!exceeded) resolvePromise(Buffer.concat(chunks).toString('utf8'));
    });
    request.on('error', (error) => {
      if (!exceeded) rejectPromise(error);
    });
  });
}

/** Interpreta il payload ricevuto: elenco, `{cards:[...]}` o scheda singola. */
function extractCards(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object' && Array.isArray(payload.cards)) return payload.cards;
  if (payload && typeof payload === 'object') return [payload];
  return null;
}

/**
 * Crea il server API (non avviato).
 * @param {{
 *   store: object,
 *   token?: string,
 *   corsOrigin?: string,
 *   maxBodyBytes?: number,
 *   logger?: object|null,
 *   version?: string,
 *   startedAt?: number
 * }} options
 */
export function createApiServer({
  store,
  token = '',
  corsOrigin = '*',
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  maxCardsPerRequest = DEFAULT_MAX_CARDS_PER_REQUEST,
  rateLimit = DEFAULT_RATE_LIMIT,
  trustProxy = false,
  logger = null,
  version = SERVER_VERSION,
  startedAt = Date.now(),
} = {}) {
  if (!store || typeof store.upsert !== 'function') {
    throw new TypeError('createApiServer: serve uno store (vedi createMemoryStore/createFileStore).');
  }

  const limiter = createRateLimiter(rateLimit);
  const audit = createAuditLog({ logger: logger && typeof logger.info === 'function' ? logger : null });

  function send(response, status, payload, extraHeaders = {}) {
    const request = response.req;
    const body = payload === undefined ? '' : JSON.stringify(payload);
    response.writeHead(status, {
      ...JSON_HEADERS,
      'Content-Length': Buffer.byteLength(body),
      ...apiSecurityHeaders({ https: isSecureRequest(request, { trustProxy }) }),
      'Access-Control-Allow-Origin': corsOrigin,
      Vary: 'Origin',
      ...extraHeaders,
    });
    if (response.req.method === 'HEAD') {
      response.end();
      return;
    }
    response.end(body);
  }

  function sendError(response, status, code, message, details, extraHeaders = {}) {
    send(
      response,
      status,
      details === undefined ? { error: code, message } : { error: code, message, details },
      extraHeaders,
    );
  }

  function authorized(request) {
    if (token === '') return true;
    const header = String(request.headers.authorization || '');
    if (!header.toLowerCase().startsWith('bearer ')) return false;
    return sameSecret(token, header.slice(7).trim());
  }

  async function handle(request, response) {
    const started = Date.now();
    const client = clientKey(request, { trustProxy });
    const counters = { cards: undefined, invalid: undefined };
    response.on('finish', () => {
      audit.write({
        method: request.method,
        path: url.pathname,
        status: response.statusCode,
        durationMs: Date.now() - started,
        client,
        cards: counters.cards,
        invalid: counters.invalid,
      });
    });

    const url = new URL(request.url, 'http://localhost');
    const path = url.pathname.replace(/\/+$/, '') || '/';

    // Il preflight CORS non consuma il budget di richieste: è generato dal
    // browser e non trasporta dati.
    if (request.method !== 'OPTIONS') {
      const verdict = limiter.check(client);
      response.setHeader('X-RateLimit-Limit', String(rateLimit.max));
      response.setHeader('X-RateLimit-Remaining', String(verdict.remaining));
      if (!verdict.allowed) {
        sendError(response, 429, 'too_many_requests', 'Troppe richieste: riprova più tardi.', undefined, {
          'Retry-After': String(verdict.retryAfterSeconds),
        });
        return;
      }
    }

    if (request.method === 'OPTIONS') {
      send(response, 204, undefined, {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '600',
      });
      return;
    }

    if (!authorized(request)) {
      sendError(response, 401, 'unauthorized', 'Token di accesso mancante o non valido.');
      return;
    }

    if (path === HEALTH_PATH) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendError(response, 405, 'method_not_allowed', `Metodo ${request.method} non supportato su ${HEALTH_PATH}.`);
        return;
      }
      send(response, 200, {
        status: 'ok',
        version,
        cards: store.count(),
        storage: store.kind,
        uptimeMs: Date.now() - startedAt,
        time: new Date().toISOString(),
      });
      return;
    }

    if (path === API_PATH) {
      if (request.method === 'GET' || request.method === 'HEAD') {
        const cards = store.list();
        send(response, 200, { count: cards.length, cards });
        return;
      }

      if (request.method !== 'POST') {
        sendError(response, 405, 'method_not_allowed', `Metodo ${request.method} non supportato su ${API_PATH}.`);
        return;
      }

      const contentType = String(request.headers['content-type'] || '');
      if (!contentType.includes('application/json')) {
        sendError(response, 415, 'unsupported_media_type', 'Content-Type richiesto: application/json.');
        return;
      }

      let raw;
      try {
        raw = await readBody(request, maxBodyBytes);
      } catch (error) {
        if (error.code === 'TOO_LARGE') {
          request.resume(); // drena il resto del corpo senza accumularlo
          sendError(response, 413, 'payload_too_large', `Corpo oltre il limite di ${maxBodyBytes} byte.`);
          return;
        }
        sendError(response, 400, 'bad_request', `Errore di lettura: ${error.message}`);
        return;
      }

      let payload;
      try {
        payload = JSON.parse(raw === '' ? 'null' : raw);
      } catch (error) {
        sendError(response, 400, 'invalid_json', `JSON non valido: ${error.message}`);
        return;
      }

      const extracted = extractCards(payload);
      if (extracted === null || extracted.length === 0) {
        sendError(response, 400, 'invalid_payload', 'Atteso un elenco di schede o un oggetto scheda.');
        return;
      }
      if (extracted.length > maxCardsPerRequest) {
        sendError(
          response,
          413,
          'too_many_cards',
          `Massimo ${maxCardsPerRequest} schede per richiesta (ricevute ${extracted.length}).`,
        );
        return;
      }

      const valid = [];
      const errors = [];
      for (const raw of extracted) {
        const card = normalizeCard(raw);
        const result = validateCard(card);
        if (result.valid) valid.push(card);
        else errors.push({ nome: card.nome, errors: result.errors });
      }

      if (valid.length === 0) {
        sendError(response, 400, 'invalid_cards', 'Nessuna scheda valida nel payload.', errors);
        return;
      }

      counters.cards = valid.length;
      counters.invalid = errors.length;
      const { created, updated } = store.upsert(valid);
      send(response, 201, {
        received: extracted.length,
        saved: valid.length,
        created,
        updated,
        invalid: errors.length,
        errors,
        count: store.count(),
      });
      return;
    }

    sendError(response, 404, 'not_found', `Percorso non trovato: ${path}`);
  }

  const server = createServer((request, response) => {
    handle(request, response).catch((error) => {
      audit.write({
        method: request.method,
        path: new URL(request.url, 'http://localhost').pathname,
        status: 500,
        durationMs: 0,
        client: clientKey(request, { trustProxy }),
        message: error.message,
      });
      if (!response.headersSent) sendError(response, 500, 'internal_error', 'Errore interno del server.');
      else response.end();
    });
  });

  // Difese contro richieste lente/abusive (slowloris) e header abnormi.
  server.headersTimeout = 20000;
  server.requestTimeout = 30000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 100;
  return server;
}

const USAGE = `Uso: node server/src/server.js [opzioni]

  -p, --port <numero>        porta di ascolto (default 3000, env PORT)
      --host <indirizzo>     interfaccia (default 0.0.0.0, env HOST)
      --data-dir <cartella>  cartella dell'archivio JSON (default ./data)
      --data-file <file>     file dell'archivio (default <data-dir>/cards.json)
      --memory               archivio in memoria (nessuna scrittura su disco)
      --token <segreto>      richiede Authorization: Bearer <segreto>
      --cors <origine>       Access-Control-Allow-Origin (default *)
      --trust-proxy          considera x-forwarded-for/-proto (solo dietro proxy fidato)
      --rate-limit <numero>  richieste per finestra e per origine (default 120)
  -q, --quiet                nessun log per richiesta
  -h, --help                 mostra questo aiuto`;

export function parseArgs(argv) {
  const options = {
    port: Number(process.env.REALTOR_PORT || process.env.PORT || 3000),
    host: process.env.REALTOR_HOST || process.env.HOST || '0.0.0.0',
    dataDir: process.env.REALTOR_DATA_DIR || './data',
    dataFile: process.env.REALTOR_DATA_FILE || '',
    memory: false,
    token: process.env.REALTOR_API_TOKEN || '',
    cors: process.env.REALTOR_CORS_ORIGIN || '*',
    maxBodyBytes: Number(process.env.REALTOR_MAX_BODY_BYTES || DEFAULT_MAX_BODY_BYTES),
    maxCardsPerRequest: Number(process.env.REALTOR_MAX_CARDS || DEFAULT_MAX_CARDS_PER_REQUEST),
    rateLimitMax: Number(process.env.REALTOR_RATE_LIMIT_MAX || DEFAULT_RATE_LIMIT.max),
    rateLimitWindowMs: Number(process.env.REALTOR_RATE_LIMIT_WINDOW_MS || DEFAULT_RATE_LIMIT.windowMs),
    trustProxy: process.env.REALTOR_TRUST_PROXY === '1' || process.env.REALTOR_TRUST_PROXY === 'true',
    quiet: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--port' || arg === '-p') options.port = Number(argv[++index]);
    else if (arg === '--host') options.host = String(argv[++index]);
    else if (arg === '--data-dir') options.dataDir = String(argv[++index]);
    else if (arg === '--data-file') options.dataFile = String(argv[++index]);
    else if (arg === '--memory') options.memory = true;
    else if (arg === '--token') options.token = String(argv[++index]);
    else if (arg === '--cors') options.cors = String(argv[++index]);
    else if (arg === '--trust-proxy') options.trustProxy = true;
    else if (arg === '--rate-limit') options.rateLimitMax = Number(argv[++index]);
    else if (arg === '--quiet' || arg === '-q') options.quiet = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Argomento non riconosciuto: ${arg}`);
  }
  return options;
}

function isMain() {
  const entry = process.argv[1] || '';
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href;
  } catch {
    return false;
  }
}

if (isMain()) {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(USAGE);
    process.exit(2);
  }

  if (options.help) {
    console.log(USAGE);
    process.exit(0);
  }

  const onWarn = (message) => console.warn(`[realtor-api] ${message}`);
  const store = options.memory
    ? createMemoryStore()
    : createFileStore({
        file: options.dataFile || resolve(options.dataDir, 'cards.json'),
        onWarn,
      });

  const server = createApiServer({
    store,
    token: options.token,
    corsOrigin: options.cors,
    maxBodyBytes: options.maxBodyBytes,
    maxCardsPerRequest: options.maxCardsPerRequest,
    rateLimit: { windowMs: options.rateLimitWindowMs, max: options.rateLimitMax },
    trustProxy: options.trustProxy,
    logger: options.quiet ? null : console,
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Porta ${options.port} già in uso.`);
    } else {
      console.error(`Errore del server: ${error.message}`);
    }
    process.exit(1);
  });

  server.listen(options.port, options.host, () => {
    console.log(`Realtor API ${SERVER_VERSION} in ascolto su http://${options.host}:${options.port}`);
    console.log(`  archivio: ${store.kind === 'file' ? store.file : 'in memoria'}`);
    console.log(`  token:    ${options.token === '' ? 'non richiesto' : 'richiesto (Bearer)'}`);
    console.log(`  endpoint: ${API_PATH}  ·  health: ${HEALTH_PATH}`);
    console.log(`  limiti:   ${options.rateLimitMax} richieste/${Math.round(options.rateLimitWindowMs / 1000)}s per origine · max ${options.maxCardsPerRequest} schede/richiesta`);

    const publicBind = !['127.0.0.1', 'localhost', '::1'].includes(options.host);
    if (publicBind && options.token === '') {
      console.warn('[realtor-api] ATTENZIONE: server raggiungibile da rete senza token (REALTOR_API_TOKEN).');
    }
    if (publicBind && options.cors === '*') {
      console.warn('[realtor-api] ATTENZIONE: CORS su qualsiasi origine; imposta REALTOR_CORS_ORIGIN in produzione.');
    }
    if (publicBind && options.trustProxy) {
      console.log('[realtor-api] proxy fidato: x-forwarded-for/proto usati per origine e scheme.');
    }
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
    });
  }
}

export default createApiServer;

export const modulePath = fileURLToPath(import.meta.url);
