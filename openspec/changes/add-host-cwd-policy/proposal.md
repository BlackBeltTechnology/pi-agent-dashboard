## Why

`add-plugin-spawn-scope` (#473) lets a plugin constrain the capability surface of a session **it spawns** — the scope travels with the spawn call. But one real host responsibility cannot be expressed that way: applying policy to sessions **the plugin did not spawn**. A user opening a session in a sensitive directory (`~/client-secrets/`, a production checkout) never routes through a plugin, so there is no `scope` object to attach and no caller to attach it to. The constraint has to live at a layer *every* spawn crosses — the host's own spawn funnel — keyed by **where the session lands**, not by who originated it.

`spawnPiSession(cwd, options)` (`packages/server/src/spawn-process/process-manager.ts`) is that funnel: every mechanism (plugin `spawnSession`, generic `session-api` user/degrade/reload spawns, worktree, tmux, headless) routes through it, and it already receives `cwd`. This change registers cwd-keyed policy there.

## What Changes

- Add a host-side `CwdPolicyRegistry` (new `packages/server/src/spawn-process/cwd-policy.ts`): `registerCwdPolicy(cwd, policy)`, `unregisterCwdPolicy(cwd)` (idempotent), and `resolveCwdPolicy(cwd)`. Entries are keyed by **`(pluginId, realpath(cwd))`** so one plugin cannot overwrite or unregister another's policy; a single instance is wired into both the spawn funnel and every plugin context.
- The pure `mergeCwdPolicy(policy, options)` composes ONLY the *tightening* fields of #473's vocabulary — `tools`/`skills` (INTERSECTION), `excludeTools` (UNION), `noBuiltinTools`/`noTools`/`noSkills` (sticky-OR) — all order-independent (this change **depends on #473** for the fields + their emission). It does NOT compose `extensions`/`extensionConfig`: those are widenings/order-dependent and belong to the deferred ops-config path (design D2). The **plugin-facing** `registerCwdPolicy` accepts only the tightening fields and **rejects** (observable error, not silent drop) any policy carrying `extensions`/`extensionConfig` — a plugin loading code into sessions it did not spawn is a privilege expansion (design D3). Registration targets are bounded to recognized workspace roots (`/`, `$HOME`, and non-workspace paths rejected) to cap denial-of-capability blast radius (design D7).
- `spawnPiSession(cwd, options)` resolves the cwd policy (composing ALL registered entries across plugins AND matching ancestor dirs — never overwriting) and merges it into `options` BEFORE building argv/env. The merge is **non-weakening**: a caller's own `scope` can only be tightened, never loosened, by host policy — the load-bearing security property.
- Expose `registerCwdPolicy` / `unregisterCwdPolicy` on the plugin `ServerPluginContext`, gated to first-party / trusted plugins by the same trust gate as `spawnSession` (untrusted plugins get a no-op hook). Registered policies are deep-frozen (no post-register mutation) and dropped when the owning plugin unloads.
- When no policy matches the spawn cwd, `spawnPiSession` produces argv + env **byte-identical to today** (strict non-regression).

## Capabilities

### New Capabilities
- `host-cwd-policy`: A host-side, cwd-keyed capability policy applied by the spawn funnel to ANY session landing in a registered directory — including generic (non-plugin) spawns — composing non-weakeningly with a spawn's own `scope`, with idempotent unregister and an absent-policy ⇒ byte-identical-spawn guarantee.

### Modified Capabilities
<!-- No existing capability's REQUIREMENTS change; the spawn funnel gains a new optional merge step keyed by cwd. `plugin-spawn-scope` (#473) is a dependency, not a modification. -->

## Impact

- `packages/server/src/spawn-process/cwd-policy.ts` — NEW: `CwdPolicyRegistry`, `registerCwdPolicy`/`unregisterCwdPolicy`/`resolveCwdPolicy`, pure `mergeCwdPolicy`.
- `packages/server/src/spawn-process/process-manager.ts` — `spawnPiSession` resolves + merges cwd policy into `options` before argv/env assembly.
- `packages/dashboard-plugin-runtime/src/server/server-context.ts` — `ServerPluginContext` gains `registerCwdPolicy`/`unregisterCwdPolicy`, trust-gated.
- `packages/server/src/server.ts` — wires the trusted-gated context hooks to the registry.
- Depends on `add-plugin-spawn-scope` (#473) for the flat capability fields on `SessionFlags`/`SessionOptions` and their `sessionFlagsToArgv` + `buildSpawnEnv` emission. This change adds no new argv/env emission — it only populates those inputs from host policy.

## Open Questions

These were not confirmed at planning time; the design records a recommended default for each and can be re-decided before the worktree boundary:

1. **Policy source** — this change ships the **plugin-facing** `ctx.registerCwdPolicy` (trusted-gated, tighten-only) + the host registry the funnel reads. The **ops-config source** (declare cwd policy in `settings.json` / a config file, no plugin involved) — which is ALSO the only sanctioned path for extension-injecting policies — is deferred to a follow-up. Confirm plugin-tighten-only-first, or pull the ops-config injector into this change's scope.
2. **Nesting/match semantics** — when `~/work` and `~/work/secrets` are both registered and a session lands in `~/work/secrets/deep`, the design defaults to **compose-all-ancestors** (union every matching ancestor's tightening — a broad ban cannot be escaped by a narrower registration), NOT the longest-prefix-wins that `resource-origin.ts` uses for the trust store. Confirm compose-all-ancestors.
3. **Extension injection** — RESOLVED during planning by two cross-model review cycles: removed from BOTH the plugin-facing path (privilege expansion the forgeable `priority<=100` gate cannot authorize) AND from `mergeCwdPolicy` (UNION/policy-wins violated the non-weakening + order-independence invariants). The deferred ops-config follow-up owns extension composition as an explicit trusted-operator widening.
