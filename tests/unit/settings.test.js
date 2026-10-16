/**
 * Test unitari delle impostazioni (endpoint API, modalità offline).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  createSettingsStore,
  normalizeBaseUrl,
  normalizeSettings,
  validateSettings,
} from '../../www/js/core/settings.js';
import { createMemoryStorage } from '../helpers/fakes.js';

test('default: nessun endpoint e modalità offline', () => {
  const store = createSettingsStore({ storage: createMemoryStorage() });
  assert.deepEqual(store.get(), { ...DEFAULT_SETTINGS });
  assert.equal(store.get().apiBaseUrl, '');
  assert.equal(store.isOffline(), true);
});

test('normalizeBaseUrl rimuove spazi e slash finali', () => {
  assert.equal(normalizeBaseUrl('  https://api.test/realtor/  '), 'https://api.test/realtor');
  assert.equal(normalizeBaseUrl(''), '');
  assert.equal(normalizeBaseUrl(null), '');
  assert.equal(normalizeBaseUrl(42), '');
});

test('validateSettings accetta solo URL completi', () => {
  assert.equal(validateSettings({ apiBaseUrl: '' }).valid, true);
  assert.equal(validateSettings({ apiBaseUrl: 'https://api.test/realtor/api/scheda' }).valid, true);
  assert.equal(validateSettings({ apiBaseUrl: 'http://localhost:3000/realtor/api/scheda' }).valid, true);

  const invalid = validateSettings({ apiBaseUrl: 'api.test/scheda' });
  assert.equal(invalid.valid, false);
  assert.equal(invalid.errors[0].field, 'apiBaseUrl');
  assert.equal(invalid.errors[0].code, 'invalid_url');

  const timeout = validateSettings({ apiBaseUrl: '', apiTimeoutMs: -5 });
  assert.equal(timeout.valid, false);
  assert.equal(timeout.errors[0].field, 'apiTimeoutMs');
});

test('save persiste e fa merge dei valori parziali', () => {
  const storage = createMemoryStorage();
  const store = createSettingsStore({ storage });

  store.save({ apiBaseUrl: 'https://api.test/realtor/api/scheda/' });
  assert.equal(store.isOffline(), false);
  assert.equal(store.get().apiBaseUrl, 'https://api.test/realtor/api/scheda');
  assert.equal(store.get().migrateLegacyOnStart, true);

  store.save({ migrateLegacyOnStart: false });
  assert.equal(store.get().migrateLegacyOnStart, false);
  assert.equal(store.get().apiBaseUrl, 'https://api.test/realtor/api/scheda');
  assert.notEqual(storage.getItem(SETTINGS_KEY), null);
});

test('save rifiuta URL non validi senza scrivere', () => {
  const storage = createMemoryStorage();
  const store = createSettingsStore({ storage });
  assert.throws(
    () => store.save({ apiBaseUrl: 'non-un-url' }),
    (error) => {
      assert.equal(error.name, 'ValidationError');
      assert.equal(error.errors[0].code, 'invalid_url');
      return true;
    },
  );
  assert.equal(storage.getItem(SETTINGS_KEY), null);
});

test('reset riporta ai valori predefiniti', () => {
  const storage = createMemoryStorage();
  const store = createSettingsStore({ storage });
  store.save({ apiBaseUrl: 'https://api.test/x' });
  assert.deepEqual(store.reset(), { ...DEFAULT_SETTINGS });
  assert.equal(store.isOffline(), true);
});

test('dati corrotti o di tipo sbagliato ricadono sui default', () => {
  for (const raw of ['{non-json', '"stringa"', '[1,2,3]', 'null']) {
    const store = createSettingsStore({ storage: createMemoryStorage({ [SETTINGS_KEY]: raw }) });
    assert.deepEqual(store.get(), { ...DEFAULT_SETTINGS }, `non gestito: ${raw}`);
  }
});

test('normalizeSettings corregge i tipi', () => {
  assert.deepEqual(normalizeSettings({ apiBaseUrl: 5, apiTimeoutMs: 'abc', migrateLegacyOnStart: 'no' }), {
    version: 1,
    apiBaseUrl: '',
    apiTimeoutMs: DEFAULT_SETTINGS.apiTimeoutMs,
    migrateLegacyOnStart: true,
  });
  assert.equal(normalizeSettings({ migrateLegacyOnStart: false }).migrateLegacyOnStart, false);
  assert.equal(normalizeSettings({}).migrateLegacyOnStart, true);
});

test('le impostazioni non interferiscono con le schede', () => {
  const storage = createMemoryStorage();
  const store = createSettingsStore({ storage });
  store.save({ apiBaseUrl: 'https://api.test/x' });
  assert.equal(storage.length, 1);
  assert.equal(storage.key(0), SETTINGS_KEY);
  assert.equal(storage.key(0).startsWith('realtor.scheda.'), false);
});
