# Design: flows-anthropic-bridge peer resolution and pi loading

## Context

Empirical reproduction of the bug, with `/tmp/pi-am.log` evidence:

```
$ cd /home/skrot1/BB/pi-packages/pi-agent-dashboard
$ node -e "const r = require('node:module').createRequire(process.cwd()+'/_'); r.resolve('@pi/anthropic-messages')"
FAIL Cannot find module '@pi/anthropic-messages'

$ cat ~/.pi/agent/settings.json | jq .dashboardPluginBridges
{
  "dashboard-flows-anthropic-bridge": "/.../flows-anthropic-bridge-plugin/src/bridge/index.ts"
}

# 9 distinct pi sessions reloaded. Only main session @pi/anthropic-messages activations appear
# in /tmp/pi-am.log. Zero subagent activations even after /flows:new.
```

Three layered failures, each independent. The first two prevent `flows-anthropic-bridge-plugin/src/bridge/index.ts` from successfully resolving its peers when it runs. The third prevents the bridge file from running at all.

## Architecture

```mermaid
flowchart TD
  subgraph "Before"
    A1[settings.json#packages] -.does NOT include.-> A2[flows-anthropic-bridge/src/bridge/index.ts]
    A3[settings.json#dashboardPluginBridges] -.lists.-> A2
    A4[pi-coding-agent 0.74] -.reads only.-> A1
    A2 -.is never loaded.-> A5[never executes]
  end

  subgraph "After"
    B1[settings.json#packages] -- includes --> B2[flows-anthropic-bridge/src/bridge/index.ts]
    B3[settings.json#dashboardPluginBridges] -- still lists -- B2
    B4[pi-coding-agent 0.74] -- reads --> B1
    B1 -- loads --> B2
    B2 -- on activate --> B5{probe peers}
    B5 -->|node_modules walk OK| B6[import bare spec]
    B5 -->|MODULE_NOT_FOUND| B7[scan ~/.pi/agent/git/, ~/.pi/agent/npm/]
    B7 --> B8[read pi.extensions or main/exports, import absolute path]
    B6 --> B9[run @pi/anthropic-messages default on main pi]
    B8 --> B9
    B9 --> B10[emit flow:register-agent-extension factory]
    B10 --> B11[pi-flows pushes to extraAgentExtensions]
    B11 --> B12[every flow subagent gets the bridge]
  end
```

## Decision 1: Fix entry points in pi-packages (upstream)

The root cause for path 1: Node's resolver requires `main`, `exports`, or an `index.js` to consider a directory a "package". Pi packages historically only declared `pi.extensions`, which is pi-specific metadata Node ignores.

**Decision:** Update `pi-flows/package.json` and `@pi/anthropic-messages/package.json` to add:

```json
"main": "./extensions/index.ts",
"exports": { ".": "./extensions/index.ts" }
```

The `.ts` extension is intentional — pi processes always run with `jiti-register.mjs` preloaded, so `.ts` imports work natively. Node-only consumers (rare for pi packages) would need to compile, but that's already true for any package shipping TypeScript source.

**Why not `"type": "module"` alone?** Both packages already declare `"type": "module"`; that's necessary but not sufficient. Without `main`/`exports`, Node's resolver still rejects the package.

**Alternatives rejected:**

- *Ship compiled `dist/`*: would add a build step to every pi package, raise the bar for third-party plugin authors, and break "drop-in" local dev. The `.ts` entry path is fine because the pi runtime always has jiti loaded.
- *Use `pi.extensions` directly via a custom Node resolver*: too invasive; the Node resolver isn't pluggable enough at the `import()` call site, and patching pi-coding-agent's jiti alias map (the only place we control resolution) is a separate, broader concern.

## Decision 2: Resolution fallback honoring pi's install layout

Even with `main`/`exports` added, `import("@pi/anthropic-messages")` from inside the bridge plugin still fails when pi installed the package to `~/.pi/agent/git/<host>/<owner>/<repo>/` and the dashboard's `cwd` is somewhere else that doesn't have that path on its `node_modules` walk.

**Decision:** Extend `peer-probe.ts` with a two-tier resolver:

```ts
function probePeer(spec: string, deps: ProbeDeps): PeerProbe {
  // Tier 1: standard node_modules walk anchored at process.cwd()
  try {
    deps.resolve(spec);
    return { ok: true, via: "node_modules" };
  } catch {}

  // Tier 2: scan pi's git/npm install caches
  const candidates = [
    path.join(piAgentDir, "git", "*",     "*", basename(spec)),  // github URL installs
    path.join(piAgentDir, "git", "*",     "*", spec),
    path.join(piAgentDir, "npm",   "node_modules", spec),         // npm scope installs
    path.join(globalNpmRoot, spec),
  ];
  for (const pattern of candidates) {
    for (const match of glob.sync(pattern)) {
      if (fs.existsSync(path.join(match, "package.json"))) {
        return { ok: true, via: "pi-cache", path: match };
      }
    }
  }

  return { ok: false, reason: "not resolvable via node_modules nor pi cache" };
}
```

When `via === "pi-cache"`, the bridge does:

```ts
const pkg = JSON.parse(readFileSync(path.join(probe.path, "package.json"), "utf-8"));
const entry = pkg.exports?.["."] ?? pkg.main ?? pkg.pi?.extensions?.[0];
const mod = await import(path.join(probe.path, entry));
```

This works regardless of `main`/`exports` presence because `pi.extensions[0]` is the canonical fallback.

**Why not just use `pi.extensions[0]` directly?** Because Decision 1 makes `main`/`exports` work for Node-pure consumers. We want both paths to succeed; the pi-cache fallback is the last resort.

**Behaviour-detection fallback for pi-flows** stays as-is: `flowsListenerCount("flow:register-agent-extension") > 0` is a positive signal regardless of module resolvability. It's already implemented in `peer-probe.ts:48`.

## Decision 3: Write bridges to `settings.json#packages[]`, not just `dashboardPluginBridges`

`pi-coding-agent` 0.74 (and earlier) does not read `settings.json#dashboardPluginBridges`. It only loads extensions declared in `settings.json#packages[]`. The dashboard's existing `plugin-bridge-register.ts` writes only to `dashboardPluginBridges`, so plugin bridge entries are effectively dead.

**Decision:** Extend `registerPluginBridge` and `deregisterPluginBridge` so they manage **two** places in `settings.json`:

1. `dashboardPluginBridges[dashboard-<id>]` (existing) — kept for forward compatibility when pi adds native support.
2. `packages[]` (new) — append the bridge file path; remove on disable.

Both writes use the same atomic tmp+rename helper. The `packages[]` entry is recognized as managed only if it matches a known `dashboardPluginBridges[dashboard-<id>]` value; user-added entries are left alone.

**Conflict handling:**
- If `packages[]` already contains the resolved path (user added it manually or a previous run), do nothing — idempotent.
- If `packages[]` contains a stale dashboard-managed entry pointing at a different path (e.g. plugin moved), update it and log info.

**Why not require pi-coding-agent to read `dashboardPluginBridges`?** That's a clean architectural fix and the right long-term answer, but it requires upstream coordination. The `packages[]` workaround is mechanical, ships today, and is removable in one line when pi catches up.

**Alternative rejected:** documenting "user must manually add the bridge entry to packages[]". That defeats the purpose of `dashboardPluginBridges` being auto-managed. The whole point is invisible setup.

## Spec deltas

Two requirements are MODIFIED in `dashboard-plugin-loader`:

- *Bridge auto-register uses dashboard- key prefix* — clarify that the loader writes to BOTH `dashboardPluginBridges` AND `packages[]`, with the `packages[]` entry being authoritative for pi-coding-agent versions that don't read the bridges key.
- *Bridge entries auto-register as pi extensions* — drop the implicit assumption that pi reads `extensions[]` directly; explicitly assert the path through `packages[]`.

Two requirements are ADDED:

- *Bridge plugin peer probe SHALL fall back to pi's install layout* — when the standard module resolver fails, the probe scans pi's git/npm caches and returns success when a peer is found there.
- *Plugin bridge auto-register SHALL fail loudly if the bridge file is unreachable to pi* — surface the `waiting_peers` state as a plugin health error if the bridge entry can't be loaded after a configurable timeout, so the dashboard surfaces the gap rather than silently failing.

## Risks

1. **Adding bridges to `packages[]` could be unexpected by users.** Mitigation: the entry is added under explicit dashboard ownership (recognized by exact path match against `dashboardPluginBridges` values), and removable via plugin disable. The dashboard `Plugins` settings UI surfaces which bridges are active.

2. **`main: "./extensions/index.ts"` is unusual.** Most Node packages ship compiled JS. Mitigation: pi always runs with jiti-register preloaded, and the alternative (adding a build step to every pi package) is much higher friction. Document the convention in the pi-extension authoring docs.

3. **Pi-cache fallback resolver could find the wrong package** if multiple installs with the same name coexist. Mitigation: the resolver checks `package.json#name` matches the requested spec before returning success. Returns `ok: false` with a diagnostic message on ambiguity.

## Verification plan

1. **Unit tests** (`packages/flows-anthropic-bridge-plugin/src/__tests__/`):
   - `peer-probe.test.ts` — tier-1 (node_modules) hit, tier-1 miss + tier-2 (pi-cache) hit, both miss + behavioural detection hit, all miss → `ok: false` with diagnostic.
   - `plugin-bridge-register.test.ts` — registering a bridge adds to BOTH `dashboardPluginBridges` and `packages[]`; deregister removes from both; user-added `packages[]` entries are preserved.

2. **Integration test:** a real `/flows:new` against a Claude `anthropic-messages` session asserts:
   - `/tmp/pi-am.log` contains at least two `"stage": "load"` entries with different parent PIDs (main + subagent).
   - The subagent's outbound payload has `mcp__pi__` and canonical CC tool names.
   - The architect's `finish` tool call succeeds (no "Available tools: (none)" hallucination).

3. **Health endpoint check:** `GET /api/health.plugins[]` for `flows-anthropic-bridge` reports `loaded: true` and no error after the dashboard restart, even when neither peer is installed via npm in the dashboard's cwd.
