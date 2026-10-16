/**
 * Test unitari dello schema scheda.
 * Esecuzione: npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CARD_FIELDS,
  CARD_VERSION,
  createCard,
  formatPrice,
  normalizeCard,
  normalizeField,
  normalizePrice,
  priceToNumber,
  validateCard,
} from '../../www/js/core/schema.js';

test('CARD_FIELDS è immutabile e contiene i campi della scheda', () => {
  assert.deepEqual([...CARD_FIELDS], ['nome', 'indirizzo', 'descrizione', 'prezzo']);
  assert.throws(() => {
    CARD_FIELDS.push('altro');
  }, TypeError);
});

test('createCard restituisce una scheda vuota con versione corrente', () => {
  assert.deepEqual(createCard(), {
    version: CARD_VERSION,
    nome: '',
    indirizzo: '',
    descrizione: '',
    prezzo: '',
  });
});

test('normalizeField fa trim, compatta gli spazi e ignora i valori non testuali', () => {
  assert.equal(normalizeField('  Villa   Roma  '), 'Villa Roma');
  assert.equal(normalizeField('riga1\nriga2'), 'riga1 riga2');
  assert.equal(normalizeField('con\u0000controllo'), 'con controllo');
  assert.equal(normalizeField(undefined), '');
  assert.equal(normalizeField(null), '');
  assert.equal(normalizeField(1500), '1500');
  assert.equal(normalizeField({}), '');
});

test('normalizePrice rimuove spazi e simbolo di valuta', () => {
  assert.equal(normalizePrice(' € 150.000,50 '), '150.000,50');
  assert.equal(normalizePrice('150 000'), '150000');
});

test('normalizeCard normalizza tutti i campi e applica la versione', () => {
  const card = normalizeCard({
    nome: '  Attico  Centro ',
    indirizzo: 'Via   Roma 1',
    descrizione: '  Vista  sul  parco ',
    prezzo: ' € 250.000,00 ',
  });
  assert.deepEqual(card, {
    version: CARD_VERSION,
    nome: 'Attico Centro',
    indirizzo: 'Via Roma 1',
    descrizione: 'Vista sul parco',
    prezzo: '250.000,00',
  });
});

test('normalizeCard sopravvive a input non oggetto', () => {
  assert.equal(normalizeCard(null).nome, '');
  assert.equal(normalizeCard('testo').prezzo, '');
});

test('validateCard richiede il nome', () => {
  const result = validateCard({ prezzo: '100' });
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].field, 'nome');
  assert.equal(result.errors[0].code, 'required');
});

test('validateCard accetta i prezzi nei formati italiani', () => {
  for (const prezzo of ['', '150000', '150.000', '1.234.567', '150.000,50', '1500,50', '1500.50', '-1500']) {
    const result = validateCard({ nome: 'Casa', prezzo });
    assert.equal(result.valid, true, `prezzo rifiutato: ${prezzo}`);
  }
});

test('validateCard rifiuta i prezzi non interpretabili', () => {
  for (const prezzo of ['abc', '12,345', '1,2,3', '150,', '12.34.567']) {
    const result = validateCard({ nome: 'Casa', prezzo });
    assert.equal(result.valid, false, `prezzo accettato: ${prezzo}`);
    assert.equal(result.errors[0].field, 'prezzo');
    assert.equal(result.errors[0].code, 'invalid_format');
  }
});

test('il solo simbolo di valuta equivale a prezzo non indicato', () => {
  assert.equal(normalizePrice('€'), '');
  assert.equal(validateCard({ nome: 'Casa', prezzo: '€' }).valid, true);
});

test('validateCard applica i limiti di lunghezza', () => {
  assert.equal(validateCard({ nome: 'x'.repeat(81) }).errors[0].code, 'too_long');
  assert.equal(validateCard({ nome: 'ok', indirizzo: 'x'.repeat(161) }).errors[0].field, 'indirizzo');
  assert.equal(validateCard({ nome: 'ok', descrizione: 'x'.repeat(2001) }).errors[0].field, 'descrizione');
  assert.equal(validateCard({ nome: 'x'.repeat(80) }).valid, true);
});

test('priceToNumber interpreta migliaia e decimali', () => {
  assert.equal(priceToNumber('150000'), 150000);
  assert.equal(priceToNumber('150.000'), 150000);
  assert.equal(priceToNumber('1.234.567'), 1234567);
  assert.equal(priceToNumber('150.000,50'), 150000.5);
  assert.equal(priceToNumber('1500.50'), 1500.5);
  assert.equal(priceToNumber('1500,50'), 1500.5);
  assert.equal(priceToNumber('-1500,25'), -1500.25);
  assert.equal(priceToNumber(' € 150.000,50 '), 150000.5);
});

test('priceToNumber restituisce null per valori vuoti o non validi', () => {
  assert.equal(priceToNumber(''), null);
  assert.equal(priceToNumber('   '), null);
  assert.equal(priceToNumber('abc'), null);
  assert.equal(priceToNumber('12,345'), null);
});

test('formatPrice produce il formato italiano con due decimali', () => {
  assert.equal(formatPrice(150000.5), '150.000,50');
  assert.equal(formatPrice('150.000,50'), '150.000,50');
  assert.equal(formatPrice(0), '0,00');
  assert.equal(formatPrice(''), '');
  assert.equal(formatPrice('abc'), '');
});
