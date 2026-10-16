/**
 * Doppi di test condivisi (storage in memoria, fetch finta).
 * MIT License — Copyright (c) 2014-2026 Donato Pepe.
 */

/**
 * Storage con la stessa interfaccia di `window.localStorage`, in memoria.
 * @param {Record<string,string>} [initial]
 */
export function createMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    key(index) {
      const keys = Array.from(map.keys());
      return index >= 0 && index < keys.length ? keys[index] : null;
    },
    getItem(key) {
      const value = map.get(String(key));
      return value === undefined ? null : value;
    },
    setItem(key, value) {
      map.set(String(key), String(value));
    },
    removeItem(key) {
      map.delete(String(key));
    },
    clear() {
      map.clear();
    },
    /** Snapshot per le asserzioni. */
    dump() {
      return Object.fromEntries(map);
    },
  };
}

/**
 * `fetch` finta che registra le chiamate.
 * @param {(url:string, options:object, callIndex:number) => ({status?:number, body?:string, ok?:boolean})|Promise<any>} handler
 */
export function createFetchFake(handler = () => ({ status: 200, body: '{"ok":true}' })) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    const result = (await handler(url, options, calls.length)) || {};
    const status = result.status ?? 200;
    const body = result.body ?? '';
    return {
      ok: result.ok ?? (status >= 200 && status < 300),
      status,
      statusText: result.statusText ?? '',
      text: async () => body,
      json: async () => JSON.parse(body),
    };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

/** `fetch` finta che non risponde mai e rispetta `AbortSignal` (per i timeout). */
export function createNeverResolvingFetch() {
  const calls = [];
  const fetchImpl = (url, options = {}) => {
    calls.push({ url, options });
    return new Promise((resolve, reject) => {
      const signal = options.signal;
      if (!signal) return;
      if (signal.aborted) {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        return;
      }
      signal.addEventListener('abort', () => {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

/** `window` finto minimale per `createPlatform`. */
export function createFakeWindow({ notification, connection, Connection, onLine, cordova } = {}) {
  const listeners = new Map();
  const win = {
    alerts: [],
    confirms: [],
    closed: false,
    alert(message) {
      win.alerts.push(message);
    },
    confirm(message) {
      win.confirms.push(message);
      return Boolean(win.confirmAnswer);
    },
    confirmAnswer: true,
    close() {
      win.closed = true;
    },
    document: {
      addEventListener(event, handler) {
        listeners.set(event, handler);
      },
    },
    navigator: {
      onLine,
      connection: connection ? { type: connection } : undefined,
      Connection,
      notification,
    },
  };
  if (cordova !== undefined) win.cordova = cordova;
  win.listeners = listeners;
  return win;
}
