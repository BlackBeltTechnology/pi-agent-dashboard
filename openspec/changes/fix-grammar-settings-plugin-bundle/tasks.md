# Tasks

## 1. Fix

- [x] 1.1 Add `"grammar-settings-plugin"` to `BUNDLED_PLUGINS` in
  `packages/electron/scripts/bundle-server.mjs` (after `hermes-memory-plugin`).

## 2. Verify

- [x] 2.1 `bundled-plugins-complete.test.ts` passes (4/4): the `lists every non-fixture
  runtime plugin` assertion no longer reports `grammar-settings-plugin` missing, and no stale
  entry is introduced.
- [ ] 2.2 (manual, on an `electron:build`) `resources/plugins/grammar-settings-plugin/` is
  present in the packaged app — a fresh install shows Settings ▸ Plugins ▸ "Grammar &
  Spelling". Deferred: not run in this change (no local Electron build here); the built-bundle
  guard `assert-bundled-plugins-complete.mjs` covers it on the electron path.

## 3. Spec

- [x] 3.1 Add the "First-party runtime plugins are bundled into `resources/plugins/`"
  requirement to `electron-build-pipeline`, codifying the `BUNDLED_PLUGINS` completeness
  invariant already enforced by `bundled-plugins-complete.test.ts`.
