# Test Plan — add-plugin-spawn-scope (umbrella: #473 + #475)

Stage: design   Generated: 2026-08-26

Umbrella change folding Capability A (`plugin-spawn-scope`, #473) + Capability B
(`host-cwd-policy`, #475). Part A ids are `E*/X*/F*`; Part B ids are `CE*/CF*`
(C = cwd-policy) to keep the two namespaces disjoint. All spec scenarios resolve
concrete Triples (input · trigger · observable) — no unfillable slots.

---

## Part A scenarios — `plugin-spawn-scope` (#473)

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
| E15 | Array config value JSON round-trips | fault (unsafe path chars) | L1 | automated | `scope.extensionConfig={guard:{allowedRoots:["/a","/b,c"," /d "]}}` | mapper → `buildSpawnEnv` → `JSON.parse` | env `PI_EXT_GUARD_ALLOWED_ROOTS` = `JSON.stringify(arr)`; parsed value deep-equals original (lossless; no delimiter split); scalar keys still project verbatim |

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

### Part A coverage

- Requirements covered: 6/6
- Scenarios by class: edge 15 · perf 0 · frontend 1 · error 5
- Scenarios by level: L1 20 · L2 0 · L3 1
- Scenarios by disposition: automated 21 · manual-only 0

---

## Part B scenarios — `host-cwd-policy` (#475)

`mergeCwdPolicy` and the registry are pure/in-process (L1); the headline
"applied to a generic non-plugin spawn" acceptance is proven end-to-end at L3.

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| CE1 | Register then resolve | EP | L1 | automated | `registerCwdPolicy("/w/secrets",{noTools:true})` | `resolveCwdPolicy("/w/secrets")` | composed policy carries `noTools:true` |
| CE2 | Symlink alias keys same entry | EP | L1 | automated | register via `/alias/secrets`→`/real/secrets` (tmp symlink) | resolve for spawn in `/real/secrets` | policy applies (canonical keying) |
| CE3 | Not-yet-created dir under symlinked ancestor | EP | L1 | automated | `/work-link`→`/real/work`; register `/work-link/new` before it exists; create + spawn | resolve for `/work-link/new` | policy applies (longest-existing-ancestor canonicalization) |
| CE4 | Symlink swap does not fail open | state-transition | L1 | automated | register `/projects/target`; later replace with symlink elsewhere | resolve for spawn under `/projects/target` | policy STILL applies (lexical-form match; floor over-applies not disappears) |
| CE5 | Untrusted plugin cannot register | decision-table | L1 | automated | untrusted plugin (priority above gate) calls `ctx.registerCwdPolicy` | later spawn in that cwd | nothing registered; spawn unaffected |
| CE6 | Plugin extension fields rejected | fault (fail-closed) | L1 | automated | `registerCwdPolicy("/w/secrets",{noTools:true,extensions:["/evil.js"]})` | register call | observable error, registers NOTHING; spawn gains neither `--no-tools` nor `-e /evil.js` |
| CE7 | Overly-broad target rejected | BVA (boundary) | L1 | automated | `registerCwdPolicy("/",...)` or `registerCwdPolicy("<home>",...)` | register call | rejected, registers nothing |
| CE8 | Registered policy immutable | fault | L1 | automated | register `{tools:["read"]}`, then push `"exec"` onto the passed array | `resolveCwdPolicy` | still `tools:["read"]` — mutation does not reach spawn |
| CE9 | Unregister owner-scoped | decision-table | L1 | automated | A reg `{noTools:true}` + B reg `{noBuiltinTools:true}` for `/w/secrets`; B unregisters | `resolveCwdPolicy("/w/secrets")` | still `noTools:true` from A's surviving entry |
| CE10 | Unregister unregistered = no-op | BVA | L1 | automated | plugin unregisters `/never/registered` with nothing of its own there | unregister call | returns without throw; registry unchanged |
| CE11 | Plugin unload drops its policies | state-transition | L1 | automated | trusted plugin registers `{noTools:true}` for `/w/secrets`, then unloads | later generic spawn in `/w/secrets` | argv does NOT carry `--no-tools` from departed plugin |
| CE12 | Funnel merges policy into argv | EP | L1 | automated | registry (test-injected) has `{noTools:true}` for cwd; `spawnPiSession(cwd,{})` argv assembly | funnel resolve+merge before argv | assembled argv contains `--no-tools` |
| CE13 | No matching policy byte-identical | regression | L1 | automated | spawn cwd with no registered policy | funnel argv+env assembly | byte-identical to pre-change `spawnPiSession` output for that mechanism |
| CE14 | Policy tools allowlist reaches argv | EP | L1 | automated | policy `{tools:["read","grep"]}` for cwd, no caller scope | funnel→argv | `--tools read,grep` |
| CE15 | Allowlist intersection tightens | EP | L1 | automated | caller `tools:["read","grep","write"]` + policy `tools:["read","grep"]` | `mergeCwdPolicy` | merged `--tools read,grep`, no `write` |
| CE16 | Caller cannot widen host ban | decision-table | L1 | automated | policy `noTools:true` + caller `noTools:false`,`tools:["read"]` | `mergeCwdPolicy` | merged carries `noTools:true` — caller cannot clear ban |
| CE17 | Denylist union | EP | L1 | automated | caller `excludeTools:["write"]` + policy `excludeTools:["exec"]` | `mergeCwdPolicy` | merged `--exclude-tools` has both `write` and `exec` |
| CE18 | Sticky-true booleans | decision-table | L1 | automated | either side sets `noBuiltinTools:true` | `mergeCwdPolicy` | merged `noBuiltinTools:true` |
| CE19 | Policy allowlist applies when caller omits tools | BVA (omitted side) | L1 | automated | policy `tools:["read"]` + caller options omit `tools` | `mergeCwdPolicy` | merged `--tools read` (NOT "caller unrestricted") |
| CE20 | Composition order-independent (3+ ancestors) | property | L1 | automated | `{noTools:true}`,`{excludeTools:["a"]}`,`{excludeTools:["b"]}` composed in any order | `mergeCwdPolicy` | identical result: `noTools:true`, `excludeTools ⊇ {a,b}` |
| CE21 | Empty policy is identity | regression | L1 | automated | `mergeCwdPolicy({}, options)` | merge | returns `options` unchanged |
| CE22 | Broad ban survives narrow looser reg | decision-table | L1 | automated | `/work`={noTools:true}, `/work/secrets`={tools:["read"]}, spawn `/work/secrets/deep` | `resolveCwdPolicy` | merged carries `noTools:true` — narrower does NOT re-enable tools |
| CE23 | Same-path second reg composes not replaces | state-transition | L1 | automated | reg `{excludeTools:["exec"]}` then `{excludeTools:["write"]}` for `/w/secrets` | `resolveCwdPolicy` | excludes BOTH `exec` and `write` |
| CE24 | Sibling prefix no false-match | BVA (boundary) | L1 | automated | `/work` registered; spawn lands in `/work-shop/app` | `resolveCwdPolicy` | `/work` policy NOT applied |
| CE25 | No plugin path produces extension-bearing policy | property | L1 | automated | only plugin-facing registrations exist | resolve any | no resolved policy carries `extensions`/`extensionConfig`; no `-e`/`PI_EXT_*` from host policy |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| CF1 | Policy applied to a GENERIC (non-plugin) spawn | state-convergence | L3 | automated | a cwd policy `{noTools:true}` registered for a workspace dir; a generic user-initiated (non-plugin) session spawned there against the docker harness | session boots | the spawned session is constrained (no model-facing tools) yet still loads the bridge + REGISTERS — session card converges into the dashboard list; constraint applied with no plugin originating the spawn |

### Part B coverage

- Requirements covered: 8/8
- Scenarios by class: edge 25 · perf 0 · frontend 1 · error 0 (fail-closed reject cases folded into edge CE6/CE7)
- Scenarios by level: L1 25 · L2 0 · L3 1
- Scenarios by disposition: automated 26 · manual-only 0

---

## Combined coverage summary

- Requirements covered: 14/14 (6 Part A + 8 Part B)
- Total scenarios: 47 (Part A 21 · Part B 26)
- Scenarios by level: L1 45 · L2 0 · L3 2
- Scenarios by disposition: automated 47 · manual-only 0

## New infra needed

- none — Part A L1 rows extend `packages/dashboard-plugin-runtime` + `packages/shared`
  vitest suites; Part B L1 rows add `packages/server/src/spawn-process/__tests__/cwd-policy.test.ts`
  (+ funnel assertions extending `process-manager` tests, in-process tmp-dir symlinks for
  CE2–CE4/CE11); F1 + CF1 extend the existing docker e2e harness.
