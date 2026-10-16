# Contribuire a Realtor

Grazie per l'interesse. Il progetto è piccolo e volutamente senza dipendenze runtime:
prima di aprire una modifica, leggi [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) per le
regole di struttura e [PLAN.md](PLAN.md) per criteri di accettazione e stato del lavoro.

## Preparare l'ambiente

```bash
npm ci
npm test
npm run serve        # http://localhost:8080
```

Per gli end-to-end serve un browser Playwright:

```bash
npx playwright install chromium
npm run test:e2e
```

Per la build Android servono JDK 17 e l'SDK Android con `ANDROID_HOME` esportato
(platform e build-tools 36). iOS richiede macOS.

## Flusso di lavoro

1. Apri una issue descrivendo il problema o la proposta (per i bug: passi per riprodurli, versione, piattaforma).
2. Crea un ramo: `git switch -c fix/invio-senza-endpoint`.
3. Fai modifiche piccole e mirate, con commit atomici in italiano o inglese.
4. Aggiungi o aggiorna i test: ogni correzione dovrebbe avere un test che fallisce prima e passa dopo.
5. Esegui i controlli (devono essere tutti verdi):

   ```bash
   npm run lint
   npm test
   npm run test:e2e
   npm run docs:check
   npm run scan:secrets
   ```

6. Apri la pull request spiegando *cosa* cambia e *perché*, citando i comandi eseguiti e il loro esito.

## Regole di codice

- **Il core resta puro**: `www/js/core/` non può usare DOM, jQuery, Cordova o `window.localStorage`
  (le dipendenze si iniettano). La violazione è intercettata da un test.
- **Nessun ramo per piattaforma** nel codice dell'app: le differenze passano da `www/js/platform.js`.
- **Nessun dato distrutto**: leggere dati corrotti non deve cancellare nulla, rimuovere schede locali
  solo dopo `2xx`, non sovrascrivere mai durante una migrazione.
- **Nessun endpoint o segreto nel codice**: l'API si configura dalle Impostazioni.
- **Commenti e messaggi in italiano**, coerenti con il resto del progetto; testo sempre UTF-8.
- **Nessuna dipendenza runtime** nell'app o nel server: se serve una libreria, discutila prima in una issue.
- Le icone si generano, non si modificano a mano: `npm run icons` (richiede ImageMagick).

## Checklist della pull request

- [ ] Modifica mirata e descritta (cosa/perché), nessun refactor non richiesto.
- [ ] Test aggiunti o aggiornati; `npm test` e `npm run test:e2e` verdi.
- [ ] `npm run lint` e `npm run docs:check` verdi.
- [ ] Documentazione aggiornata se cambiano comandi, configurazione o comportamento.
- [ ] Nessun segreto, keystore, build o file personale aggiunto al repository.
- [ ] `CHANGELOG.md` aggiornato se il cambiamento è visibile a chi usa l'app.

## Segnalare problemi di sicurezza

Non aprire una issue pubblica: segui [SECURITY.md](SECURITY.md).

## Codice di condotta

Partecipando accetti il [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md): comportamento rispettoso e
collaborativo, nessuna discriminazione, nessuna molestia.
