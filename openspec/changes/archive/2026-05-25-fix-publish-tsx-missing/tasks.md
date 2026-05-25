## 1. Declare `tsx` as a root devDependency

- [x] 1.1 Add `"tsx": "^4.19.2"` (or latest 4.x at implementation time — confirm with `npm view tsx version`) to `package.json` under `devDependencies`. Keep the alphabetical order convention of the existing block.
- [x] 1.2 Run `npm install --package-lock-only --no-audit --no-fund` at repo root to regenerate `package-lock.json` deterministically (same flags the workflow's `prepare` job uses).
- [x] 1.3 Verify: `node -e "require.resolve('tsx')"` from repo root after `npm ci` resolves without error.

## 2. Local smoke verification

- [x] 2.1 From a clean checkout: `npm ci`, then `BUNDLE_RECOMMENDED_EXTENSIONS=1 node --import tsx/esm packages/electron/scripts/bundle-recommended-extensions.mjs`. Confirm it gets past the manifest-load phase (the original ERR_MODULE_NOT_FOUND no longer fires).
- [x] 2.2 Confirm `npm run start:dev` inside `packages/electron/` does not error on missing `tsx` (best-effort — full Electron startup is out of scope; first-line module resolution is the verification target).

## 3. CHANGELOG

- [x] 3.1 Under `## [Unreleased]` → `Fixed`: add "Publish workflow: declared missing `tsx` devDependency so the bundle-recommended-extensions step resolves on CI."

## 4. Verification

- [x] 4.1 Run `npm test 2>&1 | tee /tmp/pi-test.log` and confirm no regressions (none expected — dep-only change).
- [x] 4.2 After merge, manually re-run the failed `publish.yml` workflow (or wait for next release) and confirm all 6 matrix entries pass the Bundle step.
