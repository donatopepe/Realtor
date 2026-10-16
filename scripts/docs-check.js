#!/usr/bin/env node
/**
 * Realtor — verifica della documentazione.
 *
 * Controlla che quanto scritto nei documenti sia eseguibile davvero:
 *   - ogni `npm run <script>` citato esiste in package.json;
 *   - ogni `node <file>` citato esiste;
 *   - ogni percorso locale citato nei link e nel codice inline esiste;
 *   - gli screenshot citati esistono;
 *   - i documenti non contengono caratteri corrotti (U+FFFD);
 *   - il README contiene le sezioni obbligatorie.
 *
 * Uso: node scripts/docs-check.js [--json]
 * Exit code: 0 = documentazione coerente, 1 = problemi trovati.
 *
 * MIT License — Copyright (c) 2014-2026 Donato Pepe (vedi LICENSE).
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Script npm integrati: non devono comparire in package.json. */
const NPM_BUILTINS = new Set(['ci', 'install', 'test', 'start', 'publish', 'exec', 'init', 'update', 'audit', 'outdated', 'ls', 'run']);

/** Binari esterni ammessi nei comandi documentati. */
const ALLOWED_BINARIES = new Set([
  'cordova',
  'playwright',
  'eslint',
  'docker',
  'gh',
  'sdkmanager',
  'npx',
  'node',
  'npm',
  'git',
  'curl',
  'unzip',
  'ls',
  'cd',
]);

/** Radici di percorso considerate locali al progetto. */
const LOCAL_ROOTS = ['www/', 'server/', 'scripts/', 'tests/', 'docs/', 'resources/', '.github/', '.gitignore'];

const REQUIRED_README_SECTIONS = [
  '## Funzionalità',
  '## Requisiti',
  '## Avvio rapido',
  '## Test',
  '## Build',
  '## Server',
  '## Struttura',
  '## Piattaforme',
  '## Licenza',
];

/** Documenti storici che citano file non più presenti (audit): percorsi non verificati. */
const DOCUMENTS_WITHOUT_PATH_CHECK = new Set(['PLAN.md']);

const DOC_FILES = ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CHANGELOG.md', 'PLAN.md', 'docs/ARCHITECTURE.md', 'docs/API.md', 'docs/MIGRATION.md', 'docs/PUBLISHING.md'];

/** Estrae i blocchi di codice con linguaggio `bash`, `sh` o `shell`. */
function shellBlocks(markdown) {
  const blocks = [];
  const pattern = /```(?:bash|sh|shell)\n([\s\S]*?)```/g;
  let match;
  while ((match = pattern.exec(markdown)) !== null) blocks.push(match[1]);
  return blocks;
}

/** Percorsi locali citati nel testo (link markdown e codice inline). */
function referencedPaths(markdown) {
  const found = new Set();
  for (const pattern of [/\]\(([^)\s]+)\)/g, /`([^`\s]+)`/g]) {
    let match;
    while ((match = pattern.exec(markdown)) !== null) {
      const value = match[1].trim();
      if (value === '' || value.startsWith('http') || value.startsWith('#') || value.includes(' ')) continue;
      const isLocal = LOCAL_ROOTS.some((prefix) => value.startsWith(prefix)) ||
        /^(LICENSE|NOTICE|README\.md|CHANGELOG\.md|PLAN\.md|CONTRIBUTING\.md|SECURITY\.md|CODE_OF_CONDUCT\.md|package\.json|config\.xml|playwright\.config\.js|eslint\.config\.js)$/.test(value) ||
        /^docs\/screenshots\/[A-Za-z0-9._-]+$/.test(value);
      if (isLocal) found.add(value);
    }
  }
  return found;
}

/**
 * Verifica un documento.
 * @param {{relative:string, scripts:Set<string>, problems:string[]}} context
 */
function checkDocument({ relative, scripts, problems, checkPaths = true }) {
  const file = join(root, relative);
  if (!existsSync(file)) {
    problems.push(`${relative}: file mancante`);
    return;
  }
  const markdown = readFileSync(file, 'utf8');

  if (markdown.includes('\uFFFD')) problems.push(`${relative}: contiene il carattere di sostituzione U+FFFD`);

  for (const block of shellBlocks(markdown)) {
    for (const rawLine of block.split('\n')) {
      const line = rawLine.replace(/^\s*\$?\s*/, '').trim();
      if (line === '' || line.startsWith('#')) continue;

      for (const match of line.matchAll(/\bnpm (?:run )?([A-Za-z0-9:_-]+)/g)) {
        const name = match[1];
        if (!NPM_BUILTINS.has(name) && !scripts.has(name)) {
          problems.push(`${relative}: script npm inesistente -> npm ${match[0].replace('npm ', '')}`);
        }
      }
      for (const match of line.matchAll(/\bnode ([\w./-]+\.js)/g)) {
        if (!existsSync(join(root, match[1]))) problems.push(`${relative}: file node inesistente -> ${match[1]}`);
      }
      for (const match of line.matchAll(/\b(npx|npx --yes) ([\w@./-]+)/g)) {
        const binary = match[2].replace(/^@[\w-]+\//, '').split('@')[0];
        if (!ALLOWED_BINARIES.has(binary) && !existsSync(join(root, 'node_modules', '.bin', binary))) {
          problems.push(`${relative}: binario non disponibile -> ${match[2]}`);
        }
      }
    }
  }

  if (!checkPaths) return;

  for (const path of referencedPaths(markdown)) {
    if (!existsSync(join(root, path))) problems.push(`${relative}: percorso citato ma inesistente -> ${path}`);
  }
}

const readme = readFileSync(join(root, 'README.md'), 'utf8');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const scripts = new Set(Object.keys(pkg.scripts || {}));
const problems = [];

for (const relative of DOC_FILES) {
  if (existsSync(join(root, relative))) {
    checkDocument({
      relative,
      scripts,
      problems,
      checkPaths: !DOCUMENTS_WITHOUT_PATH_CHECK.has(relative),
    });
  } else {
    problems.push(`${relative}: documentazione prevista mancante`);
  }
}

for (const section of REQUIRED_README_SECTIONS) {
  if (!readme.includes(section)) problems.push(`README.md: sezione obbligatoria mancante -> ${section}`);
}

for (const screenshot of ['home', 'scheda', 'elenco', 'impostazioni']) {
  const file = join(root, 'docs', 'screenshots', `${screenshot}.png`);
  if (!existsSync(file) || statSync(file).size < 2000) problems.push(`docs/screenshots/${screenshot}.png: screenshot mancante o troppo piccolo`);
  if (!readme.includes(`docs/screenshots/${screenshot}.png`)) problems.push(`README.md: screenshot non mostrato -> ${screenshot}.png`);
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ documents: DOC_FILES.length, scripts: [...scripts].length, problems }, null, 2));
} else if (problems.length === 0) {
  console.log(`Documentazione coerente: ${DOC_FILES.length} documenti, ${scripts.size} script npm, link e comandi verificati.`);
} else {
  console.error(`Problemi nella documentazione (${problems.length}):`);
  for (const problem of problems) console.error(`  - ${problem}`);
}

process.exit(problems.length === 0 ? 0 : 1);
