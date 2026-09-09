# Tasks — split-faux-seed-default-provider

## 1. Implementation

- [x] 1.1 Create `scripts/seed-settings-default-model.mjs` exporting a pure `mergeDefaultModel(cfg) → { cfg, changed }` (gate all mutation on `!cfg.defaultProvider`; normalize a combined `defaultModel` by splitting on the FIRST `/`; else pin `defaultProvider:"faux"` + `defaultModel:"faux-1"` only when absent) plus a thin file wrapper `seedFile(path)` that: reads the file (missing → treat as `{}`), leaves a present-but-unparseable file untouched and exits 0, writes `JSON.stringify(cfg,null,2)+"\n"` only when `changed`, and logs the `[test-entrypoint] PI_E2E_SEED: …` line only on write. When run as `node scripts/seed-settings-default-model.mjs <path>` it calls `seedFile(argv[2])`.
- [x] 1.2 Rewrite the settings.json seed step in `docker/test-entrypoint.sh` (~lines 288-305) to call `node /app/scripts/seed-settings-default-model.mjs "${SETTINGS}"` — removing the inline `node -e` program, the `grep -q '"defaultModel"'` shell guard, and the shell `echo` (the module now owns the log). Leave the `config.json` seed and the `providers.json`/`faux-roles.json` role-preset seed untouched.

## 2. Tests

- [x] 2.1 L1 — author `scripts/__tests__/seed-settings-default-model.test.mjs` covering the merge decision-table (see `scripts/__tests__/test-up-port-derivation.test.mjs` for the tmp-dir + import harness pattern):
  - E1 (test-plan #E1): input absent `settings.json` (`cfg={}`) · trigger run merge · observable returns `{defaultProvider:"faux",defaultModel:"faux-1"}`, `changed=true`.
  - E2 (test-plan #E2): input `{defaultModel:"faux/faux-1"}` no provider · trigger run merge · observable `{defaultProvider:"faux",defaultModel:"faux-1"}`, `changed=true`, no `/` remains.
  - E3 (test-plan #E3): input `{defaultProvider:"faux",defaultModel:"faux-1"}` · trigger run merge · observable `changed=false`, object unchanged, wrapper writes nothing.
  - E4 (test-plan #E4): input `{defaultProvider:"openrouter",defaultModel:"anthropic/claude-3.5"}` · trigger run merge · observable `changed=false`, `defaultModel` still `"anthropic/claude-3.5"` (not split).
  - E5 (test-plan #E5): input `{defaultProvider:"anthropic"}` no model · trigger run merge · observable `changed=false`, no `defaultModel` added.
  - E6 (test-plan #E6): input `{defaultModel:"a/b/c"}` no provider · trigger run merge · observable `defaultProvider:"a"`, `defaultModel:"b/c"` (first-slash split).
- [x] 2.2 L1 — file-wrapper fault cases in the same test file (tmp-dir FS):
  - X1 (test-plan #X1): fault existing `settings.json` = `"{not json"` · trigger `seedFile(path)` · observable exit 0, file bytes unchanged, no overwrite.
  - X2 (test-plan #X2): fault path does not exist · trigger `seedFile(path)` · observable treated as fresh, writes split keys, exit 0 (no throw).
- [x] 2.3 L3 — extend an existing faux roundtrip spec (see `tests/e2e/faux-text.spec.ts` for the docker-harness + derived-port pattern; read `dashboardPort` from `.pi-test-harness.json`, never hardcode `:18000`):
  - I1 (test-plan #I1): input harness booted `PI_E2E_SEED=1`, fresh tmpfs `~/.pi` · trigger fresh harness-spawned pi session with no `--model` · observable active model converges to `faux/faux-1` (faux stream reaches the browser).

## 3. Docs

- [x] 3.1 Add a `scripts/AGENTS.md` row for `seed-settings-default-model.mjs` (purpose + `mergeDefaultModel`/`seedFile` exports + `See change:`), path-alphabetical.
- [x] 3.2 Update the `docker/AGENTS.md` row for `test-entrypoint.sh` (settings seed now delegates to `scripts/seed-settings-default-model.mjs`; `See change:`).

## 4. Validate

- [x] 4.1 `npm test` green (new L1 rows pass); `openspec validate split-faux-seed-default-provider --strict` clean.
- [x] 4.2 Run the docker e2e harness for the faux roundtrip (I1) per `run-dashboard-e2e-local-changes` so it reflects the local seed change (verified in CI).
