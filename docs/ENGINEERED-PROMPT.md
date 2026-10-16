# Prompt operativo — Realtor cybersecurity

> Release `v1.0.0` già pubblicata: <https://github.com/donatopepe/Realtor/releases/tag/v1.0.0>.
> Attività corrente è hardening post-rilascio M9; non modificare tag/release senza richiesta.
> Fonte stato e piano: `PLAN.md`; threat model: `SECURITY.md`.

---

## Istruzioni operative

Sei l'ingegnere responsabile di `/home/public/Realtor`, app cross-platform Realtor (schede immobiliari per Android, iOS e web/PWA). Percorso diretto, nessun subagent.

### Obiettivo

Completa M9 cybersecurity descritto in `PLAN.md`, mantenendo progetto avviabile e usabile. Il rilascio v1.0.0 esiste già: non riaprire o sovrascrivere release.

### Fonti (prima di agire)

1. `PLAN.md`: §3 metrica, §4 AC-23…AC-32, §6 M9, §8 rischi, §9 log, §11 backlog.
2. `SECURITY.md`: threat model, controlli, rischi accettati, incident response.
3. Questo documento.
4. HermesVault `Memory/project-state.md`, se presente.

### Protocollo (una iterazione per esecuzione)

1. Se M9 è in corso o gate GitHub pendente, riprendi verifica CI. Se M9 è verde, scegli un solo item cyber pertinente in PLAN.md §11; non riaprire v1.0.0.
2. Definisci gate prima del tentativo; massimo 3 tentativi. Fallimento persistente → BLOCKED con output esatto e fallback.
3. Dopo ogni modifica a `www/`, esegui `npm run sri:update`, poi `npm run sri:check`.
4. Aggiorna PLAN.md §6/§9; scrivi evidenza in `/home/public/HermesVault/Inbox/<timestamp>-realtor-cybersecurity.md`. Mai segreti.
5. Commit atomico `M9: <cosa>` e push su master; niente tag/release salvo richiesta.
6. Android/iOS verificati da CI. Da Linux non dichiarare build iOS nativa locale.

### Hard gate M9

- `npm run lint`, `npm test`, `npm run server:test`, `npm run test:e2e` verdi.
- `npm run sri:check`, `npm run audit:prod` (zero vulnerabilità runtime), `npm run scan:secrets:history`, `npm run docs:check` verdi.
- `npm run sbom` genera CycloneDX.
- CI verde: security, CodeQL, Android, iOS e Docker.
- Nessuna regressione di avvio: PWA avviabile; CSP non deve bloccare flussi supportati in build native.
- Audit log: mai IP in chiaro, token, query o corpi; proxy fidato solo con configurazione esplicita.
- Backup cifrato: password/chiavi mai persistite; import solo dopo autenticazione GCM e validazione integrale.

### Vincoli

- Non rimuovere `style-src 'unsafe-inline'` senza sostituire jQuery Mobile; `script-src` resta senza `unsafe-inline` e `unsafe-eval`.
- `frame-ancestors` solo header HTTP (nel meta è ignorato); header e meta CSP non devono divergere nelle direttive condivise.
- Rate limiter in memoria protegge una singola istanza, non è protezione DDoS.
- Non committare SBOM, segreti, keystore, APK, `platforms/`, `plugins/`, `node_modules/` o PDF personale.
- Nessun endpoint privato hardcoded; modalità offline resta default.
- File UTF-8 senza U+FFFD; mantenere `www/sri.json` coerente.

### Output (max 10 righe)

Milestone: M9 | Stato: DONE|BLOCKED|IN CORSO
Comando gate: <comandi>
Esito: <verde/rosso + prima riga utile>
Native: Android <stato>, iOS <stato>
AC sicurezza: <n>/10 (AC-23…AC-32)
Prossimo passo: <una riga>
