/**
 * Test dei controlli di sicurezza lato client: CSP, header, assenza di script
 * inline, pinning dei file (SRI statici) e resilienza all'iniezione di markup.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONTENT_SECURITY_POLICY, CONTENT_SECURITY_POLICY_META, securityHeaders } from '../../scripts/serve.js';
import { verifyManifest } from '../../scripts/sri.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const www = join(root, 'www');
const indexHtml = readFileSync(join(www, 'index.html'), 'utf8');

function walk(dir, filter = () => true) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, filter));
    else if (filter(full)) out.push(full);
  }
  return out;
}

test('la CSP dichiara le direttive essenziali e vieta gli script inline', () => {
  const directives = Object.fromEntries(
    CONTENT_SECURITY_POLICY.split('; ').map((part) => {
      const [name, ...values] = part.split(' ');
      return [name, values.join(' ')];
    }),
  );

  assert.equal(directives['default-src'], "'self'");
  assert.equal(directives['script-src'], "'self'");
  assert.ok(!CONTENT_SECURITY_POLICY.includes("script-src 'self' 'unsafe-inline'"));
  assert.ok(!CONTENT_SECURITY_POLICY.includes("'unsafe-eval'"));
  assert.equal(directives['object-src'], "'none'");
  assert.equal(directives['base-uri'], "'self'");
  assert.equal(directives['frame-ancestors'], "'none'");
  assert.equal(directives['form-action'], "'none'");
  assert.match(directives['connect-src'], /https:/, 'deve poter contattare l’endpoint configurato');
});

test('il meta CSP di index.html coincide con la policy per il meta', () => {
  const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(indexHtml);
  assert.ok(meta, 'manca il meta CSP');
  assert.equal(meta[1], CONTENT_SECURITY_POLICY_META);
  // `frame-ancestors` vale solo come header: nel meta sarebbe inutile.
  assert.doesNotMatch(meta[1], /frame-ancestors/);
  assert.match(CONTENT_SECURITY_POLICY, /frame-ancestors 'none'/);
  assert.ok(CONTENT_SECURITY_POLICY.startsWith(CONTENT_SECURITY_POLICY_META));
});

test('base-uri è limitato all’origine, non disattivato', () => {
  assert.match(CONTENT_SECURITY_POLICY, /base-uri 'self'/);
  assert.doesNotMatch(CONTENT_SECURITY_POLICY, /base-uri 'none'/);
});

test('index.html non contiene script o stili inline', () => {
  const inlineScripts = [...indexHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1].trim())
    .filter((body) => body !== '');
  assert.deepEqual(inlineScripts, [], 'gli script inline violano la CSP');

  assert.doesNotMatch(indexHtml, /\son[a-z]+\s*=\s*"/i, 'niente handler inline (onclick, onerror, ...)');
  assert.doesNotMatch(indexHtml, /<style[\s>]/i);
  assert.match(indexHtml, /<script type="module" src="js\/app\.js"><\/script>/);
});

test('gli header di sicurezza del server statico coprono le difese principali', () => {
  const headers = securityHeaders();

  assert.match(headers['Content-Security-Policy'], /default-src 'self'/);
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['Referrer-Policy'], 'no-referrer');
  assert.match(headers['Permissions-Policy'], /geolocation=\(\)/);
  assert.equal(headers['Cross-Origin-Opener-Policy'], 'same-origin');
  assert.equal(headers['Strict-Transport-Security'], undefined, 'HSTS solo su HTTPS');

  const secure = securityHeaders({ https: true });
  assert.match(secure['Strict-Transport-Security'], /max-age=31536000; includeSubDomains/);
});

test('il codice dell’app non usa innerHTML, eval o document.write', () => {
  const files = walk(join(www, 'js'), (file) => file.endsWith('.js') && !file.includes('jquery'));
  files.push(join(www, 'sw.js'));

  const offenders = [];
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    if (/\b(innerHTML|outerHTML|document\.write|eval\s*\(|new Function\s*\()/.test(content)) {
      offenders.push(file.replace(root, '.'));
    }
  }
  assert.deepEqual(offenders, []);
});

test('i nomi delle schede sono trattati come testo, non come markup', () => {
  const app = readFileSync(join(www, 'js', 'app.js'), 'utf8');
  assert.match(app, /\$link\.text\(card\.nome\)/);
  assert.doesNotMatch(app, /"<li[^"]*"\s*\+\s*card\.nome/);
});

test('il pinning dei file (SRI) corrisponde a quanto è nel repository', () => {
  const result = verifyManifest();
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.changed, [], 'un file dell’app è cambiato: esegui npm run sri:update');
  assert.deepEqual(result.extra, []);
  assert.equal(result.ok, true);
});

test('il service worker non mette in cache richieste non GET né altre origini', () => {
  const sw = readFileSync(join(www, 'sw.js'), 'utf8');
  assert.match(sw, /request\.method !== 'GET'/);
  assert.match(sw, /url\.origin !== self\.location\.origin/);
  assert.match(sw, /caches\.delete\(key\)/);
});

test('nessun endpoint o credenziale è cablato nell’app', () => {
  const files = walk(www, (file) => /\.(js|html|json)$/.test(file) && !file.includes('jquery'));
  const offenders = files.filter((file) => /realtor\.dntppe\.net|ghp_|AKIA|BEGIN [A-Z ]*PRIVATE KEY/.test(readFileSync(file, 'utf8')));
  assert.deepEqual(offenders, []);
});
