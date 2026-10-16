/**
 * Realtor — configurazione ESLint (flat config, ESM).
 *
 * Copre app, service worker, server, script e test; esclude il codice di terze
 * parti e gli artefatti generati.
 *
 * MIT License — Copyright (c) 2014-2026 Donato Pepe (vedi LICENSE).
 */

import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'platforms/**',
      'plugins/**',
      'www/js/jquery/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      'blob-report/**',
      'docs/screenshots/**',
    ],
  },
  js.configs.recommended,

  // App e core: girano nel browser/WebView, jQuery è globale.
  {
    files: ['www/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, $: 'readonly', jQuery: 'readonly' },
    },
  },

  // Service worker.
  {
    files: ['www/sw.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...globals.serviceworker },
    },
  },

  // File di configurazione alla radice (Node).
  {
    files: ['*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },

  // Server, script di build e test girano in Node.
  {
    files: ['server/**/*.js', 'scripts/**/*.js', 'tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },

  // I test E2E usano anche API del browser.
  {
    files: ['tests/e2e/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
  },

  {
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-console': 'off',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
    },
  },
];
