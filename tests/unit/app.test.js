/**
 * Test della UI (www/js/app.js) con jQuery finta: coprono salvataggio,
 * elenco, invio senza perdita dati, impostazioni, backup e migrazione.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { APP_VERSION, createApp } from '../../www/js/app.js';
import { SETTINGS_KEY } from '../../www/js/core/settings.js';
import { CARD_KEY_PREFIX } from '../../www/js/core/storage.js';
import { createPlatform } from '../../www/js/platform.js';
import { createFakeWindow, createFetchFake, createMemoryStorage } from '../helpers/fakes.js';
import { createJQueryStub } from '../helpers/jquery-stub.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

const IDS = [
  'txtNome',
  'txtIndirizzo',
  'txtDescrizione',
  'txtPrezzo',
  'btnSalva',
  'btnExit',
  'btnInviaSchede',
  'liElencoSchede',
  'statoImpostazioni',
  'txtApiUrl',
  'txtBackup',
  'btnSalvaImpostazioni',
  'btnEsportaBackup',
  'btnImportaBackup',
  'btnImportaSostituisci',
  'btnMigraLegacy',
  'elencoSchede',
  'scheda',
  'impostazioni',
];

const silentLogger = { log() {}, error() {} };

function setup({ storage = createMemoryStorage(), confirmAnswer = true, baseUrl = '', cards = [], win } = {}) {
  const fakeWin = win || createFakeWindow();
  if (win === undefined) fakeWin.confirmAnswer = confirmAnswer;

  if (baseUrl !== '') {
    storage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ version: 1, apiBaseUrl: baseUrl, apiTimeoutMs: 10000, migrateLegacyOnStart: true }),
    );
  }

  const $ = createJQueryStub({ ids: IDS });
  const platform = createPlatform({ win: fakeWin });
  const app = createApp({ $, storage, platform, win: fakeWin, logger: silentLogger });
  for (const card of cards) app.store.save(card);

  return {
    app,
    $,
    storage,
    win: fakeWin,
    element: (id) => $.elements.get(id),
    fillForm: (values) => {
      for (const [id, value] of Object.entries(values)) $.elements.get(id).val(value);
    },
  };
}

/**
 * Costruisce l'app con un `fetch` globale finto: il client API cattura `fetch`
 * alla creazione, quindi il doppio va installato prima di `createApp`.
 */
async function withFakeFetch(fakeFetch, build) {
  const original = globalThis.fetch;
  globalThis.fetch = fakeFetch;
  try {
    return await build();
  } finally {
    globalThis.fetch = original;
  }
}

test('APP_VERSION è allineata a package.json', () => {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  assert.equal(APP_VERSION, pkg.version);
});

test('createApp richiede jQuery e storage', () => {
  assert.throws(() => createApp({}), TypeError);
  assert.throws(() => createApp({ $: () => {} }), TypeError);
});

test('il pulsante di uscita è nascosto dove la chiusura non è consentita', () => {
  const web = setup();
  web.app.bindEvents();
  assert.equal(web.element('btnExit').hidden, true);
  assert.equal(web.app.applyPlatformUi(), 'web');

  const androidWin = createFakeWindow({ cordova: {} });
  androidWin.navigator.app = { exitApp() {} };
  const mobile = setup({ win: androidWin });
  mobile.app.bindEvents();
  assert.equal(mobile.element('btnExit').hidden, false);
  assert.equal(mobile.app.applyPlatformUi(), 'cordova');
});

test('saveCurrent salva la scheda del form', () => {
  const { app, fillForm } = setup();
  fillForm({ txtNome: ' Attico ', txtIndirizzo: 'Via Roma 1', txtDescrizione: 'nota', txtPrezzo: '150.000,50' });

  const saved = app.saveCurrent();
  assert.equal(saved.nome, 'Attico');
  assert.equal(app.store.count(), 1);
  assert.equal(app.store.get('Attico').prezzo, '150.000,50');
});

test('saveCurrent rifiuta una scheda senza nome senza scrivere', () => {
  const { app, fillForm } = setup();
  fillForm({ txtNome: '', txtPrezzo: '100' });
  assert.equal(app.saveCurrent(), null);
  assert.equal(app.store.count(), 0);
});

test('renderList scrive i nomi come testo, non come HTML', () => {
  const { app, element } = setup({ cards: [{ nome: '<b>Alfa</b>' }, { nome: 'Beta' }] });
  app.renderList();

  const list = element('liElencoSchede');
  const links = list.children
    .filter((child) => Array.isArray(child.children) && child.children.some((node) => node.tagName === 'a'))
    .map((child) => child.children.find((node) => node.tagName === 'a').textContent);

  assert.deepEqual(links, ['<b>Alfa</b>', 'Beta']);
  assert.equal(list.listviewRefreshes, 1);
});

test('openCard apre la scheda e pagebeforeshow riempie il form', () => {
  const { app, $, element } = setup({ cards: [{ nome: 'Alfa', indirizzo: 'Via A', prezzo: '10' }] });
  app.bindEvents();

  assert.equal(app.openCard('Alfa'), true);
  element('scheda').trigger('pagebeforeshow');
  assert.equal(element('txtNome').val(), 'Alfa');
  assert.equal(element('txtIndirizzo').val(), 'Via A');
  assert.equal($.mobile.changePage.calls, 1);

  assert.equal(app.openCard('Assente'), false);
  assert.equal(app.store.count(), 1);
});

test('ogni nuova scheda parte da un form vuoto', () => {
  const { app, element } = setup({ cards: [{ nome: 'Alfa', indirizzo: 'Via A' }] });
  app.bindEvents();
  app.openCard('Alfa');
  element('scheda').trigger('pagebeforeshow');
  assert.equal(element('txtNome').val(), 'Alfa');

  // Apertura di "Nuova scheda": nessuna scheda in sospeso -> form azzerato.
  element('scheda').trigger('pagebeforeshow');
  assert.equal(element('txtNome').val(), '');
  assert.equal(element('txtIndirizzo').val(), '');
});

test('removeCard rispetta la conferma', async () => {
  const no = setup({ cards: [{ nome: 'Alfa' }], confirmAnswer: false });
  assert.equal(await no.app.removeCard('Alfa'), false);
  assert.equal(no.app.store.count(), 1);

  const yes = setup({ cards: [{ nome: 'Alfa' }], confirmAnswer: true });
  assert.equal(await yes.app.removeCard('Alfa'), true);
  assert.equal(yes.app.store.count(), 0);
});

test('sendAll senza endpoint configurato non tocca le schede', async () => {
  const { app } = setup({ cards: [{ nome: 'Alfa' }] });
  const result = await app.sendAll();
  assert.equal(result.skipped, 'unconfigured');
  assert.equal(result.removed, 0);
  assert.equal(app.store.count(), 1);
});

test('sendAll senza schede non invia nulla', async () => {
  const { app } = setup();
  const result = await app.sendAll();
  assert.equal(result.skipped, 'empty');
});

test('sendAll conserva le schede se il server risponde con errore', async () => {
  const fetchImpl = createFetchFake(() => ({ status: 500, body: '{"error":"boom"}' }));
  const result = await withFakeFetch(fetchImpl, () => {
    const { app } = setup({ baseUrl: 'https://api.test/scheda', cards: [{ nome: 'Alfa' }] });
    return app.sendAll().then((outcome) => ({ outcome, app }));
  });

  assert.equal(result.outcome.skipped, 'error');
  assert.equal(result.outcome.removed, 0);
  assert.equal(result.app.store.count(), 1, 'le schede sono state perse dopo un errore HTTP');
  assert.equal(result.app.api.isConfigured(), true);
});

test('sendAll rimuove le schede solo dopo una risposta 2xx', async () => {
  const fetchImpl = createFetchFake(() => ({ status: 200, body: '{"ok":true}' }));
  const result = await withFakeFetch(fetchImpl, () => {
    const { app } = setup({ baseUrl: 'https://api.test/scheda', cards: [{ nome: 'Alfa' }, { nome: 'Beta' }] });
    return app.sendAll().then((outcome) => ({ outcome, app }));
  });

  assert.deepEqual(result.outcome, { sent: 2, removed: 2 });
  assert.equal(result.app.store.count(), 0);
  assert.equal(fetchImpl.calls.length, 1);
  assert.deepEqual(
    JSON.parse(fetchImpl.calls[0].options.body).map((card) => card.nome),
    ['Alfa', 'Beta'],
  );
});

test('sendAll annullata dall’utente non invia nulla', async () => {
  const fetchImpl = createFetchFake();
  const result = await withFakeFetch(fetchImpl, () => {
    const { app } = setup({ baseUrl: 'https://api.test/scheda', cards: [{ nome: 'Alfa' }], confirmAnswer: false });
    return app.sendAll().then((outcome) => ({ outcome, app }));
  });

  assert.equal(result.outcome.skipped, 'cancelled');
  assert.equal(fetchImpl.calls.length, 0);
  assert.equal(result.app.store.count(), 1);
});

test('saveSettings salva l’endpoint e riconfigura il client', () => {
  const { app, element } = setup();
  element('txtApiUrl').val('  https://api.test/realtor/api/scheda/  ');

  const saved = app.saveSettings();
  assert.equal(saved.apiBaseUrl, 'https://api.test/realtor/api/scheda');
  assert.equal(app.api.isConfigured(), true);
  assert.equal(app.settings.isOffline(), false);
});

test('saveSettings rifiuta un endpoint non valido', () => {
  const { app, element } = setup();
  element('txtApiUrl').val('senza-schema');
  assert.equal(app.saveSettings(), null);
  assert.equal(app.api.isConfigured(), false);
  assert.equal(app.settings.isOffline(), true);
});

test('fillSettingsForm mostra endpoint e stato', () => {
  const { app, element } = setup({ baseUrl: 'https://api.test/x', cards: [{ nome: 'Alfa' }] });
  const current = app.fillSettingsForm();
  assert.equal(current.apiBaseUrl, 'https://api.test/x');
  assert.equal(element('txtApiUrl').val(), 'https://api.test/x');
  assert.match(element('statoImpostazioni').text(), /1 schede in locale · invio a https:\/\/api\.test\/x/);
});

test('exportBackup riempie il campo di testo con il JSON', () => {
  const { app, element } = setup({ cards: [{ nome: 'Alfa' }] });
  const json = app.exportBackup();
  const payload = JSON.parse(json);
  assert.equal(payload.cards.length, 1);
  assert.equal(payload.app, `realtor/${APP_VERSION}`);
  assert.equal(element('txtBackup').val(), json);
  assert.equal(app.downloadBackup(json), false, 'senza Blob/URL il download non è possibile');
});

test('downloadBackup usa un link temporaneo quando l’ambiente lo consente', () => {
  const win = createFakeWindow();
  const clicks = [];
  win.Blob = class {
    constructor(parts, options) {
      this.parts = parts;
      this.options = options;
    }
  };
  win.URL = { createObjectURL: () => 'blob:finto', revokeObjectURL: () => {} };
  win.document.createElement = (tagName) => ({
    tagName,
    click() {
      clicks.push(this.download);
    },
  });
  win.document.body = { appendChild() {}, removeChild() {} };

  const { app } = setup({ win });
  assert.equal(app.downloadBackup('{"cards":[]}', new Date('2026-10-16T00:00:00.000Z')), true);
  assert.deepEqual(clicks, ['realtor-backup-2026-10-16.json']);
});

test('importBackup: aggiunge, sostituisce e rifiuta dati non validi', async () => {
  const { app, element } = setup({ cards: [{ nome: 'Alfa' }] });

  element('txtBackup').val('[{"nome":"Beta"}]');
  const merged = await app.importBackup();
  assert.equal(merged.imported, 1);
  assert.deepEqual(app.store.keys(), ['Alfa', 'Beta']);

  element('txtBackup').val(JSON.stringify({ cards: [{ nome: 'Gamma' }] }));
  const replaced = await app.importBackup({ mode: 'replace' });
  assert.equal(replaced.imported, 1);
  assert.deepEqual(app.store.keys(), ['Gamma']);

  element('txtBackup').val('{non-json');
  assert.equal(await app.importBackup(), null);
  assert.deepEqual(app.store.keys(), ['Gamma']);
});

test('importBackup avvisa quando il campo è vuoto', async () => {
  const { app, element } = setup({ cards: [{ nome: 'Alfa' }] });
  element('txtBackup').val('   ');
  assert.equal(await app.importBackup(), null);
  assert.equal(app.store.count(), 1);
});

test('migrateNow importa le schede della 0.0.1', () => {
  const storage = createMemoryStorage({
    Vecchia: JSON.stringify({ nome: 'Vecchia', indirizzo: 'Via V 1', prezzo: '10' }),
  });
  const { app } = setup({ storage });

  const report = app.migrateNow();
  assert.equal(report.migrated, 1);
  assert.equal(app.store.get('Vecchia').indirizzo, 'Via V 1');
  assert.equal(storage.getItem('Vecchia'), null);
  assert.notEqual(storage.getItem(`${CARD_KEY_PREFIX}Vecchia`), null);
});

test('runStartupMigration rispetta l’impostazione', () => {
  const storage = createMemoryStorage({ Vecchia: JSON.stringify({ nome: 'Vecchia' }) });
  storage.setItem(
    SETTINGS_KEY,
    JSON.stringify({ version: 1, apiBaseUrl: '', apiTimeoutMs: 10000, migrateLegacyOnStart: false }),
  );
  const { app } = setup({ storage });
  assert.equal(app.runStartupMigration(), null);
  assert.notEqual(storage.getItem('Vecchia'), null);
});

test('updateOnlineState disabilita il pulsante di invio offline', () => {
  const offline = setup({ win: createFakeWindow({ onLine: false }) });
  assert.equal(offline.app.updateOnlineState(), false);
  assert.equal(offline.element('btnInviaSchede').hasClass('ui-disabled'), true);
  assert.equal(offline.element('btnInviaSchede').attr('aria-disabled'), 'true');

  const online = setup({ win: createFakeWindow({ onLine: true }) });
  assert.equal(online.app.updateOnlineState(), true);
  assert.equal(online.element('btnInviaSchede').hasClass('ui-disabled'), false);
});

test('bindEvents collega i comandi della pagina impostazioni', async () => {
  const { app, element } = setup({ cards: [{ nome: 'Alfa' }] });
  app.bindEvents();

  element('impostazioni').trigger('pagebeforeshow');
  assert.equal(element('txtApiUrl').val(), '');
  assert.match(element('statoImpostazioni').text(), /1 schede in locale · solo offline/);

  element('btnEsportaBackup').trigger('tap');
  assert.match(element('txtBackup').val(), /"format": "realtor\.backup"/);
  assert.match(element('statoImpostazioni').text(), /Backup di 1 schede pronto/);

  element('btnMigraLegacy').trigger('tap');

  // Invio senza endpoint: nessuna scheda rimossa.
  await element('btnInviaSchede').triggerAsync('tap');
  assert.equal(app.store.count(), 1);
});

test('backupFileName usa la data ISO', () => {
  const { app } = setup();
  assert.equal(app.backupFileName(new Date('2026-01-02T03:04:05.000Z')), 'realtor-backup-2026-01-02.json');
});
