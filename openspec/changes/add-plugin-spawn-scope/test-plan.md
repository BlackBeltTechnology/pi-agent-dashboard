# Test Plan — add-plugin-spawn-scope

Stage: design   Generated: 2026-08-26

All spec scenarios resolve concrete Triples (input · trigger · observable) —
no unfillable slots, no clarifications needed.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Scope block omitted | regression / EP | L1 | automated | `{ cwd, model }`, no `scope` | `pluginSpawnToSessionOptions` → `sessionFlagsToArgv` + `buildSpawnEnv` | argv byte-identical to pre-change output; env carries no `PI_EXT_*` |
| E2 | Partial scope block | EP | L1 | automated | `scope.tools=["read"]`, all else absent | mapper → argv | argv contains `--tools read` and no skill/extension/builtin flag |
| E3 | Allowlist comma-joined | EP | L1 | automated | `scope.tools=["read","grep","ls"]` | mapper → argv | `--tools` immediately followed by single arg `read,grep,ls` |
| E4 | Repeatable `--skill` | EP | L1 | automated | `scope.skills=["/a/skill.md","/b/skill.md"]` | mapper → argv | `--skill /a/skill.md` and `--skill /b/skill.md` as separate pairs |
| E5 | Repeatable `-e` | EP | L1 | automated | `scope.extensions=["/x/ext.js","/y/ext.js"]` | mapper → argv | `-e /x/ext.js` and `-e /y/ext.js` as separate pairs |
| E6 | Boolean toggles bare | decision-table | L1 | automated | `scope.noTools=true`, `scope.noSkills=true` | mapper → argv | argv contains `--no-tools` and `--no-skills` |
| E7 | Empty array emits no flag | BVA (lower bound) | L1 | automated | `scope.tools=[]` | mapper → argv | no `--tools` flag present |
| E8 | Conflicting fields both forwarded | decision-table | L1 | automated | `scope.noTools=true` + `scope.tools=["read"]` | mapper → argv | both `--no-tools` and `--tools read` present; neither dropped nor rejected |
| E9 | Config → namespaced env | EP | L1 | automated | `scope.extensionConfig={ myext:{ token:"abc" } }` | mapper → `buildSpawnEnv` | env has `PI_EXT_MYEXT_TOKEN=abc`; no argv element derived from it |
| E10 | Name/key normalization | EP | L1 | automated | `scope.extensionConfig={ "my-ext":{ "api.key":"v" } }` | mapper → env | env has `PI_EXT_MY_EXT_API_KEY=v` |
| E11 | extensionConfig absent leaves env untouched | regression | L1 | automated | `scope.extensionConfig` absent | mapper → env | env carries no `PI_EXT_*` introduced by this capability |
| E12 | Mapper forwards existing fields unchanged | regression | L1 | automated | `{ cwd, model }` no scope | `pluginSpawnToSessionOptions` | returned `SessionOptions.model` unchanged; argv equals prior inline-literal argv |
| E13 | Mapper forwards scope fields | EP | L1 | automated | full `scope` block | `pluginSpawnToSessionOptions` | each `scope.*` reaches `sessionFlagsToArgv` (argv) and `buildSpawnEnv` (`extensionConfig`) |
| E14 | No `--no-extensions` ever emitted | property / decision-table | L1 | automated | any combination of `scope` fields (incl. every boolean true) | mapper → argv | argv NEVER contains `--no-extensions`; `scope` type exposes no field mapping to it |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Non-string allowlist entries dropped | fault-injection (malformed input) | L1 | automated | `scope.tools=["read", 42, "", null, "grep"]` | mapper → argv | `--tools read,grep`; invalid entries dropped; no throw |
| X2 | NUL in argv-bound string dropped | fault-injection | L1 | automated | a `skills`/`extensions`/`tools` entry contains `\0` | mapper → argv | that entry dropped; spawn proceeds; no `spawn` crash |
| X3 | NUL in env value dropped | fault-injection | L1 | automated | an `extensionConfig` value contains `\0` | mapper → env | that entry dropped; spawn proceeds; no crash |
| X4 | Malformed container treated as absent | fault-injection | L1 | automated | `scope.extensionConfig` = `null` \| array \| primitive (and same for `scope` itself) | mapper | treated as absent; no throw; no iteration error |
| X5 | Mapping precedes automationRun enqueue | state-transition (ordering invariant) | L1 | automated | options carry both `automationRun` + malformed `scope` | `spawnSession` hook | `pluginSpawnToSessionOptions` runs BEFORE `pendingAutomationRunRegistry.enqueue`; a rejected/sanitized input cannot strand a stamp keyed by `cwd` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Scope preserves control channel | state-convergence | L3 | automated | headless spawn with `scope.noTools=true` | session boots against docker harness | session loads the dashboard bridge and REGISTERS with the server (session card converges into the dashboard list); session is abortable — control channel intact despite `noTools` |

---

## Coverage summary

- Requirements covered: 6/6
- Scenarios by class: edge 14 · perf 0 · frontend 1 · error 5
- Scenarios by level: L1 19 · L2 0 · L3 1
- Scenarios by disposition: automated 20 · manual-only 0

## New infra needed

- none — L1 rows extend `packages/dashboard-plugin-runtime` + `packages/shared`
  vitest suites; F1 extends the existing docker e2e harness.
