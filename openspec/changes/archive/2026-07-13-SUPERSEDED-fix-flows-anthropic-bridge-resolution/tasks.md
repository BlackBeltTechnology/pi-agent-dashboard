# Tasks

## 1. Upstream pi-package fixes (out-of-repo, prerequisite)

- [x] 1.1 Add `"main": "./extensions/index.ts"` + `"exports": { ".": "./extensions/index.ts" }` to `pi-flows/package.json`.
- [x] 1.2 Add `"main": "./extensions/index.ts"` + `"exports": { ".": "./extensions/index.ts" }` to `@pi/anthropic-messages/package.json` AND the GH-cloned copy at `~/.pi/agent/git/.../pi-anthropic-messages/package.json`.
- [ ] 1.3 Verify both packages pass `require.resolve(<spec>)` from an arbitrary cwd that contains them in `node_modules`.

## 2. flows-anthropic-bridge-plugin: peer resolution fallback

- [ ] 2.1 Extend `packages/flows-anthropic-bridge-plugin/src/peer-probe.ts` with a `resolveViaPiCache(spec, opts)` helper.
  - Scan `~/.pi/agent/git/<host>/<owner>/<package-basename>/package.json` and `~/.pi/agent/npm/.../node_modules/<spec>/package.json`.
  - Return `{ ok: true, via: "pi-cache", absPath, entry }` on match (entry is `pkg.exports?.["."] ?? pkg.main ?? pkg.pi?.extensions?.[0]`).
  - Return `{ ok: false }` if no match.
- [ ] 2.2 Update `probeAll()` to call `resolveViaPiCache` when tier-1 (`deps.resolve(spec)`) throws.
- [ ] 2.3 Update `flows-anthropic-bridge-plugin/src/bridge/index.ts` to import via the resolved absolute path when `probe.am.via === "pi-cache"` instead of `import(spec)`.
- [ ] 2.4 Add unit tests in `__tests__/peer-probe.test.ts` covering all four tiers (node_modules hit, pi-cache hit, behavioural-fallback hit, all-miss).

## 3. plugin-bridge-register: dual-write to packages[]

- [x] 3.0 **(temp workaround)** Manually add bridge path to `~/.pi/agent/settings.json#packages[]`. This is the workaround the user applied to verify the fix. The proper auto-managed dual-write below replaces this.
- [ ] 3.1 Extend `packages/shared/src/plugin-bridge-register.ts` with:
  - `registerPluginBridge(pluginId, bridgePath, opts)` writes the path to BOTH `dashboardPluginBridges[dashboard-<id>]` AND `packages[]`, with idempotent semantics (no-op if already present).
  - `deregisterPluginBridge(pluginId, opts)` removes BOTH the `dashboardPluginBridges[dashboard-<id>]` entry AND the matching `packages[]` entry. User-added entries (any path not matching a current `dashboardPluginBridges` value) are preserved.
  - Both operations use the existing atomic tmp+rename helper.
- [ ] 3.2 Add `migratePluginBridges(opts)` helper that, on dashboard startup, scans existing `dashboardPluginBridges` entries and ensures each has a corresponding `packages[]` entry. Idempotent; runs unconditionally on every startup.
- [ ] 3.3 Update unit tests in `packages/shared/src/__tests__/plugin-bridge-register.test.ts` to assert the dual-write contract, ordering of writes, and the user-entry-preservation rule.
- [ ] 3.4 Wire `migratePluginBridges()` into the dashboard server bootstrap (`packages/server/src/`).

## 4. Health surfacing

- [ ] 4.1 Extend `/api/health.plugins[]` to include `bridgeStatus: "probing" | "waiting_peers" | "active" | "degraded" | "unreachable"` for plugins that declare a `bridge` entry.
  - `unreachable` is a new state set by the dashboard server when the bridge file path doesn't exist on disk OR fails to load when pi runs it.
  - When status is `unreachable` or `waiting_peers` for > 30 s, also include an `error` field with a diagnostic message.
- [ ] 4.2 Forward the bridge plugin's per-PID `flows-anthropic-bridge:status` events into the health response (already implemented in `flows-anthropic-bridge-plugin/src/server/index.ts` — wire into the generic health surface).
- [ ] 4.3 Add an integration test that asserts the health response shows `bridgeStatus: "active"` after `/flows:new` runs successfully and a subagent activates `@pi/anthropic-messages`.

## 5. Spec updates

- [ ] 5.1 In `openspec/specs/dashboard-plugin-loader/spec.md`, MODIFY the "Bridge auto-register uses dashboard- key prefix" requirement to specify the dual-write to `packages[]` AND `dashboardPluginBridges`.
- [ ] 5.2 MODIFY the "Bridge entries auto-register as pi extensions" requirement to explicitly state the path is via `packages[]`, not `extensions[]` (which was a misnomer in the existing spec text — `extensions[]` is not a key in `settings.json`).
- [ ] 5.3 ADD a new requirement "Bridge plugin peer probe falls back to pi install layout" with scenarios for node_modules-resolvable, pi-git-cache-resolvable, npm-scope-resolvable, and unresolvable peers.
- [ ] 5.4 ADD a new requirement "Plugin bridge unreachable surfaces in /api/health.plugins[].bridgeStatus".

## 6. End-to-end verification

- [ ] 6.1 Truncate `/tmp/pi-am.log`, restart dashboard, reload all pi sessions, trigger `/flows:new` against a Claude-model anthropic-messages session.
- [ ] 6.2 Assert `grep -c '"stage": "load"' /tmp/pi-am.log` ≥ 2 distinct PIDs (parent pi + spawned architect subagent).
- [ ] 6.3 Assert architect successfully invokes `mcp__flows__finish` or `mcp__pi__ask_user` without panicking about missing tools.
- [ ] 6.4 Add the e2e scenario to QA scripts under `qa/tests/`.

## 7. Documentation

- [ ] 7.1 Update `packages/flows-anthropic-bridge-plugin/README.md` "Dependencies" section to clarify that peers can be installed via pi (any source) OR npm — both resolve correctly via the new fallback.
- [ ] 7.2 Add a troubleshooting entry to `docs/faq.md`: "Flow architect says 'Available tools: (none)' — what's wrong?"
- [ ] 7.3 Document the pi-package `main`/`exports` convention in pi-flows' and pi-anthropic-messages' READMEs and (separately) propose it to the upstream pi-extension authoring docs.
