/**
 * Test unitari del client API.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ApiError, createApiClient, DEFAULT_TIMEOUT_MS } from '../../www/js/core/api.js';
import { createFetchFake, createNeverResolvingFetch } from '../helpers/fakes.js';

const URL_OK = 'https://api.example.test/realtor/api/scheda';

test('endpoint non configurato: nessun invio e schede conservate', async () => {
  const fetchImpl = createFetchFake();
  const api = createApiClient({ fetchImpl });

  assert.equal(api.isConfigured(), false);
  assert.equal(api.endpoint(), '');
  await assert.rejects(api.sendCards([{ nome: 'Alfa' }]), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 0);
    assert.equal(error.responded, false);
    return true;
  });
  assert.equal(fetchImpl.calls.length, 0);
});

test('sendCards invia JSON con header corretti', async () => {
  const fetchImpl = createFetchFake(() => ({ status: 201, body: '{"saved":2}' }));
  const api = createApiClient({ baseUrl: ` ${URL_OK} `, fetchImpl });

  const cards = [
    { nome: 'Alfa', prezzo: '100' },
    { nome: 'Beta', prezzo: '200' },
  ];
  const result = await api.sendCards(cards);

  assert.equal(api.endpoint(), URL_OK);
  assert.equal(fetchImpl.calls.length, 1);
  const { url, options } = fetchImpl.calls[0];
  assert.equal(url, URL_OK);
  assert.equal(options.method, 'POST');
  assert.equal(options.headers['Content-Type'], 'application/json');
  assert.equal(options.headers.Accept, 'application/json');
  assert.deepEqual(JSON.parse(options.body), cards);
  assert.deepEqual(result, { status: 201, body: { saved: 2 }, count: 2 });
});

test('una singola scheda viene inviata come array di un elemento', async () => {
  const fetchImpl = createFetchFake();
  const api = createApiClient({ baseUrl: URL_OK, fetchImpl });
  await api.sendCards({ nome: 'Alfa' });
  assert.deepEqual(JSON.parse(fetchImpl.calls[0].options.body), [{ nome: 'Alfa' }]);
});

test('risposta non 2xx: ApiError con status, cosi i dati restano in locale', async () => {
  const fetchImpl = createFetchFake(() => ({ status: 500, body: '{"error":"boom"}' }));
  const api = createApiClient({ baseUrl: URL_OK, fetchImpl });

  await assert.rejects(api.sendCards([{ nome: 'Alfa' }]), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 500);
    assert.equal(error.responded, true);
    assert.deepEqual(error.body, { error: 'boom' });
    assert.match(error.message, /HTTP 500/);
    return true;
  });
});

test('errore di rete: ApiError senza status', async () => {
  const fetchImpl = createFetchFake(() => {
    throw new Error('ECONNREFUSED');
  });
  const api = createApiClient({ baseUrl: URL_OK, fetchImpl });

  await assert.rejects(api.sendCards([{ nome: 'Alfa' }]), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 0);
    assert.match(error.message, /Errore di rete/);
    return true;
  });
});

test('timeout: la richiesta viene interrotta e diventa ApiError', async () => {
  const fetchImpl = createNeverResolvingFetch();
  const api = createApiClient({ baseUrl: URL_OK, fetchImpl, timeoutMs: 20 });

  await assert.rejects(api.sendCards([{ nome: 'Alfa' }]), (error) => {
    assert.ok(error instanceof ApiError);
    assert.match(error.message, /Timeout/);
    return true;
  });
});

test('setBaseUrl aggiorna endpoint e stato di configurazione', () => {
  const api = createApiClient({ fetchImpl: createFetchFake() });
  assert.equal(DEFAULT_TIMEOUT_MS > 0, true);
  assert.equal(api.isConfigured(), false);
  api.setBaseUrl('https://altro.example.test/api');
  assert.equal(api.isConfigured(), true);
  assert.equal(api.endpoint(), 'https://altro.example.test/api');
  api.setBaseUrl('   ');
  assert.equal(api.isConfigured(), false);
});
