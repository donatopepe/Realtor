/**
 * Realtor — adapter di piattaforma.
 *
 * Incapsula le API Cordova (`navigator.notification`, `navigator.connection`,
 * `navigator.app`) con fallback web equivalenti, così la stessa UI funziona nel
 * WebView, nel browser e nei test.
 *
 * MIT License — Copyright (c) 2014-2026 Donato Pepe (vedi LICENSE e NOTICE).
 */

/**
 * Crea l'adapter di piattaforma.
 * @param {{win?: object}} [options]
 */
export function createPlatform({ win = typeof window !== 'undefined' ? window : globalThis } = {}) {
  const nav = win.navigator || {};
  const doc = win.document || null;
  const notification = nav.notification || null;

  /** `true` quando gira dentro Cordova. */
  function isCordova() {
    return typeof win.cordova !== 'undefined';
  }

  /**
   * Piattaforma corrente, dedotta senza richiedere plugin.
   * @returns {'android'|'ios'|'cordova'|'web'}
   */
  function platformName() {
    const ua = String(nav.userAgent || '');
    if (!isCordova()) return 'web';
    if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
    if (/Android/.test(ua)) return 'android';
    return 'cordova';
  }

  /**
   * `true` se la piattaforma permette di chiudere l'app dal codice.
   * iOS e browser non lo permettono: la UI nasconde il pulsante di uscita.
   */
  function canExit() {
    return Boolean(nav.app && typeof nav.app.exitApp === 'function');
  }

  /** Messaggio informativo (Cordova `notification.alert` o `window.alert`). */
  function alert(message, title = 'Informazione') {
    if (notification && typeof notification.alert === 'function') {
      try {
        notification.alert(String(message), () => {}, String(title), 'OK');
        return Promise.resolve();
      } catch {
        /* fallback sotto */
      }
    }
    if (typeof win.alert === 'function') win.alert(`${title}\n\n${message}`);
    return Promise.resolve();
  }

  /**
   * Richiesta di conferma.
   * @param {string} message
   * @param {{title?:string, ok?:string, cancel?:string}} [options]
   * @returns {Promise<boolean>}
   */
  function confirm(message, { title = 'Conferma', ok = 'Si', cancel = 'No' } = {}) {
    if (notification && typeof notification.confirm === 'function') {
      return new Promise((resolve) => {
        try {
          notification.confirm(
            String(message),
            (buttonIndex) => resolve(Number(buttonIndex) === 1),
            String(title),
            `${ok},${cancel}`,
          );
        } catch {
          resolve(Boolean(typeof win.confirm === 'function' ? win.confirm(`${title}\n\n${message}`) : false));
        }
      });
    }
    const answer = typeof win.confirm === 'function' ? win.confirm(`${title}\n\n${message}`) : false;
    return Promise.resolve(Boolean(answer));
  }

  /**
   * Stato della connessione. In assenza di plugin usa `navigator.onLine`,
   * e se nemmeno quello è disponibile assume online (ottimistico).
   * @returns {boolean}
   */
  function isOnline() {
    const connection = nav.connection;
    if (connection && typeof connection.type === 'string' && nav.Connection) {
      return connection.type !== nav.Connection.NONE;
    }
    if (typeof nav.onLine === 'boolean') return nav.onLine;
    return true;
  }

  /**
   * Chiude l'app (solo Android con plugin attivo).
   * @returns {boolean} `false` se la piattaforma non lo consente
   */
  function exit() {
    if (!canExit()) return false;
    nav.app.exitApp();
    return true;
  }

  /**
   * Registra un listener su `document`, se disponibile.
   * @param {string} event
   * @param {Function} handler
   */
  function on(event, handler) {
    if (doc && typeof doc.addEventListener === 'function') doc.addEventListener(event, handler, false);
  }

  return { isCordova, platformName, canExit, alert, confirm, isOnline, exit, on };
}
