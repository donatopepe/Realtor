/**
 * Realtor — persistenza delle schede per l'API di riferimento.
 *
 * Due implementazioni con la stessa interfaccia:
 *   - `createMemoryStore()`  → per test e demo volatili;
 *   - `createFileStore()`    → file JSON con scrittura atomica (tmp + rename).
 *
 * Un file corrotto non viene mai sovrascritto in silenzio: viene messo da parte
 * con suffisso `.corrupt-<timestamp>` e si riparte da un archivio vuoto.
 *
 * MIT License — Copyright (c) 2014-2026 Donato Pepe (vedi LICENSE).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Normalizza la forma dell'archivio su disco. */
function readArchive(file, onWarn) {
  if (!existsSync(file)) return [];
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    onWarn?.(`archivio non leggibile (${error.message}): si riparte da vuoto`);
    return [];
  }
  if (raw.trim() === '') return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.cards)) return parsed.cards;
    onWarn?.('archivio in formato inatteso: si riparte da vuoto');
    return [];
  } catch {
    const backup = `${file}.corrupt-${Date.now()}`;
    try {
      renameSync(file, backup);
      onWarn?.(`archivio corrotto messo da parte in ${backup}`);
    } catch (error) {
      onWarn?.(`archivio corrotto non spostabile (${error.message})`);
    }
    return [];
  }
}

/**
 * Inserisce o aggiorna le schede, usando il nome come chiave.
 * @param {object[]} current
 * @param {object[]} incoming
 * @returns {{cards:object[], created:string[], updated:string[]}}
 */
export function upsertCards(current, incoming) {
  const cards = current.map((card) => ({ ...card }));
  const index = new Map(cards.map((card, position) => [card.nome, position]));
  const created = [];
  const updated = [];

  for (const card of incoming) {
    const entry = { ...card };
    if (index.has(entry.nome)) {
      cards[index.get(entry.nome)] = entry;
      updated.push(entry.nome);
    } else {
      index.set(entry.nome, cards.length);
      cards.push(entry);
      created.push(entry.nome);
    }
  }
  return { cards, created, updated };
}

/**
 * Archivio in memoria.
 * @param {object[]} [initial]
 */
export function createMemoryStore(initial = []) {
  let cards = initial.map((card) => ({ ...card }));
  return {
    kind: 'memory',
    list: () => cards.map((card) => ({ ...card })),
    count: () => cards.length,
    upsert(incoming) {
      const result = upsertCards(cards, incoming);
      cards = result.cards;
      return { created: result.created, updated: result.updated };
    },
    clear() {
      const removed = cards.length;
      cards = [];
      return removed;
    },
  };
}

/**
 * Archivio su file JSON con scrittura atomica.
 * @param {{file:string, onWarn?:Function, now?:() => Date}} options
 */
export function createFileStore({ file, onWarn, now = () => new Date() } = {}) {
  if (!file) throw new TypeError('createFileStore: serve il percorso del file.');

  function write(cards) {
    mkdirSync(dirname(file), { recursive: true });
    const temporary = `${file}.tmp-${process.pid}`;
    const payload = JSON.stringify(
      { version: 1, updatedAt: now().toISOString(), count: cards.length, cards },
      null,
      2,
    );
    writeFileSync(temporary, payload, 'utf8');
    renameSync(temporary, file); // atomico: nessun file parziale visibile
  }

  return {
    kind: 'file',
    file,
    list: () => readArchive(file, onWarn).map((card) => ({ ...card })),
    count: () => readArchive(file, onWarn).length,
    upsert(incoming) {
      const result = upsertCards(readArchive(file, onWarn), incoming);
      write(result.cards);
      return { created: result.created, updated: result.updated };
    },
    clear() {
      const removed = readArchive(file, onWarn).length;
      write([]);
      return removed;
    },
  };
}
