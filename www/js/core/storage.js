/**
 * Realtor — repository delle schede su uno storage iniettabile.
 *
 * Il modulo non conosce l'oggetto storage globale del browser: riceve un oggetto con l'interfaccia
 * Web Storage (`length`, `key`, `getItem`, `setItem`, `removeItem`), quindi è
 * testabile in Node e riutilizzabile (sessionStorage, storage in memoria, ...).
 *
 * MIT License — Copyright (c) 2014-2026 Donato Pepe (vedi LICENSE e NOTICE).
 */

import { normalizeCard, validateCard } from './schema.js';

/** Prefisso delle chiavi: evita collisioni con altre chiavi della stessa origine. */
export const CARD_KEY_PREFIX = 'realtor.scheda.';

/**
 * @typedef {object} StorageLike
 * @property {number} length
 * @property {(index:number) => string|null} key
 * @property {(key:string) => string|null} getItem
 * @property {(key:string, value:string) => void} setItem
 * @property {(key:string) => void} removeItem
 */

/**
 * Crea il repository delle schede.
 * @param {{storage: StorageLike, keyPrefix?: string}} options
 * @returns {{
 *   keyPrefix: string,
 *   keys: () => string[],
 *   count: () => number,
 *   has: (nome:string) => boolean,
 *   get: (nome:string) => object|null,
 *   list: () => object[],
 *   save: (card:object) => object,
 *   remove: (nome:string) => boolean,
 *   clear: () => number,
 *   exportAll: () => object[]
 * }}
 */
export function createCardStore({ storage, keyPrefix = CARD_KEY_PREFIX } = {}) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    throw new TypeError('createCardStore: è richiesto uno storage con getItem/setItem/removeItem.');
  }
  const prefix = String(keyPrefix ?? '');
  const keyOf = (nome) => `${prefix}${nome}`;
  const nameOfKey = (key) => (typeof key === 'string' && key.startsWith(prefix) ? key.slice(prefix.length) : null);

  /**
   * Nomi delle schede presenti nello storage.
   * Itera su uno snapshot della lunghezza: nessuna rimozione durante l'iterazione,
   * quindi nessun salto di indice.
   * @returns {string[]}
   */
  function keys() {
    const collected = [];
    const total = Number(storage.length) || 0;
    for (let index = 0; index < total; index += 1) {
      const name = nameOfKey(storage.key(index));
      if (name !== null && name !== '') collected.push(name);
    }
    return collected.sort((a, b) => a.localeCompare(b, 'it'));
  }

  /** @param {string} nome */
  function has(nome) {
    const key = keyOf(String(nome ?? '').trim());
    return key !== prefix && storage.getItem(key) !== null;
  }

  /**
   * Legge una scheda. Dati corrotti o assenti restituiscono `null`
   * (nessuna eccezione: i dati non vengono distrutti).
   * @param {string} nome
   */
  function get(nome) {
    const clean = String(nome ?? '').trim();
    if (clean === '') return null;
    const raw = storage.getItem(keyOf(clean));
    if (raw === null || raw === undefined) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      const card = normalizeCard(parsed);
      if (card.nome === '') card.nome = clean; // dati legacy: il nome era la chiave
      return card;
    } catch {
      return null;
    }
  }

  /** @returns {object[]} tutte le schede, ordinate per nome */
  function list() {
    return keys()
      .map((nome) => get(nome))
      .filter((card) => card !== null);
  }

  /**
   * Salva una scheda normalizzata e validata.
   * @param {object} card
   * @returns {object} la scheda salvata
   * @throws {Error & {errors?: Array}} se la scheda non è valida
   */
  function save(card) {
    const normalized = normalizeCard(card);
    const { valid, errors } = validateCard(normalized);
    if (!valid) {
      const error = new Error(errors.map((item) => item.message).join(' '));
      error.name = 'ValidationError';
      error.errors = errors;
      throw error;
    }
    storage.setItem(keyOf(normalized.nome), JSON.stringify(normalized));
    return normalized;
  }

  /**
   * Rimuove una scheda.
   * @param {string} nome
   * @returns {boolean} `true` se esisteva
   */
  function remove(nome) {
    const clean = String(nome ?? '').trim();
    if (clean === '') return false;
    const existed = has(clean);
    storage.removeItem(keyOf(clean));
    return existed;
  }

  /**
   * Rimuove tutte le schede del prefisso (non tocca altre chiavi).
   * @returns {number} numero di schede rimosse
   */
  function clear() {
    const names = keys();
    for (const nome of names) storage.removeItem(keyOf(nome));
    return names.length;
  }

  /** @returns {object[]} copia esportabile di tutte le schede */
  function exportAll() {
    return list().map((card) => ({ ...card }));
  }

  return { keyPrefix: prefix, keys, count: () => keys().length, has, get, list, save, remove, clear, exportAll };
}
