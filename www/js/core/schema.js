/**
 * Realtor — schema e validazione della scheda immobiliare.
 *
 * Modulo puro: nessuna dipendenza da DOM, jQuery o Cordova, quindi eseguibile
 * sia nel WebView sia in Node per i test.
 *
 * MIT License — Copyright (c) 2014-2026 Donato Pepe (vedi LICENSE e NOTICE).
 */

/** Versione dello schema della scheda salvata nello storage. */
export const CARD_VERSION = 1;

/** Campi della scheda, nell'ordine usato dal form. */
export const CARD_FIELDS = Object.freeze(['nome', 'indirizzo', 'descrizione', 'prezzo']);

/** Lunghezze massime dei campi (caratteri). */
export const LIMITS = Object.freeze({
  nome: 80,
  indirizzo: 160,
  descrizione: 2000,
  prezzo: 40,
});

/**
 * Formati prezzo accettati:
 *  - interi: `150000`, `-1500`
 *  - migliaia con punto: `150.000`, `1.234.567`
 *  - decimali con virgola (IT) o punto (rimane accettato per compatibilità):
 *    `150.000,50`, `1500,50`, `1500.50`
 * Non sono ammessi simboli di valuta (vengono rimossi in normalizzazione).
 */
const PRICE_PATTERN = /^-?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:[.,]\d{1,2})?$/;

/**
 * Normalizza una stringa: trim, spazi multipli compattati, caratteri di
 * controllo rimossi. Valori non stringa diventano stringa vuota.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeField(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return '';
  return value
    // Rimozione dei caratteri di controllo (voluta): il campo diventa testo pulito.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalizza il prezzo: rimuove spazi e simboli di valuta.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizePrice(value) {
  return normalizeField(value).replace(/[\s€]/g, '');
}

/**
 * Crea una scheda vuota (o popolata dai valori passati, normalizzati).
 * @param {object} [init]
 * @returns {{version:number, nome:string, indirizzo:string, descrizione:string, prezzo:string}}
 */
export function createCard(init = {}) {
  return normalizeCard(init);
}

/**
 * Normalizza una scheda arbitraria nello schema corrente.
 * @param {object} [raw]
 * @returns {{version:number, nome:string, indirizzo:string, descrizione:string, prezzo:string}}
 */
export function normalizeCard(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const card = { version: CARD_VERSION };
  for (const field of CARD_FIELDS) {
    card[field] = normalizeField(source[field]);
  }
  card.prezzo = normalizePrice(source.prezzo);
  return card;
}

/**
 * Valida una scheda normalizzata.
 * @param {object} [card]
 * @returns {{valid:boolean, errors:Array<{field:string, code:string, message:string}>}}
 */
export function validateCard(card = {}) {
  const errors = [];
  const fields = normalizeCard(card);

  if (fields.nome === '') {
    errors.push({ field: 'nome', code: 'required', message: 'Il nome della scheda è obbligatorio.' });
  } else if (fields.nome.length > LIMITS.nome) {
    errors.push({ field: 'nome', code: 'too_long', message: `Il nome non può superare ${LIMITS.nome} caratteri.` });
  }

  if (fields.indirizzo.length > LIMITS.indirizzo) {
    errors.push({ field: 'indirizzo', code: 'too_long', message: `L'indirizzo non può superare ${LIMITS.indirizzo} caratteri.` });
  }

  if (fields.descrizione.length > LIMITS.descrizione) {
    errors.push({ field: 'descrizione', code: 'too_long', message: `La descrizione non può superare ${LIMITS.descrizione} caratteri.` });
  }

  if (fields.prezzo !== '' && !PRICE_PATTERN.test(fields.prezzo)) {
    errors.push({
      field: 'prezzo',
      code: 'invalid_format',
      message: 'Prezzo non valido: usa un numero, ad esempio 150000 oppure 150.000,50.',
    });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Converte un prezzo testuale in numero.
 * Gestisce il separatore delle migliaia (`.`) e quello decimale (`,` o `.`).
 * @param {unknown} value
 * @returns {number|null} `null` se vuoto o non interpretabile
 */
export function priceToNumber(value) {
  const raw = normalizePrice(value);
  if (raw === '') return null;

  const negative = raw.startsWith('-');
  let digits = negative ? raw.slice(1) : raw;
  if (!PRICE_PATTERN.test(raw)) return null;

  if (digits.includes(',')) {
    digits = digits.replace(/\./g, '').replace(',', '.');
  } else if (digits.includes('.')) {
    const parts = digits.split('.');
    const last = parts[parts.length - 1];
    const looksLikeThousands = parts.length > 1 && last.length === 3 && parts[0].length <= 3;
    if (looksLikeThousands) digits = parts.join('');
  }

  const parsed = Number(digits);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

/**
 * Formatta un prezzo (numero o testo) in stile italiano: `1.234,50`.
 * @param {number|string} value
 * @returns {string} stringa vuota se il valore non è interpretabile
 */
export function formatPrice(value) {
  const amount = typeof value === 'number' ? value : priceToNumber(value);
  if (amount === null || !Number.isFinite(amount)) return '';
  return amount.toLocaleString('it-IT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
