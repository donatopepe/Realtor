/**
 * Test dei controlli di sicurezza del server API: limiti di richieste, header,
 * log di audit, limiti di payload e individuazione dell'origine.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { API_PATH, HEALTH_PATH, createApiServer } from '../src/server.js';
import { apiSecurityHeaders, clientKey, createAuditLog, createRateLimiter, isSecureRequest } from '../src/security.js';
import { createMemoryStore } from '../src/store.js';

const card = (nome) => ({ nome, indirizzo: 'Via Test 1', descrizione: '', prezzo: '100' });

async function withServer(options, fn) {
  const store = options.store || createMemoryStore();
  const server = createApiServer({ ...options, store });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base, { server, store });
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
}

test('limitatore: blocca oltre il massimo e indica quando riprovare', () => {
  let clock = 0;
  const limiter = createRateLimiter({ windowMs: 1000, max: 2, now: () => clock });

  assert.equal(limiter.check('a').allowed, true);
  assert.equal(limiter.check('a').remaining, 0);
  const blocked = limiter.check('a');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 1);

  // origini diverse hanno budget indipendente
  assert.equal(limiter.check('b').allowed, true);

  // dopo la finestra il budget torna disponibile
  clock = 1500;
  assert.equal(limiter.check('a').allowed, true);
});

test('limitatore: la mappa ha un tetto e le voci scadute vengono ripulite', () => {
  let clock = 0;
  const limiter = createRateLimiter({ windowMs: 100, max: 5, maxTracked: 2, pruneEvery: 1000, now: () => clock });
  limiter.check('a');
  limiter.check('b');
  const rejected = limiter.check('c');
  assert.equal(rejected.allowed, false, 'una nuova origine non deve superare il tetto di memoria');
  assert.equal(limiter.size, 2);

  clock = 1000;
  assert.equal(limiter.check('c').allowed, true);
  assert.equal(limiter.size, 1, 'le voci scadute dovevano essere rimosse');

  limiter.reset();
  assert.equal(limiter.size, 0);
});

test('clientKey ignora x-forwarded-for se il proxy non è fidato', () => {
  const request = { headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }, socket: { remoteAddress: '127.0.0.1' } };
  assert.equal(clientKey(request), '127.0.0.1');
  assert.equal(clientKey(request, { trustProxy: true }), '203.0.113.9');
  assert.equal(clientKey({ headers: {}, socket: {} }), 'sconosciuto');
});

test('isSecureRequest riconosce TLS diretto e proxy fidato', () => {
  assert.equal(isSecureRequest({ socket: { encrypted: true } }), true);
  assert.equal(isSecureRequest({ socket: {}, headers: { 'x-forwarded-proto': 'https' } }), false);
  assert.equal(isSecureRequest({ socket: {}, headers: { 'x-forwarded-proto': 'https' } }, { trustProxy: true }), true);
});

test('apiSecurityHeaders include HSTS solo su https', () => {
  const plain = apiSecurityHeaders();
  assert.equal(plain['X-Content-Type-Options'], 'nosniff');
  assert.equal(plain['X-Frame-Options'], 'DENY');
  assert.equal(plain['Referrer-Policy'], 'no-referrer');
  assert.equal(plain['Strict-Transport-Security'], undefined);

  assert.match(apiSecurityHeaders({ https: true })['Strict-Transport-Security'], /max-age=31536000/);
});

test('audit log: JSON strutturato, IP pseudonimizzato e nessun segreto', () => {
  const lines = [];
  const audit = createAuditLog({ logger: { info: (line) => lines.push(line) }, salt: 'sale-di-test' });

  audit.write({ method: 'POST', path: API_PATH, status: 201, durationMs: 12, client: '203.0.113.9', cards: 2 });
  assert.equal(lines.length, 1);

  const entry = JSON.parse(lines[0]);
  assert.equal(entry.event, 'http_request');
  assert.equal(entry.status, 201);
  assert.equal(entry.cards, 2);
  assert.match(entry.client, /^[0-9a-f]{12}$/);
  assert.ok(!lines[0].includes('203.0.113.9'), 'l’IP non deve comparire in chiaro');

  // lo stesso client produce sempre lo stesso hash (correlazione senza dato personale)
  const again = createAuditLog({ logger: { info: (line) => lines.push(line) }, salt: 'sale-di-test' });
  again.write({ method: 'GET', path: HEALTH_PATH, status: 200, durationMs: 1, client: '203.0.113.9' });
  assert.equal(JSON.parse(lines[1]).client, entry.client);
});

test('limite di richieste per origine: 429 con Retry-After e header informativi', async () => {
  await withServer({ rateLimit: { windowMs: 60000, max: 2 } }, async (base) => {
    const first = await fetch(`${base}${HEALTH_PATH}`);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('x-ratelimit-limit'), '2');
    assert.equal(first.headers.get('x-ratelimit-remaining'), '1');

    const second = await fetch(`${base}${HEALTH_PATH}`);
    assert.equal(second.status, 200);
    assert.equal(second.headers.get('x-ratelimit-remaining'), '0');

    const third = await fetch(`${base}${HEALTH_PATH}`);
    assert.equal(third.status, 429);
    assert.ok(Number(third.headers.get('retry-after')) >= 1);
    assert.equal((await third.json()).error, 'too_many_requests');
  });
});

test('il preflight CORS non consuma il budget di richieste', async () => {
  await withServer({ rateLimit: { windowMs: 60000, max: 1 } }, async (base) => {
    for (let index = 0; index < 5; index += 1) {
      const preflight = await fetch(`${base}${API_PATH}`, { method: 'OPTIONS' });
      assert.equal(preflight.status, 204);
    }
    const real = await fetch(`${base}${API_PATH}`);
    assert.equal(real.status, 200, 'il budget doveva essere intatto');
    const blocked = await fetch(`${base}${API_PATH}`);
    assert.equal(blocked.status, 429);
  });
});

test('le risposte dell’API includono gli header di sicurezza', async () => {
  await withServer({}, async (base) => {
    const response = await fetch(`${base}${API_PATH}`);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('strict-transport-security'), null);
  });
});

test('dietro proxy fidato su https vengono emessi HSTS e origine reale', async () => {
  const lines = [];
  await withServer(
    { trustProxy: true, logger: { info: (line) => lines.push(line), error() {} } },
    async (base) => {
      const response = await fetch(`${base}${API_PATH}`, {
        headers: { 'x-forwarded-proto': 'https', 'x-forwarded-for': '198.51.100.7' },
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('strict-transport-security'), /max-age=/);

      const entry = JSON.parse(lines.at(-1));
      assert.match(entry.client, /^[0-9a-f]{12}$/);
      assert.ok(!lines.join('').includes('198.51.100.7'));
    },
  );
});

test('troppe schede in una richiesta: 413', async () => {
  await withServer({ maxCardsPerRequest: 3 }, async (base) => {
    const response = await fetch(`${base}${API_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([card('A'), card('B'), card('C'), card('D')]),
    });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error, 'too_many_cards');
  });
});

test('il log audit esclude query string e parametri di URL', async () => {
  const lines = [];
  await withServer({ logger: { info: (line) => lines.push(line), error() {} } }, async (base) => {
    await fetch(`${base}${HEALTH_PATH}?token=segreto&password=altro`);
  });
  const serialized = lines.join('\n');
  assert.ok(!serialized.includes('segreto'));
  assert.ok(!serialized.includes('password='));
  assert.equal(JSON.parse(lines[0]).path, HEALTH_PATH);
});

test('il token non compare nei log di audit', async () => {
  const lines = [];
  await withServer(
    { token: 'token-segreto-di-test', logger: { info: (line) => lines.push(line), error() {} } },
    async (base) => {
      await fetch(`${base}${API_PATH}`, { headers: { Authorization: 'Bearer token-segreto-di-test' } });
      await fetch(`${base}${API_PATH}`, { headers: { Authorization: 'Bearer sbagliato' } });
    },
  );

  const text = lines.join('\n');
  assert.ok(text.length > 0);
  assert.ok(!text.includes('token-segreto-di-test'), 'il token non deve finire nei log');
  assert.ok(!text.includes('Bearer'), 'gli header non devono finire nei log');
  assert.ok(lines.every((line) => JSON.parse(line).event === 'http_request'));
});

test('il server impone timeout contro richieste lente', () => {
  const server = createApiServer({ store: createMemoryStore() });
  assert.ok(server.headersTimeout > 0);
  assert.ok(server.requestTimeout > 0);
  assert.ok(server.keepAliveTimeout > 0);
  assert.equal(server.maxHeadersCount, 100);
});
