/**
 * Realtor — cifratura dei backup (WebCrypto).
 *
 * Le schede contengono dati personali (indirizzi, prezzi, note). Il backup JSON
 * in chiaro è comodo ma leggibile da chiunque: questo modulo produce un
 * contenitore cifrato con password, portabile fra browser, PWA e Node.
 *
 * Algoritmi: **PBKDF2-SHA256** (310 000 iterazioni, salt casuale di 16 byte) per
 * derivare la chiave e **AES-256-GCM** (IV di 12 byte) per cifrare e autenticare.
 * Una password sbagliata o un file manomesso falliscono l'autenticazione GCM,
 * quindi non viene mai restituito testo parziale o corrotto.
 *
 * Modulo puro: nessuna dipendenza da DOM, jQuery o Cordova; `crypto` è
 * iniettabile per i test.
 *
 * MIT License — Copyright (c) 2014-2026 Donato Pepe (vedi LICENSE e NOTICE).
 */

/** Identificatore del formato cifrato. */
export const ENCRYPTED_FORMAT = 'realtor.backup.enc';

/** Versione del formato cifrato. */
export const ENCRYPTED_VERSION = 1;

/** Iterazioni PBKDF2 predefinite (raccomandazione OWASP per PBKDF2-SHA256). */
export const DEFAULT_ITERATIONS = 310000;

/** Lunghezza minima della password richiesta dalla UI. */
export const MIN_PASSWORD_LENGTH = 8;

/** Errore di cifratura/decifratura con codice stabile per i test. */
export class BackupCryptoError extends Error {
  /**
   * @param {string} message
   * @param {{code?:string, cause?:unknown}} [details]
   */
  constructor(message, { code = 'crypto_error', cause = null } = {}) {
    super(message);
    this.name = 'BackupCryptoError';
    this.code = code;
    this.cause = cause;
  }
}

/** WebCrypto disponibile? */
export function isCryptoAvailable(cryptoImpl = globalThis.crypto) {
  return Boolean(cryptoImpl && cryptoImpl.subtle && typeof cryptoImpl.getRandomValues === 'function');
}

function requireCrypto(cryptoImpl) {
  if (!isCryptoAvailable(cryptoImpl)) {
    throw new BackupCryptoError('Cifratura non disponibile in questo ambiente.', { code: 'unsupported' });
  }
  return cryptoImpl;
}

/** Codifica in base64 senza dipendere da Buffer (funziona in browser e Node). */
export function toBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

/** Decodifica base64. */
export function fromBase64(value) {
  const binary = atob(String(value));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Deriva una chiave AES-GCM da una password.
 * @param {string} password
 * @param {{salt:Uint8Array, iterations:number, cryptoImpl?:object}} options
 */
async function deriveKey(password, { salt, iterations, cryptoImpl }) {
  const crypto = requireCrypto(cryptoImpl);
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Cifra un testo con una password.
 * @param {string} plainText
 * @param {string} password
 * @param {{cryptoImpl?:object, iterations?:number, salt?:Uint8Array, iv?:Uint8Array}} [options]
 * @returns {Promise<object>} contenitore serializzabile in JSON
 */
export async function encryptText(plainText, password, { cryptoImpl = globalThis.crypto, iterations = DEFAULT_ITERATIONS, salt, iv } = {}) {
  const crypto = requireCrypto(cryptoImpl);
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new BackupCryptoError(`La password deve avere almeno ${MIN_PASSWORD_LENGTH} caratteri.`, {
      code: 'weak_password',
    });
  }

  const saltBytes = salt || crypto.getRandomValues(new Uint8Array(16));
  const ivBytes = iv || crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, { salt: saltBytes, iterations, cryptoImpl: crypto });
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ivBytes },
    key,
    new TextEncoder().encode(plainText),
  );

  return {
    format: ENCRYPTED_FORMAT,
    version: ENCRYPTED_VERSION,
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations,
      salt: toBase64(saltBytes),
    },
    cipher: {
      name: 'AES-GCM',
      length: 256,
      iv: toBase64(ivBytes),
    },
    data: toBase64(new Uint8Array(ciphertext)),
  };
}

/** `true` se il valore (stringa JSON o oggetto) è un contenitore cifrato Realtor. */
export function isEncryptedEnvelope(value) {
  let candidate = value;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text.startsWith('{')) return false;
    try {
      candidate = JSON.parse(text);
    } catch {
      return false;
    }
  }
  return Boolean(
    candidate &&
      typeof candidate === 'object' &&
      candidate.format === ENCRYPTED_FORMAT &&
      candidate.kdf &&
      candidate.cipher &&
      typeof candidate.data === 'string',
  );
}

/**
 * Decifra un contenitore prodotto da `encryptText`.
 * @param {object|string} envelope
 * @param {string} password
 * @param {{cryptoImpl?:object}} [options]
 * @returns {Promise<string>}
 */
export async function decryptText(envelope, password, { cryptoImpl = globalThis.crypto } = {}) {
  const crypto = requireCrypto(cryptoImpl);

  let parsed = envelope;
  if (typeof envelope === 'string') {
    try {
      parsed = JSON.parse(envelope);
    } catch (error) {
      throw new BackupCryptoError('Il contenuto cifrato non è JSON valido.', { code: 'invalid_envelope', cause: error });
    }
  }
  if (!isEncryptedEnvelope(parsed)) {
    throw new BackupCryptoError('Formato cifrato non riconosciuto.', { code: 'invalid_envelope' });
  }
  if (parsed.version !== ENCRYPTED_VERSION) {
    throw new BackupCryptoError(`Versione cifrata non supportata: ${parsed.version}.`, { code: 'unsupported_version' });
  }

  const iterations = Number(parsed.kdf.iterations);
  if (!Number.isFinite(iterations) || iterations < 10000) {
    throw new BackupCryptoError('Parametri di derivazione non validi.', { code: 'invalid_envelope' });
  }

  try {
    const key = await deriveKey(password, {
      salt: fromBase64(parsed.kdf.salt),
      iterations,
      cryptoImpl: crypto,
    });
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(parsed.cipher.iv) },
      key,
      fromBase64(parsed.data),
    );
    return new TextDecoder().decode(plain);
  } catch (error) {
    throw new BackupCryptoError('Password errata o file cifrato danneggiato.', {
      code: 'wrong_password',
      cause: error,
    });
  }
}
