# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Offline-first card storage with an injectable repository layer.
- Configurable REST endpoint (default: offline, no hardcoded server).
- JSON backup export/import.
- Reference API server (`server/`) implementing `GET/POST /realtor/api/scheda`.
- Unit, integration and end-to-end test suites.
- GitHub Actions CI (lint, tests, Android build) and release workflow.
- MIT license, NOTICE with third-party attributions, contribution and security docs.
- PWA manifest so `www/` runs installable in a browser.

### Fixed

- "Invia schede" no longer deletes local cards when the upload fails: removal
  happens only after a 2xx response (previously all cards were deleted while the
  AJAX call was commented out).
- `POST` body is now real JSON (`JSON.stringify`) instead of jQuery form-encoded
  data sent with `Content-Type: application/json`.
- Broken non-ASCII characters (U+FFFD) in source files; everything is UTF-8.
- Card list iteration while removing items (index shifting).
- Silent overwrite of cards with identical names (validated, versioned schema).

### Changed

- Cordova project regenerated with a modern `cordova-android` platform and
  Gradle build (the previous Ant/`android-19` project could not be built).
- Application id `com.cordova.realtor` -> `net.dntppe.realtor`; version `0.0.1` -> `1.0.0`.
- Core logic extracted into dependency-free ES modules; jQuery Mobile is used
  only in the UI layer.
- Only the Cordova plugins actually used are kept.

### Removed

- Tracked build artifacts (`platforms/`, `plugins/`) and the unrelated
  `001014428tesi.pdf`; legacy Windows `.bat` build scripts.

## [0.0.1] - 2014

- Initial Cordova 3.x application: create, list, delete and upload property
  appraisal cards ("schede immobiliari") from a jQuery Mobile UI.
