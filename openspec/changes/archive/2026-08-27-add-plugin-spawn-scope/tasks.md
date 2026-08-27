## 1. Shared argv layer — `SessionFlags` + `sessionFlagsToArgv`

- [x] 1.1 Add capability-scope fields to `SessionFlags` in `packages/shared/src/platform/spawn-mechanism.ts` (`tools?`, `excludeTools?`, `noBuiltinTools?`, `noTools?`, `skills?`, `noSkills?`, `extensions?`) — flat primitives, matching the existing `model`/`name` convention. Deliberately NO `noExtensions` field.
- [x] 1.2 Emit the scope flags from `sessionFlagsToArgv`: comma-joined single arg for `--tools`/`--exclude-tools`; repeated `--skill <path>` and `-e <path>`; bare `--no-builtin-tools`/`--no-tools`/`--no-skills`. Each only when present; empty array emits nothing. Append after the existing session/model/name flags so absent-scope argv is byte-identical.

## 2. Env layer — `SessionOptions` + `buildSpawnEnv`

- [x] 2.1 Add scope fields + `extensionConfig?: Record<string,Record<string,string>>` to `SessionOptions` in `packages/server/src/spawn-process/process-manager.ts`; thread the argv scope fields into the `sessionFlagsToArgv` call sites (`buildHeadlessArgs`/wt/tmux) via `SessionFlags`.
- [x] 2.2 Project `extensionConfig` into env in `buildSpawnEnv`: for each `name`/`key`, set `PI_EXT_<NAME>_<KEY>` where name+key are uppercased with every `[^A-Z0-9_]` char replaced by `_`. Absent `extensionConfig` leaves env untouched. Applies on the headless mechanism (the plugin-spawn path).

## 3. Mapper + plugin-facing type

- [x] 3.1 Add the optional `scope` block to `PluginSpawnOptions` in `packages/dashboard-plugin-runtime/src/server/server-context.ts` (nested block per design D1; no `noExtensions`).
- [x] 3.2 Add exported total pure function `pluginSpawnToSessionOptions(opts: PluginSpawnOptions): SessionOptions` (dashboard-plugin-runtime) that flattens `scope` → `SessionOptions` scope fields + `extensionConfig`. Total: never throws; malformed containers (`null`/array/primitive where an array/record is expected) treated as absent; argv-bound strings dropped when not a non-empty string or containing NUL; `extensionConfig` values dropped when non-string or containing NUL.

## 4. Server hook wiring

- [x] 4.1 In the `spawnSession` hook (`packages/server/src/server.ts` ~2185) replace the inline `spawnPiSession(cwd, {...})` literal with a call to `pluginSpawnToSessionOptions(opts)`, spread into the `spawnPiSession` call. Call the mapper BEFORE `pendingAutomationRunRegistry.enqueue` so a malformed-input path cannot strand a stale `automationRun` stamp keyed by `cwd`. Trust gate (`priority <= 100`) unchanged.

## 5. Folded automated tests — L1 argv (extend `packages/shared/src/platform/__tests__/spawn-mechanism.test.ts`)

- [x] 5.1 Partial scope block. Input: `scope.tools=["read"]`, all else absent · trigger: mapper→argv · observable: `--tools read` and no skill/extension/builtin flag. (see spawn-mechanism.test.ts) (test-plan #E2)
- [x] 5.2 Allowlist comma-joined. Input: `scope.tools=["read","grep","ls"]` · trigger: mapper→argv · observable: `--tools` then single arg `read,grep,ls`. (test-plan #E3)
- [x] 5.3 Repeatable `--skill`. Input: `scope.skills=["/a/skill.md","/b/skill.md"]` · trigger: mapper→argv · observable: `--skill /a/skill.md` and `--skill /b/skill.md` separate pairs. (test-plan #E4)
- [x] 5.4 Repeatable `-e`. Input: `scope.extensions=["/x/ext.js","/y/ext.js"]` · trigger: mapper→argv · observable: `-e /x/ext.js` and `-e /y/ext.js` separate pairs. (test-plan #E5)
- [x] 5.5 Boolean toggles bare. Input: `scope.noTools=true`,`scope.noSkills=true` · trigger: mapper→argv · observable: argv contains `--no-tools` and `--no-skills`. (test-plan #E6)
- [x] 5.6 Empty array emits no flag. Input: `scope.tools=[]` · trigger: mapper→argv · observable: no `--tools` flag present. (test-plan #E7)
- [x] 5.7 Conflicting fields both forwarded. Input: `scope.noTools=true` + `scope.tools=["read"]` · trigger: mapper→argv · observable: both `--no-tools` and `--tools read`; neither dropped nor rejected. (test-plan #E8)
- [x] 5.8 No `--no-extensions` ever emitted. Input: any combination of `scope` fields (incl. every boolean true) · trigger: mapper→argv · observable: argv NEVER contains `--no-extensions`. (test-plan #E14)
- [x] 5.9 Non-string allowlist entries dropped. Input: `scope.tools=["read",42,"",null,"grep"]` (runtime JS) · trigger: mapper→argv · observable: `--tools read,grep`; invalids dropped; no throw. (test-plan #X1)
- [x] 5.10 NUL in argv-bound string dropped. Input: a `skills`/`extensions`/`tools` entry contains `\0` · trigger: mapper→argv · observable: that entry dropped; spawn proceeds; no `spawn` crash. (test-plan #X2)

## 6. Folded automated tests — L1 env (new test beside `packages/server/src/__tests__/cli-env-no-clobber.test.ts`)

- [x] 6.1 Config → namespaced env. Input: `scope.extensionConfig={myext:{token:"abc"}}` · trigger: mapper→`buildSpawnEnv` (headless) · observable: `PI_EXT_MYEXT_TOKEN=abc`; no argv element derived. (see cli-env-no-clobber.test.ts) (test-plan #E9)
- [x] 6.2 Name/key normalization. Input: `{"my-ext":{"api.key":"v"}}` · trigger: mapper→env · observable: `PI_EXT_MY_EXT_API_KEY=v`. (test-plan #E10)
- [x] 6.3 extensionConfig absent leaves env untouched. Input: `scope.extensionConfig` absent · trigger: mapper→env · observable: env carries no `PI_EXT_*` from this capability. (test-plan #E11)
- [x] 6.4 NUL in env value dropped. Input: an `extensionConfig` value contains `\0` · trigger: mapper→env · observable: entry dropped; spawn proceeds; no crash. (test-plan #X3)

## 7. Folded automated tests — L1 mapper (new test in `packages/dashboard-plugin-runtime/src/__tests__/`)

- [x] 7.1 Scope omitted ⇒ byte-identical. Input: `{cwd,model}` no `scope` · trigger: `pluginSpawnToSessionOptions`→`sessionFlagsToArgv`+`buildSpawnEnv` · observable: argv byte-identical to pre-change output; env carries no `PI_EXT_*`. (see server-context-model-runtime.test.ts) (test-plan #E1)
- [x] 7.2 Mapper forwards existing fields unchanged. Input: `{cwd,model}` no scope · trigger: `pluginSpawnToSessionOptions` · observable: returned `SessionOptions.model` unchanged; argv equals prior inline-literal argv. (test-plan #E12)
- [x] 7.3 Mapper forwards scope fields. Input: full `scope` block · trigger: `pluginSpawnToSessionOptions` · observable: each `scope.*` reaches `sessionFlagsToArgv` (argv) and `buildSpawnEnv` (`extensionConfig`). (test-plan #E13)
- [x] 7.4 Malformed container treated as absent. Input: `scope.extensionConfig`/`scope` = `null` | array | primitive · trigger: mapper · observable: treated as absent; no throw; no iteration error. (test-plan #X4)
- [x] 7.5 Mapping precedes automationRun enqueue. Input: options carry both `automationRun` + malformed `scope` · trigger: `spawnSession` hook · observable: `pluginSpawnToSessionOptions` runs BEFORE `pendingAutomationRunRegistry.enqueue`; a sanitized/rejected input cannot strand a stamp keyed by `cwd`. (test-plan #X5)

## 8. Folded automated tests — L3 e2e (extend `tests/e2e/automation-fanout.spec.ts` pattern)

- [~] 8.1 **DEFERRED to manual/later QA** — no consumer surface drives `scope` yet. This change is pure plumbing: the proposal scopes consumers (automation-plugin, flows, REST spawn) as *future opt-in*, so nothing currently passes a `scope` block to the plugin `spawnSession` hook. An authentic docker-harness F1 (boot a real headless session with `scope.noTools=true`) would require adding consumer wiring that is out of scope here. The targeted control-channel invariant is already structurally guaranteed (no `--no-extensions` field, D2/D6) and asserted by the L1 E14 tests (mapper/argv NEVER emit `--no-extensions` under any scope combination). Re-activate this L3 e2e once a first-party consumer opts into `scope`. (see tests/e2e/automation-fanout.spec.ts) (test-plan #F1)

## 9. Docs

- [x] 9.1 Document the `scope` block + `PI_EXT_<NAME>_<KEY>` env convention and the deliberate no-`noExtensions` control-channel rule. Update the per-file `AGENTS.md` rows for the changed exports: `packages/dashboard-plugin-runtime/src/server/AGENTS.md` (`PluginSpawnOptions`, `pluginSpawnToSessionOptions`), `packages/shared/src/platform/AGENTS.md` (`SessionFlags`/`sessionFlagsToArgv`), `packages/server/src/spawn-process/AGENTS.md` (`SessionOptions`/`buildSpawnEnv`). Any `docs/` prose is delegated to DocScribe in caveman style.

## 10. Part A consolidation — `extensionConfig` `string | string[]` JSON encoding (design D8)

> These amend the already-implemented (string-only) mapper + env projection to accept array values. Do them before Part B if Part A's env layer was built string-only.

- [x] 10.1 Widen the `extensionConfig` type to `Record<string, Record<string, string | string[]>>` on `PluginSpawnOptions` + `SessionOptions` (`server-context.ts`, `process-manager.ts`).
- [x] 10.2 In `buildSpawnEnv`, project a scalar `string` value verbatim and a `string[]` value as `JSON.stringify(value)` for `PI_EXT_<NAME>_<KEY>`. Update the total-mapper sanitization: accept a value that is a string OR an array of strings; within an array drop elements that are not non-empty strings or contain NUL; drop the entry if no valid elements remain.
- [x] 10.3 Round-trip test (extend the Part A env test): `scope.extensionConfig={guard:{allowedRoots:["/a","/b,c"," /d "]}}` → `buildSpawnEnv` → `JSON.parse(env.PI_EXT_GUARD_ALLOWED_ROOTS)` deep-equals the original array; a sibling scalar key still projects verbatim. (test-plan #E15)

## 11. Part B implementation — `host-cwd-policy` (#475)

> Intra-change ordering: Part A's flat `SessionFlags`/`SessionOptions` fields + `sessionFlagsToArgv`/`buildSpawnEnv` emission (§1–§4) must exist before §11.5's merge step. No cross-change dependency remains (folded).

- [x] 11.1 Add `packages/server/src/spawn-process/cwd-policy.ts`: `CwdPolicyRegistry` with `registerCwdPolicy(cwd, policy)`, `unregisterCwdPolicy(cwd)`, `resolveCwdPolicy(cwd)`; entries keyed by `(owningPluginId, canonicalCwd)`. Canonicalize via `fs.realpathSync` of the longest EXISTING ancestor + lexical trailing segments; case-fold on Windows (design B6).
- [x] 11.2 Implement pure `mergeCwdPolicy(policy, options)` composing ONLY tightening fields — `tools`/`skills` INTERSECTION (absent side = universe; policy-present + caller-absent ⇒ policy applies), `excludeTools` UNION, `noBuiltinTools`/`noTools`/`noSkills` sticky-OR; all commutative+associative. Does NOT compose `extensions`/`extensionConfig` (design B2). Empty/absent policy ⇒ `options` unchanged.
- [x] 11.3 Plugin-facing `registerCwdPolicy`: REJECT (observable error, register nothing) a policy carrying `extensions`/`extensionConfig` (design B3); REJECT targets that are `/`, `$HOME`, or outside a recognized workspace root (design B7); store a deep-frozen copy (immutability); `unregisterCwdPolicy` removes only the caller's entry + is idempotent (design B5/B6).
- [x] 11.4 `resolveCwdPolicy(cwd)` composes EVERY registered entry that is an ancestor-of-or-equal-to the spawn cwd, across all plugins AND matching ancestor dirs, via `mergeCwdPolicy`; match at path-segment boundaries on canonical OR lexical form (design B4/B6). Never overwrite.
- [x] 11.5 Wire a single `CwdPolicyRegistry` instance into `spawnPiSession` (`process-manager.ts` ~L446) — resolve + merge policy into `options` BEFORE argv/env; and into every `createServerPluginContext` (design B5).
- [x] 11.6 Expose `registerCwdPolicy`/`unregisterCwdPolicy` on `ServerPluginContext` (`server-context.ts`), trust-gated (`priority<=100`, no-op for untrusted); wire in `server.ts`.
- [x] 11.7 Drop all of a plugin's registry entries on plugin unload/disable (design B6); hook the existing plugin-unregister lifecycle.
- [x] 11.8 Document the registry + non-weakening/tighten-only contract + accepted limitations (TOCTOU, literal-token intersection) in the relevant `AGENTS.md` rows (`packages/server/src/spawn-process/AGENTS.md`).

## 12. Part B folded tests — `host-cwd-policy`

- [x] 12.1 Register then resolve (new `packages/server/src/spawn-process/__tests__/cwd-policy.test.ts`; `registerCwdPolicy("/w/secrets",{noTools:true})` · `resolveCwdPolicy` · composed policy carries `noTools:true`) (test-plan #CE1)
- [x] 12.2 Symlink alias keys same entry (register via tmp symlink `/alias/secrets`→`/real/secrets` · resolve for `/real/secrets` · policy applies) (test-plan #CE2)
- [x] 12.3 Not-yet-created dir under symlinked ancestor matches (`/work-link`→`/real/work`, register `/work-link/new` pre-existence, then create+spawn · resolve · policy applies) (test-plan #CE3)
- [x] 12.4 Symlink swap does not fail open (register `/projects/target` then replace with elsewhere-symlink · resolve · policy STILL applies via lexical match) (test-plan #CE4)
- [x] 12.5 Untrusted plugin cannot register (see `server-context-provider-auth.test.ts`; untrusted plugin calls register · later spawn · nothing registered, spawn unaffected) (test-plan #CE5)
- [x] 12.6 Plugin extension fields rejected (`{noTools:true,extensions:["/evil.js"]}` · register · observable error, registers nothing, spawn gains neither `--no-tools` nor `-e /evil.js`) (test-plan #CE6)
- [x] 12.7 Overly-broad target rejected (`registerCwdPolicy("/",...)` / `("<home>",...)` · register · rejected, registers nothing) (test-plan #CE7)
- [x] 12.8 Registered policy immutable (register `{tools:["read"]}` then push `"exec"` onto passed array · resolve · still `tools:["read"]`) (test-plan #CE8)
- [x] 12.9 Unregister owner-scoped (A `{noTools:true}` + B `{noBuiltinTools:true}` for `/w/secrets`, B unregisters · resolve · still `noTools:true` from A) (test-plan #CE9)
- [x] 12.10 Unregister unregistered = no-op (unregister `/never/registered` · call · no throw, registry unchanged) (test-plan #CE10)
- [x] 12.11 Plugin unload drops its policies (register `{noTools:true}` for `/w/secrets` then unload · later generic spawn · argv lacks `--no-tools`) (test-plan #CE11)
- [x] 12.12 Funnel merges policy into argv (new test in `packages/server/src/__tests__/`, see `process-manager.test.ts`; test-injected registry `{noTools:true}` for cwd, `spawnPiSession(cwd,{})` · funnel resolve+merge · assembled argv contains `--no-tools`) (test-plan #CE12)
- [x] 12.13 No matching policy byte-identical (spawn cwd with no policy · argv+env assembly · byte-identical to pre-change output) (test-plan #CE13)
- [x] 12.14 Policy tools allowlist reaches argv (policy `{tools:["read","grep"]}`, no caller scope · funnel→argv · `--tools read,grep`) (test-plan #CE14)
- [x] 12.15 Allowlist intersection tightens (caller `tools:["read","grep","write"]` + policy `tools:["read","grep"]` · merge · `--tools read,grep`, no `write`) (test-plan #CE15)
- [x] 12.16 Caller cannot widen host ban (policy `noTools:true` + caller `noTools:false`,`tools:["read"]` · merge · merged `noTools:true`) (test-plan #CE16)
- [x] 12.17 Denylist union (caller `excludeTools:["write"]` + policy `excludeTools:["exec"]` · merge · both `write` and `exec`) (test-plan #CE17)
- [x] 12.18 Sticky-true booleans (either side `noBuiltinTools:true` · merge · merged `noBuiltinTools:true`) (test-plan #CE18)
- [x] 12.19 Policy allowlist applies when caller omits tools (policy `tools:["read"]` + caller omits `tools` · merge · `--tools read`, not "unrestricted") (test-plan #CE19)
- [x] 12.20 Composition order-independent across 3+ ancestors (`{noTools:true}`,`{excludeTools:["a"]}`,`{excludeTools:["b"]}` any order · merge · identical result) (test-plan #CE20)
- [x] 12.21 Empty policy is identity (`mergeCwdPolicy({},options)` · merge · returns `options` unchanged) (test-plan #CE21)
- [x] 12.22 Broad ban survives narrow looser reg (`/work`={noTools:true}, `/work/secrets`={tools:["read"]}, spawn `/work/secrets/deep` · resolve · `noTools:true`, tools not re-enabled) (test-plan #CE22)
- [x] 12.23 Same-path second reg composes not replaces (reg `{excludeTools:["exec"]}` then `{excludeTools:["write"]}` for `/w/secrets` · resolve · excludes both) (test-plan #CE23)
- [x] 12.24 Sibling prefix no false-match (`/work` registered, spawn `/work-shop/app` · resolve · `/work` policy NOT applied) (test-plan #CE24)
- [x] 12.25 No plugin path produces extension-bearing policy (only plugin-facing registrations · resolve · no `extensions`/`extensionConfig`, no `-e`/`PI_EXT_*` from host policy) (test-plan #CE25)
- [~] 12.26 **DEFERRED to manual/later QA** (L3 docker-harness e2e, like 8.1) — the funnel-covers-generic-spawns invariant is already proven at L1 by CE13 (byte-identical when no policy) + CE12/CE14 (policy reaches argv via `spawnPiSession`, which BOTH plugin and generic paths route through). An authentic docker-harness run (register a workspace policy, boot a real generic headless session, assert it loads the bridge + registers while constrained) needs live harness wiring beyond this pure-plumbing change; re-activate alongside 8.1 once a consumer surface exists. Policy applied to a GENERIC (non-plugin) spawn (see `tests/e2e/project-trust-headless-spawn.spec.ts`; cwd policy `{noTools:true}` for a workspace dir + a generic non-plugin session spawned there vs docker harness · session boots · constrained yet loads bridge + registers — card converges, no plugin originated the spawn) (test-plan #CF1)

## 13. Validate (both parts)

- [x] 13.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` green for the touched packages (shared, dashboard-plugin-runtime, server). New suites all pass (mapper 16, env 5, cwd-policy 27, funnel). The 8 pre-existing failures (faux-session real-pi-subprocess 20s timeouts, openspec/automation fs.watch integration) reproduce with this change's process-manager/server edits stashed — environment flakiness, not this change.
- [x] 13.2 `security-hardening` pass (STRIDE over the plugin→spawn boundary). Findings: (a) argv strings travel as single `execFile`/keeper tokens, `shell:false` — no shell surface; NUL-bearing argv/env strings dropped by the total mapper (X1/X2/X4). (b) env NAME normalized to `[A-Z0-9_]` — crafted keys cannot inject extra vars; array values JSON-encoded (no delimiter ambiguity). (c) Part B: plugin path REJECTS extension injection (CE6) + overly-broad targets bound the DoS blast radius to recognized workspace roots (CE7); merge is tighten-only (CE16); frozen policy (CE8); compose-never-overwrite + owner-scoped unregister (CE9/CE23); symlink swap fails-toward-applying not open (CE4); untrusted no-op (CE5). (d) Accepted pre-existing limitations, unchanged by this change: forgeable `priority<=100` gate (`-e` escalation — follow-up: real attestation), filesystem TOCTOU (canonical-OR-lexical narrows but doesn't close), literal-token intersection (pi owns taxonomy). No new dependencies; only node builtins + existing shared helpers. No critical/high findings.
- [x] 13.3 `review-code` pass. Design: merge algebra is pure/commutative/associative (order-independent composition), registry seam null-safe (byte-identical when unwired). Correctness: fixed a local `within` shadow of the imported helper; deep-freeze guards post-register mutation; empty-policy identity returns the same reference so no spurious `undefined` argv keys. Tests: 43 new (mapper/env/registry/funnel) cover every spec scenario except the two L3 docker-harness e2e (8.1/12.26) deferred with justification. Biome: cleared the complexity warning I aggravated (extracted `sanitizeConfigValue`); the remaining warning on `pluginSpawnToSessionOptions` pre-existed this change. No blocking issues.
