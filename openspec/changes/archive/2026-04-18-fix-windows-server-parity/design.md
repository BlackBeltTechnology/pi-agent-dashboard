## Context

The dashboard server is launched from three independent call sites, each using `spawn(node, ["--import", <loader-path>, <cli.ts>, ...args])`:

```
┌────────────────────────────┬─────────────────────────────────────────────┐
│ Launcher                   │ Loader path source                          │
├────────────────────────────┼─────────────────────────────────────────────┤
│ packages/server/src/cli.ts │ resolveJitiImport() or tsx fallback         │
│ packages/extension/        │ resolveJitiImport() (shared)                │
│   src/server-launcher.ts   │                                             │
│ packages/electron/src/lib/ │ resolveJitiFromAnchor() (duplicated copy)   │
│   server-lifecycle.ts      │                                             │
└────────────────────────────┴─────────────────────────────────────────────┘
```

All three return raw filesystem paths. On Linux/macOS, Node's ESM loader accepts both raw paths and `file://` URLs for `--import`. On Windows ≥ Node 20, raw absolute paths like `B:\...\jiti-register.mjs` are rejected because the drive-letter prefix (`B:`) is parsed as a URL scheme, producing `ERR_UNSUPPORTED_ESM_URL_SCHEME: Received protocol 'b:'`. The fix is a one-line URL conversion per resolver; a `file://` URL is accepted on every OS.

A broader audit of every `spawn`/`execSync`/`execFile` site in `packages/` revealed four additional Windows-breaking assumptions in the server-launch / restart / port-cleanup surface:

| Call site | Unix tool assumed | Windows effect |
|---|---|---|
| `cli.ts:findPortHolders` | `lsof` | silent no-op; stale server PID not killed |
| `system-routes.ts:/api/restart` | `sh`, `lsof`, `curl` | `/api/restart` fails entirely |
| `session-diff.ts` untracked diff | `cat` | untracked files show no synthetic diff |
| `editor-detection.ts:whichBinary` | `which` (no `where` fallback) | code-server auto-detect silently fails |

And three diagnostic-hygiene gaps that made the primary `--import` crash invisible in practice:

- `extension/server-launcher.ts` uses `stdio: "ignore"` → stderr of the crashed child is lost
- `cli.ts` opens `server.log` with `"w"` → crash output from the previous retry is truncated before a human can read it
- The extension `.catch(() => {})` swallows `launchServer` failures without surfacing the log path

## Goals / Non-Goals

**Goals:**
- Dashboard server auto-starts on Windows (x64 and arm64) with only pi installed, matching the Linux/macOS "Option B" contract.
- `pi-dashboard start`, `POST /api/restart`, and stale-port cleanup work on all three supported OSes without depending on `sh`, `lsof`, `curl`, or `cat`.
- When the server-launch path crashes, the cause is visible via `~/.pi/dashboard/server.log` without re-running the command.
- The fix is small, cross-platform, and does not regress Linux/macOS.

**Non-Goals:**
- WSL-specific spawn paths in `process-manager.ts` (tracked separately).
- ARM64 native-module coverage (node-pty prebuild availability at runtime — tracked separately).
- Collapsing the duplication between `shared/resolve-jiti.ts` and `electron/server-lifecycle.ts` (worth doing, but out of scope here — this change patches both sites consistently).
- Changing `process-manager.ts` headless-spawn logic (already has a Windows branch).
- Rewriting `tunnel.ts` or `editor-registry.ts` (already OS-branched correctly).

## Decisions

### D1: Always emit `file://` URLs from loader resolvers, not platform-gated

Resolvers (`resolveJitiImport`, `resolveJitiFromAnchor`, tsx fallback in `cmdStart`) return `pathToFileURL(p).href` unconditionally. Alternatives considered:

- **Gate on `process.platform === "win32"`**: works, but every caller has to remember the rule, and the conversion is cheap and correct on Unix too (Node accepts `file://` URLs everywhere).
- **Convert at the spawn site**: requires touching 3+ sites, risks missing one, and makes the resolver's return type ambiguous.

Rationale: put the invariant at the boundary that produces the value, not at every consumer.

### D2: Rewrite `/api/restart` in Node, not shell

Current implementation builds a bash script (`for i in $(seq …); do lsof …; curl …; done`) and hands it to `spawn("sh", ["-c", script])`. Replacement: spawn a small detached Node process (via `process.execPath` + the same `--import` loader) that:

1. Polls the port in a loop (using `net.createConnection` with short timeout) until free or deadline.
2. Spawns the new server with the same argv as the current process would use for `cmdStart`.
3. Polls `GET /api/health` (using Node's built-in `http` module) until it returns `{ ok: true }` or deadline.
4. Logs failure to `~/.pi/dashboard/restart.log`.

This reuses the CLI's existing `cmdStart` helper rather than re-implementing spawn logic.

Alternative considered: keep the shell script on Unix, fork to PowerShell on Windows. Rejected — two implementations to maintain, PowerShell execution-policy friction, no upside.

### D3: Cross-platform `findPortHolders` via `netstat`/`lsof` branch

Not using a pure-Node approach (enumerating process tables) because:
- Node has no built-in API for this; alternatives pull in native deps (`find-process`, `ps-list` + arch-specific binaries).
- We already accept shelling out on Unix; parity is the only missing piece.

Windows branch: `netstat -ano | findstr ":<port>"` → parse the 5th column for PID → `taskkill /F /PID <pid>`. Unix branch unchanged (`lsof -t -i :<port>` + `kill`).

The helper remains best-effort (wrapped in try/catch); a failure just means the user sees the existing "port already in use" error instead of an automatic cleanup.

### D4: Stderr capture in extension server-launcher, not process-wide redesign

`packages/extension/src/server-launcher.ts` currently passes `stdio: "ignore"` to `spawn`. Change to `stdio: ["ignore", logFd, logFd]` using `fs.openSync(serverLogPath, "a")`. This matches what `cmdStart` already does in `cli.ts` and means both paths converge on the same log file.

Not doing a full logging-framework redesign — the existing `~/.pi/dashboard/server.log` convention is already understood; we just stop bypassing it.

### D5: `server.log` opened append, not truncate

`fs.openSync(..., "w")` → `fs.openSync(..., "a")`. Each start attempt is prefixed with a timestamp header line (already written by `server-lifecycle.ts` — adopt the same pattern in `cli.ts`). Log rotation is out of scope (file grows unbounded, but start attempts are infrequent and each is ~50–200 lines; users who care can delete the file).

### D6: `ToolResolver.which` everywhere, including editor-detection

`packages/server/src/editor-detection.ts:whichBinary` uses `which ${name}` unconditionally. It should delegate to `ToolResolver.which`, which already handles `where`/`which`, login-shell fallback, and managed-bin paths. No behavior change on Linux/macOS; fixes Windows detection silently.

### D7: Minor cleanups bundled vs. separate

`session-diff.ts` `cat` → `readFileSync` and `isPiProcess` Windows guard are each ~3-line changes touching the same "Windows parity" theme. Bundling them here avoids two more round-trips; each has a dedicated task with its own test.

## Risks / Trade-offs

- **Risk: URL conversion misses a call site**  
  → Mitigation: add a unit test in `packages/shared/src/__tests__/` asserting `resolveJitiImport()` returns a string starting with `file://`. Grep for `--import` across the tree; there are exactly four sites after this change.

- **Risk: `/api/restart` rewrite regresses on Linux/macOS (original worked there)**  
  → Mitigation: manual smoke test on all three OSes before archiving. Keep the old shell script path behind a fallback only if the Node rewrite fails in QA — but default to the new path.

- **Risk: `netstat` output format differs across Windows versions**  
  → Mitigation: loose parsing (regex that accepts variable whitespace); treat parse failure as "no holder found" and proceed to the normal "port in use" error path. This is best-effort cleanup, not a correctness requirement.

- **Risk: Stderr capture changes downstream behavior**  
  → Mitigation: the capture is write-only to a file descriptor that's immediately closed via `fd` reference; child is still detached + unref'd. No change to parent process lifecycle.

- **Trade-off: `server.log` grows without rotation**  
  → Accepted. Log rotation is orthogonal; users who want it can add it later.

- **Trade-off: Electron resolver still duplicated**  
  → Accepted for this change. A follow-up explore item covers collapsing the duplication; patching both sites keeps this change narrow.

## Migration Plan

No data or config migration needed. Deployment is a normal npm publish + Electron installer rebuild. Rollback: revert the PR; the old behavior returns.

Users who previously worked around the Windows failure by installing `tsx` globally will continue to work unchanged (the tsx fallback is still present, just also URL-converted).

## Open Questions

- Should `resolveJitiFromAnchor` in the Electron package import from `@blackbelt-technology/pi-dashboard-shared` to remove duplication? → Out of scope; tracked as a separate explore item.
- Should we add a startup sanity check in the extension that `resolveJitiImport()` returns a valid URL and notify if not? → Probably yes; captured as an optional task.
- Should `findPortHolders` get a structured return (PID + process name) for nicer error messages? → Deferred; current call sites only need "try to free the port."
