/**
 * Test unitari della cifratura dei backup (WebCrypto: PBKDF2-SHA256 + AES-256-GCM).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BackupCryptoError,
  DEFAULT_ITERATIONS,
  ENCRYPTED_FORMAT,
  ENCRYPTED_VERSION,
  decryptText,
  encryptText,
  fromBase64,
  isCryptoAvailable,
  isEncryptedEnvelope,
  toBase64,
} from '../../www/js/core/crypto.js';

const PASSWORD = 'password-di-test-123';
const ITERATIONS = 20000; // ridotte nei test: la cifratura resta reale, il tempo no

test('WebCrypto è disponibile in questo ambiente', () => {
  assert.equal(isCryptoAvailable(), true);
});

test('base64: andata e ritorno su dati binari e lunghi', () => {
  const bytes = new Uint8Array(70000).map((_, index) => index % 256);
  const decoded = fromBase64(toBase64(bytes));
  assert.equal(decoded.length, bytes.length);
  assert.deepEqual(Array.from(decoded.subarray(0, 8)), Array.from(bytes.subarray(0, 8)));
  assert.deepEqual(Array.from(decoded.subarray(-8)), Array.from(bytes.subarray(-8)));
});

test('il contenitore cifrato ha formato, parametri KDF e cifrario dichiarati', async () => {
  const envelope = await encryptText('{"cards":[]}', PASSWORD, { iterations: ITERATIONS });

  assert.equal(envelope.format, ENCRYPTED_FORMAT);
  assert.equal(envelope.version, ENCRYPTED_VERSION);
  assert.equal(envelope.kdf.name, 'PBKDF2');
  assert.equal(envelope.kdf.hash, 'SHA-256');
  assert.equal(envelope.kdf.iterations, ITERATIONS);
  assert.equal(envelope.cipher.name, 'AES-GCM');
  assert.equal(envelope.cipher.length, 256);
  assert.ok(envelope.kdf.salt.length > 0);
  assert.ok(envelope.cipher.iv.length > 0);
  assert.ok(!JSON.stringify(envelope).includes('cards'));
  assert.ok(DEFAULT_ITERATIONS >= 300000, 'iterazioni predefinite troppo basse');
});

test('cifratura e decifratura fanno round-trip', async () => {
  const plain = JSON.stringify({ cards: [{ nome: 'Attico', prezzo: '150.000,50' }] });
  const envelope = await encryptText(plain, PASSWORD, { iterations: ITERATIONS });
  assert.equal(await decryptText(envelope, PASSWORD), plain);
  assert.equal(await decryptText(JSON.stringify(envelope), PASSWORD), plain);
});

test('il salt e l’IV cambiano a ogni esportazione (nessuna riutilizzazione)', async () => {
  const first = await encryptText('contenuto', PASSWORD, { iterations: ITERATIONS });
  const second = await encryptText('contenuto', PASSWORD, { iterations: ITERATIONS });
  assert.notEqual(first.kdf.salt, second.kdf.salt);
  assert.notEqual(first.cipher.iv, second.cipher.iv);
  assert.notEqual(first.data, second.data);
});

test('password errata: errore esplicito, nessun dato parziale', async () => {
  const envelope = await encryptText('contenuto segreto', PASSWORD, { iterations: ITERATIONS });
  await assert.rejects(decryptText(envelope, 'password-sbagliata-1'), (error) => {
    assert.ok(error instanceof BackupCryptoError);
    assert.equal(error.code, 'wrong_password');
    return true;
  });
});

test('dato cifrato manomesso: autenticazione GCM fallita', async () => {
  const envelope = await encryptText('contenuto', PASSWORD, { iterations: ITERATIONS });
  const bytes = fromBase64(envelope.data);
  bytes[0] ^= 0x01;
  envelope.data = toBase64(bytes);

  await assert.rejects(decryptText(envelope, PASSWORD), (error) => {
    assert.equal(error.code, 'wrong_password');
    return true;
  });
});

test('contenitori non validi vengono rifiutati', async () => {
  const invalidInputs = [
    'non-json',
    '42',
    'null',
    JSON.stringify({ format: 'altro', data: 'x' }),
    JSON.stringify({ format: ENCRYPTED_FORMAT, version: 1, data: 'x' }),
    JSON.stringify({ format: ENCRYPTED_FORMAT, version: 1, kdf: { iterations: 1 }, cipher: {}, data: 'x' }),
    JSON.stringify({
      format: ENCRYPTED_FORMAT,
      version: 99,
      kdf: { iterations: ITERATIONS, salt: 'AA==' },
      cipher: { iv: 'AA==' },
      data: 'AA==',
    }),
  ];
  for (const input of invalidInputs) {
    await assert.rejects(decryptText(input, PASSWORD), (error) => {
      assert.ok(error instanceof BackupCryptoError);
      assert.ok(['invalid_envelope', 'unsupported_version'].includes(error.code), `codice inatteso: ${error.code}`);
      return true;
    });
  }
});

test('password troppo corta viene rifiutata in cifratura', async () => {
  await assert.rejects(encryptText('contenuto', 'corta', { iterations: ITERATIONS }), (error) => {
    assert.equal(error.code, 'weak_password');
    return true;
  });
});

test('isEncryptedEnvelope riconosce solo i contenitori Realtor', async () => {
  const envelope = await encryptText('contenuto', PASSWORD, { iterations: ITERATIONS });
  assert.equal(isEncryptedEnvelope(envelope), true);
  assert.equal(isEncryptedEnvelope(JSON.stringify(envelope)), true);
  assert.equal(isEncryptedEnvelope('{"format":"realtor.backup","cards":[]}'), false);
  assert.equal(isEncryptedEnvelope(''), false);
  assert.equal(isEncryptedEnvelope('{non-json'), false);
  assert.equal(isEncryptedEnvelope(null), false);
});

test('senza WebCrypto l’errore è esplicito', async () => {
  await assert.rejects(encryptText('x', PASSWORD, { cryptoImpl: {}, iterations: ITERATIONS }), (error) => {
    assert.equal(error.code, 'unsupported');
    return true;
  });
});
