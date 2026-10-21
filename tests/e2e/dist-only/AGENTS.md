# DOX — tests/e2e/dist-only

Dist-only Playwright project (`playwright.dist-only.config.ts`, `npm run test:e2e:dist-only`). Clean-prefix npm install, no docker, no monorepo root. Plain `@playwright/test` import (fixtures.js is docker-harness bound). See change: decouple-plugins-from-core (8.5).

| File | Purpose |
|------|---------|
| `dist-only-lifecycle.ts` | `REPO_ROOT`, `DIST_ONLY_MARKER` (`.pi-test-dist-only.json`: prefix/binDir/port), `CANARY_ID`. |
| `global-setup.ts` | Attach when `PW_DIST_ONLY_URL` set; else `npm install` dashboard (`QA_DASHBOARD_TARBALL`+`QA_EXTRA_TARBALLS` local w/ overrides, or `QA_DASHBOARD_VERSION`), stage canary UNTRUSTED via `stage-runtime-canary.mjs`, copy to `<prefix>/.pi/dashboard/plugins`, `pi-dashboard start` on free port, export `PW_DIST_ONLY_URL`. Written, not yet run. |
| `global-teardown.ts` | `pi-dashboard stop` + rm prefix from marker; no-op when attached. |
| `runtime-plugin-dist-only.spec.ts` | F18 (8.139): untrusted canary refused → click Trust (host is loopback-local) → claim appears after `plugins_changed`, 0 reloads. Written, not yet run. |
