## Why

Two related gaps in the dashboard spawn chain, folded into one change because the second consumes the first's vocabulary (keeping them separate forces a cross-worktree dependency that cannot be built or tested in isolation):

1. **Plugins cannot scope the sessions they spawn.** A plugin that spawns a pi session has no typed way to constrain the spawned session's tool / skill / extension surface. The only conceivable channel is the raw `env` bag, which pi does not read for capability selection. pi's CLI already exposes native scoping flags (`--tools`, `--exclude-tools`, `--no-tools`, `--no-builtin-tools`, `--skill`, `--no-skills`, `-e`) that the dashboard spawn chain never wires through.
2. **The host cannot apply policy to sessions it did not spawn.** A user opening a session in a sensitive directory (`~/client-secrets/`, a production checkout) never routes through a plugin, so there is no `scope` object to attach. That constraint has to live at a layer *every* spawn crosses — the host's own spawn funnel — keyed by **where the session lands**, not by who originated it.

`sessionFlagsToArgv` (`packages/shared/src/platform/spawn-mechanism.ts`) is the single argv funnel every mechanism routes through; `buildSpawnEnv` (`packages/server/src/spawn-process/process-manager.ts`) is the single env builder; and `spawnPiSession(cwd, options)` (`process-manager.ts`) is the single spawn funnel every mechanism — plugin `spawnSession`, generic `session-api` user/degrade/reload, worktree, tmux, headless — passes through with `cwd` already in hand. All three capabilities land at these existing chokepoints.

## What Changes

This change delivers **two** capabilities in one branch. (A third, `path-containment-guard` (#474), is a from-scratch follow-up — see Deferred, below.)

### Capability A — `plugin-spawn-scope` (#473): the vocabulary

- Add one optional `scope` block to `PluginSpawnOptions` (`dashboard-plugin-runtime`), mapping tool/skill/extension fields to pi CLI capability flags (argv) and per-extension config to namespaced env.
- Thread each `scope.*` field through the spawn chain: `PluginSpawnOptions` → new **total** `pluginSpawnToSessionOptions` mapper → `SessionOptions` → `SessionFlags` → `sessionFlagsToArgv` → argv (with `extensionConfig` routed to env instead).
- Extract the currently inline `PluginSpawnOptions → SessionOptions` object literal (in the `spawnSession` hook, `server.ts`) into a named, unit-testable `pluginSpawnToSessionOptions` function.
- Add capability-scope fields to `SessionFlags` + emit their flags from `sessionFlagsToArgv` (comma-joined allowlists, repeatable `--skill` / `-e`, boolean toggles).
- **`extensionConfig` supports typed `string | string[]` values.** Project `scope.extensionConfig[name][key]` into namespaced env (`PI_EXT_<NAME>_<KEY>`) via `buildSpawnEnv` on the headless plugin-spawn mechanism. A **scalar string** projects verbatim; a **`string[]`** projects as its JSON encoding (`JSON.stringify`), which the consuming extension `JSON.parse`s. Names/keys are sanitized to valid env-var characters (uppercase, non-alphanumeric → `_`). JSON is chosen over delimiter-join because config values are frequently filesystem paths, for which every delimiter (`,` `:` `;`) is unsafe; JSON is lossless and type-preserving. This makes raw `env` an internal transport detail rather than a plugin-facing knob.
- Preserve a control-channel invariant: `scope` deliberately exposes **no** `--no-extensions` toggle, because disabling extension discovery would stop the dashboard bridge from loading and make the spawned session uncontrollable. The `extensions` allowlist is additive (discovery still runs). The mapper is total (never throws) and sanitizes untrusted plugin input.

Non-breaking: every `scope.*` field is optional and, when absent, the produced argv + env are byte-identical to today.

### Capability B — `host-cwd-policy` (#475): the host attachment point

- Add a host-side `CwdPolicyRegistry` (new `packages/server/src/spawn-process/cwd-policy.ts`): `registerCwdPolicy(cwd, policy)`, `unregisterCwdPolicy(cwd)` (idempotent), `resolveCwdPolicy(cwd)`. Entries keyed by **`(pluginId, realpath(cwd))`** so one plugin cannot overwrite or unregister another's policy; a single instance wired into both the spawn funnel and every plugin context.
- Pure `mergeCwdPolicy(policy, options)` composes ONLY the *tightening* fields of Capability A's vocabulary — `tools`/`skills` (INTERSECTION), `excludeTools` (UNION), `noBuiltinTools`/`noTools`/`noSkills` (sticky-OR) — all commutative + associative → order-independent. It does NOT compose `extensions`/`extensionConfig` (widenings / order-dependent; deferred to ops-config). Because A and B now ship together, B builds directly on A's flat fields + emission — no cross-change dependency remains.
- The **plugin-facing** `registerCwdPolicy` accepts only tightening fields and **rejects** (observable error, not silent drop) any policy carrying `extensions`/`extensionConfig` — a plugin loading code into sessions it did not spawn is a privilege expansion the `priority<=100` gate cannot authorize. Registration targets are bounded to recognized workspace roots (`/`, `$HOME`, non-workspace paths rejected).
- `spawnPiSession(cwd, options)` resolves the cwd policy (composing ALL registered entries across plugins AND matching ancestor dirs — never overwriting) and merges it into `options` BEFORE building argv/env. The merge is **non-weakening**: a caller's own `scope` can only be tightened, never loosened — the load-bearing security property.
- Expose `registerCwdPolicy`/`unregisterCwdPolicy` on `ServerPluginContext`, trust-gated (untrusted plugins get a no-op hook). Registered policies are deep-frozen and dropped when the owning plugin unloads.
- When no policy matches the spawn cwd, `spawnPiSession` produces argv + env **byte-identical to today**.

## Capabilities

### New Capabilities
- `plugin-spawn-scope`: A first-class `scope` block on `PluginSpawnOptions` mapping plugin-declared tool / skill / extension constraints to pi CLI capability flags (and per-extension `string | string[]` config to namespaced env, arrays JSON-encoded), with an absent-field ⇒ byte-identical-argv guarantee.
- `host-cwd-policy`: A host-side, cwd-keyed capability policy applied by the spawn funnel to ANY session landing in a registered directory — including generic (non-plugin) spawns — composing non-weakeningly with a spawn's own `scope`, with idempotent unregister and an absent-policy ⇒ byte-identical-spawn guarantee.

### Modified Capabilities
<!-- No existing capability's REQUIREMENTS change; the spawn chain + funnel gain new optional inputs only. -->

## Deferred

- **`path-containment-guard` (#474)** — a first-party extension that rejects tool calls whose path arg resolves outside configured `allowedRoots` (consuming Capability A's `string[]` `extensionConfig` via the JSON env convention). The issue as filed asks to *extract* an existing host `SessionGuardPolicy` and *delete* it — but no such host guard, `collectPathCandidates`, or `pathWithinRoots` exists in the codebase (the "guard" was only ever a proposal; #475 was renamed away from it). #474 is therefore a **from-scratch build**, not a refactor, and its "delete `SessionGuardPolicy`" acceptance clause is vacuous. Re-scope and plan #474 as its own change with its own doubt-review; it is not folded here.
- **Session tags (#476/#477)** — rejected as redundant for current needs (existing run/id binding already suffices).

## Impact

- `packages/dashboard-plugin-runtime/src/server/server-context.ts` — `PluginSpawnOptions` gains `scope`; new exported `pluginSpawnToSessionOptions` mapper; `ServerPluginContext` gains trust-gated `registerCwdPolicy`/`unregisterCwdPolicy`.
- `packages/shared/src/platform/spawn-mechanism.ts` — `SessionFlags` gains scope fields; `sessionFlagsToArgv` emits the corresponding pi flags.
- `packages/server/src/spawn-process/process-manager.ts` — `SessionOptions` gains scope fields; `buildSpawnEnv` projects `extensionConfig` → `PI_EXT_*` env (scalars verbatim, arrays JSON); `spawnPiSession` resolves + merges cwd policy into `options` before argv/env assembly.
- `packages/server/src/spawn-process/cwd-policy.ts` — NEW: `CwdPolicyRegistry`, `registerCwdPolicy`/`unregisterCwdPolicy`/`resolveCwdPolicy`, pure `mergeCwdPolicy`.
- `packages/server/src/server.ts` — `spawnSession` hook delegates mapping to `pluginSpawnToSessionOptions` (before enqueuing any `automationRun` stamp); wires the trust-gated context hooks to the registry.
- Consumers: first-party trusted plugins may opt into scoping and/or register cwd policy; no change required for plugins that omit `scope` and register nothing.

## Discipline Skills

Tasks in this change trigger these `eng-disciplines` skills (rationale in `design.md`):

- **`security-hardening`** — plugin-supplied strings flow into spawn argv (`-e`, `--skill`, `--tools`) and process env (`PI_EXT_*`); host policy injects capability constraints into sessions the user did not opt into. Validate env-name normalization, the JSON array-value encoding, the total-mapper input sanitization, the non-weakening merge (caller cannot loosen a host floor), compose-never-overwrite, plugin-path-cannot-inject-extensions, target-bounding (D7-cwd), and the canonical-OR-lexical fail-toward-applying match; confirm no shell interpretation is introduced.
- **`review-code`** — non-trivial change to the shared argv builder, the spawn funnel, and a new security-load-bearing registry; run the inline review once tests pass, before commit.

No latency/throughput budget, new endpoint, migration, or opaque-runtime-state work applies, so `performance-optimization`, `observability-instrumentation`, and `node-inspect-debugger` do not. `doubt-driven-review` already ran in planning (cross-model, `@propose-review-1` + `@propose-review-2`) for both folded capabilities.
