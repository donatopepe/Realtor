/**
 * Realtor — test end-to-end della parte PWA: manifest, service worker,
 * funzionamento offline e screenshot per la documentazione.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

const HOME_LINK_SCHEDA = '#homePage a[href="#scheda"]';

async function collectDialogs(page) {
  page.on('dialog', async (dialog) => {
    await dialog.accept();
  });
}

/** Apre una pagina dell'app tramite hash, come fa jQuery Mobile. */
async function openPage(page, hash) {
  await page.goto(`/#${hash}`);
  await expect(page.locator(`#${hash}.ui-page-active`)).toBeVisible();
}

test('il manifest è servito con il content-type corretto ed è collegato alla pagina', async ({
  page,
  request,
}) => {
  const response = await request.get('/manifest.webmanifest');
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-type']).toContain('application/manifest+json');

  const manifest = await response.json();
  expect(manifest.short_name).toBe('Realtor');
  expect(manifest.display).toBe('standalone');

  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
});

test('cordova.js è uno shim: nessun errore di pagina e fallback web attivi', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  const response = await page.goto('/');
  expect(response.status()).toBe(200);
  expect(await page.evaluate(() => typeof window.cordova)).toBe('undefined');
  await expect(page.locator('#homePage.ui-page-active')).toBeVisible();
  expect(errors).toEqual([]);
});

test('il service worker si registra e l’app si apre senza rete', async ({ page, context }) => {
  await page.goto('/');

  const registered = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return Boolean(registration.active || registration.installing || registration.waiting);
  });
  expect(registered).toBe(true);

  // Secondo caricamento: la pagina è controllata dal service worker e l'app shell è in cache.
  await page.reload();
  await expect(page.locator('#homePage.ui-page-active')).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#homePage.ui-page-active')).toBeVisible();
  await expect(page.locator(HOME_LINK_SCHEDA)).toBeVisible();

  await context.setOffline(false);
  await page.reload();
  await expect(page.locator('#homePage.ui-page-active')).toBeVisible();
});

test('offline: i dati locali restano accessibili', async ({ page, context }) => {
  await collectDialogs(page);
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();

  await openPage(page, 'scheda');
  await page.locator('#txtNome').fill('Scheda offline');
  await page.locator('#btnSalva').click();

  await context.setOffline(true);
  await page.reload();
  await openPage(page, 'elencoSchede');
  await expect(page.locator('#liElencoSchede')).toContainText('Scheda offline');

  await context.setOffline(false);
  await page.reload();
  await openPage(page, 'elencoSchede');
  await expect(page.locator('#liElencoSchede')).toContainText('Scheda offline');
});

test('screenshot per la documentazione', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'gli screenshot si generano una sola volta (progetto desktop)');

  const directory = join('docs', 'screenshots');
  mkdirSync(directory, { recursive: true });
  await collectDialogs(page);

  await openPage(page, 'homePage');
  await page.screenshot({ path: join(directory, 'home.png') });

  await page.locator(HOME_LINK_SCHEDA).click();
  await expect(page.locator('#scheda.ui-page-active')).toBeVisible();
  await page.locator('#txtNome').fill('Attico Centro');
  await page.locator('#txtIndirizzo').fill('Via Roma 1');
  await page.locator('#txtDescrizione').fill('Vista sul parco, ristrutturato');
  await page.locator('#txtPrezzo').fill('250.000,50');
  await page.screenshot({ path: join(directory, 'scheda.png') });

  await page.locator('#btnSalva').click();
  await openPage(page, 'impostazioni');
  await page.locator('#txtApiUrl').fill('https://esempio.tld/realtor/api/scheda');
  await page.locator('#btnSalvaImpostazioni').click();
  await page.screenshot({ path: join(directory, 'impostazioni.png') });

  await openPage(page, 'elencoSchede');
  await expect(page.locator('#liElencoSchede')).toContainText('Attico Centro');
  await page.screenshot({ path: join(directory, 'elenco.png') });
});
