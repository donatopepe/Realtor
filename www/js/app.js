/**
 * Realtor — livello UI (jQuery Mobile) sopra il core testabile.
 *
 * Tutte le dipendenze (jQuery, storage, piattaforma, finestra) sono iniettate:
 * il modulo si importa senza effetti collaterali in Node e si avvia da solo nel
 * browser/WebView. Nessun ramo condizionale per piattaforma: le differenze sono
 * incapsulate in `platform.js`.
 *
 * MIT License — Copyright (c) 2014-2026 Donato Pepe (vedi LICENSE e NOTICE).
 * Porzioni derivate dal template Apache Cordova (Apache-2.0): vedi NOTICE.
 */

import { createApiClient } from './core/api.js';
import { decryptText, encryptText, isEncryptedEnvelope, MIN_PASSWORD_LENGTH } from './core/crypto.js';
import { createBackup } from './core/backup.js';
import { migrateLegacy } from './core/migration.js';
import { createSettingsStore } from './core/settings.js';
import { CARD_KEY_PREFIX, createCardStore } from './core/storage.js';
import { createPlatform } from './platform.js';

/** Versione dell'app (allineata a package.json, verificata dai test). */
export const APP_VERSION = '1.0.0';

/**
 * Costruisce l'applicazione (senza avviarla).
 * @param {{
 *   $:Function,
 *   storage:object,
 *   platform?:object,
 *   win?:object,
 *   appVersion?:string,
 *   logger?:object
 * }} deps
 */
export function createApp({
  $,
  storage,
  platform = createPlatform(),
  win = typeof window !== 'undefined' ? window : globalThis,
  appVersion = APP_VERSION,
  logger = console,
} = {}) {
  if (typeof $ !== 'function') throw new TypeError('createApp: jQuery è richiesto.');
  if (!storage) throw new TypeError('createApp: storage è richiesto.');

  const store = createCardStore({ storage, keyPrefix: CARD_KEY_PREFIX });
  const settings = createSettingsStore({ storage });
  const backup = createBackup({ store, appVersion });
  const api = createApiClient({ baseUrl: settings.get().apiBaseUrl, timeoutMs: settings.get().apiTimeoutMs });

  /** Scheda da mostrare alla prossima apertura della pagina scheda. */
  let pendingCard = null;

  function changePage(selector) {
    if ($.mobile && typeof $.mobile.changePage === 'function') {
      $.mobile.changePage($(selector));
      return true;
    }
    return false;
  }

  function setStatus(message) {
    const $status = $('#statoImpostazioni');
    if ($status && typeof $status.text === 'function') $status.text(message);
    return message;
  }

  /**
   * Collega un comando al "click virtuale", una volta sola per interazione.
   *
   * Con jQuery Mobile la stessa interazione produce `vclick` e, a seconda della
   * piattaforma, anche `tap` e/o un `click` sintetico del browser: si esegue
   * `vclick` e si ignorano le copie che arrivano subito dopo. Due interazioni
   * distinte dell'utente restano invece entrambe valide, anche se ravvicinate.
   * Senza jQuery Mobile (solo `click`) ogni click viene eseguito.
   * @param {object} $element
   * @param {Function} handler
   */
  function bindActivate($element, handler) {
    let lastVirtual = 0;
    const run = (event, kind) => {
      const now = Date.now();
      if (kind !== 'vclick' && now - lastVirtual < 300) return undefined;
      lastVirtual = now;
      return handler(event);
    };
    $element.on('vclick', (event) => run(event, 'vclick'));
    $element.on('tap', (event) => run(event, 'tap'));
    $element.on('click', (event) => run(event, 'click'));
    return $element;
  }

  /**
   * Collega un'azione "pressione prolungata".
   * Su touch vale `taphold` di jQuery Mobile; con il mouse (browser desktop e
   * PWA) vale il menu contestuale, che sulla maggior parte dei dispositivi
   * mobili corrisponde alla pressione prolungata.
   * @param {object} $element
   * @param {Function} handler
   */
  function bindHold($element, handler) {
    $element.on('taphold', handler);
    $element.on('contextmenu', (event) => {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      return handler(event);
    });
    return $element;
  }

  // ---------------------------------------------------------------- schede --

  function readForm() {
    return {
      nome: $('#txtNome').val(),
      indirizzo: $('#txtIndirizzo').val(),
      descrizione: $('#txtDescrizione').val(),
      prezzo: $('#txtPrezzo').val(),
    };
  }

  function fillForm(card = {}) {
    $('#txtNome').val(card.nome || '');
    $('#txtIndirizzo').val(card.indirizzo || '');
    $('#txtDescrizione').val(card.descrizione || '');
    $('#txtPrezzo').val(card.prezzo || '');
  }

  function validationMessage(error) {
    if (error && Array.isArray(error.errors) && error.errors.length > 0) return error.errors[0].message;
    if (error && error.message) return error.message;
    return 'Operazione non riuscita.';
  }

  /** Salva la scheda del form. @returns {object|null} */
  function saveCurrent() {
    try {
      const saved = store.save(readForm());
      logger.log('Scheda salvata:', saved.nome);
      platform.alert('Salvataggio effettuato!', 'Informazione');
      return saved;
    } catch (error) {
      logger.error('Salvataggio non riuscito', error);
      platform.alert(validationMessage(error), 'Dati non validi');
      return null;
    }
  }

  /** Ricostruisce l'elenco delle schede. @returns {object[]} */
  function renderList() {
    const $list = $('#liElencoSchede');
    $list.html('');
    $list.append($("<li data-role='list-divider' role='heading'>Schede</li>"));

    const cards = store.list();
    if (cards.length === 0) {
      $list.append($("<li data-role='list-divider' role='heading'>Nessuna scheda salvata</li>"));
    }

    for (const card of cards) {
      // `.text()` invece della concatenazione HTML: nessuna rottura del markup
      // se il nome contiene caratteri speciali.
      const $item = $("<li data-theme='c'><a href='#' data-transition='slide'></a></li>");
      const $link = $item.find('a');
      $link.text(card.nome);
      bindActivate($link, () => openCard(card.nome));
      bindHold($item, () => removeCard(card.nome));
      $list.append($item);
    }

    if (typeof $list.listview === 'function') {
      // La listview può non essere ancora inizializzata (elenco mai aperto in
      // questa sessione): jQuery Mobile lancia un errore. Si ignora il refresh,
      // che verrà ripetuto al `pagebeforeshow` della pagina.
      try {
        $list.listview('refresh');
      } catch (error) {
        logger.log?.('Listview non ancora inizializzata, refresh rimandato', error?.message ?? error);
      }
    }
    return cards;
  }

  /** Apre una scheda nel form. */
  function openCard(nome) {
    const card = store.get(nome);
    if (!card) {
      platform.alert('Scheda non trovata.', 'Errore');
      return false;
    }
    pendingCard = card;
    changePage('#scheda');
    return true;
  }

  /** Chiede conferma e rimuove una scheda. @returns {Promise<boolean>} */
  async function removeCard(nome) {
    const confirmed = await platform.confirm("Confermi l'eliminazione della scheda?", {
      title: 'Conferma eliminazione',
    });
    if (!confirmed) return false;
    const removed = store.remove(nome);
    if (removed) renderList();
    return removed;
  }

  /**
   * Invia tutte le schede. Le schede vengono rimosse in locale **solo** dopo
   * una risposta 2xx: in caso di errore i dati restano intatti.
   * @returns {Promise<{sent:number, removed:number, skipped?:string}>}
   */
  async function sendAll() {
    const cards = store.list();
    if (cards.length === 0) {
      platform.alert('Nessuna scheda da inviare.', 'Informazione');
      return { sent: 0, removed: 0, skipped: 'empty' };
    }
    if (!api.isConfigured()) {
      platform.alert(
        'Endpoint API non configurato: le schede restano salvate in locale (vedi Impostazioni).',
        'Informazione',
      );
      return { sent: 0, removed: 0, skipped: 'unconfigured' };
    }

    const confirmed = await platform.confirm(`Confermi l'invio di ${cards.length} schede?`, {
      title: 'Conferma invio',
    });
    if (!confirmed) return { sent: 0, removed: 0, skipped: 'cancelled' };

    try {
      await api.sendCards(cards);
    } catch (error) {
      logger.error('Invio schede non riuscito', error);
      platform.alert(
        "Si è verificato un problema durante l'invio delle schede! I dati sono stati conservati.",
        'Errore',
      );
      return { sent: 0, removed: 0, skipped: 'error' };
    }

    let removed = 0;
    for (const card of cards) {
      if (store.remove(card.nome)) removed += 1;
    }
    renderList();
    platform.alert(`Schede inviate: ${removed}.`, 'Informazione');
    return { sent: cards.length, removed };
  }

  // ----------------------------------------------------------- impostazioni --

  /** Copia le impostazioni correnti nel form. */
  function fillSettingsForm() {
    const current = settings.get();
    $('#txtApiUrl').val(current.apiBaseUrl);
    $('#txtPassword').val(''); // la password non resta nel form
    setStatus(settingsStatus(current));
    return current;
  }

  function settingsStatus(current = settings.get()) {
    const mode = current.apiBaseUrl === '' ? 'solo offline' : `invio a ${current.apiBaseUrl}`;
    return `${store.count()} schede in locale · ${mode}`;
  }

  /** Salva le impostazioni e riconfigura il client API. */
  function saveSettings() {
    try {
      const saved = settings.save({ apiBaseUrl: $('#txtApiUrl').val() });
      api.setBaseUrl(saved.apiBaseUrl);
      $('#txtPassword').val(''); // la password non resta nel DOM
      updateOnlineState();
      setStatus(settingsStatus(saved));
      platform.alert('Impostazioni salvate!', 'Informazione');
      return saved;
    } catch (error) {
      logger.error('Impostazioni non valide', error);
      $('#txtPassword').val(''); // non trattenere il segreto neppure in caso di errore
      platform.alert(validationMessage(error), 'Impostazioni non valide');
      return null;
    }
  }

  // ---------------------------------------------------------------- backup --

  /** Nome file proposto per il backup. */
  function backupFileName(date = new Date(), prefix = 'realtor-backup') {
    const stamp = date.toISOString().slice(0, 10);
    return `${prefix}-${stamp}.json`;
  }

  /** Esporta le schede nel campo di testo (e tenta il download). */
  function exportBackup({ download = false } = {}) {
    const json = backup.toJson();
    $('#txtBackup').val(json);
    const done = download ? downloadBackup(json) : false;
    setStatus(`Backup di ${store.count()} schede pronto${done ? ' (file scaricato)' : ''}.`);
    return json;
  }

  /**
   * Tenta il download del file; `false` se l'ambiente non lo consente.
   * @param {string} json
   * @param {Date} [date]
   * @param {string} [fileName]
   */
  function downloadBackup(json, date = new Date(), fileName = backupFileName(date)) {
    const doc = win && win.document;
    const BlobImpl = win && win.Blob;
    const urlImpl = win && win.URL;
    if (
      !doc ||
      typeof doc.createElement !== 'function' ||
      typeof BlobImpl !== 'function' ||
      !urlImpl ||
      typeof urlImpl.createObjectURL !== 'function'
    ) {
      return false;
    }
    try {
      const url = urlImpl.createObjectURL(new BlobImpl([json], { type: 'application/json' }));
      const anchor = doc.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      doc.body.appendChild(anchor);
      anchor.click();
      doc.body.removeChild(anchor);
      urlImpl.revokeObjectURL(url);
      return true;
    } catch (error) {
      logger.error('Download del backup non riuscito', error);
      return false;
    }
  }

  /**
   * Importa il backup incollato nel campo di testo.
   * @param {{mode?:'merge'|'replace'}} [options]
   */
  async function importBackup({ mode = 'merge', text: providedText } = {}) {
    const text = providedText === undefined ? $('#txtBackup').val() : providedText;
    if (!text || String(text).trim() === '') {
      platform.alert('Incolla un backup nel campo di testo, oppure esportane uno prima.', 'Informazione');
      return null;
    }

    const preview = backup.parse(text);
    if (!preview.valid) {
      platform.alert(preview.errors.join(' '), 'Backup non valido');
      return null;
    }

    const message =
      mode === 'replace'
        ? `Sostituire le ${store.count()} schede presenti con le ${preview.cards.length} del backup?`
        : `Aggiungere ${preview.cards.length} schede dal backup a quelle presenti?`;
    const confirmed = await platform.confirm(message, { title: 'Conferma importazione' });
    if (!confirmed) return null;

    const result = backup.importJson(text, { mode });
    renderList();
    setStatus(settingsStatus());
    const details = result.errors.length > 0 ? ` Problemi: ${result.errors.slice(0, 3).join(' ')}` : '';
    platform.alert(
      `Importazione completata: ${result.imported} schede importate, ${result.invalid} scartate.${details}`,
      'Informazione',
    );
    return result;
  }

  /** Migra le schede salvate con la versione 0.0.1. */
  function migrateNow({ silent = false } = {}) {
    let report;
    try {
      report = migrateLegacy({ storage, keyPrefix: CARD_KEY_PREFIX });
    } catch (error) {
      logger.error('Migrazione non riuscita', error);
      if (!silent) platform.alert(`Migrazione non riuscita: ${error.message}`, 'Errore');
      return null;
    }
    if (report.migrated > 0) {
      renderList();
      logger.log(`Migrate ${report.migrated} schede dalla versione 0.0.1`);
    }
    if (!silent) {
      const renamed = report.renamed > 0 ? ` (${report.renamed} rinominate per evitare sovrascritture)` : '';
      platform.alert(
        `Migrazione completata: ${report.migrated} schede importate${renamed}.`,
        'Informazione',
      );
    }
    return report;
  }

  // -------------------------------------------------------- backup cifrato --

  /** Legge la password dal campo dedicato (mai persistita). */
  function readPassword() {
    const $field = $('#txtPassword');
    return $field && typeof $field.val === 'function' ? String($field.val() || '') : '';
  }

  /** Esporta un backup cifrato con password (AES-256-GCM + PBKDF2-SHA256). */
  async function exportEncryptedBackup({ download = true } = {}) {
    const password = readPassword();
    if (password.length < MIN_PASSWORD_LENGTH) {
      platform.alert(`Indica una password di almeno ${MIN_PASSWORD_LENGTH} caratteri.`, 'Password richiesta');
      return null;
    }

    try {
      const envelope = await encryptText(backup.toJson(), password);
      const json = JSON.stringify(envelope, null, 2);
      $('#txtBackup').val(json);
      const saved = download ? downloadBackup(json, new Date(), backupFileName(new Date(), 'realtor-backup-cifrato')) : false;
      setStatus(`Backup cifrato di ${store.count()} schede pronto${saved ? ' (file scaricato)' : ''}.`);
      platform.alert(
        'Backup cifrato creato. Conserva la password: senza di essa il file non è recuperabile.',
        'Informazione',
      );
      return envelope;
    } catch (error) {
      logger.error('Cifratura del backup non riuscita', error);
      platform.alert(error.message || 'Cifratura non riuscita.', 'Errore');
      return null;
    }
  }

  /**
   * Importa un backup cifrato: decifra e riusa il percorso di importazione già
   * validato (`importBackup`), quindi nessun dato viene scritto prima dei controlli.
   */
  async function importEncryptedBackup({ mode = 'merge' } = {}) {
    const text = $('#txtBackup').val();
    const password = readPassword();

    if (!isEncryptedEnvelope(text)) {
      platform.alert('Nel campo non c\u2019\u00e8 un backup cifrato: incolla un file creato con "Esporta cifrato".', 'Informazione');
      return null;
    }
    if (password === '') {
      platform.alert('Indica la password usata per cifrare il backup.', 'Password richiesta');
      return null;
    }

    let plain;
    try {
      plain = await decryptText(text, password);
    } catch (error) {
      logger.error('Decifratura del backup non riuscita', error);
      platform.alert(
        error.code === 'wrong_password' ? 'Password errata o file danneggiato.' : error.message,
        'Decifratura non riuscita',
      );
      return null;
    }
    return importBackup({ mode, text: plain });
  }

  // ------------------------------------------------------------------- UI --

  /** Nasconde i comandi non disponibili sulla piattaforma corrente. */
  function applyPlatformUi() {
    // Dove la chiusura programmatica non è consentita, il pulsante non serve.
    if (!platform.canExit()) $('#btnExit').hide();
    return platform.platformName();
  }

  /** Abilita/disabilita il pulsante di invio in base alla connessione. */
  function updateOnlineState() {
    const $button = $('#btnInviaSchede');
    if (platform.isOnline()) {
      $button.removeClass('ui-disabled');
      $button.attr('aria-disabled', 'false');
    } else {
      $button.addClass('ui-disabled');
      $button.attr('aria-disabled', 'true');
    }
    return platform.isOnline();
  }

  /** Collega gli eventi della UI. */
  function bindEvents() {
    applyPlatformUi();
    api.setBaseUrl(settings.get().apiBaseUrl);

    bindActivate($('#btnSalva'), saveCurrent);
    bindActivate($('#btnExit'), () => platform.exit());

    $('#elencoSchede').on('pagebeforeshow', renderList);
    $('#scheda').on('pagebeforeshow', () => {
      fillForm(pendingCard || {});
      pendingCard = null;
    });
    $('#impostazioni').on('pagebeforeshow', () => fillSettingsForm());

    bindActivate($('#btnInviaSchede'), async () => {
      if (!platform.isOnline()) {
        platform.alert('Connessione Internet non disponibile!', 'Informazione');
        updateOnlineState();
        return;
      }
      await sendAll();
    });

    bindActivate($('#btnSalvaImpostazioni'), saveSettings);
    bindActivate($('#btnEsportaBackup'), () => exportBackup({ download: true }));
    bindActivate($('#btnImportaBackup'), () => importBackup({ mode: 'merge' }));
    bindActivate($('#btnImportaSostituisci'), () => importBackup({ mode: 'replace' }));
    bindActivate($('#btnEsportaCifrato'), () => exportEncryptedBackup());
    bindActivate($('#btnImportaCifrato'), () => importEncryptedBackup());
    bindActivate($('#btnMigraLegacy'), () => migrateNow());

    platform.on('online', updateOnlineState);
    platform.on('offline', updateOnlineState);
    platform.on('deviceready', () => {
      updateOnlineState();
      migrateNow({ silent: true });
    });
    return true;
  }

  /** Migrazione automatica all'avvio, se abilitata nelle impostazioni. */
  function runStartupMigration() {
    if (!settings.get().migrateLegacyOnStart) return null;
    return migrateNow({ silent: true });
  }

  /**
   * Registra il service worker per l'uso offline.
   * Attivo solo su http/https (nella PWA e in Cordova con schema web); su
   * `file://` o dove l'API non esiste non fa nulla.
   * @returns {Promise|null}
   */
  function registerServiceWorker() {
    const nav = win && win.navigator;
    const location = win && win.location;
    if (!nav || !('serviceWorker' in nav) || !location || !/^https?:$/.test(location.protocol)) return null;
    try {
      const registration = nav.serviceWorker.register('sw.js');
      if (registration && typeof registration.catch === 'function') {
        registration.catch((error) => {
          if (typeof logger.warn === 'function') logger.warn('Service worker non registrato', error);
        });
      }
      return registration;
    } catch (error) {
      logger.error('Registrazione del service worker non riuscita', error);
      return null;
    }
  }

  return {
    store,
    api,
    settings,
    backup,
    platform,
    bindEvents,
    applyPlatformUi,
    bindActivate,
    bindHold,
    updateOnlineState,
    renderList,
    readForm,
    fillForm,
    saveCurrent,
    openCard,
    removeCard,
    sendAll,
    changePage,
    fillSettingsForm,
    settingsStatus,
    saveSettings,
    exportBackup,
    downloadBackup,
    importBackup,
    exportEncryptedBackup,
    importEncryptedBackup,
    readPassword,
    migrateNow,
    runStartupMigration,
    registerServiceWorker,
    backupFileName,
    setStatus,
  };
}

/**
 * Avvia l'app nel browser/WebView.
 * @param {{win?:object}} [options]
 */
export function boot({ win = typeof window !== 'undefined' ? window : globalThis } = {}) {
  const app = createApp({ $: win.jQuery, storage: win.localStorage, win });
  const start = () => {
    app.runStartupMigration();
    app.bindEvents();
    app.updateOnlineState();
    app.registerServiceWorker();
  };
  const doc = win.document;
  if (doc && doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', start, false);
  } else {
    start();
  }
  return app;
}

if (typeof window !== 'undefined' && window.document) {
  boot();
}

export default createApp;
