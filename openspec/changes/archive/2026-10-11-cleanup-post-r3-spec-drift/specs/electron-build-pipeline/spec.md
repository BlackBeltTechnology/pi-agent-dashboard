## REMOVED Requirements

### Requirement: Size budget enforcement in CI

**Reason**: It gates the size of `resources/bundled-extensions/`, which no longer exists. The bundling step and the extraResource were removed by change `eliminate-electron-runtime-install` (`packages/electron/forge.config.ts:121`), and `bundle-runtime-contract.test.ts` keeps the step out of `_electron-build.yml`/`publish.yml`. This mirrors the REMOVED "Installer size budget" in `bundled-recommended-extensions`.
**Migration**: None.
