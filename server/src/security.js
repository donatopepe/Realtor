/**
 * Realtor — componenti di sicurezza del server API.
 *
 * - `createRateLimiter`: limite di richieste per origine (finestra scorrevole),
 *   con pulizia delle voci scadute per non crescere indefinitamente in memoria.
 * - `createAuditLog`: log strutturato in JSON per ogni richiesta; non registra mai
 *   token o corpi, e sostituisce l'indirizzo IP con un hash salato (correlazione
 *   senza conservare dati personali).
 * - `clientKey`: individua l'origine della richiesta, considerando i proxy solo se
 *   dichiarati fidati.
 *
 * Nessuna dipendenza esterna.
 *
 * MIT License — Copyright (c) 2014-2026 Donato Pepe (vedi LICENSE e NOTICE).
 */

import { createHash, randomBytes } from 'node:crypto';

/**
 * Crea un limitatore di richieste a finestra scorrevole.
 * @param {{windowMs?:number, max?:number, maxTracked?:number, now?:() => number}} [options]
 */
export function createRateLimiter({ windowMs = 60000, max = 60, maxTracked = 5000, pruneEvery = 256, now = () => Date.now() } = {}) {
  /** @type {Map<string, number[]>} */
  const hits = new Map();
  let checks = 0;

  function prune(timestamp) {
    for (const [key, timestamps] of hits) {
      const recent = timestamps.filter((value) => timestamp - value < windowMs);
      if (recent.length === 0) hits.delete(key);
      else hits.set(key, recent);
    }
  }

  /**
   * Registra una richiesta.
   * @param {string} key
   * @returns {{allowed:boolean, remaining:number, retryAfterSeconds:number}}
   */
  function check(key) {
    const timestamp = now();
    checks += 1;

    // Pulizia periodica (costo ammortizzato) o immediata se la mappa cresce troppo.
    if (hits.size >= maxTracked || checks % pruneEvery === 0) prune(timestamp);

    // Limita la memoria anche quando arrivano molte origini ancora attive.
    // Invece di espellere un client esistente (aggiramento del rate-limit),
    // rifiuta nuove chiavi fino alla scadenza della finestra.
    if (!hits.has(key) && hits.size >= maxTracked) {
      return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)) };
    }

    const timestamps = (hits.get(key) || []).filter((value) => timestamp - value < windowMs);
    if (timestamps.length >= max) {
      const oldest = timestamps[0];
      const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (timestamp - oldest)) / 1000));
      hits.set(key, timestamps);
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }

    timestamps.push(timestamp);
    hits.set(key, timestamps);
    return { allowed: true, remaining: Math.max(0, max - timestamps.length), retryAfterSeconds: 0 };
  }

  function reset(key) {
    if (key === undefined) hits.clear();
    else hits.delete(key);
  }

  return { check, reset, get size() { return hits.size; } };
}

/**
 * Individua l'origine della richiesta.
 * L'header `x-forwarded-for` viene considerato **solo** se il server è dietro un
 * proxy dichiarato fidato (`trustProxy`), altrimenti sarebbe falsificabile dal
 * client e permetterebbe di aggirare il limite di richieste.
 * @param {object} request
 * @param {{trustProxy?:boolean}} [options]
 */
export function clientKey(request, { trustProxy = false } = {}) {
  if (trustProxy) {
    const forwarded = String(request.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded !== '') return forwarded;
  }
  return request.socket?.remoteAddress || request.connection?.remoteAddress || 'sconosciuto';
}

/**
 * Crea il logger di audit.
 * @param {{logger?:object|null, salt?:string, now?:() => Date}} [options]
 */
export function createAuditLog({ logger = console, salt = randomBytes(16).toString('hex'), now = () => new Date() } = {}) {
  const hash = (value) => createHash('sha256').update(`${salt}:${value}`).digest('hex').slice(0, 12);

  /**
   * Registra una richiesta conclusa.
   * @param {{method:string, path:string, status:number, durationMs:number, client?:string, cards?:number, invalid?:number, bytes?:number, message?:string}} entry
   */
  function write(entry) {
    if (!logger || typeof logger.info !== 'function') return;
    logger.info(
      JSON.stringify({
        ts: now().toISOString(),
        event: 'http_request',
        method: entry.method,
        path: entry.path,
        status: entry.status,
        ms: entry.durationMs,
        client: entry.client ? hash(entry.client) : undefined,
        cards: entry.cards,
        invalid: entry.invalid,
        bytes: entry.bytes,
        message: entry.message,
      }),
    );
  }

  return { write, hash };
}

/** Header di sicurezza applicati alle risposte dell'API. */
export function apiSecurityHeaders({ https = false } = {}) {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-site',
    'Cache-Control': 'no-store',
  };
  if (https) headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return headers;
}

/** `true` se la richiesta arriva su HTTPS (diretta o via proxy fidato). */
export function isSecureRequest(request, { trustProxy = false } = {}) {
  if (request?.socket?.encrypted) return true;
  if (!trustProxy) return false;
  return String(request?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}
