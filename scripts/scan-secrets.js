#!/usr/bin/env node
/**
 * Realtor — scansione dei segreti (working tree e storia git).
 *
 * Zero dipendenze. Non stampa mai un segreto per intero: le occorrenze sono
 * redatte (prefisso + lunghezza) così il log della CI resta sicuro.
 *
 * Uso:
 *   node scripts/scan-secrets.js              # file tracciati da git
 *   node scripts/scan-secrets.js --history    # tutti i blob di ogni commit
 *   node scripts/scan-secrets.js --json       # output macchina-leggibile
 *
 * Exit code: 0 = nessun segreto, 1 = segreti trovati, 2 = errore d'uso.
 *
 * MIT License — Copyright (c) 2014-2026 Donato Pepe (vedi LICENSE).
 */

import { execFileSync } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

/** File che contengono i pattern per definizione: esclusi dalla scansione. */
export const IGNORED_FILES = new Set(['scan-secrets.js', 'secrets.test.js']);

/** Valori evidentemente fittizi: non sono segreti. */
const PLACEHOLDER = /^(?:\$[A-Za-z_{]|\{\{|<|%|x{3,}|\.{3,}|-+|change|cambia|modifica|inserisci|inserire|segnaposto|replace|example|placeholder|your|test|dummy|fake|sample|todo|redacted|secret$|password$|token$|api[_-]?key$|access[_-]?token$)/i;

/**
 * @typedef {object} Pattern
 * @property {string} id
 * @property {string} description
 * @property {RegExp} regex
 */

/** @type {Pattern[]} */
export const PATTERNS = [
  {
    id: 'private-key',
    description: 'chiave privata PEM/OpenSSH',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
  },
  {
    id: 'aws-access-key-id',
    description: 'AWS access key id',
    regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  },
  {
    id: 'github-token',
    description: 'token GitHub',
    regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
  },
  {
    id: 'google-api-key',
    description: 'API key Google',
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/,
  },
  {
    id: 'slack-token',
    description: 'token Slack',
    regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/,
  },
  {
    id: 'stripe-key',
    description: 'chiave Stripe',
    regex: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  },
  {
    id: 'npm-auth-token',
    description: 'token di registry npm (.npmrc)',
    regex: /_authToken\s*=\s*\S+/,
  },
  {
    id: 'basic-auth-url',
    description: 'credenziali in URL',
    regex: /https?:\/\/[^\s/:@]+:([^\s/@]{3,})@/,
  },
  {
    id: 'assigned-credential',
    description: 'valore assegnato a password/secret/api key/token',
    regex:
      /(?:password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key)\s*[:=]\s*["'`]([^"'`\s]{8,})["'`]/i,
  },
  {
    id: 'bearer-literal',
    description: 'token Bearer in chiaro',
    regex: /["'`]Bearer\s+[A-Za-z0-9._~/+-]{20,}["'`]/,
  },
  {
    id: 'keystore-password',
    description: 'password di keystore Android',
    // Il valore catturato passa dai controlli sui placeholder: le variabili
    // d'ambiente e i segnaposto di esempio non sono segnalati.
    regex: /^\s*(?:store|key)Password\s*[=:]\s*(\S+)/m,
  },
  {
    id: 'jwt',
    description: 'JWT in chiaro',
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
];

/**
 * Redige un valore: mai il contenuto completo nei log.
 * @param {string} value
 */
export function redact(value) {
  const text = String(value);
  if (text.length <= 6) return `*** (${text.length})`;
  return `${text.slice(0, 4)}…*** (${text.length})`;
}

/**
 * Analizza un testo e restituisce le occorrenze sospette.
 * @param {string} content
 * @param {{file?:string}} [options]
 * @returns {Array<{file:string, line:number, pattern:string, description:string, preview:string}>}
 */
export function scanText(content, { file = '<testo>' } = {}) {
  const findings = [];
  if (typeof content !== 'string' || content === '') return findings;

  const lines = content.split('\n');
  for (const pattern of PATTERNS) {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const match = pattern.regex.exec(line);
      if (!match) continue;
      const captured = match[1];
      if (captured && PLACEHOLDER.test(captured)) continue;
      // Evita di segnalare l'uso di variabili d'ambiente come fonte del valore.
      if (match[0] && /process\.env|import\.meta\.env/.test(line)) continue;
      findings.push({
        file,
        line: index + 1,
        pattern: pattern.id,
        description: pattern.description,
        preview: redact(captured || match[0]),
      });
    }
  }
  return findings;
}

/** `true` se il contenuto sembra binario. */
export function looksBinary(buffer) {
  const sample = buffer.subarray(0, 8000);
  return sample.includes(0);
}

/**
 * Scansiona i file tracciati da git nella directory indicata.
 * @param {{cwd?:string}} [options]
 */
export function scanTrackedFiles({ cwd = process.cwd() } = {}) {
  const list = execFileSync('git', ['ls-files', '-z'], { cwd, encoding: 'utf8' });
  const files = list.split('\0').filter(Boolean);
  const findings = [];
  let scanned = 0;
  for (const file of files) {
    if (IGNORED_FILES.has(basename(file))) continue;
    const buffer = readFileSync(`${cwd}/${file}`);
    if (looksBinary(buffer)) continue;
    scanned += 1;
    findings.push(...scanText(buffer.toString('utf8'), { file }));
  }
  return { scanned, findings };
}

/**
 * Scansiona tutti i blob presenti in ogni commit (storia completa).
 * Usa un unico processo `git cat-file --batch` per restare veloce.
 * @param {{cwd?:string}} [options]
 */
export function scanHistory({ cwd = process.cwd() } = {}) {
  const listing = execFileSync('git', ['rev-list', '--objects', '--all'], { cwd, encoding: 'utf8' });
  const objects = listing
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, ...rest] = line.split(' ');
      return { sha, path: rest.join(' ') };
    });

  const input = objects.map((object) => object.sha).join('\n') + '\n';
  const result = spawnSync('git', ['cat-file', '--batch'], {
    cwd,
    input,
    maxBuffer: 512 * 1024 * 1024,
  });
  if (result.error) throw result.error;

  const output = result.stdout;
  const findings = [];
  let scanned = 0;
  let cursor = 0;

  for (const object of objects) {
    const headerEnd = output.indexOf(0x0a, cursor);
    if (headerEnd === -1) break;
    const header = output.subarray(cursor, headerEnd).toString('utf8');
    const [sha, type, sizeText] = header.split(' ');
    const size = Number(sizeText);
    const bodyStart = headerEnd + 1;
    const bodyEnd = bodyStart + size;
    if (type === 'blob' && Number.isFinite(size)) {
      const body = output.subarray(bodyStart, bodyEnd);
      if (!looksBinary(body) && !IGNORED_FILES.has(basename(object.path || ''))) {
        scanned += 1;
        findings.push(...scanText(body.toString('utf8'), { file: `${sha.slice(0, 7)}:${object.path || sha}` }));
      }
    }
    cursor = bodyEnd + 1; // salta il newline finale
  }

  return { scanned, findings };
}

const USAGE = `Uso: node scripts/scan-secrets.js [--history] [--json] [--quiet]

  --history   scansiona anche ogni blob di ogni commit
  --json      output JSON
  --quiet     stampa solo il riepilogo
  -h, --help  mostra questo aiuto`;

function isMain() {
  const entry = process.argv[1] || '';
  return entry.endsWith('scan-secrets.js');
}

if (isMain()) {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) {
    console.log(USAGE);
    process.exit(0);
  }
  const history = args.includes('--history');
  const json = args.includes('--json');
  const quiet = args.includes('--quiet');

  try {
    const tracked = scanTrackedFiles();
    const historic = history ? scanHistory() : { scanned: 0, findings: [] };
    const findings = [...tracked.findings, ...historic.findings];

    if (json) {
      console.log(JSON.stringify({ tracked, history: historic, findings }, null, 2));
    } else {
      if (!quiet) {
        for (const finding of findings) {
          console.log(`${finding.file}:${finding.line} [${finding.pattern}] ${finding.description} -> ${finding.preview}`);
        }
      }
      console.log(
        `Scansione segreti: ${tracked.scanned} file tracciati` +
          (history ? ` + ${historic.scanned} blob storici` : '') +
          ` -> ${findings.length} occorrenze`,
      );
    }
    process.exit(findings.length === 0 ? 0 : 1);
  } catch (error) {
    console.error(`Errore durante la scansione: ${error.message}`);
    process.exit(2);
  }
}

export default scanTrackedFiles;
