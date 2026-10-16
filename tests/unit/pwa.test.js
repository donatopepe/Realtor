/**
 * Test cross-platform: PWA/web, config.xml multi-piattaforma e risorse native.
 *
 * Verifica che lo stesso sorgente `www/` sia utilizzabile su Android, iOS e
 * browser e che gli asset dichiarati esistano davvero.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const www = join(root, 'www');

const manifest = JSON.parse(readFileSync(join(www, 'manifest.webmanifest'), 'utf8'));
const indexHtml = readFileSync(join(www, 'index.html'), 'utf8');
const config = readFileSync(join(root, 'config.xml'), 'utf8');

/**
 * Legge le dimensioni reali di un PNG dai byte dell'header IHDR.
 * @param {string} file
 * @returns {{width:number, height:number}}
 */
function pngSize(file) {
  const buffer = readFileSync(file);
  const signature = buffer.subarray(0, 8).toString('hex');
  assert.equal(signature, '89504e470d0a1a0a', `${file} non è un PNG`);
  assert.equal(buffer.subarray(12, 16).toString('ascii'), 'IHDR', `${file} senza chunk IHDR`);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test('manifest PWA: campi obbligatori e coerenza con l’app', () => {
  assert.equal(manifest.short_name, 'Realtor');
  assert.match(manifest.name, /Realtor/);
  assert.equal(manifest.lang, 'it');
  assert.equal(manifest.start_url, '.');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.scope, '.');
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
  assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
});

test('manifest PWA: le icone dichiarate esistono con le dimensioni indicate', () => {
  const purposes = new Set();
  for (const icon of manifest.icons) {
    const file = join(www, icon.src);
    assert.ok(statSync(file).isFile(), `icona mancante: ${icon.src}`);
    assert.equal(icon.type, 'image/png');
    const { width, height } = pngSize(file);
    assert.equal(`${width}x${height}`, icon.sizes, `dimensioni errate per ${icon.src}`);
    purposes.add(icon.purpose);
  }
  assert.ok(purposes.has('any'), 'serve almeno un’icona purpose=any');
  assert.ok(purposes.has('maskable'), 'serve un’icona purpose=maskable per Android');
});

test('index.html collega manifest, icone e meta per l’installazione su ogni piattaforma', () => {
  assert.match(indexHtml, /<link rel="manifest" href="manifest\.webmanifest" \/>/);
  assert.match(indexHtml, /<meta name="theme-color" content="#1d1d1d" \/>/);
  assert.match(indexHtml, /<link rel="icon" type="image\/png" sizes="32x32" href="img\/favicon-32\.png" \/>/);
  assert.match(indexHtml, /<link rel="apple-touch-icon" sizes="180x180" href="img\/apple-touch-icon-180\.png" \/>/);
  assert.match(indexHtml, /name="apple-mobile-web-app-capable"/);
  assert.match(indexHtml, /viewport-fit=cover/);
});

test('config.xml: identità dell’app allineata a package.json', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.match(config, /<widget id="net\.dntppe\.realtor" version="1\.0\.0"/);
  assert.match(config, new RegExp(`version="${pkg.version.replace(/\./g, '\\.')}"`));
  assert.match(config, /<content src="index\.html" \/>/);
  assert.match(config, /<access origin="\*" \/>/);
  assert.doesNotMatch(config, /realtor\.dntppe\.net/);
});

test('config.xml dichiara le piattaforme android, ios e browser', () => {
  for (const platform of ['android', 'ios', 'browser']) {
    assert.match(config, new RegExp(`<platform name="${platform}">`), `manca la piattaforma ${platform}`);
  }
  assert.match(config, /android-minSdkVersion" value="24"/);
  assert.match(config, /android-targetSdkVersion" value="35"/);
  assert.match(config, /deployment-target" value="13\.0"/);
  assert.match(config, /WKWebViewOnly" value="true"/);
});

test('config.xml: le icone native dichiarate esistono e sono PNG validi', () => {
  const sources = [...config.matchAll(/<icon[^>]*src="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(sources.length >= 20, `attese icone per Android e iOS, trovate ${sources.length}`);
  for (const source of sources) {
    const file = join(root, source);
    assert.ok(statSync(file).isFile(), `icona dichiarata ma assente: ${source}`);
    const { width } = pngSize(file);
    assert.ok(width > 0, `icona senza dimensioni: ${source}`);
  }
});

test('gli asset nativi coprono le densità Android e il set iOS', () => {
  const androidDir = join(root, 'resources/android');
  const iosDir = join(root, 'resources/ios');
  const densities = { ldpi: 36, mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const [density, size] of Object.entries(densities)) {
    const file = join(androidDir, `icon-${density}.png`);
    assert.equal(pngSize(file).width, size, `densità ${density} con lato errato`);
  }
  const iosFiles = readdirSync(iosDir).filter((file) => file.endsWith('.png'));
  assert.ok(iosFiles.length >= 15, `set iOS incompleto: ${iosFiles.length} file`);
  assert.equal(pngSize(join(iosDir, 'AppIcon-1024.png')).width, 1024);
});

/**
 * Rimuove commenti di blocco e di riga, per verificare solo il codice.
 * @param {string} source
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('il codice dell’app è platform-agnostico: solo feature detection', () => {
  const appFiles = [
    join(www, 'js/app.js'),
    join(www, 'js/core/schema.js'),
    join(www, 'js/core/storage.js'),
    join(www, 'js/core/api.js'),
    join(www, 'js/core/settings.js'),
    join(www, 'js/core/backup.js'),
    join(www, 'js/core/migration.js'),
  ];
  for (const file of appFiles) {
    const content = stripComments(readFileSync(file, 'utf8'));
    assert.doesNotMatch(content, /cordova\.platformId/, `${file} usa cordova.platformId`);
    assert.doesNotMatch(content, /window\.Android/, `${file} usa window.Android`);
    assert.doesNotMatch(content, /\b(android|ios)\b/i, `${file} contiene logica specifica di piattaforma`);
  }
  // La rilevazione della piattaforma è isolata nell'adapter.
  const platform = readFileSync(join(www, 'js/platform.js'), 'utf8');
  assert.match(platform, /iPad\|iPhone\|iPod/);
  assert.match(platform, /canExit/);
});

test('il manifest non referenzia asset inesistenti', () => {
  const icons = manifest.icons.map((icon) => icon.src);
  for (const icon of icons) {
    assert.ok(statSync(join(www, icon)).isFile(), `icona non trovata: ${icon}`);
  }
});

test('service worker: app shell completa e strategia conservativa', () => {
  const source = readFileSync(join(www, 'sw.js'), 'utf8');

  // Tutti i file dell'app shell devono esistere davvero.
  const shell = [...source.matchAll(/'(\.[^']*)'/g)].map((match) => match[1]);
  assert.ok(shell.length >= 10, `app shell troppo corta: ${shell.length} voci`);
  for (const entry of shell) {
    const relative = entry.replace(/^\.\//, '') || 'index.html';
    assert.ok(statSync(join(www, relative)).isFile(), `file dell'app shell mancante: ${entry}`);
  }

  // Non intercetta POST (invio schede) né richieste verso l'API dell'utente.
  assert.match(source, /request\.method !== 'GET'/);
  assert.match(source, /url\.origin !== self\.location\.origin/);
  assert.match(source, /caches\.delete\(key\)/);
});

test('l’app registra il service worker solo su http/https', () => {
  const source = readFileSync(join(www, 'js/app.js'), 'utf8');
  assert.match(source, /serviceWorker\.register\('sw\.js'\)/);
  assert.match(source, /\^https\?\$|https\?:/);
});

test('gli screenshot per la documentazione esistono', () => {
  for (const name of ['home.png', 'scheda.png', 'elenco.png', 'impostazioni.png']) {
    const file = join(root, 'docs', 'screenshots', name);
    assert.ok(statSync(file).isFile(), `screenshot mancante: ${name}`);
    const { width, height } = pngSize(file);
    assert.ok(width >= 600 && height >= 400, `screenshot troppo piccolo: ${name}`);
  }
});
