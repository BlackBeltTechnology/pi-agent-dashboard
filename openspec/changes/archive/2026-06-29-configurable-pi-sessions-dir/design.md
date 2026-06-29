# Design — configurable-pi-sessions-dir

## Problem framing

Two processes, one truth. pi writes session JSONL under a dir it resolves at launch. The dashboard
is a **separate** long-lived process that scans that dir. Today the dashboard hardcodes the default;
when pi's dir moves, the dashboard goes blind.

```
pi process (per invocation)              dashboard server (long-lived)
─────────────────────────────           ──────────────────────────────
--session-dir flag        ──┐
PI_CODING_AGENT_SESSION_DIR ─┤
settings.json#sessionDir   ─┼─► writes JSONL ──► ??? ◄── scans  HARDCODED ~/.pi/agent/sessions
PI_CODING_AGENT_DIR/sessions ┤
~/.pi/agent/sessions       ──┘
```

The dashboard cannot observe a *per-invocation* `--session-dir` of some other pi. It can only resolve
one global sessions root. So the design picks the **durable, process-independent** signals.

## Resolution precedence (chosen)

```
resolvePiSessionsDir(env?):
  1. config.json#piSessionsDir            (operator's explicit dashboard override)   ← highest
  2. process.env.PI_CODING_AGENT_SESSION_DIR  (inherited by dashboard process)
  3. process.env.PI_CODING_AGENT_DIR + "/sessions"  (mirrors pi-core getAgentDir())
  4. literal ~/.pi/agent/sessions         (last-ditch)                              ← lowest
```

Each string layer: tilde-expand, trim; whitespace-only string is "unset" and falls through.

### Why read `PI_CODING_AGENT_DIR` directly instead of importing pi-core (implementation deviation)

The original plan (Option A below) injected `getSessionsDir()` imported from
`@earendil-works/pi-coding-agent`. **This is unimplementable under the project's tsconfig**:
pi-core's published `dist/index.d.ts` re-exports `getAgentDir`/`getSessionsDir` via `./config.ts`
specifiers, which `moduleResolution: bundler` (no `allowImportingTsExtensions`) cannot follow for
*value* imports — `tsc` errors `has no exported member 'getAgentDir'` (a hard quality gate). Only
`import type` resolves; the runtime `dist/index.js` re-exports via `./config.js` and works under
jiti, but tsc gates CI.

Resolution (ratified during implementation): **fold pi's `PI_CODING_AGENT_DIR` layer directly into
the resolver in `shared`** — read the env var and append `/sessions`. This:
- Honors `PI_CODING_AGENT_DIR` (the same durable signal pi-core's `getAgentDir()` reads).
- Keeps `shared` dependency-light — no pi-core dep, no cross-package injection. Simpler than A.
- Removes three copies of `join(os.homedir(), ".pi", "agent", "sessions")` from the server.
- Coupling to pi's `.pi/agent` layout already existed (the last-ditch literal hardcodes it); the
  unachievable DRY win was delegating that literal to pi's helper.

Rejected/superseded:
- **A (original)**: inject `piCoreGetSessionsDir()` from the server. Blocked by the tsc barrel issue.
- **B**: add the pi-core dep to `shared`. Heavier; still hits the same barrel issue.

Shape:

```ts
// packages/shared/src/dashboard-paths.ts
export type DashboardPathsEnv = ManagedPathsEnv & {
  piSessionsDir?: string;   // from config.json
  sessionDirEnv?: string;   // test seam for process.env.PI_CODING_AGENT_SESSION_DIR
  agentDirEnv?: string;     // test seam for process.env.PI_CODING_AGENT_DIR
};

export function resolvePiSessionsDir(env?: DashboardPathsEnv): string {
  const pick = (s?: string) => { const t = s?.trim(); return t ? expandTilde(t, env) : undefined; };
  const agentDir = pick(env?.agentDirEnv ?? process.env.PI_CODING_AGENT_DIR);
  return pick(env?.piSessionsDir)
    ?? pick(env?.sessionDirEnv ?? process.env.PI_CODING_AGENT_SESSION_DIR)
    ?? (agentDir ? path.join(agentDir, "sessions") : undefined)
    ?? path.join(env?.homedir ?? os.homedir(), ".pi", "agent", "sessions");  // last-ditch literal
}
```

Server call site (no pi-core import):

```ts
// session-scanner.ts
import { loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { resolvePiSessionsDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";

function getSessionsDir(): string {
  return resolvePiSessionsDir({ piSessionsDir: loadConfig().piSessionsDir });
}
```

## Tilde expansion

pi already exposes `expandTildePath`. To avoid coupling `shared` to pi, the resolver does minimal
`~/`-prefix expansion against `homedir` locally (matches existing `dashboard-paths.ts` style of
`env.homedir ?? os.homedir()`). Absolute paths pass through untouched.

## Windows / Electron safety (maintainer concern)

- Resolver never hand-builds separators beyond `path.join`; absolute inputs pass through verbatim.
- pi-core's `getSessionsDir()` already returns native Windows paths.
- No symlink/junction assumptions added.
- Electron loads config via `loadMinimalConfig()` (`~/.pi/dashboard/config.json`); `piSessionsDir`
  is just another optional string field there — no new IPC.

## Test plan

Unit (`dashboard-paths` resolver), table-driven:

| config piSessionsDir | env SESSION_DIR | env AGENT_DIR | expected |
|---|---|---|---|
| unset | unset | unset | `<homedir>/.pi/agent/sessions` |
| unset | unset | `/custom/agent` | `/custom/agent/sessions` |
| `/data/sess` | unset | unset | `/data/sess` |
| unset | `/env/sess` | unset | `/env/sess` |
| unset | `/env/sess` | `/custom/agent` | `/env/sess` (SESSION_DIR wins) |
| `  ` (blank) | `/env/sess` | unset | `/env/sess` (blank skipped) |
| `~/mine` | unset | unset | `<homedir>/mine` |
| `/data/sess` | `/env/sess` | unset | `/data/sess` (config wins) |

Integration: point `piSessionsDir` at a temp fixture tree with `.meta.json` sidecars; assert
`scanAllSessions()` discovers them; assert default (all unset) still scans `~/.pi/agent/sessions`.

## Deferred decisions

- **`settings.json#sessionDir`** (pi's persistent per-user session-dir setting): pi reads it via its
  startup settings manager. Replicating that parse in the dashboard is a 4th precedence layer; deferred
  until a user reports relying on it. `PI_CODING_AGENT_DIR` covers the common relocate case.
- **`--session-dir` per-invocation flag**: structurally unobservable to a separate dashboard process.
  Out of scope.
- **Configurable `~/.pi/dashboard` root** (the issue's secondary ask): separate concern (the
  dashboard's own state dir, not pi's sessions). Not in this change.
- **Multi-root scanning** (watch several sessions dirs at once): not requested; single root only.
