## Why

The dashboard scans pi's session JSONL from a **hardcoded** `~/.pi/agent/sessions`
(`session-scanner.ts:15`, `session-discovery.ts:28`, `migrate-persistence.ts:78`),
derived directly from `os.homedir()` with literal path segments. pi itself resolves
its sessions dir through a precedence chain (`--session-dir` flag → `PI_CODING_AGENT_SESSION_DIR`
env → `settings.json#sessionDir` → `PI_CODING_AGENT_DIR/sessions` → `~/.pi/agent/sessions`).
Any user who relocates pi's agent dir (e.g. `PI_CODING_AGENT_DIR=/custom`) gets sessions in a
non-default location, and the dashboard **silently finds nothing** — empty session list, no error.

The server package already depends on `@earendil-works/pi-coding-agent` (`^0.80.2`), which exports
`getSessionsDir()`. The dashboard re-derives the path by hand instead of asking pi. Closing this
divergence makes the dashboard track pi's own resolution in lockstep.

Reported in issue #98. Maintainer flagged Windows/Electron dir fragility as the main risk — in
scope: only the **read/scan** path. The dashboard's own runtime dirs (`~/.pi/dashboard/sessions/`
RPC sockets, PID sidecars) are a different tree and are NOT touched.

## What Changes

- **Single resolver**: add `resolvePiSessionsDir(env?)` in `packages/shared/src/dashboard-paths.ts`
  as the one source of truth. Precedence (high → low):
  1. dashboard `config.json#piSessionsDir` (explicit operator override)
  2. `PI_CODING_AGENT_SESSION_DIR` env (inherited from the dashboard's process env)
  3. pi's exported `getSessionsDir()` from `@earendil-works/pi-coding-agent` — already honors
     `PI_CODING_AGENT_DIR` and falls back to `~/.pi/agent/sessions`
- **Replace hardcoded paths**: `session-scanner.ts`, `session-discovery.ts`, and
  `migrate-persistence.ts` SHALL call the resolver instead of `join(os.homedir(), ".pi", "agent", "sessions")`.
- **Config field**: `src/shared/config.ts` gains optional `piSessionsDir?: string` (trim-aware,
  tilde-expanded, whitespace-only treated as unset). Absent → resolver falls through to pi.
- **No new env coupling for `--session-dir`**: a per-invocation `--session-dir` flag is invisible to
  a separate dashboard process. The durable equivalent (`settings.json#sessionDir`) is deferred —
  see design.md "Deferred decisions".

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `session-persistence`: startup scan + discovery path is no longer fixed at `~/.pi/agent/sessions`;
  it resolves via `resolvePiSessionsDir()`, tracking pi's `PI_CODING_AGENT_DIR` relocation and an
  explicit dashboard override. Default behaviour (no env, no config) is unchanged: `~/.pi/agent/sessions`.

## Impact

**Code**:
- `packages/shared/src/dashboard-paths.ts` — add `resolvePiSessionsDir(env?)`; extend
  `DashboardPathsEnv` with optional `piSessionsDir` + `agentSessionDirEnv` for test isolation.
- `packages/server/src/session-scanner.ts:15` — `getSessionsDir()` delegates to resolver.
- `packages/server/src/session-discovery.ts:28` — same delegation.
- `packages/server/src/migrate-persistence.ts:78` — default `sessionsScanDir` from resolver.
- `src/shared/config.ts` — add `piSessionsDir?` field + parse/trim.
- `README.md` Config section — document `piSessionsDir` + the resolution order.

**APIs**: none (no REST/WS surface change).

**Config**: `~/.pi/dashboard/config.json` gains optional `piSessionsDir`. Additive, non-breaking.

**Risk**: low. Default path unchanged. Windows: resolver returns native paths from pi's own helper;
no manual separator math added.
