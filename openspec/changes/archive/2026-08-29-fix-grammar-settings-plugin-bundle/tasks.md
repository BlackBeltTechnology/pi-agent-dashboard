# Tasks

## 1. Fix

- [x] 1.1 ~~Add `"grammar-settings-plugin"` to `BUNDLED_PLUGINS`~~ — **superseded**. The
  archived `make-grammar-fully-plugin-contained` (2026-07-22) folded `grammar-settings-plugin`
  into `grammar-plugin`, which is already listed in `BUNDLED_PLUGINS`
  (`packages/electron/scripts/bundle-server.mjs`). No stale entry remains.

## 2. Verify

- [x] 2.1 `bundled-plugins-complete.test.ts` passes (4/4): the `lists every non-fixture
  runtime plugin` assertion no longer reports `grammar-settings-plugin` missing, and no stale
  entry is introduced.
- [x] 2.2 (manual, on an `electron:build`) `resources/plugins/grammar-plugin/` is present in
  the packaged app — a fresh install shows Settings ▸ Plugins ▸ "Grammar & Spelling".
  Done-by-supersession: `grammar-plugin` has shipped in `BUNDLED_PLUGINS` since
  `make-grammar-fully-plugin-contained`; the built-bundle guard
  `assert-bundled-plugins-complete.mjs` covers it on the electron path.

## 3. Spec

- [x] 3.1 Add the "First-party runtime plugins are bundled into `resources/plugins/`"
  requirement to `electron-build-pipeline`, codifying the `BUNDLED_PLUGINS` completeness
  invariant already enforced by `bundled-plugins-complete.test.ts`.
