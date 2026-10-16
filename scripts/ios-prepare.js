#!/usr/bin/env node
/**
 * Realtor — preparazione della piattaforma iOS.
 *
 * Perché serve questo script: `cordova-ios` copia nel progetto alcuni file
 * **CommonJS** (`platforms/ios/cordova/loggingHelper.js`, `platforms/ios/cordova/Api.js`)
 * e li esegue con Node. Poiché il `package.json` principale di questo progetto ha
 * `"type": "module"` (necessario a Node per test e server), Node tratterebbe quei
 * file come ESM e `cordova platform add ios` fallisce con:
 *
 *     module is not defined in ES module scope
 *
 * Lo script:
 *   1. aggiunge la piattaforma tollerando **solo** quell'errore noto;
 *   2. scrive `platforms/ios/package.json` con `{"type":"commonjs"}`, così i file
 *      copiati tornano a essere interpretati come CommonJS;
 *   3. completa con `cordova prepare ios`.
 *
 * `platforms/` non è versionato: lo script va eseguito a ogni clonazione.
 *
 * MIT License — Copyright (c) 2014-2026 Donato Pepe (vedi LICENSE).
 */

import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';

const KNOWN_ESM_ERROR = /module is not defined in ES module scope/;
const PLATFORM_DIR = 'platforms/ios';

/**
 * Esegue un comando mostrandone l'output.
 * @param {string[]} args
 * @returns {{status:number, output:string}}
 */
function run(args) {
  const result = spawnSync('npx', args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  process.stdout.write(output);
  return { status: result.status ?? 1, output };
}

if (process.platform !== 'darwin') {
  console.log('Nota: la compilazione iOS richiede macOS; qui si prepara solo il progetto.');
}

const added = run(['cordova', 'platform', 'add', 'ios']);
if (added.status !== 0 && !KNOWN_ESM_ERROR.test(added.output)) {
  console.error('cordova platform add ios è fallito per un motivo non previsto.');
  process.exit(added.status);
}

if (!existsSync(PLATFORM_DIR)) {
  console.error(`La cartella ${PLATFORM_DIR} non è stata creata: impossibile continuare.`);
  process.exit(1);
}

const marker = `${PLATFORM_DIR}/package.json`;
if (!existsSync(marker)) {
  writeFileSync(marker, '{"type":"commonjs"}\n', 'utf8');
  console.log(`Creato ${marker}: i file CommonJS copiati da cordova-ios restano CommonJS.`);
}

const prepared = run(['cordova', 'prepare', 'ios']);
if (prepared.status !== 0) {
  console.error('cordova prepare ios è fallito.');
  process.exit(prepared.status);
}

console.log('Piattaforma iOS pronta (compilazione su macOS con: npm run build:ios).');
