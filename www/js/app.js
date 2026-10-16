/**
 * Realtor — livello UI (jQuery Mobile) sopra il core testabile.
 *
 * Tutte le dipendenze (jQuery, storage, piattaforma) sono iniettate: il modulo
 * si importa senza effetti collaterali in Node e si avvia da solo nel browser.
 *
 * MIT License — Copyright (c) 2014-2026 Donato Pepe (vedi LICENSE e NOTICE).
 * Porzioni derivate dal template Apache Cordova (Apache-2.0): vedi NOTICE.
 */

import { createApiClient } from './core/api.js';
import { CARD_KEY_PREFIX, createCardStore } from './core/storage.js';
import { createPlatform } from './platform.js';

/**
 * Costruisce l'applicazione (senza avviarla).
 * @param {{$:Function, storage:object, platform?:object, apiBaseUrl?:string, logger?:object}} deps
 */
export function createApp({ $, storage, platform = createPlatform(), apiBaseUrl = '', logger = console } = {}) {
  if (typeof $ !== 'function') throw new TypeError('createApp: jQuery è richiesto.');
  if (!storage) throw new TypeError('createApp: storage è richiesto.');

  const store = createCardStore({ storage, keyPrefix: CARD_KEY_PREFIX });
  const api = createApiClient({ baseUrl: apiBaseUrl });

  /** Scheda da mostrare alla prossima apertura della pagina scheda. */
  let pendingCard = null;

  function changePage(selector) {
    if ($.mobile && typeof $.mobile.changePage === 'function') {
      $.mobile.changePage($(selector));
      return true;
    }
    return false;
  }

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
    return 'Salvataggio non riuscito.';
  }

  /** Salva la scheda del form. @returns {object|null} la scheda salvata o `null`. */
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
      // `.text()` invece della concatenazione HTML dell'originale: nessuna
      // rottura del markup se il nome contiene caratteri speciali.
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
        'Endpoint API non configurato: le schede restano salvate in locale.',
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

  /** Collega gli eventi della UI. */
  function bindEvents() {
    $('#btnSalva').on('tap', saveCurrent);
    $('#btnExit').on('tap', () => platform.exit());
    $('#elencoSchede').on('pagebeforeshow', renderList);
    $('#scheda').on('pagebeforeshow', () => {
      fillForm(pendingCard || {});
      pendingCard = null;
    });
    $('#btnInviaSchede').on('tap', async () => {
      if (!platform.isOnline()) {
        platform.alert('Connessione Internet non disponibile!', 'Informazione');
        updateOnlineState();
        return;
      }
      await sendAll();
    });

    platform.on('online', updateOnlineState);
    platform.on('offline', updateOnlineState);
    platform.on('deviceready', updateOnlineState);
    return true;
  }

  return {
    store,
    api,
    platform,
    bindEvents,
    updateOnlineState,
    renderList,
    readForm,
    fillForm,
    saveCurrent,
    openCard,
    removeCard,
    sendAll,
    changePage,
  };
}

/**
 * Avvia l'app nel browser/WebView.
 * @param {{win?:object}} [options]
 */
export function boot({ win = typeof window !== 'undefined' ? window : globalThis } = {}) {
  const app = createApp({ $: win.jQuery, storage: win.localStorage });
  const start = () => {
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
