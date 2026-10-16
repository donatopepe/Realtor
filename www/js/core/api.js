/**
 * Realtor — client HTTP per l'invio delle schede.
 *
 * `fetch` è iniettabile: nel WebView usa quello globale, nei test una funzione
 * finta. L'endpoint non è mai cablato nel codice: arriva dalla configurazione
 * (pagina Impostazioni), con stringa vuota = modalità solo offline.
 *
 * MIT License — Copyright (c) 2014-2026 Donato Pepe (vedi LICENSE e NOTICE).
 */

/** Errore di invio con dettagli utili alla UI e ai test. */
export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {{status?:number, body?:unknown, url?:string, cause?:unknown}} [details]
   */
  constructor(message, { status = 0, body = null, url = '', cause = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.url = url;
    this.cause = cause;
  }

  /** `true` se il server ha risposto (anche con errore HTTP). */
  get responded() {
    return this.status > 0;
  }
}

/** Timeout predefinito dell'invio, in millisecondi. */
export const DEFAULT_TIMEOUT_MS = 10000;

function parseBody(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Crea il client API.
 * @param {{baseUrl?:string, fetchImpl?:Function, timeoutMs?:number}} [options]
 * @returns {{
 *   endpoint: () => string,
 *   isConfigured: () => boolean,
 *   setBaseUrl: (url:string) => void,
 *   sendCards: (cards:object[]|object, options?:{signal?:AbortSignal}) => Promise<{status:number, body:unknown, count:number}>
 * }}
 */
export function createApiClient({ baseUrl = '', fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let currentUrl = String(baseUrl ?? '').trim();
  const doFetch = fetchImpl || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);

  const endpoint = () => currentUrl;
  const isConfigured = () => currentUrl !== '';

  function setBaseUrl(url) {
    currentUrl = String(url ?? '').trim();
    return currentUrl;
  }

  /**
   * Invia una o più schede come JSON.
   * Risolve solo con risposta 2xx: in ogni altro caso lancia `ApiError`,
   * così il chiamante non rimuove dati locali.
   * @param {object[]|object} cards
   * @param {{signal?:AbortSignal}} [options]
   */
  async function sendCards(cards, { signal } = {}) {
    const url = endpoint();
    if (url === '') {
      throw new ApiError('Endpoint API non configurato: le schede restano in locale.', { url });
    }
    if (typeof doFetch !== 'function') {
      throw new ApiError('fetch non disponibile in questo ambiente.', { url });
    }

    const payload = Array.isArray(cards) ? cards : [cards];
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const response = await doFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: signal || (controller ? controller.signal : undefined),
        mode: 'cors',
        credentials: 'omit',
      });

      const raw = typeof response.text === 'function' ? await response.text() : '';
      if (!response.ok) {
        throw new ApiError(`Invio non riuscito (HTTP ${response.status}).`, {
          status: response.status,
          body: parseBody(raw),
          url,
        });
      }
      return { status: response.status, body: parseBody(raw), count: payload.length };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error && error.name === 'AbortError') {
        throw new ApiError(`Timeout dell'invio dopo ${timeoutMs} ms.`, { url, cause: error });
      }
      throw new ApiError("Errore di rete durante l'invio.", { url, cause: error });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return { endpoint, isConfigured, setBaseUrl, sendCards };
}
