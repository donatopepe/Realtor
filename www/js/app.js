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
      $link.on('tap', () => openCard(card.nome));
      $item.on('taphold', () => removeCard(card.nome));
      $list.append($item);
    }

    if (typeof $list.listview === 'function') $list.listview('refresh');
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
      updateOnlineState();
      setStatus(settingsStatus(saved));
      platform.alert('Impostazioni salvate!', 'Informazione');
      return saved;
    } catch (error) {
      logger.error('Impostazioni non valide', error);
      platform.alert(validationMessage(error), 'Impostazioni non valide');
      return null;
    }
  }

  // ---------------------------------------------------------------- backup --

  /** Nome file proposto per il backup. */
  function backupFileName(date = new Date()) {
    const stamp = date.toISOString().slice(0, 10);
    return `realtor-backup-${stamp}.json`;
  }

  /** Esporta le schede nel campo di testo (e tenta il download). */
  function exportBackup({ download = false } = {}) {
    const json = backup.toJson();
    $('#txtBackup').val(json);
    const done = download ? downloadBackup(json) : false;
    setStatus(`Backup di ${store.count()} schede pronto${done ? ' (file scaricato)' : ''}.`);
    return json;
  }

  /** Tenta il download del file; `false` se l'ambiente non lo consente. */
  function downloadBackup(json, date = new Date()) {
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
      anchor.download = backupFileName(date);
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
  async function importBackup({ mode = 'merge' } = {}) {
    const text = $('#txtBackup').val();
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

    $('#btnSalva').on('tap', saveCurrent);
    $('#btnExit').on('tap', () => platform.exit());

    $('#elencoSchede').on('pagebeforeshow', renderList);
    $('#scheda').on('pagebeforeshow', () => {
      fillForm(pendingCard || {});
      pendingCard = null;
    });
    $('#impostazioni').on('pagebeforeshow', () => fillSettingsForm());

    $('#btnInviaSchede').on('tap', async () => {
      if (!platform.isOnline()) {
        platform.alert('Connessione Internet non disponibile!', 'Informazione');
        updateOnlineState();
        return;
      }
      await sendAll();
    });

    $('#btnSalvaImpostazioni').on('tap', saveSettings);
    $('#btnEsportaBackup').on('tap', () => exportBackup({ download: true }));
    $('#btnImportaBackup').on('tap', () => importBackup({ mode: 'merge' }));
    $('#btnImportaSostituisci').on('tap', () => importBackup({ mode: 'replace' }));
    $('#btnMigraLegacy').on('tap', () => migrateNow());

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

  return {
    store,
    api,
    settings,
    backup,
    platform,
    bindEvents,
    applyPlatformUi,
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
    migrateNow,
    runStartupMigration,
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
