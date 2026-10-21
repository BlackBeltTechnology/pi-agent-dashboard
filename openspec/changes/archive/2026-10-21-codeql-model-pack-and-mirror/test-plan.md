# Test Plan — codeql-model-pack-and-mirror

Stage: design   Generated: 2026-10-21

Levels: `L1` = vitest. The locations used are `packages/shared/src/__tests__/*.test.ts` (repo contract tests) and `scripts/__tests__/codeql-local*.test.mjs` (ratchet; fake `CODEQL_BIN` via `scripts/__tests__/fixtures/fake-codeql.mjs`, fake `gh` via `PI_CODEQL_GH_BIN`). `L1-real` = the opt-in real-CLI suite `scripts/__tests__/codeql-local-real.test.mjs`, run with the installed `codeql` 2.27.2; it skips when CodeQL is absent, like the existing suite.

The spike (tasks 4.1–4.2) is a pre-merge gate on throwaway branches, not a durable test. It is owned by `tasks.md` and is deliberately not a manifest row.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Model type strings name the intended package | EP (quoted / unquoted / dot-free) | L1 | automated | a model YAML with rows typed `@s/p/m.js` (unquoted), `'@s/p/m.js'` (quoted), `@s/p/m` (bare) | contract test parses every `.github/codeql/extensions/*.model.yml` (plus this fixture) | fails naming file + row for the unquoted one only; passes on the repo's fixed `cwd-guard.model.yml` |
| E2 | Local analysis loads the model files (CI/local parity guard) | EP | L1 | automated | `.github/codeql/extensions/` containing `cwd-guard.model.yml`, `AGENTS.md`, and a fixture `extra.yml` | contract test lists the directory | passes with `*.model.yml` + `AGENTS.md` (+ `codeql-pack.yml` allowed); fails naming `extra.yml` |
| E3 | Model type strings (existing consumer) | regression | L1 | automated | `cwd-guard.model.yml` with quoted `.js` rows | `bundled-plugins-complete.test.ts` `has()` looks up `'@blackbelt-technology/pi-dashboard-shared/cwd-guard.js'` for `isAllowedCwd`, `admissionAllows`, `tokenAllows`, `admitCwd` | each lookup finds its row; the test passes |
| E4 | Quoted `.js` type suppresses a guarded sink | state (guarded vs twin) | L1-real | automated | fixture tree: shared `package.json` (exports `./*.js`) + `src/cwd-guard.ts`; route file importing `isAllowedCwd` from `@blackbelt-technology/pi-dashboard-shared/cwd-guard.js`; guarded and unguarded `fs.readFileSync(req.query.cwd + …)` | real local analysis with the repo's model files | `js/path-injection` reported at the unguarded line only |
| E5 | Quoted model (barrier scope) | negative case | L1-real | automated | same fixture plus `await admitCwd(c, known)` whose result is never branched on, then `fs.readFileSync(c + "/x")` | real local analysis | `js/path-injection` reported at that sink |
| E6 | Analysis passes the pack | decision table (language × flag) | L1 | automated | fake `CODEQL_BIN` recording argv | `node scripts/codeql-local.mjs --json` | the `javascript-typescript` `database analyze` argv has `--additional-packs=<dir>` with `<dir>` outside `<run>/src`, plus `--model-packs=pi-dashboard/local-models`; the `actions` and `python` argv have neither; no argv has `--download` |
| E7 | Wrapper copies exactly the model files | EP | L1 | automated | snapshot with `.github/codeql/extensions/a.model.yml` + `AGENTS.md` | run with fake `CODEQL_BIN` | `<run>/model-pack/` holds exactly `codeql-pack.yml` + `a.model.yml`; recorded `snapshotId` equals `snapshotId(cwd)` computed before the run |
| E8 | Uncommitted model edit is analyzed | state | L1 | automated | tracked `a.model.yml` with an unstaged edit (marker comment) | run with fake `CODEQL_BIN` | the copied `a.model.yml` contains the marker |
| E9 | Ignored model file is not applied | EP | L1 | automated | `.gitignore` entry for `.github/codeql/extensions/x.model.yml`; file present | run with fake `CODEQL_BIN` | `<run>/model-pack/` has no `x.model.yml` |
| E10 | Model digest reported | BVA (file order) | L1 | automated | two model files `b.model.yml`, `a.model.yml` | `--json` run with fake `CODEQL_BIN` | `versions.models` == sha256 of `a.model.yml` bytes followed by `b.model.yml` bytes (byte-wise sorted paths) |
| E11 | Spike glob excludes only the root spike directory | EP | L1 | automated | `paths-ignore: ["spike/**"]` | `indexFilters` | filter lines contain exactly `exclude:spike` |
| E12 | Spike glob (extractor semantics) | EP | L1-real | automated | injected config with `spike/**`; flagged pattern in `spike/a.mjs` and `packages/x/spike/b.mjs` | real local analysis | a result references `packages/x/spike/b.mjs`; none references `spike/a.mjs` |
| E13 | Dismissed reason grammar | decision table | L1 | automated | reasons `github-dismissed (#12, #13, won't fix): operator-authz: x` / `(#12, x): y` / `(#0, false positive): y` / `(#12, used in tests): y` | `reasonError` | valid / invalid / invalid / valid |
| E14 | Dismissed reason grammar (existing data) | regression sweep | L1 | automated | the committed `codeql-baseline.json` | `reasonError` over every entry | returns null for every entry |
| E15 | Run record fields | state | L1 | automated | repo with an untracked file vs a clean repo | analysis with fake `CODEQL_BIN` | `last-run.json` has `headCommit` == `git rev-parse HEAD` in both; `clean` false then true |
| E16 | Remote parsing | EP + BVA | L1 | automated | `git@github.com:o/r.git`, `ssh://git@github.com/o/r`, `https://github.com/o/r/`, `https://github.com/o/r.git` / `https://gitlab.com/o/r`, `git@github.com:o/..`, `https://github.com/o%2F/r`, `https://github.com/o/r/x` | exported pure parser | first four → `{owner:"o", repo:"r"}`; last four → refusal |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Model pack is verified before analysis | fault (wrong data) | L1 | automated | fake `resolve extensions` reports `rowCount` 7 for a file holding 10 rows | `node scripts/codeql-local.mjs` | exit 2; stderr names `pi-dashboard/local-models`; no `database analyze` call recorded |
| X2 | Model pack is verified (file omitted) | fault (wrong data) | L1 | automated | fake output lists no entry for the copied file | run | exit 2 naming the pack |
| X3 | Model pack not found is an error, not a skip | fault (abort) | L1 | automated | fake `resolve extensions` exits 2 with `ERROR: Could not find extension pack 'pi-dashboard/local-models'` | run (and with `--json`) | exit 2; no `CODEQL SKIPPED:` line; `--json` `status` `error` |
| X4 | Model pack verified (unparsable) | fault (garbage) | L1 | automated | fake `resolve extensions` prints non-JSON, exit 0 | run | exit 2 naming the pack |
| M1 | Mirror-dismissal mode | state (happy) | L1 | automated | recorded clean run with `headCommit` H; `operator-authz:` entry count 2 at lines {10, 20}; fake `gh` returns alerts 12 (line 10) and 13 (line 20), both dismissed `won't fix`, same rule/file, `commit_sha` H | `--mirror-dismissal <key> --alert 12,13` | exit 0; reason `github-dismissed (#12, #13, won't fix): operator-authz: …`; count 2; the next `--prune` is accepted (hash re-bound) |
| M2 | Mirror refusals (count) | BVA (n−1, n+1) | L1 | automated | as M1 | `--alert 12` and `--alert 12,13,14` | each exit 2; baseline bytes unchanged |
| M3 | Mirror refusals (line multiset) | decision table | L1 | automated | as M1, but alert 13 at line 10 | `--alert 12,13` | exit 2; baseline unchanged |
| M4 | Mirror refusals (alert state) | EP | L1 | automated | alert 13 `state: "open"` | `--alert 12,13` | exit 2 naming 13; baseline unchanged |
| M5 | Mirror refusals (rule/file) | EP | L1 | automated | alert 13 for another file; separately, for another rule id | `--alert 12,13` | exit 2 each; baseline unchanged |
| M6 | Mirror refusals (commit) | EP | L1 | automated | alert 13 `commit_sha` ≠ H | `--alert 12,13` | exit 2; baseline unchanged |
| M7 | Mirror refusals (reason) | decision table | L1 | automated | alert 12 `false positive`, alert 13 `won't fix` | `--alert 12,13` | exit 2; baseline unchanged |
| M8 | Mirror input checks (entry reason) | EP | L1 | automated | entry `untriaged`; entry `github-dismissed (#5, won't fix): x`; key absent | `--mirror-dismissal … --alert 12[,13]` | exit 2 each; baseline unchanged; fake `gh` never invoked |
| M9 | Mirror input checks (run state) | state | L1 | automated | recorded run with `clean: false`; legacy record without `baselineHash`; no record | `--mirror-dismissal … --alert 12,13` | exit 2 each; baseline unchanged |
| M10 | Mirror input checks (flags) | decision table | L1 | automated | valid M1 setup | `--mirror-dismissal` combined with each of `--json`, `--reason x`, `--prune`, `--accept`, `--triage`, `--write-baseline`, `--check-baseline-diff`, `--no-growth`; plus `--alert 12` alone | exit 2 each; baseline unchanged |
| M11 | Mirror input checks (alert list) | EP + BVA | L1 | automated | `--alert 0`, `--alert a`, `--alert 12,12`, `--alert ""`, `--alert -1` | `--mirror-dismissal …` | exit 2 each; fake `gh` never invoked |
| M12 | Mirror hash binding | state | L1 | automated | M1 setup, then the baseline hand-edited (another entry's reason text) after the run | `--mirror-dismissal … --alert 12,13` then `--prune` | the mirror exits 0 and writes; `--prune` exits 2 ("re-run first") |
| M13 | Mirror refusals (GitHub CLI abort) | fault (abort) | L1 | automated | `PI_CODEQL_GH_BIN` = fake that exits 1 with `gh: To get started with GitHub CLI, please run: gh auth login`; separately, a path that is not executable | `--mirror-dismissal … --alert 12,13` | exit 2 each; baseline unchanged |
| M14 | Stalled GitHub CLI is refused | fault (delay) | L1 | automated | `PI_CODEQL_GH_TIMEOUT_MS=200`; fake `gh` sleeps 2 s | `--mirror-dismissal … --alert 12,13` | exit 2 within 2 s; baseline unchanged |
| M15 | Mirror input checks (timeout value) | BVA | L1 | automated | `PI_CODEQL_GH_TIMEOUT_MS` = `0`, `-5`, `abc` | `--mirror-dismissal … --alert 12,13` | exit 2 each; fake `gh` never invoked |
| M16 | Mirror refusals (missing field) | fault (schema drift) | L1 | automated | fake `gh` returns the fixture without `most_recent_instance.commit_sha` | `--mirror-dismissal … --alert 12,13` | exit 2 naming the field; baseline unchanged |
| M17 | Mirror keeps the diff check passing | state | L1 | automated | a branch whose only baseline change is an M1 mirror | `--check-baseline-diff <parent>` and `--check-baseline-diff <parent> --no-growth` | both exit 0 |

---

## Coverage summary

- Requirements covered: 10/10 delta requirements. Every scenario block in `specs/codeql-local-ratchet/spec.md` maps to at least one row; unchanged base scenarios stay covered by the existing suites.
- Scenarios by class: edge 16 · perf 0 · frontend 0 · error 21
- Scenarios by level: L1 34 · L1-real 3 · L2 0 · L3 0
- Scenarios by disposition: automated 37 · manual-only 0

## New infra needed

- A fake `gh` fixture (`scripts/__tests__/fixtures/fake-gh.mjs`), selected via `PI_CODEQL_GH_BIN`. It serves recorded alert JSON per number and can fail or sleep on demand. Modelled on `fake-codeql.mjs`.
- `fake-codeql.mjs` learns `resolve extensions` (serves the captured `codeql-resolve-extensions.json`, or a scripted fault).
- The real-CLI suite gains a mini-monorepo fixture (shared `package.json` + `cwd-guard.ts`) and a config-injection hook for E12.
