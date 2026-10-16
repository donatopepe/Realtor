/**
 * Realtor — test end-to-end della PWA (app reale servita a browser desktop e
 * mobile in due progetti Playwright).
 */

import { expect, test } from '@playwright/test';

const API_URL = `http://127.0.0.1:${process.env.E2E_API_PORT || 8124}/realtor/api/scheda`;

/** Selettori precisi: il testo appare sia nei link della home sia nei titoli. */
const HOME_LINK_SCHEDA = '#homePage a[href="#scheda"]';
const HOME_LINK_ELENCO = '#homePage a[href="#elencoSchede"]';
const HOME_LINK_IMPOSTAZIONI = '#homePage a[href="#impostazioni"]';

/** Raccoglie i dialoghi (alert/confirm) accettandoli, come farebbe l'utente. */
function collectDialogs(page) {
  const dialogs = [];
  page.on('dialog', async (dialog) => {
    dialogs.push({ type: dialog.type(), message: dialog.message() });
    await dialog.accept();
  });
  return dialogs;
}

const allMessages = (dialogs) => dialogs.map((entry) => entry.message).join(' | ');

/** Apre una pagina dell'app tramite hash, come fa jQuery Mobile. */
async function openPage(page, hash) {
  await page.goto(`/#${hash}`);
  await expect(page.locator(`#${hash}.ui-page-active`)).toBeVisible();
}

/** Schede presenti nello storage locale dell'app. */
function localCards(page) {
  return page.evaluate(() =>
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith('realtor.scheda.'))
      .map((key) => JSON.parse(window.localStorage.getItem(key)))
      .sort((a, b) => a.nome.localeCompare(b.nome)),
  );
}

/** Apre il form, compila e salva. */
async function createCard(page, { nome, indirizzo = 'Via Test 1', descrizione = 'nota', prezzo = '150.000,50' }) {
  await openPage(page, 'scheda');
  await page.locator('#txtNome').fill(nome);
  await page.locator('#txtIndirizzo').fill(indirizzo);
  await page.locator('#txtDescrizione').fill(descrizione);
  await page.locator('#txtPrezzo').fill(prezzo);
  await page.locator('#btnSalva').click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#homePage.ui-page-active')).toBeVisible();
});

test('la home espone tutti i comandi dell’app', async ({ page }) => {
  await expect(page.locator(HOME_LINK_SCHEDA)).toBeVisible();
  await expect(page.locator(HOME_LINK_ELENCO)).toBeVisible();
  await expect(page.locator('#btnInviaSchede')).toBeVisible();
  await expect(page.locator(HOME_LINK_IMPOSTAZIONI)).toBeVisible();

  // Su web e iOS la chiusura non è consentita: il pulsante di uscita è nascosto.
  await expect(page.locator('#btnExit')).toBeHidden();
});

test('il link “Nuova scheda” della home apre il form', async ({ page }) => {
  await page.locator(HOME_LINK_SCHEDA).click();
  await expect(page.locator('#scheda.ui-page-active')).toBeVisible();
  await expect(page.locator('#txtNome')).toBeVisible();
});

test('crea una scheda e la ritrova dopo il ricaricamento', async ({ page }) => {
  const dialogs = collectDialogs(page);

  await createCard(page, { nome: 'Attico Centro' });
  await expect.poll(() => allMessages(dialogs)).toContain('Salvataggio effettuato!');

  const stored = await localCards(page);
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ nome: 'Attico Centro', prezzo: '150.000,50', version: 1 });

  await page.reload();
  await openPage(page, 'elencoSchede');
  await expect(page.locator('#liElencoSchede')).toContainText('Attico Centro');
});

test('rifiuta una scheda senza nome senza salvare nulla', async ({ page }) => {
  const dialogs = collectDialogs(page);

  await openPage(page, 'scheda');
  await page.locator('#txtPrezzo').fill('100');
  await page.locator('#btnSalva').click();

  await expect.poll(() => allMessages(dialogs)).toContain('Il nome della scheda è obbligatorio.');
  expect(await localCards(page)).toHaveLength(0);
});

test('rifiuta un prezzo non valido con un messaggio comprensibile', async ({ page }) => {
  const dialogs = collectDialogs(page);

  await openPage(page, 'scheda');
  await page.locator('#txtNome').fill('Casa');
  await page.locator('#txtPrezzo').fill('abc');
  await page.locator('#btnSalva').click();

  await expect.poll(() => allMessages(dialogs)).toContain('Prezzo non valido');
  expect(await localCards(page)).toHaveLength(0);
});

test('apre una scheda esistente dalL’elenco, la modifica e la risalva', async ({ page }) => {
  collectDialogs(page);
  await createCard(page, { nome: 'Villa A', prezzo: '500.000' });

  await openPage(page, 'elencoSchede');
  await expect(page.locator('#liElencoSchede')).toContainText('Villa A');

  await page.locator('#liElencoSchede a').first().click();
  await expect(page.locator('#scheda.ui-page-active')).toBeVisible();
  await expect(page.locator('#txtNome')).toHaveValue('Villa A');

  await page.locator('#txtDescrizione').fill('aggiornata');
  await page.locator('#btnSalva').click();

  const stored = await localCards(page);
  expect(stored).toHaveLength(1);
  expect(stored[0].descrizione).toBe('aggiornata');
});

test('apre “Nuova scheda” con il form vuoto', async ({ page }) => {
  collectDialogs(page);
  await createCard(page, { nome: 'Villa A' });

  await openPage(page, 'homePage');
  await page.locator(HOME_LINK_SCHEDA).click();
  await expect(page.locator('#scheda.ui-page-active')).toBeVisible();
  await expect(page.locator('#txtNome')).toHaveValue('');
  await expect(page.locator('#txtIndirizzo')).toHaveValue('');
});

test('elimina una scheda dopo la conferma', async ({ page }) => {
  const dialogs = collectDialogs(page);
  await createCard(page, { nome: 'Da eliminare' });
  await openPage(page, 'elencoSchede');
  await expect(page.locator('#liElencoSchede')).toContainText('Da eliminare');

  // Pressione prolungata sulla voce dell'elenco: su desktop è il menu contestuale,
  // su touch il taphold di jQuery Mobile.
  await page.locator('#liElencoSchede li').nth(1).dispatchEvent('contextmenu');
  await expect.poll(() => allMessages(dialogs)).toContain("Confermi l'eliminazione della scheda?");

  await expect.poll(async () => (await localCards(page)).length).toBe(0);
  await expect(page.locator('#liElencoSchede')).toContainText('Nessuna scheda salvata');
});

test('impostazioni: l’endpoint API persiste dopo il ricaricamento', async ({ page }) => {
  const dialogs = collectDialogs(page);

  await openPage(page, 'impostazioni');
  await expect(page.locator('#statoImpostazioni')).toContainText('solo offline');

  await page.locator('#txtApiUrl').fill(`${API_URL}/`);
  await page.locator('#btnSalvaImpostazioni').click();
  await expect.poll(() => allMessages(dialogs)).toContain('Impostazioni salvate!');

  const settings = await page.evaluate(() => JSON.parse(window.localStorage.getItem('realtor.settings')));
  expect(settings.apiBaseUrl).toBe(API_URL);

  await page.reload();
  await openPage(page, 'impostazioni');
  await expect(page.locator('#txtApiUrl')).toHaveValue(API_URL);
});

test('impostazioni: rifiuta un endpoint senza schema', async ({ page }) => {
  const dialogs = collectDialogs(page);

  await openPage(page, 'impostazioni');
  await page.locator('#txtApiUrl').fill('esempio.tld/scheda');
  await page.locator('#btnSalvaImpostazioni').click();

  await expect.poll(() => allMessages(dialogs)).toContain('Endpoint non valido');
  expect(await page.evaluate(() => window.localStorage.getItem('realtor.settings'))).toBeNull();
});

test('invio senza endpoint configurato: nessuna scheda viene persa', async ({ page }) => {
  const dialogs = collectDialogs(page);
  await createCard(page, { nome: 'Alfa' });

  await openPage(page, 'homePage');
  await page.locator('#btnInviaSchede').click();

  await expect.poll(() => allMessages(dialogs)).toContain('Endpoint API non configurato');
  expect(await localCards(page)).toHaveLength(1);
});

test('invio con il server reale: le schede restano finché il server non conferma', async ({
  page,
  request,
}) => {
  const dialogs = collectDialogs(page);
  const before = (await (await request.get(API_URL)).json()).count;
  // Nomi unici: il server è condiviso tra i test e aggiorna per nome.
  const suffix = Date.now().toString(36);
  const first = `Alfa ${suffix}`;
  const second = `Beta ${suffix}`;

  await createCard(page, { nome: first });
  await createCard(page, { nome: second });
  expect(await localCards(page)).toHaveLength(2);

  await openPage(page, 'impostazioni');
  await page.locator('#txtApiUrl').fill(API_URL);
  await page.locator('#btnSalvaImpostazioni').click();
  await expect.poll(() => allMessages(dialogs)).toContain('Impostazioni salvate!');

  await openPage(page, 'homePage');
  await page.locator('#btnInviaSchede').click();
  await expect.poll(() => allMessages(dialogs)).toContain("Confermi l'invio di 2 schede?");
  await expect.poll(() => allMessages(dialogs)).toContain('Schede inviate: 2.');

  expect(await localCards(page)).toHaveLength(0);

  // Il server (condiviso tra i test) ha ricevuto entrambe le schede.
  const server = await request.get(API_URL);
  expect(server.ok()).toBe(true);
  const payload = await server.json();
  expect(payload.count).toBeGreaterThanOrEqual(before + 2);
  const names = payload.cards.map((card) => card.nome);
  expect(names).toEqual(expect.arrayContaining([first, second]));
});

test('invio verso un server irraggiungibile: le schede restano in locale', async ({ page }) => {
  const dialogs = collectDialogs(page);
  await createCard(page, { nome: 'Alfa' });

  await openPage(page, 'impostazioni');
  await page.locator('#txtApiUrl').fill('http://127.0.0.1:9/realtor/api/scheda');
  await page.locator('#btnSalvaImpostazioni').click();

  await openPage(page, 'homePage');
  await page.locator('#btnInviaSchede').click();
  await expect.poll(() => allMessages(dialogs), { timeout: 15_000 }).toContain('I dati sono stati conservati');
  expect(await localCards(page)).toHaveLength(1);
});

test('backup: esporta, sostituisce e rifiuta un backup non valido', async ({ page }) => {
  const dialogs = collectDialogs(page);
  await createCard(page, { nome: 'Alfa' });

  await openPage(page, 'impostazioni');
  await page.locator('#btnEsportaBackup').click();
  const exported = await page.locator('#txtBackup').inputValue();
  expect(JSON.parse(exported).cards).toHaveLength(1);
  expect(JSON.parse(exported).format).toBe('realtor.backup');

  await page.locator('#txtBackup').fill(
    JSON.stringify({ cards: [{ nome: 'Gamma', prezzo: '10' }, { nome: 'Delta', prezzo: '20' }] }),
  );
  await page.locator('#btnImportaSostituisci').click();
  await expect.poll(async () => (await localCards(page)).map((card) => card.nome)).toEqual(['Delta', 'Gamma']);

  await page.locator('#txtBackup').fill('{non-json');
  await page.locator('#btnImportaBackup').click();
  await expect.poll(() => allMessages(dialogs)).toContain('JSON non valido');
  expect(await localCards(page)).toHaveLength(2);
});

test('migrazione automatica: importa le schede della versione 0.0.1 all’avvio', async ({ page }) => {
  const dialogs = collectDialogs(page);

  await page.evaluate(() => {
    window.localStorage.setItem(
      'Scheda vecchia',
      JSON.stringify({ nome: 'Scheda vecchia', indirizzo: 'Via Vecchia 1', descrizione: '', prezzo: '99' }),
    );
  });

  await page.reload();
  await openPage(page, 'elencoSchede');
  await expect(page.locator('#liElencoSchede')).toContainText('Scheda vecchia');

  const stored = await localCards(page);
  expect(stored).toHaveLength(1);
  expect(stored[0].indirizzo).toBe('Via Vecchia 1');
  expect(await page.evaluate(() => window.localStorage.getItem('Scheda vecchia'))).toBeNull();

  // Il comando manuale resta disponibile ed è idempotente.
  await openPage(page, 'impostazioni');
  await page.locator('#btnMigraLegacy').click();
  await expect.poll(() => allMessages(dialogs)).toContain('Migrazione completata: 0 schede importate.');
});
