#!/usr/bin/env node
/**
 * Realtor — pinning dei file dell'app (Subresource Integrity "statica").
 *
 * Calcola l'hash SHA-384 di ogni file che compone l'app shell e lo registra in
 * `www/sri.json`. La verifica (`--check`, eseguita in CI e nei test) intercetta
 * qualunque modifica non intenzionale o manomissione dei file serviti.
 *
 * Perché non attributi `integrity=` in `index.html`: sul WebView iOS le risorse
 * sono caricate da `file://`, dove la verifica SRI del browser è inaffidabile e
 * rischia di bloccare l'app. Il pinning resta quindi una verifica ripetibile in
 * CI, senza introdurre rischio a runtime.
 *
 * Uso:
 *   node scripts/sri.js --update   # rigenera www/sri.json
 *   node scripts/sri.js --check    # verifica (exit 1 se qualcosa non torna)
 *
 * MIT License — Copyright (c) 2014-2026 Donato Pepe (vedi LICENSE).
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const www = join(root, 'www');
const manifestFile = join(www, 'sri.json');

/** File dell'app shell di cui garantire l'integrità. */
export const PINNED_FILES = [
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'css/index.css',
  'js/mobileinit.js',
  'js/app.js',
  'js/platform.js',
  'js/core/api.js',
  'js/core/backup.js',
  'js/core/crypto.js',
  'js/core/migration.js',
  'js/core/schema.js',
  'js/core/settings.js',
  'js/core/storage.js',
  'js/jquery/jquery-2.1.0.min.js',
  'js/jquery/jquery.mobile-1.4.2.min.js',
  'js/jquery/jquery.mobile-1.4.2.min.css',
];

/**
 * Calcola l'hash `sha384-<base64>` di un file dell'app.
 * @param {string} relative
 * @returns {string}
 */
export function hashFile(relative) {
  const content = readFileSync(join(www, relative));
  return `sha384-${createHash('sha384').update(content).digest('base64')}`;
}

/**
 * Costruisce il manifest corrente.
 * @returns {Record<string,string>}
 */
export function buildManifest() {
  const manifest = {};
  for (const file of [...PINNED_FILES].sort()) manifest[file] = hashFile(file);
  return manifest;
}

/**
 * Confronta i file su disco con il manifest atteso.
 * @returns {{ok:boolean, missing:string[], changed:string[], extra:string[]}}
 */
export function verifyManifest() {
  const actual = buildManifest();
  const expected = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')).files || {} : {};

  const missing = Object.keys(expected).filter((file) => !(file in actual));
  const changed = Object.keys(expected).filter((file) => file in actual && actual[file] !== expected[file]);
  const extra = Object.keys(actual).filter((file) => !(file in expected));

  return { ok: missing.length === 0 && changed.length === 0 && extra.length === 0, missing, changed, extra };
}

const USAGE = `Uso: node scripts/sri.js [--update | --check]

  --update   rigenera www/sri.json con gli hash correnti
  --check    verifica i file rispetto a www/sri.json (default)
  -h, --help mostra questo aiuto`;

function isMain() {
  return (process.argv[1] || '').endsWith('sri.js');
}

if (isMain()) {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) {
    console.log(USAGE);
    process.exit(0);
  }

  const manifest = buildManifest();

  if (args.includes('--update')) {
    const payload = {
      version: 1,
      algorithm: 'sha384',
      note: 'Hash dei file dell\'app shell. Rigenerare con: npm run sri:update',
      files: manifest,
    };
    writeFileSync(manifestFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    console.log(`Aggiornati ${Object.keys(manifest).length} hash in www/sri.json`);
    process.exit(0);
  }

  const result = verifyManifest();
  if (result.ok) {
    console.log(`Integrità verificata: ${Object.keys(manifest).length} file corrispondono a www/sri.json.`);
    process.exit(0);
  }
  console.error('Integrità NON verificata:');
  for (const file of result.missing) console.error(`  mancante: ${file}`);
  for (const file of result.changed) console.error(`  modificato: ${file}`);
  for (const file of result.extra) console.error(`  non registrato: ${file}`);
  console.error('Se la modifica è intenzionale: npm run sri:update');
  process.exit(1);
}

export default verifyManifest;
