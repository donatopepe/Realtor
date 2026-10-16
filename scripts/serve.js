#!/usr/bin/env node
/**
 * Realtor — server statico di sviluppo, cross-platform e senza dipendenze.
 *
 * Serve `www/` come farebbe GitHub Pages o il WebView di Cordova, con:
 *   - MIME corretti anche per `.webmanifest` (necessario per la PWA),
 *   - shim di `/cordova.js` (nel browser il file generato da Cordova non esiste),
 *   - fallback su `index.html` per le route lato client.
 *
 * Uso:
 *   node scripts/serve.js [--port 8080] [--host 0.0.0.0] [--root www] [--cache] [--quiet]
 *
 * MIT License — Copyright (c) 2014-2026 Donato Pepe (vedi LICENSE).
 */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** MIME type usati dal progetto. */
export const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.wasm': 'application/wasm',
});

/**
 * MIME type dedotto dall'estensione.
 * @param {string} file
 * @returns {string}
 */
export function mimeFor(file) {
  return MIME_TYPES[extname(String(file)).toLowerCase()] || 'application/octet-stream';
}

/**
 * Contenuto servito su `/cordova.js` quando si usa il browser: non definisce
 * `window.cordova`, quindi `www/js/platform.js` usa i fallback web.
 */
export const CORDOVA_SHIM = `/* Realtor — shim di cordova.js per il browser.
 * Cordova genera questo file a build time e lo inietta nel WebView; nel
 * browser non esiste. Questo shim evita un 404 e non definisce window.cordova.
 */
`;

/**
 * Policy CSP usata sia come header HTTP sia (identica) nel meta di `index.html`.
 * `style-src 'unsafe-inline'` è richiesto da jQuery Mobile, che applica stili
 * inline a runtime; gli script restano invece vincolati a `'self'`.
 */
/** Direttive valide sia come header sia come meta. */
const BASE_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self'",
  // jQuery Mobile applica stili inline a runtime.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  // L'endpoint REST è scelto dall'utente: si consente http/https, non altri schemi.
  "connect-src 'self' http: https:",
  "object-src 'none'",
  // `'self'` invece di `'none'`: jQuery Mobile imposta una base URI per la
  // navigazione hash, ma resta vincolata all'origine (niente dirottamenti).
  "base-uri 'self'",
  "form-action 'none'",
  "worker-src 'self'",
  "manifest-src 'self'",
];

/** Policy completa, usata come header HTTP. */
export const CONTENT_SECURITY_POLICY = [...BASE_DIRECTIVES, "frame-ancestors 'none'"].join('; ');

/**
 * Policy per il `meta` di `index.html`: identica all'header tranne
 * `frame-ancestors`, che i browser ignorano quando arriva via meta.
 */
export const CONTENT_SECURITY_POLICY_META = BASE_DIRECTIVES.join('; ');

/**
 * Header di sicurezza applicati a ogni risposta del server statico.
 * `Strict-Transport-Security` è incluso solo quando la connessione è HTTPS.
 * @param {{https?:boolean}} [options]
 */
export function securityHeaders({ https = false } = {}) {
  const headers = {
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'geolocation=(), camera=(), microphone=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
  if (https) headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return headers;
}

function sendBody(response, status, headers, body) {
  response.writeHead(status, { ...securityHeaders({ https: isSecureRequest(response.req) }), ...headers });
  if (response.req.method === 'HEAD') {
    response.end();
    return;
  }
  response.end(body);
}

/** `true` se la richiesta arriva su HTTPS (diretto o dietro proxy fidato). */
function isSecureRequest(request) {
  if (!request) return false;
  if (request.socket && request.socket.encrypted) return true;
  const forwarded = String(request.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
  return forwardCSV(forwarded);
}

function forwardCSV(value) {
  return value === 'https';
}

function sendText(response, status, type, text) {
  sendBody(response, status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(text) }, text);
}

/**
 * Crea il server statico (non avviato).
 * @param {{root?:string, cache?:boolean, logger?:object|null, spaFallback?:boolean}} [options]
 */
export function createStaticServer({
  root = resolve('www'),
  cache = false,
  logger = null,
  spaFallback = true,
} = {}) {
  const rootDir = resolve(root);

  async function handle(request, response) {
    const started = Date.now();
    response.on('finish', () => {
      if (logger && typeof logger.info === 'function') {
        logger.info(`${response.statusCode} ${request.method} ${request.url} (${Date.now() - started} ms)`);
      }
    });

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendText(response, 405, 'text/plain; charset=utf-8', 'Metodo non consentito');
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    } catch {
      sendText(response, 400, 'text/plain; charset=utf-8', 'Richiesta non valida');
      return;
    }

    if (pathname === '/cordova.js') {
      sendText(response, 200, MIME_TYPES['.js'], CORDOVA_SHIM);
      return;
    }

    const relative = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
    const target = resolve(rootDir, `.${relative}`);
    const insideRoot = target === rootDir || target.startsWith(rootDir + sep);
    if (!insideRoot) {
      sendText(response, 403, 'text/plain; charset=utf-8', 'Percorso non consentito');
      return;
    }

    const info = await stat(target).catch(() => null);
    if (info && info.isFile()) {
      response.writeHead(200, {
        ...securityHeaders({ https: isSecureRequest(request) }),
        'Content-Type': mimeFor(target),
        'Content-Length': info.size,
        'Cache-Control': cache ? 'public, max-age=3600' : 'no-store',
      });
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      createReadStream(target)
        .on('error', () => {
          response.destroy();
        })
        .pipe(response);
      return;
    }

    const acceptsHtml = String(request.headers.accept || '').includes('text/html');
    if (spaFallback && (acceptsHtml || extname(pathname) === '')) {
      const indexFile = resolve(rootDir, 'index.html');
      const indexInfo = await stat(indexFile).catch(() => null);
      if (indexInfo && indexInfo.isFile()) {
        response.writeHead(200, {
          ...securityHeaders({ https: isSecureRequest(request) }),
          'Content-Type': MIME_TYPES['.html'],
          'Content-Length': indexInfo.size,
          'Cache-Control': 'no-store',
        });
        if (request.method === 'HEAD') {
          response.end();
          return;
        }
        createReadStream(indexFile).pipe(response);
        return;
      }
    }

    sendText(response, 404, 'text/plain; charset=utf-8', 'File non trovato');
  }

  return createServer((request, response) => {
    handle(request, response).catch((error) => {
      sendText(response, 500, 'text/plain; charset=utf-8', `Errore interno: ${error.message}`);
    });
  });
}

/** Indirizzi IPv4 della macchina, per l'uso da altri dispositivi. */
export function localAddresses() {
  const found = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) found.push(entry.address);
    }
  }
  return found;
}

function parseArgs(argv) {
  const options = { port: 8080, host: '127.0.0.1', root: 'www', cache: false, quiet: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--port' || arg === '-p') options.port = Number(argv[++index]);
    else if (arg === '--host') options.host = String(argv[++index]);
    else if (arg === '--root') options.root = String(argv[++index]);
    else if (arg === '--cache') options.cache = true;
    else if (arg === '--quiet' || arg === '-q') options.quiet = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Argomento non riconosciuto: ${arg}`);
  }
  return options;
}

const USAGE = `Uso: node scripts/serve.js [opzioni]

  -p, --port <numero>   porta di ascolto (default 8080)
      --host <indirizzo> interfaccia (default 127.0.0.1, usa 0.0.0.0 per la rete locale)
      --root <cartella>  cartella da servire (default www)
      --cache            abilita la cache HTTP (default: disattivata)
  -q, --quiet            nessun log per richiesta
  -h, --help             mostra questo aiuto`;

function isMain() {
  const entry = process.argv[1];
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

  const logger = options.quiet ? null : console;
  const server = createStaticServer({ root: options.root, cache: options.cache, logger });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Porta ${options.port} già in uso. Riprova con --port ${options.port + 1}.`);
    } else {
      console.error(`Errore del server: ${error.message}`);
    }
    process.exit(1);
  });

  server.listen(options.port, options.host, () => {
    console.log('Realtor — server statico di sviluppo');
    console.log(`  root:  ${resolve(options.root)}`);
    console.log(`  http:  http://localhost:${options.port}/`);
    if (options.host === '0.0.0.0') {
      for (const address of localAddresses()) console.log(`  lan:   http://${address}:${options.port}/`);
    }
    console.log('  nota:  /cordova.js è servito come shim no-op (nel browser usa i fallback web)');
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
    });
  }
}

export default createStaticServer;

// Riferimento tenuto per chi importa il modulo e vuole il percorso del file.
export const modulePath = fileURLToPath(import.meta.url);
