/**
 * Realtor — impostazioni dell'applicazione.
 *
 * Le impostazioni vivono nello stesso storage delle schede ma con una chiave
 * riservata, così il repository delle schede non le vede. Nessun valore di
 * default punta a un server: stringa vuota = modalità solo offline.
 *
 * MIT License — Copyright (c) 2014-2026 Donato Pepe (vedi LICENSE e NOTICE).
 */

/** Chiave riservata delle impostazioni (fuori dal prefisso delle schede). */
export const SETTINGS_KEY = 'realtor.settings';

/** Versione dello schema delle impostazioni. */
export const SETTINGS_VERSION = 1;

/** Valori predefiniti: offline, nessun endpoint. */
export const DEFAULT_SETTINGS = Object.freeze({
  version: SETTINGS_VERSION,
  apiBaseUrl: '',
  apiTimeoutMs: 10000,
  migrateLegacyOnStart: true,
});

/**
 * Normalizza un URL di endpoint: spazi rimossi, slash finali eliminati.
 * Accetta solo URL con schema `http` o `https` (o stringa vuota per la modalità offline).
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeBaseUrl(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (raw === '') return '';
  return raw.replace(/\/+$/, '');
}

/**
 * Valida le impostazioni.
 * @param {object} [settings]
 * @returns {{valid:boolean, errors:Array<{field:string, code:string, message:string}>}}
 */
export function validateSettings(settings = {}) {
  const errors = [];
  const url = normalizeBaseUrl(settings.apiBaseUrl);

  if (url !== '' && !/^https?:\/\/[^\s/]+/i.test(url)) {
    errors.push({
      field: 'apiBaseUrl',
      code: 'invalid_url',
      message: "Endpoint non valido: usa un indirizzo completo, ad esempio https://esempio.tld/realtor/api/scheda.",
    });
  }

  const timeout = Number(settings.apiTimeoutMs);
  if (settings.apiTimeoutMs !== undefined && (!Number.isFinite(timeout) || timeout < 0)) {
    errors.push({
      field: 'apiTimeoutMs',
      code: 'invalid_timeout',
      message: 'Timeout non valido: indica un numero di millisecondi maggiore o uguale a zero.',
    });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Normalizza le impostazioni (default + tipi corretti).
 * @param {object} [raw]
 */
export function normalizeSettings(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const timeout = Number(source.apiTimeoutMs);
  return {
    version: SETTINGS_VERSION,
    apiBaseUrl: normalizeBaseUrl(source.apiBaseUrl),
    apiTimeoutMs: Number.isFinite(timeout) && timeout >= 0 ? timeout : DEFAULT_SETTINGS.apiTimeoutMs,
    migrateLegacyOnStart:
      typeof source.migrateLegacyOnStart === 'boolean' ? source.migrateLegacyOnStart : DEFAULT_SETTINGS.migrateLegacyOnStart,
  };
}

/**
 * Crea lo store delle impostazioni.
 * @param {{storage:object, key?:string}} options
 */
export function createSettingsStore({ storage, key = SETTINGS_KEY } = {}) {
  if (!storage || typeof storage.getItem !== 'function') {
    throw new TypeError('createSettingsStore: è richiesto uno storage con getItem/setItem.');
  }

  /** @returns {object} impostazioni correnti (default se assenti o corrotte) */
  function get() {
    const raw = storage.getItem(key);
    if (raw === null || raw === undefined) return { ...DEFAULT_SETTINGS };
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...DEFAULT_SETTINGS };
      return normalizeSettings(parsed);
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  /**
   * Salva le impostazioni (merge parziale).
   * @param {object} partial
   * @returns {object} impostazioni salvate
   * @throws {Error & {errors?: Array}} se non valide
   */
  function save(partial = {}) {
    const merged = normalizeSettings({ ...get(), ...partial });
    const { valid, errors } = validateSettings(merged);
    if (!valid) {
      const error = new Error(errors.map((item) => item.message).join(' '));
      error.name = 'ValidationError';
      error.errors = errors;
      throw error;
    }
    storage.setItem(key, JSON.stringify(merged));
    return merged;
  }

  /** Ripristina i valori predefiniti. */
  function reset() {
    storage.removeItem(key);
    return { ...DEFAULT_SETTINGS };
  }

  return {
    key,
    get,
    save,
    reset,
    isOffline: () => get().apiBaseUrl === '',
  };
}
