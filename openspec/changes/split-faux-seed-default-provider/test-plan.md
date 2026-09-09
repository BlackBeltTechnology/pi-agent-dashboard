# Test Plan — split-faux-seed-default-provider

Stage: design   Generated: 2026-09-08

The seed's mutation is a pure decision-table over the current `settings.json`
state, so the bulk routes to L1 (the merge function, unit-tested against fixture
states). One integration property — the harness still yields faux as the startup
default — routes to L3 as a regression guard. See "New infra needed": the merge
must be extracted from the inline `node -e` into a standalone importable script
for L1 to reach it.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | split-shape seed | EP (fresh) | L1 | automated | no `settings.json` (absent) → `cfg={}` | run merge | returns `{defaultProvider:"faux", defaultModel:"faux-1"}`, `changed=true` |
| E2 | normalize legacy combined | state (repair) | L1 | automated | `{defaultModel:"faux/faux-1"}` (no `defaultProvider`) | run merge | returns `{defaultProvider:"faux", defaultModel:"faux-1"}`, `changed=true`, no `/` remains in `defaultModel` |
| E3 | idempotent no-op on correct split | EP (settled) | L1 | automated | `{defaultProvider:"faux", defaultModel:"faux-1"}` | run merge | `changed=false`, object byte-identical, wrapper performs no write |
| E4 | no-clobber + slash-bearing bare id preserved | decision-table | L1 | automated | `{defaultProvider:"openrouter", defaultModel:"anthropic/claude-3.5"}` | run merge | `changed=false`, `defaultModel` still `"anthropic/claude-3.5"` (NOT split to `"claude-3.5"`) |
| E5 | provider set, model absent → not faux-filled | decision-table | L1 | automated | `{defaultProvider:"anthropic"}` (no `defaultModel`) | run merge | `changed=false`, no `defaultModel` added (no incoherent `anthropic/faux-1`) |
| E6 | split on FIRST slash only | BVA (boundary) | L1 | automated | `{defaultModel:"a/b/c"}` (no `defaultProvider`) | run merge | returns `defaultProvider:"a"`, `defaultModel:"b/c"` (indexOf, not last-slash) |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | corrupt file left untouched | fault-injection | L1 | automated | existing `settings.json` = `"{not json"` (present, unparseable) | run file-wrapper | wrapper exits 0, file bytes unchanged, no overwrite |
| X2 | absent-file read does not throw the entrypoint | fault-injection | L1 | automated | path does not exist | run file-wrapper | treated as fresh (`cfg={}`), writes split keys, exit 0 (no `set -e` kill) |

### Frontend-quirk / integration

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| I1 | deterministic faux startup default (contract 1) | state-convergence | L3 | automated | docker harness booted with `PI_E2E_SEED=1`, fresh tmpfs `~/.pi` | a fresh harness-spawned pi session with no `--model` | session's active model converges to `faux/faux-1` (faux stream reaches the browser); extend an existing faux roundtrip spec rather than add new harness glue |

---

## Coverage summary

- Requirements covered: 1/1 (the added requirement, all five of its scenarios + the split-on-first-slash and absent-file boundaries)
- Scenarios by class: edge 6 · perf 0 · frontend/integration 1 · error 2
- Scenarios by level: L1 8 · L2 0 · L3 1
- Scenarios by disposition: automated 9 · manual-only 0

## New infra needed

- **Extract the seed merge from the inline `node -e '…'` in `docker/test-entrypoint.sh` into a standalone importable module** (e.g. `docker/seed-settings-default-model.mjs`) exposing a pure `mergeDefaultModel(cfg) → { cfg, changed }` plus a thin file-IO wrapper. Without extraction the decision-table logic is unreachable by L1 vitest and would have to be duplicated in a test — a DRY violation. `test-entrypoint.sh` then calls the module instead of an inline program. This is the one implementation-structure change the L1 rows depend on.
- No new test level/harness: L1 is existing vitest; I1 extends an existing `tests/e2e/` faux spec.
