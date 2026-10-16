/**
 * Realtor — test end-to-end dei controlli di sicurezza: CSP, header HTTP,
 * resistenza all'iniezione di markup e backup cifrato con password.
 */

import { expect, test } from '@playwright/test';

/** Raccoglie i dialoghi accettandoli (come fa l'utente). */
function collectDialogs(page) {
  const dialogs = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    // Il test può terminare mentre il dialog è ancora aperto (es. errore CSP):
    // non lasciare una rejection non gestita nel listener.
    await dialog.accept().catch(() => {});
  });
  return dialogs;
}

const allMessages = (dialogs) => dialogs.join(' | ');

const HOME_LINK_ELENCO = '#homePage a[href="#elencoSchede"]';

async function openPage(page, hash) {
  await page.goto(`/#${hash}`);
  await expect(page.locator(`#${hash}.ui-page-active`)).toBeVisible();
}

function localCards(page) {
  return page.evaluate(() =>
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith('realtor.scheda.'))
      .map((key) => JSON.parse(window.localStorage.getItem(key))),
  );
}

test('gli header di sicurezza sono presenti e la CSP non viene violata', async ({ page }) => {
  const violations = [];
  page.on('console', (message) => {
    if (/Content Security Policy|CSP/i.test(message.text())) violations.push(message.text());
  });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const response = await page.goto('/');
  const headers = response.headers();
  expect(headers['content-security-policy']).toContain("default-src 'self'");
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['permissions-policy']).toContain('geolocation=()');
  expect(headers['cross-origin-opener-policy']).toBe('same-origin');

  await expect(page.locator('#homePage.ui-page-active')).toBeVisible();
  expect(violations).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('un nome scheda con markup viene mostrato come testo (nessuna iniezione)', async ({ page }) => {
  const dialogs = collectDialogs(page);
  const payload = '<img src=x onerror="alert(1)"><script>alert(2)</script>';

  await openPage(page, 'scheda');
  await page.locator('#txtNome').fill(payload);
  await page.locator('#btnSalva').click();
  await expect.poll(() => allMessages(dialogs)).toContain('Salvataggio effettuato!');

  await openPage(page, 'elencoSchede');
  const list = page.locator('#liElencoSchede');
  await expect(list).toContainText('<img src=x');
  await expect(list.locator('img')).toHaveCount(0);
  await expect(list.locator('script')).toHaveCount(0);

  // Nessun dialogo di alert(1)/alert(2): il markup non è stato eseguito.
  expect(dialogs.filter((message) => message.includes('1') || message.includes('2'))).toEqual([]);
  expect((await localCards(page))[0].nome).toBe(payload);
});

test('il form non conserva la password nel DOM dopo il salvataggio', async ({ page }) => {
  await openPage(page, 'impostazioni');
  await page.locator('#txtPassword').fill('password-di-prova');
  await page.locator('#btnSalvaImpostazioni').click();
  await expect(page.locator('#txtPassword')).toHaveValue('');

  const stored = await page.evaluate(() => JSON.stringify(window.localStorage));
  expect(stored).not.toContain('password-di-prova');
});

test('backup cifrato: esportazione e reimportazione con password', async ({ page }) => {
  const dialogs = collectDialogs(page);

  // due schede di partenza
  for (const nome of ['Alfa', 'Beta']) {
    await openPage(page, 'scheda');
    await page.locator('#txtNome').fill(nome);
    await page.locator('#txtPrezzo').fill('100');
    await page.locator('#btnSalva').click();
  }

  await openPage(page, 'impostazioni');
  await page.locator('#txtPassword').fill('password-di-test-123');
  await page.locator('#btnEsportaCifrato').click();
  await expect.poll(() => allMessages(dialogs)).toContain('Backup cifrato creato');

  const envelope = JSON.parse(await page.locator('#txtBackup').inputValue());
  expect(envelope.format).toBe('realtor.backup.enc');
  expect(envelope.cipher.name).toBe('AES-GCM');
  expect(envelope.kdf.name).toBe('PBKDF2');
  expect(JSON.stringify(envelope)).not.toContain('Alfa');

  // sostituzione con lo stesso contenuto decifrato
  await page.locator('#btnImportaCifrato').click();
  await expect.poll(() => allMessages(dialogs)).toContain('Importazione completata');
  expect((await localCards(page)).map((card) => card.nome).sort()).toEqual(['Alfa', 'Beta']);
});

test('backup cifrato: password errata non tocca i dati', async ({ page }) => {
  const dialogs = collectDialogs(page);

  await openPage(page, 'scheda');
  await page.locator('#txtNome').fill('Alfa');
  await page.locator('#btnSalva').click();

  await openPage(page, 'impostazioni');
  await page.locator('#txtPassword').fill('password-di-test-123');
  await page.locator('#btnEsportaCifrato').click();
  await expect.poll(() => allMessages(dialogs)).toContain('Backup cifrato creato');

  await page.locator('#txtPassword').fill('password-sbagliata-1');
  await page.locator('#btnImportaCifrato').click();
  await expect.poll(() => allMessages(dialogs)).toContain('Password errata o file danneggiato.');
  expect(await localCards(page)).toHaveLength(1);
});

test('backup cifrato: senza password il comando non fa nulla', async ({ page }) => {
  const dialogs = collectDialogs(page);

  await openPage(page, 'scheda');
  await page.locator('#txtNome').fill('Alfa');
  await page.locator('#btnSalva').click();

  await openPage(page, 'impostazioni');
  await page.locator('#txtPassword').fill('corta');
  await page.locator('#btnEsportaCifrato').click();
  await expect.poll(() => allMessages(dialogs)).toContain('almeno 8 caratteri');
  expect(await page.locator('#txtBackup').inputValue()).toBe('');
  expect(await localCards(page)).toHaveLength(1);
});

test('l’elenco delle schede non è raggiungibile da altre origini (frame negati)', async ({ page }) => {
  const response = await page.goto('/');
  expect(response.headers()['x-frame-options']).toBe('DENY');
  // La CSP vieta l'inclusione in iframe anche dove X-Frame-Options non basta.
  expect(response.headers()['content-security-policy']).toContain("frame-ancestors 'none'");

  await page.goto('/');
  await page.locator(HOME_LINK_ELENCO).click();
  await expect(page.locator('#elencoSchede.ui-page-active')).toBeVisible();
});
