/**
 * Test unitari del backup (esportazione e importazione con dati protetti).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BACKUP_FORMAT, BACKUP_VERSION, createBackup } from '../../www/js/core/backup.js';
import { CARD_KEY_PREFIX, createCardStore } from '../../www/js/core/storage.js';
import { createMemoryStorage } from '../helpers/fakes.js';

function setup({ cards = [], appVersion = '1.0.0', now } = {}) {
  const storage = createMemoryStorage();
  const store = createCardStore({ storage });
  for (const card of cards) store.save(card);
  return { storage, store, backup: createBackup({ store, appVersion, now }) };
}

test('build include formato, versione, app, data e schede', () => {
  const { backup } = setup({
    cards: [{ nome: 'Alfa', prezzo: '100' }],
    appVersion: '1.2.3',
    now: () => new Date('2026-10-16T08:00:00.000Z'),
  });
  const payload = backup.build();
  assert.equal(payload.format, BACKUP_FORMAT);
  assert.equal(payload.version, BACKUP_VERSION);
  assert.equal(payload.app, 'realtor/1.2.3');
  assert.equal(payload.exportedAt, '2026-10-16T08:00:00.000Z');
  assert.equal(payload.count, 1);
  assert.equal(payload.cards[0].nome, 'Alfa');
});

test('toJson produce JSON reimportabile (round-trip)', () => {
  const { store, backup } = setup({ cards: [{ nome: 'Alfa', indirizzo: 'Via A', prezzo: '1.500,50' }] });
  const json = backup.toJson();
  const parsed = backup.parse(json);
  assert.equal(parsed.valid, true);
  assert.deepEqual(parsed.cards, store.exportAll());
  // round-trip su storage pulito
  const target = createCardStore({ storage: createMemoryStorage() });
  const targetBackup = createBackup({ store: target });
  const result = targetBackup.importJson(json);
  assert.equal(result.imported, 1);
  assert.deepEqual(target.exportAll(), store.exportAll());
});

test('parse accetta backup Realtor, array di schede e scheda singola', () => {
  const { backup } = setup();
  assert.equal(backup.parse('{"cards":[{"nome":"A"}]}').valid, true);
  assert.equal(backup.parse('[{"nome":"A"}]').valid, true);
  assert.equal(backup.parse('{"nome":"A"}').valid, true);
});

test('parse rifiuta testo vuoto, JSON rotto, array vuoto e formati ignoti', () => {
  const { backup } = setup();
  for (const input of ['', '   ', '{non-json', '[]', '{"cards":[]}', '42', 'null']) {
    const parsed = backup.parse(input);
    assert.equal(parsed.valid, false, `accettato per errore: ${input}`);
    assert.ok(parsed.errors.length > 0, `nessun messaggio di errore per: ${input}`);
  }
});

test('importJson: merge aggiunge senza perdere le schede esistenti', () => {
  const { store, backup } = setup({ cards: [{ nome: 'Alfa' }] });
  const result = backup.importJson('[{"nome":"Beta"},{"nome":"Gamma"}]');
  assert.equal(result.imported, 2);
  assert.deepEqual(store.keys(), ['Alfa', 'Beta', 'Gamma']);
});

test('importJson: replace sostituisce tutto solo dopo la validazione', () => {
  const { store, backup } = setup({ cards: [{ nome: 'Alfa' }] });
  const result = backup.importJson('[{"nome":"Nuova"}]', { mode: 'replace' });
  assert.equal(result.imported, 1);
  assert.deepEqual(store.keys(), ['Nuova']);
});

test('importJson: un backup non valido non tocca i dati esistenti', () => {
  const { storage, store, backup } = setup({ cards: [{ nome: 'Alfa' }] });
  const before = { ...storage.dump() };

  const broken = backup.importJson('{non-json', { mode: 'replace' });
  assert.equal(broken.imported, 0);
  assert.deepEqual(store.keys(), ['Alfa']);

  const invalidCards = backup.importJson('[{"nome":""},{"prezzo":"abc"}]', { mode: 'replace' });
  assert.equal(invalidCards.imported, 0);
  assert.equal(invalidCards.invalid, 2);
  assert.deepEqual(storage.dump(), before, 'lo storage è cambiato con un backup non valido');
});

test('importJson: schede parzialmente valide vengono importate e le altre segnalate', () => {
  const { store, backup } = setup();
  const result = backup.importJson('[{"nome":"Buona"},{"nome":"","prezzo":"abc"}]');
  assert.equal(result.imported, 1);
  assert.equal(result.invalid, 1);
  assert.equal(store.keys()[0], 'Buona');
  assert.equal(result.errors.length, 1);
});

test('createBackup richiede un repository valido', () => {
  assert.throws(() => createBackup({}), TypeError);
  assert.throws(() => createBackup(), TypeError);
});
