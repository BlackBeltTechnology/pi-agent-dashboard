# Fix flows-anthropic-bridge peer resolution and pi loading

## Why

The `flows-anthropic-bridge-plugin` is supposed to forward `@pi/anthropic-messages` hooks into every pi-flows subagent. In practice it sits in `waiting_peers` forever and never wires the bridge, so `/flows:new` spawns an architect that hits Claude with un-prefixed pi tool names and panics with "Available tools: (none)".

Three independent gaps cause the failure:

1. **Pi packages lack Node-resolvable entry points.** `@pi/anthropic-messages` and `pi-flows` declare `pi.extensions` but no `main` / `exports` / `module` field. Node's `require.resolve("@pi/anthropic-messages")` fails even when the package is installed, because pi-only metadata is opaque to Node.

2. **The bridge plugin's probe anchors at `process.cwd()` but pi-installed packages live under `~/.pi/agent/git/<host>/<owner>/<repo>/`.** That path is never on Node's upward `node_modules` walk from the dashboard's cwd. Even with `main`/`exports` fixed, the peer is still unreachable through a bare specifier.

3. **`pi-coding-agent` 0.74 doesn't read `settings.json#dashboardPluginBridges`.** The dashboard's `plugin-bridge-register.ts` writes entries there, and the bridge plugin's `src/bridge/index.ts` is referenced from there — but pi only loads extensions listed in `settings.json#packages[]`. The bridge file is never loaded as a pi extension, so it never runs its probe, never emits `flow:register-agent-extension`, and pi-flows subagents never get the bridge factory.

Result: the dashboard happily logs `[plugin:flows-anthropic-bridge] flows-anthropic-bridge server entry ready` (server half OK), but the pi-extension half never executes, so flow architect subagents fail every Claude tool call.

## What changes

Three coordinated fixes, all of them mechanical:

1. **Add `main` + `exports` to pi-packages that need to be importable.** Update `pi-flows/package.json` and `@pi/anthropic-messages/package.json` to declare:

   ```json
   "main": "./extensions/index.ts",
   "exports": { ".": "./extensions/index.ts" }
   ```

   This makes Node's bare-specifier resolution find a valid entry. The dynamic `import("@pi/anthropic-messages")` and `require.resolve("pi-flows")` now succeed once the package is reachable.

2. **Provide a resolver that honors pi's git-cache install layout.** The bridge plugin's probe falls back to scanning `~/.pi/agent/git/*/<owner>/<package-name>/package.json` (and `~/.pi/agent/npm/...`) when `createRequire(process.cwd()).resolve(spec)` throws `MODULE_NOT_FOUND`. When the fallback hits, the bridge imports the absolute entry path (read from the package's `pi.extensions[0]` or `main`/`exports`) instead of the bare specifier.

3. **Auto-add the dashboard plugin bridge file to `settings.json#packages[]`** so pi (which only reads `packages[]`) actually loads the bridge as an extension. The existing `plugin-bridge-register.ts` keeps managing the `dashboardPluginBridges` mirror for forward compatibility with future pi versions; the new write SHALL also add the same path to `packages[]` under the same `dashboard-<plugin-id>` ownership prefix (or a comment marker), and SHALL remove it on plugin disable, with the same atomic-write + tmp-rename + user-entry-preservation guarantees as the existing `dashboardPluginBridges` writer.

The spec also adds explicit `_BREAKING_` requirements forbidding a regression where a plugin declares `bridge` but the dashboard fails to load it as a pi extension — surfacing the gap via `/api/health.plugins[].error` instead of silent `waiting_peers` failure.

## Impact

- **Affected specs:** `dashboard-plugin-loader` (bridge auto-register section + new resolution-fallback requirement).
- **Affected code:**
  - `packages/shared/src/plugin-bridge-register.ts` — add `packages[]` writer alongside `dashboardPluginBridges`.
  - `packages/flows-anthropic-bridge-plugin/src/peer-probe.ts` — add pi-git-cache fallback resolver.
  - `packages/flows-anthropic-bridge-plugin/src/bridge/index.ts` — import via resolved path when bare spec fails.
- **Affected upstream packages (pi-flows, pi-anthropic-messages):** add `main`/`exports` to their `package.json` so they're consumable by Node-style imports.
- **Backward compatibility:**
  - Adding `main`/`exports` does not affect pi's own loader (it reads `pi.extensions` separately).
  - The new `packages[]` writer is additive; existing bridge entries under `dashboardPluginBridges` remain managed and removable.
  - When pi-coding-agent eventually grows native `dashboardPluginBridges` support, the duplicate `packages[]` entry should be removed via a follow-up change.
- **Out of scope:** upstreaming a dynamic alias map into `pi-coding-agent/dist/core/extensions/loader.js` (the deepest architectural fix). That's a `pi-coding-agent` change, not a dashboard change.
