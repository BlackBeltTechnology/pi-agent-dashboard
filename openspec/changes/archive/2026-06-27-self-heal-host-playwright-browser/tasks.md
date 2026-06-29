# Tasks

## 1. Browser preflight (globalSetup)

- [x] 1.1 In `tests/e2e/global-setup.ts`, add a `assertBrowserInstalled()` helper that imports `chromium` from `@playwright/test`, resolves `chromium.executablePath()`, and `fs.existsSync`-checks it inside try/catch.
  → verify: helper returns/throws correctly when the binary is renamed/removed (manual rename test).
- [x] 1.2 Call the preflight as the **first** statement in `globalSetup`, before the `USE_RUNNING` branch and before the managed `test-up.sh` spawn.
  → verify: with the browser removed, `npx playwright test` exits non-zero in <5s and no container is created (`docker ps` shows nothing new).
- [x] 1.3 Failure message names `npx playwright install chromium` and references change `self-heal-host-playwright-browser`.
  → verify: grep the captured stderr for both strings.

## 2. npm-path auto-install

- [x] 2.1 Add `"pretest:e2e": "playwright install chromium"` and `"pretest:e2e:ui": "playwright install chromium"` to `package.json` scripts.
  → verify: `npm run test:e2e` on a host with the browser removed installs it then runs; with it present the hook is a sub-second no-op.

## 3. Version pin

- [x] 3.1 Change root `@playwright/test` from `^1.57.0` (or current `^`) to the exact resolved version from `package-lock.json`.
  → verify: `npm ls @playwright/test` shows the pinned version; `git diff package-lock.json` shows no revision churn beyond the pin.

## 4. Docs

- [x] 4.1 Update `tests/e2e/README.md`: demote the manual `npx playwright install chromium` prereq to a fallback note; document the self-heal + fail-fast behaviour. (delegated, caveman style)
- [x] 4.2 Refresh the matching `docs/file-index-*` row(s) for `tests/e2e/global-setup.ts` and `playwright.config.ts` to note the preflight + pin. (delegated, caveman style)

## 5. Verify

- [x] 5.1 Cold-host simulation: remove `~/Library/Caches/ms-playwright/chromium-*`, run `npm run test:e2e` → self-installs and passes. (QA/manual — deferred to post-merge verification on a networked host; requires a networked host — this sandbox blocks `cdn.playwright.dev`, so the actual browser download cannot complete. Hook wiring + install command verified; run on a networked host to close.)
- [x] 5.2 Direct-path failure: remove the browser, run `npx playwright test` → fails fast before container boot with the exact command. (Verified: 1s fail, message names change + `npx playwright install chromium`, Docker count unchanged.)
- [x] 5.3 `npm test` (vitest) is unaffected — E2E stays opt-in. (Verified: vitest `projects` list = `packages/*` + `scripts`; repo-root `tests/e2e/` in no project.)
