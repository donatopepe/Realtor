/**
 * Realtor — backup delle schede (esportazione e importazione JSON).
 *
 * L'import valida tutto **prima** di toccare lo storage: un file corrotto non
 * può cancellare o sovrascrivere dati esistenti.
 *
 * MIT License — Copyright (c) 2014-2026 Donato Pepe (vedi LICENSE e NOTICE).
 */

import { CARD_FIELDS, normalizeCard, validateCard } from './schema.js';

/** Identificatore del formato di backup. */
export const BACKUP_FORMAT = 'realtor.backup';

/** Versione del formato di backup. */
export const BACKUP_VERSION = 1;

/**
 * Crea le funzioni di backup legate a un repository di schede.
 * @param {{store:object, appVersion?:string, now?:() => Date}} options
 */
export function createBackup({ store, appVersion = '0.0.0', now = () => new Date() } = {}) {
  if (!store || typeof store.save !== 'function' || typeof store.exportAll !== 'function') {
    throw new TypeError('createBackup: è richiesto un repository di schede.');
  }

  /** Costruisce il payload di backup. @returns {object} */
  function build() {
    const cards = store.exportAll();
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      app: `realtor/${appVersion}`,
      exportedAt: now().toISOString(),
      count: cards.length,
      cards,
    };
  }

  /** Serializza il backup. */
  function toJson({ pretty = true } = {}) {
    return JSON.stringify(build(), null, pretty ? 2 : 0);
  }

  /**
   * Interpreta un testo di backup: formato Realtor, array di schede o oggetto
   * singolo. Non scrive nulla.
   * @param {string|object} input
   * @returns {{valid:boolean, errors:string[], cards:object[], payload:object|null}}
   */
  function parse(input) {
    let data = input;
    if (typeof input === 'string') {
      const text = input.trim();
      if (text === '') return { valid: false, errors: ['Backup vuoto.'], cards: [], payload: null };
      try {
        data = JSON.parse(text);
      } catch (error) {
        return { valid: false, errors: [`JSON non valido: ${error.message}`], cards: [], payload: null };
      }
    }

    if (Array.isArray(data)) {
      return { valid: data.length > 0, errors: data.length === 0 ? ['Nessuna scheda nel backup.'] : [], cards: data, payload: null };
    }
    if (data && typeof data === 'object' && Array.isArray(data.cards)) {
      if (data.cards.length === 0) {
        return { valid: false, errors: ['Il backup non contiene schede.'], cards: [], payload: data };
      }
      return { valid: true, errors: [], cards: data.cards, payload: data };
    }
    if (data && typeof data === 'object' && CARD_FIELDS.some((field) => field in data)) {
      return { valid: true, errors: [], cards: [data], payload: null };
    }
    return { valid: false, errors: ['Formato non riconosciuto: atteso un backup Realtor o un elenco di schede.'], cards: [], payload: null };
  }

  /**
   * Importa un backup.
   * @param {string|object} input
   * @param {{mode?:'merge'|'replace'}} [options]
   * @returns {{imported:number, skipped:number, invalid:number, errors:string[], mode:string}}
   */
  function importJson(input, { mode = 'merge' } = {}) {
    const parsed = parse(input);
    if (!parsed.valid) return { imported: 0, skipped: 0, invalid: 0, errors: parsed.errors, mode };

    // Valida tutte le schede prima di scrivere qualsiasi cosa.
    const valid = [];
    const errors = [];
    let invalid = 0;
    for (const raw of parsed.cards) {
      const card = normalizeCard(raw);
      const result = validateCard(card);
      if (result.valid) valid.push(card);
      else {
        invalid += 1;
        errors.push(`${card.nome || '(senza nome)'}: ${result.errors.map((item) => item.message).join(' ')}`);
      }
    }
    if (valid.length === 0) return { imported: 0, skipped: 0, invalid, errors, mode };

    let removed = 0;
    if (mode === 'replace') removed = store.clear();

    let imported = 0;
    let skipped = 0;
    for (const card of valid) {
      try {
        store.save(card);
        imported += 1;
      } catch (error) {
        skipped += 1;
        errors.push(`${card.nome}: ${error.message}`);
      }
    }
    return { imported, skipped, invalid, errors, mode, removed };
  }

  return { build, toJson, parse, importJson };
}
