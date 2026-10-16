/**
 * Test dell'archivio del server API (memoria e file con scrittura atomica).
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { createFileStore, createMemoryStore, upsertCards } from '../src/store.js';

const tempDirs = [];
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'realtor-store-'));
  tempDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const card = (nome, extra = {}) => ({ nome, indirizzo: 'Via Test 1', descrizione: '', prezzo: '100', ...extra });

test('upsertCards crea e aggiorna usando il nome come chiave', () => {
  const result = upsertCards([card('Alfa')], [card('Alfa', { prezzo: '200' }), card('Beta')]);
  assert.deepEqual(result.created, ['Beta']);
  assert.deepEqual(result.updated, ['Alfa']);
  assert.equal(result.cards.length, 2);
  assert.equal(result.cards.find((entry) => entry.nome === 'Alfa').prezzo, '200');
});

test('archivio in memoria: upsert, list e clear', () => {
  const store = createMemoryStore();
  assert.equal(store.kind, 'memory');
  assert.equal(store.count(), 0);

  store.upsert([card('Alfa'), card('Beta')]);
  assert.equal(store.count(), 2);
  assert.deepEqual(
    store.list().map((entry) => entry.nome),
    ['Alfa', 'Beta'],
  );

  store.upsert([card('Alfa', { descrizione: 'aggiornata' })]);
  assert.equal(store.count(), 2);
  assert.equal(store.list()[0].descrizione, 'aggiornata');

  assert.equal(store.clear(), 2);
  assert.equal(store.count(), 0);
});

test('archivio in memoria: list restituisce copie', () => {
  const store = createMemoryStore([card('Alfa')]);
  const listed = store.list();
  listed[0].nome = 'Modificato';
  assert.equal(store.list()[0].nome, 'Alfa');
});

test('archivio su file: persiste tra istanze', () => {
  const file = join(tempDir(), 'cards.json');
  const first = createFileStore({ file });
  first.upsert([card('Alfa'), card('Beta')]);
  assert.equal(first.kind, 'file');

  const second = createFileStore({ file });
  assert.equal(second.count(), 2);
  assert.deepEqual(
    second.list().map((entry) => entry.nome),
    ['Alfa', 'Beta'],
  );

  const onDisk = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(onDisk.version, 1);
  assert.equal(onDisk.count, 2);
  assert.equal(onDisk.cards.length, 2);
});

test('archivio su file: la scrittura è atomica e non lascia file temporanei', () => {
  const dir = tempDir();
  const file = join(dir, 'cards.json');
  const store = createFileStore({ file });
  store.upsert([card('Alfa')]);
  store.upsert([card('Beta')]);
  const leftovers = readdirSync(dir).filter((name) => name.includes('.tmp-'));
  assert.deepEqual(leftovers, []);
});

test('archivio su file: un file corrotto viene messo da parte, non sovrascritto', () => {
  const dir = tempDir();
  const file = join(dir, 'cards.json');
  writeFileSync(file, '{non-json', 'utf8');

  const warnings = [];
  const store = createFileStore({ file, onWarn: (message) => warnings.push(message) });
  assert.equal(store.count(), 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /corrotto/);

  const moved = readdirSync(dir).filter((name) => name.includes('.corrupt-'));
  assert.equal(moved.length, 1, 'il file corrotto doveva essere conservato');

  store.upsert([card('Alfa')]);
  assert.equal(store.count(), 1);
});

test('archivio su file: crea le cartelle mancanti', () => {
  const file = join(tempDir(), 'annidata', 'profonda', 'cards.json');
  const store = createFileStore({ file });
  store.upsert([card('Alfa')]);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).count, 1);
});

test('archivio su file: accetta il formato con {cards:[...]}', () => {
  const dir = tempDir();
  const file = join(dir, 'cards.json');
  writeFileSync(file, JSON.stringify({ version: 1, cards: [card('Alfa')] }), 'utf8');
  assert.equal(createFileStore({ file }).count(), 1);
});

test('createFileStore richiede il percorso', () => {
  assert.throws(() => createFileStore({}), TypeError);
});
