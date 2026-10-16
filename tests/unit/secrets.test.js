/**
 * Test dello scanner dei segreti e gate di igiene: nessun segreto nel
 * working tree tracciato né nella storia git.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { looksBinary, redact, scanHistory, scanText, scanTrackedFiles } from '../../scripts/scan-secrets.js';

test('rileva le chiavi private', () => {
  const findings = scanText('chiave:\n-----BEGIN RSA PRIVATE KEY-----\nMIIEow==\n');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].pattern, 'private-key');
  assert.equal(findings[0].line, 2);
});

test('rileva i token dei provider più comuni', () => {
  const cases = [
    ['aws-access-key-id', 'AKIAIOSFODNN7EXAMPLE'],
    ['github-token', `ghp_${'A'.repeat(36)}`],
    ['google-api-key', `AIza${'b'.repeat(35)}`],
    ['slack-token', 'xoxb-1234567890-abcdefghij'],
    ['stripe-key', 'sk_live_abcdEFGH12345678'],
  ];
  for (const [pattern, value] of cases) {
    const findings = scanText(`const x = "${value}";`);
    assert.ok(
      findings.some((finding) => finding.pattern === pattern),
      `non rilevato ${pattern}`,
    );
  }
});

test('rileva credenziali assegnate, bearer, JWT e keystore', () => {
  const samples = [
    ['assigned-credential', 'password = "S3cr3t-di-produzione"'],
    ['assigned-credential', 'apiKey: "9f8a7b6c5d4e3f2a1b0c"'],
    ['bearer-literal', 'headers: { Authorization: "Bearer abcdefghijklmnopqrstuvwxyz123456" }'],
    ['jwt', `token=${'eyJhbGciOiJIUzI1NiJ9'}.${'eyJzdWIiOiIxMjM0In0'}.${'dQw4w9WgXcQdQw4w9WgXcQ'}`],
    ['keystore-password', 'storePassword=S3gr3t0'],
    ['keystore-password', 'keyPassword: altroSegreto'],
    ['npm-auth-token', '//registry.npmjs.org/:_authToken=npm_abcdef123456'],
    ['private-key', '-----BEGIN OPENSSH PRIVATE KEY-----'],
  ];
  for (const [pattern, line] of samples) {
    const findings = scanText(line);
    assert.ok(
      findings.some((finding) => finding.pattern === pattern),
      `non rilevato ${pattern} in: ${line}`,
    );
  }
});

test('rileva le credenziali dentro un URL', () => {
  const findings = scanText('const url = "https://deploy:superSegreto123@example.test/api";');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].pattern, 'basic-auth-url');
});

test('non segnala placeholder, documentazione o variabili d’ambiente', () => {
  const safe = [
    'password = "example"',
    'password: "cambiami"',
    'const apiKey = process.env.API_KEY;',
    'const secret = import.meta.env.SECRET;',
    'api_key = "your-api-key-here"',
    'token = "placeholder"',
    '//     [0]: http://jblas:password@mycompany.com:8080/mail/inbox?msg=1234',
    '// vedi docs: password = "xxxxxxxx"',
    '',
  ];
  for (const line of safe) {
    assert.deepEqual(scanText(line), [], `falso positivo su: ${line}`);
  }
});

test('non segnala password di keystore prese da variabili d’ambiente o segnaposto', () => {
  const safe = [
    'storePassword=$ANDROID_STORE_PASSWORD',
    'keyPassword=$ANDROID_KEY_PASSWORD',
    'storePassword=...',
    'keyPassword=xxxxxxxx',
    'storePassword=CHANGE_ME',
  ];
  for (const line of safe) {
    assert.deepEqual(scanText(line), [], `falso positivo su: ${line}`);
  }
  assert.ok(scanText('storePassword=S3gr3t0').some((f) => f.pattern === 'keystore-password'));
});

test('redact non mostra mai il valore completo', () => {
  const redacted = redact('S3cr3t-di-produzione');
  assert.ok(redacted.startsWith('S3cr'));
  assert.ok(!redacted.includes('produzione'));
  assert.match(redacted, /\(20\)$/);
  assert.equal(redact('abc'), '*** (3)');
});

test('looksBinary riconosce i file binari', () => {
  assert.equal(looksBinary(Buffer.from('testo normale')), false);
  assert.equal(looksBinary(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01])), true);
});

test('gate: nessun segreto nei file tracciati', () => {
  const { scanned, findings } = scanTrackedFiles();
  assert.ok(scanned > 100, `troppo pochi file analizzati: ${scanned}`);
  assert.deepEqual(findings, [], 'segreto trovato nei file tracciati');
});

test('gate: nessun segreto nella storia git', () => {
  const { scanned, findings } = scanHistory();
  assert.ok(scanned > 50, `troppo pochi blob analizzati: ${scanned}`);
  assert.deepEqual(findings, [], 'segreto trovato nella storia');
});
