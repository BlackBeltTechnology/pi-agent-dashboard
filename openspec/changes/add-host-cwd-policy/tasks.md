# Tasks — add-host-cwd-policy

> Depends on `add-plugin-spawn-scope` (#473) — do NOT start this worktree until
> #473 is merged (this change consumes its flat `SessionFlags`/`SessionOptions`
> fields + `sessionFlagsToArgv`/`buildSpawnEnv` emission).

## 1. Implementation

- [ ] 1.1 Add `packages/server/src/spawn-process/cwd-policy.ts`: `CwdPolicyRegistry` with `registerCwdPolicy(cwd, policy)`, `unregisterCwdPolicy(cwd)`, `resolveCwdPolicy(cwd)`; entries keyed by `(owningPluginId, canonicalCwd)`. Canonicalize via `fs.realpathSync` of the longest EXISTING ancestor + lexical trailing segments; case-fold on Windows (design D6).
- [ ] 1.2 Implement pure `mergeCwdPolicy(policy, options)` composing ONLY tightening fields — `tools`/`skills` INTERSECTION (absent side = universe; policy-present + caller-absent ⇒ policy applies), `excludeTools` UNION, `noBuiltinTools`/`noTools`/`noSkills` sticky-OR; all commutative+associative. Does NOT compose `extensions`/`extensionConfig` (design D2). Empty/absent policy ⇒ `options` unchanged.
- [ ] 1.3 Plugin-facing `registerCwdPolicy`: REJECT (observable error, register nothing) a policy carrying `extensions`/`extensionConfig` (design D3); REJECT targets that are `/`, `$HOME`, or outside a recognized workspace root (design D7); store a deep-frozen copy (immutability); `unregisterCwdPolicy` removes only the caller's entry + is idempotent (design D5/D6).
- [ ] 1.4 `resolveCwdPolicy(cwd)` composes EVERY registered entry that is an ancestor-of-or-equal-to the spawn cwd, across all plugins AND matching ancestor dirs, via `mergeCwdPolicy`; match at path-segment boundaries on canonical OR lexical form (design D4/D6). Never overwrite.
- [ ] 1.5 Wire a single `CwdPolicyRegistry` instance into `spawnPiSession` (`packages/server/src/spawn-process/process-manager.ts` ~L446) — resolve + merge policy into `options` BEFORE argv/env; and into every `createServerPluginContext` (design D5).
- [ ] 1.6 Expose `registerCwdPolicy`/`unregisterCwdPolicy` on `ServerPluginContext` (`packages/dashboard-plugin-runtime/src/server/server-context.ts`), trust-gated (`priority<=100`, no-op for untrusted); wire in `packages/server/src/server.ts`.
- [ ] 1.7 Drop all of a plugin's registry entries on plugin unload/disable (design D6); hook the existing plugin-unregister lifecycle.
- [ ] 1.8 Document the registry + non-weakening/tighten-only contract + accepted limitations (TOCTOU, literal-token intersection) in the relevant `AGENTS.md` rows.

## 2. Tests

- [ ] 2.1 Register then resolve (new `packages/server/src/spawn-process/__tests__/cwd-policy.test.ts`, see sibling `packages/server/src/__tests__/spawn-token.test.ts`; input `registerCwdPolicy("/w/secrets",{noTools:true})` · trigger `resolveCwdPolicy` · observable composed policy carries `noTools:true`) (test-plan #E1)
- [ ] 2.2 Symlink alias keys same entry (see `cwd-policy.test.ts`; input register via tmp symlink `/alias/secrets`→`/real/secrets` · trigger resolve for `/real/secrets` · observable policy applies) (test-plan #E2)
- [ ] 2.3 Not-yet-created dir under symlinked ancestor matches (see `cwd-policy.test.ts`; input `/work-link`→`/real/work`, register `/work-link/new` pre-existence, then create+spawn · trigger resolve · observable policy applies) (test-plan #E3)
- [ ] 2.4 Symlink swap does not fail open (see `cwd-policy.test.ts`; input register `/projects/target` then replace with elsewhere-symlink · trigger resolve for spawn under it · observable policy STILL applies via lexical match) (test-plan #E4)
- [ ] 2.5 Untrusted plugin cannot register (see `cwd-policy.test.ts` + `packages/dashboard-plugin-runtime/src/__tests__/server-context-provider-auth.test.ts`; input untrusted plugin calls register · trigger later spawn · observable nothing registered, spawn unaffected) (test-plan #E5)
- [ ] 2.6 Plugin extension fields rejected (see `cwd-policy.test.ts`; input `registerCwdPolicy("/w/secrets",{noTools:true,extensions:["/evil.js"]})` · trigger register · observable observable error, registers nothing, spawn gains neither `--no-tools` nor `-e /evil.js`) (test-plan #E6)
- [ ] 2.7 Overly-broad target rejected (see `cwd-policy.test.ts`; input `registerCwdPolicy("/",...)` / `("<home>",...)` · trigger register · observable rejected, registers nothing) (test-plan #E7)
- [ ] 2.8 Registered policy immutable (see `cwd-policy.test.ts`; input register `{tools:["read"]}` then push `"exec"` onto passed array · trigger resolve · observable still `tools:["read"]`) (test-plan #E8)
- [ ] 2.9 Unregister owner-scoped (see `cwd-policy.test.ts`; input A `{noTools:true}` + B `{noBuiltinTools:true}` for `/w/secrets`, B unregisters · trigger resolve · observable still `noTools:true` from A) (test-plan #E9)
- [ ] 2.10 Unregister unregistered = no-op (see `cwd-policy.test.ts`; input unregister `/never/registered` · trigger call · observable no throw, registry unchanged) (test-plan #E10)
- [ ] 2.11 Plugin unload drops its policies (see `cwd-policy.test.ts`; input register `{noTools:true}` for `/w/secrets` then unload · trigger later generic spawn there · observable argv lacks `--no-tools`) (test-plan #E11)
- [ ] 2.12 Funnel merges policy into argv (new test in `packages/server/src/__tests__/`, see `process-manager.test.ts`; input test-injected registry `{noTools:true}` for cwd, `spawnPiSession(cwd,{})` · trigger funnel resolve+merge · observable assembled argv contains `--no-tools`) (test-plan #E12)
- [ ] 2.13 No matching policy byte-identical (see `process-manager.test.ts`; input spawn cwd with no policy · trigger argv+env assembly · observable byte-identical to pre-change output) (test-plan #E13)
- [ ] 2.14 Policy tools allowlist reaches argv (see `process-manager.test.ts`; input policy `{tools:["read","grep"]}`, no caller scope · trigger funnel→argv · observable `--tools read,grep`) (test-plan #E14)
- [ ] 2.15 Allowlist intersection tightens (see `cwd-policy.test.ts`; input caller `tools:["read","grep","write"]` + policy `tools:["read","grep"]` · trigger `mergeCwdPolicy` · observable `--tools read,grep`, no `write`) (test-plan #E15)
- [ ] 2.16 Caller cannot widen host ban (see `cwd-policy.test.ts`; input policy `noTools:true` + caller `noTools:false`,`tools:["read"]` · trigger merge · observable merged `noTools:true`) (test-plan #E16)
- [ ] 2.17 Denylist union (see `cwd-policy.test.ts`; input caller `excludeTools:["write"]` + policy `excludeTools:["exec"]` · trigger merge · observable both `write` and `exec`) (test-plan #E17)
- [ ] 2.18 Sticky-true booleans (see `cwd-policy.test.ts`; input either side `noBuiltinTools:true` · trigger merge · observable merged `noBuiltinTools:true`) (test-plan #E18)
- [ ] 2.19 Policy allowlist applies when caller omits tools (see `cwd-policy.test.ts`; input policy `tools:["read"]` + caller omits `tools` · trigger merge · observable `--tools read`, not "unrestricted") (test-plan #E19)
- [ ] 2.20 Composition order-independent across 3+ ancestors (see `cwd-policy.test.ts`; input `{noTools:true}`,`{excludeTools:["a"]}`,`{excludeTools:["b"]}` composed any order · trigger merge · observable identical result) (test-plan #E20)
- [ ] 2.21 Empty policy is identity (see `cwd-policy.test.ts`; input `mergeCwdPolicy({},options)` · trigger merge · observable returns `options` unchanged) (test-plan #E21)
- [ ] 2.22 Broad ban survives narrow looser reg (see `cwd-policy.test.ts`; input `/work`={noTools:true}, `/work/secrets`={tools:["read"]}, spawn `/work/secrets/deep` · trigger resolve · observable `noTools:true`, tools not re-enabled) (test-plan #E22)
- [ ] 2.23 Same-path second reg composes not replaces (see `cwd-policy.test.ts`; input reg `{excludeTools:["exec"]}` then `{excludeTools:["write"]}` for `/w/secrets` · trigger resolve · observable excludes both) (test-plan #E23)
- [ ] 2.24 Sibling prefix no false-match (see `cwd-policy.test.ts`; input `/work` registered, spawn `/work-shop/app` · trigger resolve · observable `/work` policy NOT applied) (test-plan #E24)
- [ ] 2.25 No plugin path produces extension-bearing policy (see `cwd-policy.test.ts`; input only plugin-facing registrations · trigger resolve · observable no `extensions`/`extensionConfig`, no `-e`/`PI_EXT_*` from host policy) (test-plan #E25)
- [ ] 2.26 Policy applied to a GENERIC (non-plugin) spawn (see `tests/e2e/project-trust-headless-spawn.spec.ts`; input cwd policy `{noTools:true}` registered for a workspace dir + a generic non-plugin session spawned there vs docker harness · trigger session boots · observable session constrained yet loads bridge + registers — card converges into dashboard list, no plugin originated the spawn) (test-plan #F1)

## 3. Validate

- [ ] 3.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` green for the touched packages (server, dashboard-plugin-runtime).
- [ ] 3.2 Run `security-hardening` (discipline skill) on the privilege boundary: non-weakening invariant (caller cannot loosen), compose-never-overwrite (no plugin weakens another's/ancestor's floor), plugin-path-cannot-inject-extensions, target-bounding blast radius (D7), and the canonical-OR-lexical fail-toward-applying match (D6).
- [ ] 3.3 Run `review-code` (discipline skill) once tests pass — new registry with a security-load-bearing merge on the shared spawn funnel.
