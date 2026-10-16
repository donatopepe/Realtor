/**
 * Test del server statico di sviluppo (cross-platform, zero dipendenze).
 */

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { MIME_TYPES, CORDOVA_SHIM, createStaticServer, mimeFor, localAddresses } from '../../scripts/serve.js';

test('mimeFor riconosce i tipi usati dal progetto', () => {
  assert.equal(mimeFor('index.html'), MIME_TYPES['.html']);
  assert.equal(mimeFor('js/app.js'), MIME_TYPES['.js']);
  assert.equal(mimeFor('app.mjs'), MIME_TYPES['.mjs']);
  assert.equal(mimeFor('manifest.webmanifest'), 'application/manifest+json; charset=utf-8');
  assert.equal(mimeFor('img/icon-192.PNG'), 'image/png');
  assert.equal(mimeFor('senza-estensione'), 'application/octet-stream');
  assert.equal(mimeFor('archivio.zip'), 'application/octet-stream');
});

test('lo shim di cordova.js non definisce window.cordova', () => {
  assert.match(CORDOVA_SHIM, /shim di cordova\.js/);
  assert.doesNotMatch(CORDOVA_SHIM, /window\.cordova\s*=/);
});

test('localAddresses restituisce solo indirizzi IPv4 non interni', () => {
  for (const address of localAddresses()) {
    assert.match(address, /^\d{1,3}(\.\d{1,3}){3}$/);
    assert.notEqual(address, '127.0.0.1');
  }
});

test('il server serve www/ con i MIME e i fallback attesi', async (t) => {
  const server = createStaticServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  t.after(() => {
    server.closeAllConnections?.();
    return new Promise((resolve) => server.close(resolve));
  });

  await t.test('index.html con content-type html', async () => {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(await response.text(), /<title>Realtor<\/title>/);
  });

  await t.test('manifest PWA con content-type dedicato', async () => {
    const response = await fetch(`${base}/manifest.webmanifest`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/manifest+json; charset=utf-8');
    const manifest = await response.json();
    assert.equal(manifest.short_name, 'Realtor');
  });

  await t.test('shim di cordova.js servito come javascript', async () => {
    const response = await fetch(`${base}/cordova.js`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/javascript/);
    assert.match(await response.text(), /shim di cordova\.js/);
  });

  await t.test('le icone sono servite come PNG', async () => {
    const response = await fetch(`${base}/img/icon-192.png`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
  });

  await t.test('route sconosciuta con Accept html: fallback su index.html', async () => {
    const response = await fetch(`${base}/una/route`, { headers: { Accept: 'text/html' } });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /<title>Realtor<\/title>/);
  });

  await t.test('risorsa inesistente non html: 404', async () => {
    const response = await fetch(`${base}/dati.json`);
    assert.equal(response.status, 404);
  });

  await t.test('path traversal bloccato', async () => {
    const response = await fetch(`${base}/%2e%2e%2fpackage.json`);
    assert.equal(response.status, 403);
    assert.doesNotMatch(await response.text(), /"name": "realtor"/);
  });

  await t.test('metodi diversi da GET/HEAD rifiutati', async () => {
    const response = await fetch(`${base}/`, { method: 'POST' });
    assert.equal(response.status, 405);
  });

  await t.test('HEAD senza corpo', async () => {
    const response = await fetch(`${base}/`, { method: 'HEAD' });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '');
  });

  await t.test('nessuna cache per default', async () => {
    const response = await fetch(`${base}/`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
});

test('con cache attiva il server risponde con max-age', async () => {
  const server = createStaticServer({ cache: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(response.headers.get('cache-control'), 'public, max-age=3600');
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('spaFallback disattivabile', async () => {
  const server = createStaticServer({ spaFallback: false });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/una/route`, { headers: { Accept: 'text/html' } });
    assert.equal(response.status, 404);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});
