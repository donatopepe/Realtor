/**
 * Realtor — migrazione dei dati della versione 0.0.1.
 *
 * La 0.0.1 salvava ogni scheda in `localStorage` con il **nome della scheda**
 * come chiave e senza campo `version`. Qui quelle voci vengono riconosciute,
 * convertite nello schema corrente e spostate sotto il prefisso `realtor.scheda.`.
 *
 * Regole di sicurezza:
 *  - si scrive la nuova voce e solo dopo si rimuove quella vecchia;
 *  - se esiste già una scheda con lo stesso nome, la voce migrata viene salvata
 *    con un nome libero (`Nome (2)`) invece di sovrascrivere dati;
 *  - le voci che non sono schede (es. le impostazioni) non vengono toccate.
 *
 * MIT License — Copyright (c) 2014-2026 Donato Pepe (vedi LICENSE e NOTICE).
 */

import { CARD_FIELDS, normalizeCard, validateCard } from './schema.js';
import { CARD_KEY_PREFIX } from './storage.js';
import { SETTINGS_KEY } from './settings.js';

/** Chiavi riservate che non sono schede legacy. */
export const RESERVED_KEYS = Object.freeze([SETTINGS_KEY]);

/**
 * Interpreta un valore legacy come scheda.
 * @param {string} key
 * @param {string} rawValue
 * @returns {object|null} scheda normalizzata, oppure `null` se non è una scheda
 */
export function parseLegacyCard(key, rawValue) {
  if (typeof rawValue !== 'string' || rawValue.trim() === '') return null;
  let parsed;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    return null;
  }
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const looksLikeCard = CARD_FIELDS.some((field) => field in parsed);
  if (!looksLikeCard) return null;

  const card = normalizeCard(parsed);
  if (card.nome === '') card.nome = String(key).trim();
  return validateCard(card).valid ? card : null;
}

/**
 * Trova le schede legacy presenti nello storage.
 * @param {{storage:object, keyPrefix?:string, reservedKeys?:string[]}} options
 * @returns {Array<{key:string, card:object}>}
 */
export function findLegacyEntries({ storage, keyPrefix = CARD_KEY_PREFIX, reservedKeys = RESERVED_KEYS } = {}) {
  const prefix = String(keyPrefix ?? '');
  const reserved = new Set(reservedKeys);
  const total = Number(storage.length) || 0;
  const found = [];

  for (let index = 0; index < total; index += 1) {
    const key = storage.key(index);
    if (typeof key !== 'string' || key === '') continue;
    if (key.startsWith(prefix)) continue;
    if (reserved.has(key)) continue;
    const card = parseLegacyCard(key, storage.getItem(key));
    if (card) found.push({ key, card });
  }
  return found;
}

/**
 * Migra le schede legacy sotto il prefisso corrente.
 * @param {{storage:object, keyPrefix?:string, reservedKeys?:string[]}} options
 * @returns {{migrated:number, renamed:number, removed:number, skipped:number, errors:string[]}}
 */
export function migrateLegacy({ storage, keyPrefix = CARD_KEY_PREFIX, reservedKeys = RESERVED_KEYS } = {}) {
  const entries = findLegacyEntries({ storage, keyPrefix, reservedKeys });
  const report = { migrated: 0, renamed: 0, removed: 0, skipped: 0, errors: [] };

  for (const { key, card } of entries) {
    let name = card.nome;
    let renamed = false;
    let suffix = 2;
    while (storage.getItem(`${keyPrefix}${name}`) !== null) {
      name = `${card.nome} (${suffix})`;
      suffix += 1;
      renamed = true;
      if (suffix > 1000) break;
    }

    try {
      storage.setItem(`${keyPrefix}${name}`, JSON.stringify({ ...card, nome: name }));
      if (storage.getItem(`${keyPrefix}${name}`) === null) throw new Error('scrittura non verificata');
      storage.removeItem(key);
      report.migrated += 1;
      report.removed += 1;
      if (renamed) report.renamed += 1;
    } catch (error) {
      report.skipped += 1;
      report.errors.push(`${key}: ${error.message}`);
    }
  }

  return report;
}
