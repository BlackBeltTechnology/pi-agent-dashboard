## Context

`spawnPiSession` (`packages/server/src/process-manager.ts`) returns `{ success, message, pid?, process?, dashboardSpawned? }`. Callers in `session-action-handler.ts` already wrap it and emit `spawn_result` + `spawn_error` browser messages. The failure-message string is the only signal the UI gets.

Five gaps:

1. **Windows headless**: pi's stderr is captured to `~/.pi/dashboard/sessions/pi-spawn-<ts>-<rand>.log`. On `waitForNoCrash` immediate-exit, the path is mentioned in the log but the file content is never read or forwarded.
2. **No classification**: every failure is a free-text string. UI cannot map to actionable hints (open wizard vs. rescan tools vs. fix permissions) without regexing.
3. **No watchdog**: a spawn returning `success: true` only proves the OS process is alive past 300 ms. Pi may still fail to attach to the dashboard (wrong port, missing extension, version skew) — UI shows the placeholder card forever.
4. **No preflight**: bad `cwd`, missing pi binary, or unwritable folder race the spawn. Errors surface late and inconsistently per mechanism.
5. **No history**: failures evaporate after the toast/banner. Users reporting "spawn sometimes fails" have no log to share.

## Goals / Non-Goals

**Goals:**
- Every `spawnPiSession` failure return path SHALL set a structured `code`.
- Windows-headless immediate-exit SHALL return the tail of pi's stderr in the result.
- The UI SHALL receive a distinct event when a spawned PID never registers within the configured `spawnRegisterTimeoutMs` window (default 30 s, clamped 5–120 s).
- A synchronous preflight gate SHALL run before spawn and refuse with classified reasons.
- Failed spawns SHALL persist to a rolling log that the UI can fetch via REST.
- Additive changes only — existing message strings, success cases, and event shapes preserved.

**Non-Goals:**
- No retry/auto-recovery logic. Diagnostics only.
- No Linux/macOS stderr-tail parity in this change. The Unix headless wrapper (`sh -c "tail -f /dev/null | pi"`) does not currently capture pi stderr to a file. Out of scope.
- No new global config knobs beyond `spawnRegisterTimeoutMs` (the 10 MB log cap stays a constant).
- No backfill of historical failures into the rolling log.
- No UI redesign of the existing spawn-error banner — only additive fields rendered.

## Decisions

### D1. Place classification in `process-manager.ts`, not in handlers
`SpawnResult.code: SpawnFailureCode` (string-literal union) is set at every `return { success: false, ... }` site inside `process-manager.ts`. Rationale: the function knows precisely which check tripped (e.g. `dashboardSessionExists` returns false vs. `wt.exe` missing vs. `cmd.lower().endsWith(".cmd")`). Handlers should not re-classify by inspecting message strings.

Codes (closed set):
- `DIR_MISSING` — `existsSync(cwd) === false`
- `PI_NOT_FOUND` — `resolvePiCommand()` returned `null`
- `WIN_PI_CMD_ONLY` — Windows headless found only `.cmd` wrapper
- `WT_MISSING` — Windows Terminal not installed
- `TMUX_MISSING` — tmux mechanism chosen but binary absent
- `PI_CRASHED` — `waitForNoCrash` reported immediate exit
- `SPAWN_ERRNO` — generic `spawnDetached` failure (ENOENT, EACCES, etc.)
- `PREFLIGHT_FAILED` — set by handler when preflight gate refused (never returned by `spawnPiSession` itself)
- `REGISTER_TIMEOUT` — set by handler when watchdog fires (never returned by `spawnPiSession` itself)

### D2. Stderr tail: 4 KB, Windows-headless only
Read with `fs.readSync` on a re-opened fd, pulling `min(fileSize, 4096)` bytes from end-of-file. 4 KB matches the existing 2 KB error-stderr cap (`session-action-handler.ts:333`) doubled to give pi room to print a stack trace. Truncated on UTF-8 boundary by stripping leading bytes until `>= 0x80 && < 0xC0` are gone (continuation bytes), then decoding.

Only Windows headless gets this in v1. The Unix wrapper would need a redesign (currently `stdio: "ignore"` with no log fd); deferred.

### D3. Watchdog lives in a new `spawn-register-watchdog.ts`
Two internal maps:
- `byPid: Map<number, Entry>` for headless spawns (we own the PID).
- `byCwd: Map<string, Entry>` for tmux/wt/wsl-tmux spawns (PID belongs to the terminal, not pi).

`Entry = { timer: NodeJS.Timeout; cwd: string; pid?: number; mechanism: SpawnMechanism; logPath?: string; ws: WebSocket }`.

Hooked from three sides:
- **Arm**: `session-action-handler.handleSpawnSession` calls `watchdog.arm({ pid?, cwd, mechanism, logPath?, ws })` after every successful spawn. Headless → indexed in `byPid`. tmux/wt/wsl-tmux → indexed in `byCwd` only (no PID).
- **Clear by PID**: `pi-gateway.ts::handleSessionRegister` calls `watchdog.clearByPid(pid)` for headless registrations.
- **Clear by cwd**: same handler also calls `watchdog.clearByCwd(cwd)` so any `session_register` from that directory clears a `byCwd` watch (tmux/wt path). Both calls are idempotent; headless registrations exercise both.
- **Fire**: `timeoutMs` elapses → emit `spawn_register_timeout` to the originating WS with `{ cwd, pid?, stderrTail? }`, delete entry. If `ws.readyState !== OPEN`, drop silently.
- **Late register after fire**: any subsequent `session_register` from that pid/cwd emits a new `spawn_register_recovered { cwd, pid? }` browser message so the UI can auto-clear the timeout banner (see D8).

Window: 30 s default, configurable via `spawnRegisterTimeoutMs` in `~/.pi/dashboard/config.json` (range 5000–120000, clamped). Rationale: cold tsx + AV scan on Windows can take 8–12 s; 30 s gives headroom without being so long the user assumes silent failure.

PID/cwd reuse risk: trivial in a 30 s window. `clearByPid` and `clearByCwd` are both idempotent.

### D8. Late-register recovery message
When pi finally registers AFTER the watchdog has fired and removed its entry, the gateway emits a separate `spawn_register_recovered { type, cwd, pid? }` browser message. The UI uses it to auto-clear any timeout banner still showing for that `cwd` (symmetry with the existing `spawn_result.success === true` clearing rule). Implementation: watchdog keeps a short-lived `recentlyFired: Map<string /*cwd*/, { firedAt, pid? }>` with 60 s TTL; gateway checks it on every `session_register`.

### D4. Preflight is pure, sync-fast, and SKIPS login-shell fallback
`packages/server/src/spawn-preflight.ts`:
```ts
export interface PreflightResult {
  ok: boolean;
  reasons: Array<{ code: string; message: string }>;
}
export function preflightSpawn(cwd: string, deps?: { resolver?: ToolResolver }): PreflightResult;
```
Checks (all run, all reasons returned — not short-circuited, so user fixes everything in one pass):
- `cwd` exists (`fs.existsSync`)
- `cwd` is a directory (`fs.statSync().isDirectory()`)
- `cwd` is writable (`fs.accessSync(cwd, fs.constants.W_OK)`)
- pi resolves (`resolver.resolvePi() !== null`)
- node resolves (`resolver.resolveNode() !== null`)

**Critical perf rule**: the resolver passed to preflight MUST be constructed with `useLoginShell: false`. Login-shell fallback (`$SHELL -ilc "which pi"`) spawns a full shell on every preflight invocation — unacceptable on every spawn click, especially on macOS where session-restore noise inflates latency to seconds. Preflight trusts the cached `toolPaths` config + managed bin + system PATH only. If pi is reachable only via login shell, the user's persisted `toolPaths` already records its absolute path — preflight finds it via the registry's first-tier strategies.

Handler builds the preflight resolver inline: `new ToolResolver({ processExecPath: process.execPath, useLoginShell: false })`. The actual spawn keeps the default resolver (login-shell allowed) — preflight is a fast advisory, not a replacement.

If `!ok`, handler sends `spawn_result { success: false, message: <joined reasons> }` and `spawn_error { code: "PREFLIGHT_FAILED", reasons }`. No spawn happens.

### D5. Rolling log under sessions/, append-only with single-rotation
`packages/server/src/spawn-failure-log.ts`. File path: `~/.pi/dashboard/sessions/spawn-failures.log` (rotated predecessor: `spawn-failures.log.1`). Co-located with `pi-spawn-*.log` per-session captures so all spawn artifacts live in one directory.

Format — one entry per line, JSON object, NDJSON-compatible:
```
{"ts":"2026-05-03T12:34:56.789Z","cwd":"/p/x","strategy":"headless","code":"PI_CRASHED","message":"...","stderrTail":"..."}
```

API:
```ts
export function appendSpawnFailure(entry: SpawnFailureEntry): void;  // sync, fire-and-forget catch
export function readSpawnFailures(limit: number): SpawnFailureEntry[];  // last N, parsed; skip malformed lines
```

Rotation: on `appendSpawnFailure`, if file size > 10 MB, rename to `.log.1` (overwriting any existing `.log.1`), open fresh `.log`. Single-shot rotation — no `.log.2`, `.log.3` rings. Two files cap total at ~20 MB.

`GET /api/spawn-failures?limit=N` (default 50, max 500) registered in `system-routes.ts`. Auth-gated by existing Fastify auth plugin (no special handling). Returns `{ entries: SpawnFailureEntry[] }`. **Auth posture caveat**: in default local installs without auth + zrok exposure, the endpoint is reachable by anyone who can hit the dashboard, and entries leak `cwd` paths. Documented in README.md security section and queued in `docs/todo.md` for hardening (per-endpoint auth-required override or path redaction).

### D6. Browser protocol additions are additive
`packages/shared/src/browser-protocol.ts`:
```ts
// Existing
type SpawnError = { type: "spawn_error"; cwd: string; strategy: string; message: string;
                    stderr?: string;                   // already typed
                    code?: SpawnFailureCode;           // NEW
                    reasons?: PreflightReason[]; };    // NEW (only for PREFLIGHT_FAILED)

// New — pid optional (tmux/wt/wsl-tmux own the PID, not pi)
type SpawnRegisterTimeout    = { type: "spawn_register_timeout";    cwd: string; pid?: number; stderrTail?: string };
type SpawnRegisterRecovered  = { type: "spawn_register_recovered";  cwd: string; pid?: number };
```
No version bump. Old clients ignore unknown fields/messages.

### D7. Tests: pure-first
- `spawn-preflight.test.ts` — table-driven on a memfs cwd matrix (missing/file/no-write/ok).
- `spawn-failure-log.test.ts` — round-trip parse, malformed-line skip, rotation at threshold.
- `spawn-register-watchdog.test.ts` — fake timers; arm/clear/fire ordering; idempotent clear; closed-WS no-throw.
- `process-manager-codes.test.ts` — every failure return path sets `code` (lint-style: grep AST for `success: false` literals and assert `code` present). Avoids per-platform spawn execution.
- Integration: `session-action-handler.handleSpawnSession` with stub `spawnPiSession` returning each code → asserts emitted `spawn_error` shape.

## Risks / Trade-offs

- **PID reuse on the watchdog window** (R1, low). Mitigated by `cwd` co-storage; a stale fire is at worst a phantom banner the user dismisses. Not worth a second key.
- **Stderr tail leaks paths/secrets** (R2, low). Pi's stderr already shows on the user's own log file; we're forwarding it to the same user's WebSocket. No new attack surface.
- **Watchdog window could be too short on slow hardware** (R3, medium). Mitigated by exposing `spawnRegisterTimeoutMs` in config (default 30 s, range 5–120 s) so users on slow disks / heavy AV can extend it without a code change.
- **`spawn-failures.log` could leak user `cwd` paths** (R4, low). The file is under `~/.pi/dashboard/`, same trust boundary as `server.log`. No change in posture.
- **Preflight adds 1–2 stat calls per spawn click** (R5, negligible). Sub-millisecond on local disk; user-perceptible only on a hung NFS mount, where the current spawn would also hang.
- **Tail of NDJSON not crash-safe on partial writes** (R6, low). `appendSpawnFailure` writes one `\n`-terminated line via `fs.appendFileSync`. Power-loss could leave a partial last line; `readSpawnFailures` skips malformed lines. Acceptable for diagnostics.
