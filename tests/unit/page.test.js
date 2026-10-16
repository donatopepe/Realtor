/**
 * Test strutturali della pagina e dei moduli: verificano che il markup punti ai
 * file giusti, che non ci siano riferimenti al vecchio entry point, che i file
 * siano UTF-8 validi e che i moduli si importino senza errori di sintassi.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const www = join(root, 'www');
const indexPath = join(www, 'index.html');
const indexHtml = readFileSync(indexPath, 'utf8');

/** Elenca ricorsivamente i file di una cartella. */
function walk(dir, filter = () => true) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, filter));
    else if (filter(full)) out.push(full);
  }
  return out;
}

test('index.html carica l’app come modulo ES e non il vecchio js/index.js', () => {
  assert.match(indexHtml, /<script type="module" src="js\/app\.js"><\/script>/);
  assert.doesNotMatch(indexHtml, /js\/index\.js/);
  assert.doesNotMatch(indexHtml, /app\.initialize\(\)/);
});

test('index.html carica cordova e jQuery Mobile nell’ordine corretto', () => {
  const order = ['cordova.js', 'jquery-2.1.0.min.js', 'mobileinit', 'jquery.mobile-1.4.2.min.js', 'js/app.js'];
  let cursor = -1;
  for (const needle of order) {
    const at = indexHtml.indexOf(needle);
    assert.notEqual(at, -1, `manca ${needle}`);
    assert.ok(at > cursor, `${needle} è fuori ordine`);
    cursor = at;
  }
});

test('tutte le risorse locali referenziate da index.html esistono', () => {
  const references = [...indexHtml.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
  const missing = references
    .filter((ref) => !/^(#|https?:|mailto:|tel:|javascript:)/.test(ref))
    .filter((ref) => ref !== 'cordova.js') // iniettato da Cordova a build time
    .filter((ref) => {
      try {
        return !statSync(join(www, ref)).isFile();
      } catch {
        return true;
      }
    });
  assert.deepEqual(missing, []);
});

test('la pagina non contiene più il codice morto del template', () => {
  assert.doesNotMatch(indexHtml, /id="deviceready"/);
  assert.doesNotMatch(indexHtml, /Connecting to Device/);
});

test('nessun carattere corrotto (U+FFFD) nei file testuali di www/', () => {
  const files = walk(www, (file) => /\.(js|html|css|json|webmanifest)$/.test(file));
  const broken = files.filter((file) => readFileSync(file, 'utf8').includes('\uFFFD'));
  assert.deepEqual(broken, []);
});

test('nessun endpoint hardcoded nel codice dell’app', () => {
  const files = walk(join(www, 'js'), (file) => file.endsWith('.js') && !file.includes('jquery'));
  const offenders = files.filter((file) => /realtor\.dntppe\.net|http:\/\//.test(readFileSync(file, 'utf8')));
  assert.deepEqual(offenders, []);
});

test('i moduli core e l’app si importano senza errori e espongono l’API attesa', async () => {
  const schema = await import(pathToFileURL(join(www, 'js/core/schema.js')).href);
  const storage = await import(pathToFileURL(join(www, 'js/core/storage.js')).href);
  const api = await import(pathToFileURL(join(www, 'js/core/api.js')).href);
  const platform = await import(pathToFileURL(join(www, 'js/platform.js')).href);
  const app = await import(pathToFileURL(join(www, 'js/app.js')).href);

  assert.equal(typeof schema.validateCard, 'function');
  assert.equal(typeof storage.createCardStore, 'function');
  assert.equal(typeof api.createApiClient, 'function');
  assert.equal(typeof platform.createPlatform, 'function');
  assert.equal(typeof app.createApp, 'function');
  assert.equal(typeof app.boot, 'function');
  assert.equal(typeof app.default, 'function');
});

test('il core non dipende da jQuery, Cordova o window.localStorage', () => {
  const files = walk(join(www, 'js/core'), (file) => file.endsWith('.js'));
  assert.ok(files.length >= 3);
  const offenders = files.filter((file) => /jquery|cordova|window\.localStorage/.test(readFileSync(file, 'utf8')));
  assert.deepEqual(offenders, []);
});

test('ogni selettore usato da app.js esiste in index.html', () => {
  const appSource = readFileSync(join(www, 'js/app.js'), 'utf8');
  const ids = new Set([...appSource.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map((match) => match[1]));
  assert.ok(ids.size >= 10, `trovati solo ${ids.size} selettori`);
  const missing = [...ids].filter((id) => !indexHtml.includes(`id="${id}"`));
  assert.deepEqual(missing, [], 'selettori senza elemento nel markup');
});
