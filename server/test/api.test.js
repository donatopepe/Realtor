/**
 * Test di integrazione dell'API di riferimento (fetch reale su porta effimera).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { API_PATH, DEFAULT_MAX_BODY_BYTES, HEALTH_PATH, createApiServer } from '../src/server.js';
import { createMemoryStore } from '../src/store.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

const card = (nome, extra = {}) => ({
  nome,
  indirizzo: 'Via Test 1',
  descrizione: 'nota',
  prezzo: '150.000,50',
  ...extra,
});

/**
 * Avvia il server su una porta effimera ed esegue `fn(base, server)`.
 * @param {object} options
 * @param {Function} fn
 */
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

test('GET /health riporta stato, versione e numero di schede', async () => {
  await withServer({}, async (base) => {
    const response = await fetch(`${base}${HEALTH_PATH}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.cards, 0);
    assert.equal(body.storage, 'memory');
    assert.equal(typeof body.uptimeMs, 'number');
  });
});

test('GET elenco: vuoto all’inizio', async () => {
  await withServer({}, async (base) => {
    const response = await fetch(`${base}${API_PATH}`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { count: 0, cards: [] });
  });
});

test('POST scheda singola e array di schede', async () => {
  await withServer({}, async (base) => {
    const single = await fetch(`${base}${API_PATH}`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(card('Alfa')),
    });
    assert.equal(single.status, 201);
    const singleBody = await single.json();
    assert.deepEqual(singleBody.created, ['Alfa']);
    assert.equal(singleBody.saved, 1);
    assert.equal(singleBody.count, 1);

    const many = await fetch(`${base}${API_PATH}`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify([card('Beta'), card('Gamma')]),
    });
    const manyBody = await many.json();
    assert.equal(many.status, 201);
    assert.equal(manyBody.saved, 2);

    const list = await fetch(`${base}${API_PATH}`);
    const listBody = await list.json();
    assert.equal(listBody.count, 3);
    assert.deepEqual(
      listBody.cards.map((entry) => entry.nome),
      ['Alfa', 'Beta', 'Gamma'],
    );
  });
});

test('POST normalizza i dati come fa l’app', async () => {
  await withServer({}, async (base) => {
    const response = await fetch(`${base}${API_PATH}`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ nome: '  Attico  ', indirizzo: ' Via  Roma ', prezzo: ' € 250.000,50 ' }),
    });
    assert.equal(response.status, 201);
    const list = await (await fetch(`${base}${API_PATH}`)).json();
    assert.deepEqual(list.cards[0], {
      version: 1,
      nome: 'Attico',
      indirizzo: 'Via Roma',
      descrizione: '',
      prezzo: '250.000,50',
    });
  });
});

test('POST con lo stesso nome aggiorna la scheda (nessun duplicato)', async () => {
  await withServer({}, async (base) => {
    await fetch(`${base}${API_PATH}`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(card('Alfa')) });
    const again = await fetch(`${base}${API_PATH}`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(card('Alfa', { descrizione: 'aggiornata' })),
    });
    const body = await again.json();
    assert.deepEqual(body.updated, ['Alfa']);
    assert.deepEqual(body.created, []);
    assert.equal(body.count, 1);

    const list = await (await fetch(`${base}${API_PATH}`)).json();
    assert.equal(list.cards[0].descrizione, 'aggiornata');
  });
});

test('POST rifiuta schede non valide senza salvare nulla', async () => {
  await withServer({}, async (base) => {
    const response = await fetch(`${base}${API_PATH}`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify([{ nome: '', prezzo: 'abc' }]),
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'invalid_cards');
    assert.equal(body.details.length, 1);
    assert.deepEqual(body.details[0].errors.map((item) => item.field), ['nome', 'prezzo']);

    const list = await (await fetch(`${base}${API_PATH}`)).json();
    assert.equal(list.count, 0);
  });
});

test('POST salva le schede valide e segnala quelle scartate', async () => {
  await withServer({}, async (base) => {
    const response = await fetch(`${base}${API_PATH}`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify([card('Buona'), { nome: '', prezzo: 'x' }]),
    });
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.saved, 1);
    assert.equal(body.invalid, 1);
    assert.equal(body.count, 1);
  });
});

test('POST rifiuta body non JSON, content-type errato e payload inatteso', async () => {
  await withServer({}, async (base) => {
    const wrongType = await fetch(`${base}${API_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'ciao',
    });
    assert.equal(wrongType.status, 415);

    const brokenJson = await fetch(`${base}${API_PATH}`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: '{non-json',
    });
    assert.equal(brokenJson.status, 400);
    assert.equal((await brokenJson.json()).error, 'invalid_json');

    const empty = await fetch(`${base}${API_PATH}`, { method: 'POST', headers: JSON_HEADERS, body: '[]' });
    assert.equal(empty.status, 400);
    assert.equal((await empty.json()).error, 'invalid_payload');

    const scalar = await fetch(`${base}${API_PATH}`, { method: 'POST', headers: JSON_HEADERS, body: '42' });
    assert.equal(scalar.status, 400);
  });
});

test('POST rifiuta un corpo oltre il limite', async () => {
  await withServer({ maxBodyBytes: 256 }, async (base) => {
    const response = await fetch(`${base}${API_PATH}`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ nome: 'Grande', descrizione: 'x'.repeat(1000) }),
    });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error, 'payload_too_large');
    assert.equal(DEFAULT_MAX_BODY_BYTES, 1024 * 1024);
  });
});

test('token: senza o errato risponde 401, corretto accetta', async () => {
  await withServer({ token: 'segreto-di-test-123' }, async (base) => {
    const anonymous = await fetch(`${base}${API_PATH}`);
    assert.equal(anonymous.status, 401);
    assert.equal((await anonymous.json()).error, 'unauthorized');

    const wrong = await fetch(`${base}${API_PATH}`, { headers: { Authorization: 'Bearer sbagliato' } });
    assert.equal(wrong.status, 401);

    const health = await fetch(`${base}${HEALTH_PATH}`);
    assert.equal(health.status, 401, 'l’health check è protetto dal token');

    const ok = await fetch(`${base}${API_PATH}`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, Authorization: 'Bearer segreto-di-test-123' },
      body: JSON.stringify(card('Alfa')),
    });
    assert.equal(ok.status, 201);
  });
});

test('CORS: preflight e header sulle risposte', async () => {
  await withServer({ corsOrigin: 'https://app.test' }, async (base) => {
    const preflight = await fetch(`${base}${API_PATH}`, { method: 'OPTIONS' });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://app.test');
    assert.match(preflight.headers.get('access-control-allow-methods'), /POST/);

    const get = await fetch(`${base}${API_PATH}`);
    assert.equal(get.headers.get('access-control-allow-origin'), 'https://app.test');
    assert.equal(get.headers.get('cache-control'), 'no-store');
  });
});

test('percorsi e metodi non supportati', async () => {
  await withServer({}, async (base) => {
    const missing = await fetch(`${base}/api/inesistente`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error, 'not_found');

    const wrongMethod = await fetch(`${base}${API_PATH}`, { method: 'PUT', headers: JSON_HEADERS, body: '{}' });
    assert.equal(wrongMethod.status, 405);

    const healthPost = await fetch(`${base}${HEALTH_PATH}`, { method: 'POST', headers: JSON_HEADERS, body: '{}' });
    assert.equal(healthPost.status, 405);
  });
});

test('il server funziona con l’archivio su file', async () => {
  const { createFileStore } = await import('../src/store.js');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const dir = mkdtempSync(join(tmpdir(), 'realtor-api-'));
  const file = join(dir, 'cards.json');
  try {
    await withServer({ store: createFileStore({ file }) }, async (base) => {
      await fetch(`${base}${API_PATH}`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(card('Alfa')) });
      const health = await (await fetch(`${base}${HEALTH_PATH}`)).json();
      assert.equal(health.storage, 'file');
      assert.equal(health.cards, 1);
    });
    // nuovo server sullo stesso file: i dati sono ancora lì
    await withServer({ store: createFileStore({ file }) }, async (base) => {
      const list = await (await fetch(`${base}${API_PATH}`)).json();
      assert.equal(list.count, 1);
      assert.equal(list.cards[0].nome, 'Alfa');
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createApiServer richiede uno store', () => {
  assert.throws(() => createApiServer({}), TypeError);
});

test('l’app può inviare le sue schede al server reale (contratto end-to-end)', async () => {
  const { createApiClient } = await import('../../www/js/core/api.js');
  const { createCardStore } = await import('../../www/js/core/storage.js');
  const { createMemoryStorage } = await import('../../tests/helpers/fakes.js');

  await withServer({}, async (base) => {
    const store = createCardStore({ storage: createMemoryStorage() });
    store.save(card('Alfa'));
    store.save(card('Beta'));

    const client = createApiClient({ baseUrl: `${base}${API_PATH}` });
    const result = await client.sendCards(store.list());
    assert.equal(result.status, 201);
    assert.equal(result.body.saved, 2);

    const stored = await (await fetch(`${base}${API_PATH}`)).json();
    assert.equal(stored.count, 2);
  });
});

test('parseArgs: default, opzioni CLI ed errori', async () => {
  const { parseArgs } = await import('../src/server.js');

  const defaults = parseArgs([]);
  assert.equal(defaults.port, 3000);
  assert.equal(defaults.host, '0.0.0.0');
  assert.equal(defaults.memory, false);
  assert.equal(defaults.quiet, false);

  const custom = parseArgs(['--port', '8081', '--host', '127.0.0.1', '--memory', '--token', 'x', '--cors', 'https://a.test', '--quiet']);
  assert.equal(custom.port, 8081);
  assert.equal(custom.host, '127.0.0.1');
  assert.equal(custom.memory, true);
  assert.equal(custom.token, 'x');
  assert.equal(custom.cors, 'https://a.test');
  assert.equal(custom.quiet, true);

  assert.equal(parseArgs(['--help']).help, true);
  assert.throws(() => parseArgs(['--sconosciuto']), /non riconosciuto/);
});
