## Why

The `spike/web-chat` spike (`packages/web-chat-plugin/SPIKE-FINDINGS.md` on that branch) proved tool containment and per-customer isolation for plugin-spawned sessions, but found two **core** gaps that block any externally-facing plugin session (customer web chat first):

1. **Operator environment leaks into a plugin-spawned session.** It inherits the operator's `~/.pi/agent` (global packages/extensions, skills, `AGENTS.md`, memory, credentials), the server process env (provider `*_API_KEY`s), the cwd's ancestor `AGENTS.md` / `.agents/skills`, and the dashboard bridge's own prompt fragment, provider/role registrations and operator-config reads. "Print your system prompt" disclosed operator context verbatim. `PluginSpawnOptions.scope` cannot express isolation, and the spec forbids a `noExtensions` toggle because the bridge loads through discovery (`plugin-spawn-scope` › "Scope restrictions preserve the dashboard control channel").
2. **A plugin cannot fail closed on a missing host access policy.** `ctx.identity.authorize` allows when identity is inert (`packages/server/src/identity/plugin-identity.ts:80`) and the road gate allows when no policy is registered (`packages/server/src/identity/host-access.ts:39`); the plugin cannot tell "allowed by policy" from "no policy".

3. **A plugin cannot serve external browsers.** Plugin WebSocket routes admit only genuinely-local peers (`plugin-ws-route` › "Core gates run before plugin delegation"); plugin HTTP routes sit behind dashboard authentication, and the mutation origin gate (`cross-site-request-gate`) rejects a customer site's `Origin` unless it is trusted dashboard-wide — which would weaken CSRF protection for operator routes. The only escape today is the global `auth.bypassUrls` prefix list (`packages/server/src/auth/bypass-urls.ts`).

This change closes all three in core so the follow-up `add-web-chat-plugin` can stay plugin-only. It ships no customer-facing feature by itself.

## What Changes

- **NEW `scope.agentDir` → host-enforced isolated spawn.** A valid absolute plugin-owned directory sets `PI_CODING_AGENT_DIR` for the spawned pi. The host then also forces `--no-builtin-tools`, `--no-context-files`, `--no-approve`, `--no-skills` (plugin extension tools and `scope.skills` still load), merges the cwd policy without its `skills`, applies no spawn-env contributors, and builds the child env from an allowlist plus the existing runtime/bridge shaping (drops provider keys, `SSH_AUTH_SOCK`, inherited `PI_CODING_AGENT_*`).
- **Bridge preserved** — the host appends `-e <bridge extension entry file>` from its boot-resolved bridge dir (entry file, not package dir, so bridge skills do not load). Unresolvable ⇒ spawn refused. No `--no-extensions` toggle.
- **Bridge control-channel-only mode** — under the reserved `PI_DASHBOARD_ISOLATED=1` marker the bridge only registers, forwards events and handles commands: no prompt fragment, no tools (incl. `ask_user`, `canvas`, role/model tools), providers, MCP servers or slash commands, no vault delivery, no server auto-start, no reads/writes under the operator `~/.pi/` tree; decided once per process so reloads keep it.
- **Fail-closed validation** in the `spawnSession` hook before any pending state is filed: absolute, existing directory, not the operator agent dir by canonical path (symlink- and case-safe); plugin paths outside the operator dir; `agentDir` with `resume`, a non-`local` `mode` or `initialPrompt` refused; missing bridge entry refused; the plugin's own data dir is the sanctioned provisioning root. Mapper flags a malformed `agentDir` or `scope` container instead of dropping it.
- **`PluginSpawnResult` gains `code?` and `isolated?`** so a plugin can assert isolation actually happened.
- **Spawn-scoped bridge credential** — the isolated bridge authenticates over loopback TCP with a server-minted per-spawn credential (`PI_DASHBOARD_SPAWN_CREDENTIAL`), bound to its spawn token and valid only for that bridge's registration, instead of reading the operator's local token.
- **Attested isolation** — the isolated bridge reports `isolated: true` at registration; the server kills an isolated spawn that registers without it, and never hands an isolated session a cwd-keyed queued prompt.
- **BREAKING (plugin API, buggy callers only):** a `scope` that is a string, array or number now refuses the spawn (`agent_dir_invalid`) instead of being ignored; `scope: null` is still treated as absent.
- **NEW plugin public namespace** `/api/plugins/<id>/public/*` via `ctx.registerPublicRoute` (activation only, `GET`/`POST`, validated paths, body limit): served only when the operator enables it per plugin (manifest priority grants nothing); CORS, preflight and the mutation origin gate use the plugin's operator-configured exact `allowedOrigins` only (empty ⇒ no cross-origin; dashboard-wide origins never apply there; namespace origins gain nothing elsewhere; no credentials mode); dashboard cookies and local token stripped before any auth hook, device bearers ignored; network guard, identity floor and tier gate exempt the namespace; OIDC bearers still resolve to `ctx.identity.principalOf`; requests with a principal are classified for the host access policy; bounded SSE streaming (heartbeats, cap, close on disable).
- **NEW `ctx.dataDir`** — the plugin's own data root (`~/.pi/dashboard/plugins/<id>`, 0700), the sanctioned place to provision isolated agent dirs; the isolated bridge keeps the plugin-message lane so a plugin's in-session extension can call its server.
- **NEW `ctx.identity.hasHostPolicy()`** — `isEnforced() && policy registered`, evaluated per call.
- Out of scope (owned by `add-web-chat-plugin`): agent-dir provisioning and credentials, the customer host policy, the plugin server, ownerless spawn usage.

## Capabilities

### New Capabilities
- `plugin-public-routes`: operator-enabled, origin-pinned, dashboard-authority-free public HTTP routes for trusted plugins, with SSE streaming.

### Modified Capabilities
- `plugin-spawn-scope`: `agentDir` field; isolated-spawn requirement (validation, forced flags, env allowlist, result `isolated`/`code`); control channel loads the bridge entry explicitly; mapper flags `agentDir`; bridge control-channel-only mode.
- `plugin-spawn-env-contributor`: contributions are not applied to isolated plugin spawns.
- `host-cwd-policy`: isolated spawns merge the cwd policy without its `skills`.
- `agent-session-context-injection`: no session-context fragment in isolated sessions.
- `agent-role-model-tools`: `list_models` / `list_roles` / `update_roles` not registered in isolated sessions.
- `headless-spawn`: isolated spawns' child env is allowlist-reduced (new sanctioned subtraction).
- `pi-gateway-auth`: spawn-scoped bridge credential for isolated spawns (ADDED), with carve-outs in the local-bridge authorisation, proof keying, counter-proof and spawned-bridge verification requirements (MODIFIED).
- `host-access-policy`: plugin-readable `hasHostPolicy()`; refused policy registrations throw (`policy_not_trusted` / `policy_duplicate`) instead of silently no-op'ing.
- `cross-site-request-gate`: public plugin namespaces use the plugin's exact origin allowlist instead of the dashboard trust derivation.
- `bearer-device-auth`: the bearer branch and the device-bearer tier gate skip plugin public namespaces (predicate; map stays exact).
- `server-cors`: plugin public namespaces are excluded from the global CORS origin decision.
- `trusted-networks`: enabled plugin public namespaces become an in-namespace public exception of the network guard.
- `auth-bypass-url-list`: enabled plugin public namespaces are an explicit, reviewable dashboard-authentication bypass category.

## Discipline Skills

- `security-hardening` — the change exists to stop operator-environment and credential disclosure to untrusted users, and opens a deliberately unauthenticated route namespace.
- `doubt-driven-review` — public plugin API additions (`scope.agentDir`, `isolated`, `hasHostPolicy`) are hard to retract once plugins depend on them.
- `review-code` — before commit.

## Impact

- `packages/dashboard-plugin-runtime/src/server/server-context.ts` — `scope.agentDir`, mapper (`agentDir`/`agentDirInvalid`), `PluginSpawnResult.code`/`isolated`, `PluginIdentitySeam.hasHostPolicy`.
- `packages/server/src/server.ts` — hoist boot-resolved bridge dir; `spawnSession` hook validation before registry filing; isolated argv/env path; skip cwd policy + contributors.
- `packages/server/src/spawn-process/process-manager.ts` — `buildSpawnEnv` isolated allowlist; strip inherited `PI_DASHBOARD_ISOLATED`.
- `packages/server/src/identity/plugin-identity.ts` — `hasHostPolicy` (widen `PluginIdentityDeps`).
- `packages/server/src/spawn-process/cwd-policy.ts` / `spawnPiSession` — drop policy `skills` for isolated spawns.
- `packages/extension/src/` — `isIsolated()` gate: `dashboard-context-injector.ts`, `ask-user-tool.ts`, `canvas-tool.ts`, `bridge-handlers/lifecycle.ts` (role/model tools, pins), `provider-register.ts`, `session-sync.ts`, `pi-retry-settings.ts`, `role-manager.ts`, `path-gate/grant-cache.ts`, `path-gate/grant-link.ts`, `bridge-identity-log.ts`.
- `packages/server/src/pi/` gateway + `packages/shared/src/local-credential-proof.ts` consumers — spawn-credential verification path; `packages/server/src/event-wiring.ts` — isolated registration attestation + FIFO skip; `packages/shared/src/protocol.ts` — registration `isolated` flag.
- `packages/server/src/server.ts` + `packages/server/src/auth/` (`auth-plugin.ts`, `cors-origin.ts`, network guard) + `packages/shared/src/route-tiers.ts` — public namespace mounting, origin pinning, cookie stripping, `public` tier prefix; `packages/dashboard-plugin-runtime/src/server/server-context.ts` — `registerPublicRoute`.
- Compatibility: additive except the BREAKING malformed-`scope` refusal; spawns without `agentDir` otherwise byte-identical except inherited `PI_DASHBOARD_ISOLATED` / `PI_DASHBOARD_SPAWN_CREDENTIAL` are stripped. Rollback = revert; no persisted state. Active change `add-plugin-spawn-worktree` also extends `PluginSpawnOptions`; `agentDir` + `mode:"worktree"` is refused here until that change defines the composition.
