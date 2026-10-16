/*
 * Realtor — opzioni di jQuery Mobile, da caricare **prima** della libreria.
 *
 * Stava inline in `index.html`; è in un file separato per poter usare una
 * Content-Security-Policy senza `unsafe-inline` sugli script.
 *
 * MIT License — Copyright (c) 2014-2026 Donato Pepe (vedi LICENSE).
 */

/* global jQuery */
jQuery(document).on('mobileinit', function () {
  jQuery.mobile.allowCrossDomainPages = true;
});
