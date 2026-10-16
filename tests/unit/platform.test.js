/**
 * Test unitari dell'adapter di piattaforma (Cordova + fallback web).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPlatform } from '../../www/js/platform.js';
import { createFakeWindow } from '../helpers/fakes.js';

/** Notifica Cordova finta che registra le chiamate. */
function createFakeNotification({ mode = 'alert', confirmIndex = 1 } = {}) {
  const calls = [];
  return {
    calls,
    alert(message, callback, title) {
      calls.push({ kind: 'alert', message, title });
      if (typeof callback === 'function') callback();
    },
    confirm(message, callback, title, buttons) {
      calls.push({ kind: 'confirm', message, title, buttons });
      if (mode === 'confirm') callback(confirmIndex);
    },
  };
}

test('isCordova riflette la presenza dell’oggetto cordova', () => {
  assert.equal(createPlatform({ win: createFakeWindow() }).isCordova(), false);
  assert.equal(createPlatform({ win: createFakeWindow({ cordova: {} }) }).isCordova(), true);
});

test('alert usa notification di Cordova quando disponibile', async () => {
  const notification = createFakeNotification();
  const win = createFakeWindow({ notification });
  await createPlatform({ win }).alert('Ciao', 'Titolo');

  assert.equal(notification.calls.length, 1);
  assert.deepEqual(notification.calls[0], { kind: 'alert', message: 'Ciao', title: 'Titolo' });
  assert.equal(win.alerts.length, 0);
});

test('alert usa window.alert come fallback web', async () => {
  const win = createFakeWindow();
  await createPlatform({ win }).alert('Ciao', 'Titolo');
  assert.deepEqual(win.alerts, ['Titolo\n\nCiao']);
});

test('confirm: primo pulsante = true, secondo = false', async () => {
  const yes = createFakeNotification({ mode: 'confirm', confirmIndex: 1 });
  assert.equal(await createPlatform({ win: createFakeWindow({ notification: yes }) }).confirm('Procedo?'), true);
  assert.equal(yes.calls[0].buttons, 'Si,No');

  const no = createFakeNotification({ mode: 'confirm', confirmIndex: 2 });
  assert.equal(await createPlatform({ win: createFakeWindow({ notification: no }) }).confirm('Procedo?'), false);
});

test('confirm usa window.confirm come fallback web', async () => {
  const win = createFakeWindow();
  win.confirmAnswer = true;
  assert.equal(await createPlatform({ win }).confirm('Procedo?', { title: 'Titolo' }), true);
  assert.deepEqual(win.confirms, ['Titolo\n\nProcedo?']);

  win.confirmAnswer = false;
  assert.equal(await createPlatform({ win }).confirm('Procedo?'), false);
});

test('confirm non esplode se notification.confirm fallisce', async () => {
  const notification = {
    confirm() {
      throw new Error('plugin non disponibile');
    },
  };
  const win = createFakeWindow({ notification });
  win.confirmAnswer = true;
  assert.equal(await createPlatform({ win }).confirm('Procedo?'), true);
});

test('isOnline usa navigator.onLine quando i plugin non ci sono', () => {
  assert.equal(createPlatform({ win: createFakeWindow({ onLine: false }) }).isOnline(), false);
  assert.equal(createPlatform({ win: createFakeWindow({ onLine: true }) }).isOnline(), true);
});

test('isOnline usa navigator.connection quando disponibile', () => {
  const Connection = { NONE: 'none', WIFI: 'wifi' };
  assert.equal(
    createPlatform({ win: createFakeWindow({ connection: 'none', Connection }) }).isOnline(),
    false,
  );
  assert.equal(
    createPlatform({ win: createFakeWindow({ connection: 'wifi', Connection }) }).isOnline(),
    true,
  );
});

test('isOnline è ottimista se non ci sono informazioni', () => {
  assert.equal(createPlatform({ win: createFakeWindow() }).isOnline(), true);
});

test('exit usa navigator.app.exitApp, con fallback su window.close', () => {
  const appWin = createFakeWindow();
  appWin.navigator.app = { exitApp() { appWin.navigator.app.called = true; } };
  assert.equal(createPlatform({ win: appWin }).exit(), true);
  assert.equal(appWin.navigator.app.called, true);
  assert.equal(appWin.closed, false);

  const webWin = createFakeWindow();
  assert.equal(createPlatform({ win: webWin }).exit(), true);
  assert.equal(webWin.closed, true);
});

test('on registra i listener su document', () => {
  const win = createFakeWindow();
  const handler = () => {};
  assert.equal(createPlatform({ win }).on('deviceready', handler), undefined);
  assert.equal(win.listeners.get('deviceready'), handler);
});

test('on non esplode senza document', () => {
  const win = createFakeWindow();
  delete win.document;
  assert.doesNotThrow(() => createPlatform({ win }).on('online', () => {}));
});
