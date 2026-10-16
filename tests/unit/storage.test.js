/**
 * Test unitari del repository delle schede.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CARD_KEY_PREFIX, createCardStore } from '../../www/js/core/storage.js';
import { CARD_VERSION } from '../../www/js/core/schema.js';
import { createMemoryStorage } from '../helpers/fakes.js';

function setup(initial) {
  const storage = createMemoryStorage(initial);
  return { storage, store: createCardStore({ storage }) };
}

test('createCardStore richiede uno storage valido', () => {
  assert.throws(() => createCardStore({}), TypeError);
  assert.throws(() => createCardStore(), TypeError);
});

test('save/get/list: ciclo completo con prefisso dedicato', () => {
  const { storage, store } = setup();
  store.save({ nome: 'Alfa', indirizzo: 'Via A 1', descrizione: 'nota', prezzo: '150.000,50' });

  assert.equal(storage.getItem(`${CARD_KEY_PREFIX}Alfa`) !== null, true);
  assert.equal(store.has('Alfa'), true);
  assert.deepEqual(store.get('Alfa'), {
    version: CARD_VERSION,
    nome: 'Alfa',
    indirizzo: 'Via A 1',
    descrizione: 'nota',
    prezzo: '150.000,50',
  });
  assert.equal(store.count(), 1);
  assert.deepEqual(store.keys(), ['Alfa']);
  assert.equal(store.list().length, 1);
});

test('save normalizza i dati e usa il nome come chiave', () => {
  const { storage, store } = setup();
  const saved = store.save({ nome: '  Beta  ', indirizzo: ' Via  B ', prezzo: ' € 1.000 ' });
  assert.equal(saved.nome, 'Beta');
  assert.equal(saved.indirizzo, 'Via B');
  assert.equal(saved.prezzo, '1.000');
  assert.notEqual(storage.getItem(`${CARD_KEY_PREFIX}Beta`), null);
});

test('save rifiuta le schede non valide con ValidationError e dettaglio errori', () => {
  const { store } = setup();
  assert.throws(
    () => store.save({ nome: '', prezzo: 'abc' }),
    (error) => {
      assert.equal(error.name, 'ValidationError');
      assert.equal(error.errors.length, 2);
      assert.deepEqual(
        error.errors.map((item) => item.field),
        ['nome', 'prezzo'],
      );
      return true;
    },
  );
  assert.equal(store.count(), 0);
});

test('keys() è ordinato e non risente delle rimozioni durante l’iterazione', () => {
  const { store } = setup();
  store.save({ nome: 'Alfa' });
  store.save({ nome: 'Beta' });
  store.save({ nome: 'Gamma' });
  assert.deepEqual(store.keys(), ['Alfa', 'Beta', 'Gamma']);

  assert.equal(store.remove('Beta'), true);
  assert.deepEqual(store.keys(), ['Alfa', 'Gamma']);
  assert.equal(store.count(), 2);
  assert.equal(store.remove('Beta'), false);
});

test('get restituisce null per chiavi assenti o dati corrotti (senza cancellarli)', () => {
  const { storage, store } = setup({
    [`${CARD_KEY_PREFIX}Rotta`]: '{non-json',
    [`${CARD_KEY_PREFIX}Strana`]: '"solo-una-stringa"',
  });
  assert.equal(store.get('Assente'), null);
  assert.equal(store.get('Rotta'), null);
  assert.equal(store.get('Strana'), null);
  assert.equal(store.get(''), null);
  // i dati corrotti non vengono distrutti da una lettura
  assert.equal(storage.getItem(`${CARD_KEY_PREFIX}Rotta`), '{non-json');
});

test('get recupera il nome dalla chiave per i dati legacy senza campo nome', () => {
  const { store } = setup({
    [`${CARD_KEY_PREFIX}Legacy`]: JSON.stringify({ indirizzo: 'Via Vecchia 1', prezzo: '100' }),
  });
  assert.deepEqual(store.get('Legacy'), {
    version: CARD_VERSION,
    nome: 'Legacy',
    indirizzo: 'Via Vecchia 1',
    descrizione: '',
    prezzo: '100',
  });
});

test('clear rimuove solo le chiavi con il prefisso del repository', () => {
  const { storage, store } = setup({
    'altra.app': 'da-non-toccare',
    [`${CARD_KEY_PREFIX}Alfa`]: JSON.stringify({ nome: 'Alfa' }),
    [`${CARD_KEY_PREFIX}Beta`]: JSON.stringify({ nome: 'Beta' }),
  });
  assert.equal(store.clear(), 2);
  assert.equal(store.count(), 0);
  assert.equal(storage.getItem('altra.app'), 'da-non-toccare');
  assert.equal(storage.length, 1);
});

test('exportAll restituisce copie delle schede', () => {
  const { store } = setup();
  store.save({ nome: 'Alfa', prezzo: '100' });
  const exported = store.exportAll();
  assert.equal(exported.length, 1);
  exported[0].nome = 'Modificato';
  assert.equal(store.get('Alfa').nome, 'Alfa');
});

test('prefisso personalizzato isolato da quello predefinito', () => {
  const storage = createMemoryStorage({
    [`${CARD_KEY_PREFIX}Alfa`]: JSON.stringify({ nome: 'Alfa' }),
  });
  const custom = createCardStore({ storage, keyPrefix: 'test.' });
  assert.equal(custom.count(), 0);
  custom.save({ nome: 'Beta' });
  assert.equal(custom.count(), 1);
  assert.equal(createCardStore({ storage }).count(), 1);
});
