/**
 * Test unitari della migrazione dei dati 0.0.1.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findLegacyEntries, migrateLegacy, parseLegacyCard } from '../../www/js/core/migration.js';
import { SETTINGS_KEY } from '../../www/js/core/settings.js';
import { CARD_KEY_PREFIX, createCardStore } from '../../www/js/core/storage.js';
import { createMemoryStorage } from '../helpers/fakes.js';

const legacyCard = JSON.stringify({ nome: 'Alfa', indirizzo: 'Via A 1', descrizione: 'nota', prezzo: '150.000,50' });

test('parseLegacyCard riconosce le schede della 0.0.1', () => {
  const card = parseLegacyCard('Alfa', legacyCard);
  assert.equal(card.nome, 'Alfa');
  assert.equal(card.indirizzo, 'Via A 1');
  assert.equal(card.version, 1);
});

test('parseLegacyCard usa la chiave come nome quando manca il campo', () => {
  const card = parseLegacyCard('Villa Roma', JSON.stringify({ indirizzo: 'Via B', descrizione: '', prezzo: '10' }));
  assert.equal(card.nome, 'Villa Roma');
});

test('parseLegacyCard rifiuta valori non scheda', () => {
  const cases = [
    ['chiave', ''],
    ['chiave', '{non-json'],
    ['chiave', '"stringa"'],
    ['chiave', '42'],
    ['chiave', '[1,2,3]'],
    ['chiave', 'null'],
    ['chiave', JSON.stringify({ altro: 'valore' })],
    ['chiave', JSON.stringify({ nome: '', prezzo: 'abc' })],
  ];
  for (const [key, value] of cases) {
    assert.equal(parseLegacyCard(key, value), null, `accettato per errore: ${value}`);
  }
});

test('parseLegacyCard accetta JSON annidato come stringa (doppio stringify)', () => {
  const card = parseLegacyCard('Alfa', JSON.stringify(legacyCard));
  assert.equal(card.nome, 'Alfa');
});

test('findLegacyEntries ignora le chiavi già migrate e quelle riservate', () => {
  const storage = createMemoryStorage({
    Alfa: legacyCard,
    [`${CARD_KEY_PREFIX}Beta`]: JSON.stringify({ nome: 'Beta' }),
    [SETTINGS_KEY]: JSON.stringify({ apiBaseUrl: '' }),
    'chiave-estranea': 'valore',
  });
  const found = findLegacyEntries({ storage });
  assert.deepEqual(
    found.map((entry) => entry.key),
    ['Alfa'],
  );
});

test('migrateLegacy sposta le schede sotto il prefisso e rimuove le vecchie voci', () => {
  const storage = createMemoryStorage({ Alfa: legacyCard });
  const report = migrateLegacy({ storage });

  assert.deepEqual(report, { migrated: 1, renamed: 0, removed: 1, skipped: 0, errors: [] });
  assert.equal(storage.getItem('Alfa'), null);
  const store = createCardStore({ storage });
  assert.deepEqual(store.keys(), ['Alfa']);
  assert.equal(store.get('Alfa').prezzo, '150.000,50');
});

test('migrateLegacy rinomina in caso di nome già occupato, senza sovrascrivere', () => {
  const storage = createMemoryStorage({
    Alfa: legacyCard,
    [`${CARD_KEY_PREFIX}Alfa`]: JSON.stringify({ nome: 'Alfa', indirizzo: 'Via Nuova 9', prezzo: '999' }),
  });
  const report = migrateLegacy({ storage });

  assert.equal(report.migrated, 1);
  assert.equal(report.renamed, 1);
  const store = createCardStore({ storage });
  assert.deepEqual(store.keys(), ['Alfa', 'Alfa (2)']);
  assert.equal(store.get('Alfa').indirizzo, 'Via Nuova 9');
  assert.equal(store.get('Alfa (2)').indirizzo, 'Via A 1');
  assert.equal(storage.getItem('Alfa'), null);
});

test('migrateLegacy non tocca chiavi riservate o non-schede', () => {
  const storage = createMemoryStorage({
    [SETTINGS_KEY]: JSON.stringify({ apiBaseUrl: 'https://api.test/x' }),
    'chiave-estranea': 'valore',
    'json-estraneo': JSON.stringify({ foo: 'bar' }),
  });
  const report = migrateLegacy({ storage });
  assert.equal(report.migrated, 0);
  assert.equal(storage.length, 3);
  assert.equal(storage.getItem('chiave-estranea'), 'valore');
});

test('migrateLegacy è idempotente', () => {
  const storage = createMemoryStorage({ Alfa: legacyCard, Beta: legacyCard.replace('Alfa', 'Beta') });
  const first = migrateLegacy({ storage });
  const second = migrateLegacy({ storage });
  assert.equal(first.migrated, 2);
  assert.equal(second.migrated, 0);
  assert.equal(createCardStore({ storage }).count(), 2);
});

test('migrateLegacy segnala gli errori di scrittura senza perdere la voce legacy', () => {
  const storage = createMemoryStorage({ Alfa: legacyCard });
  const originalSet = storage.setItem.bind(storage);
  let failNext = true;
  storage.setItem = (key, value) => {
    if (failNext && key.startsWith(CARD_KEY_PREFIX)) {
      failNext = false;
      throw new Error('quota superata');
    }
    originalSet(key, value);
  };

  const report = migrateLegacy({ storage });
  assert.equal(report.migrated, 0);
  assert.equal(report.skipped, 1);
  assert.match(report.errors[0], /quota superata/);
  assert.equal(storage.getItem('Alfa'), legacyCard, 'la voce legacy è stata persa');
});
