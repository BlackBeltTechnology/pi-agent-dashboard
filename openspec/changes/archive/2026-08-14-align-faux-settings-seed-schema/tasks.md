# Tasks — align-faux-settings-seed-schema

## 1. Seed the split default-model schema

- [x] 1.1 `docker/test-entrypoint.sh` (`PI_E2E_SEED` settings.json block):
  change the seed writer to emit the split pair
  `defaultProvider: "faux"` + `defaultModel: "faux-1"` (each written only when
  absent) instead of the combined `defaultModel: "faux/faux-1"`; update the log
  line and comment accordingly. Leave the guard and every other seed block
  untouched.

## 2. Verify

- [x] 2.1 Reproduce the seed writer in isolation: run the block's node snippet
  against a scratch file and assert the emitted JSON carries
  `defaultProvider: "faux"` and `defaultModel: "faux-1"`.
- [x] 2.2 `bash -n docker/test-entrypoint.sh` (syntax) clean.
- [x] 2.3 `npm run build` clean.
- [x] 2.4 `openspec validate align-faux-settings-seed-schema --strict`.
