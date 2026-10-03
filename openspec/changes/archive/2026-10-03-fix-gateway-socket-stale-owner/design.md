## Context

See proposal.md — Why. Current mechanics (from `add-pi-gateway-transport-identity`, D9):

- `bindGatewaySocket` serializes probe → unlink → bind under `<sock>.lock`
  (`proper-lockfile`, `stale: 10 s`, retries ≈ 4.8 s total).
- Probe verdicts: `live` / `timeout` / `indeterminate` never reclaim;
  `no-listener` (ENOENT) always may; `refused` may only when
  `ownerIsProvablyDead()` — i.e. `!isProcessAlive(pid)` from `<sock>.pid`.
  Existence is checked with `fs.existsSync` (follows symlinks).
- libuv unlinks a pipe's path itself on `server.close()`; `unbindGatewaySocket`
  then unlinks `sock`, `.pid`, `.lock` again, without the lock
  (`gateway-socket-bind.ts:254-267`).
- The socket lives in `getDashboardConfigDir()` (persistent), so it survives
  reboots on every host. Its path, the instance id (`ensureInstanceId(_,
  piPort)`) and the autostart lock are all keyed by HOME + `piPort`.
- `server.ts` falls back to `piGateway.start(piPort, "127.0.0.1")` on ANY
  `startOnSocket` error, only when the TCP opt-in is OFF. With `PI_GATEWAY_TCP`
  (the `docker/compose.yml` default) `start()` ran first and keeps serving.
- Loopback bridges are accepted tokenless during the D10b window
  (`requireTicketOnLoopback: false`, `server.ts:990`); a bridge ticket or a
  raw `X-Pi-Local-Token` authorises on its own. Bridges send the RAW token on
  every loopback dial, on every platform (`local-token-header.ts`,
  `bridge.ts:1158`), before any identity check — identity is verified only
  after the upgrade. The token also exempts HTTP requests from auth
  (`auth-plugin.ts`).
- `buildSpawnEnv` pins `PI_DASHBOARD_URL=ws://localhost:<piPort>`, deletes an
  inherited `PI_DASHBOARD_SOCKET`, and re-pins it when the socket file exists.
  tmux panes do NOT receive that env: they inherit the shared `pi-dashboard`
  tmux server's env; only the spawn token and `NODE_OPTIONS` ride `-e`
  (`process-manager.ts:493-513`). The bridge treats an empty variable as unset.
- `/api/health` is unauthenticated (`auth-plugin.ts:307`).

## Evidence (spikes, reproducible from `spikes/`)

| # | Spike | macOS 25.4 / node 24 | Linux 6.12 (container) |
|---|---|---|---|
| 1 | `01-unix-connect-errno.mjs` — stale socket file | `ECONNREFUSED` | `ECONNREFUSED` |
| 1 | — live listener, backlog full (SIGSTOP + flood) | **`ECONNREFUSED`** | **`EAGAIN`** |
| 1 | — healthy | connected | connected |
| 1 | `/proc/<pid>/stat` f22 + `btime` start time | n/a | works, 843 ms drift ≈ runtime |
| 2 | `02-autostart-pid-reuse.mts` — real `isLockStale` on a reused pid | stale ✅ | **held ❌** (`ps` absent → `null`) |
| 3 | `03-refused-bind-fallback.mts` — `server.ts` fallback (TCP opt-in off), live incumbent | **startup aborts** (orphan guard) | **startup aborts** |
| 3 | — stale socket + pidfile = own pid (#744 repro) | **startup aborts** | **startup aborts** |
| 3 | `transport()` after failed bind | throws `noServer` | throws `noServer` |

Existing test `gateway-socket-bind.test.ts:250`: a non-socket answers
`ENOTSOCK` on darwin, `ECONNREFUSED` on Linux. `docker/Dockerfile` ships no `ps`.

## Goals / Non-Goals

**Goals:** reclaim provably-stale sockets after reboot/pid reuse; never unlink
a live socket or any non-socket; a refused bind degrades to an authenticated
loopback listener instead of aborting; a stopping dashboard never removes a
socket it does not own; spawned sessions (incl. tmux) follow the served
transport; the fallback state is visible.

**Non-Goals:**
- Trusting the kernel's refusal alone (see D2).
- Re-binding the socket after a fallback (fallback lasts until restart).
- A distinct identity for a fallback instance.
- The autostart lock's `ps`-less defect (spike 2): `/proc` start times shift
  with wall-clock steps and the lock compares against `Date.now()`; a correct
  fix records the holder's start time. Follow-up change.
- Changing the TCP opt-in listener's D10b grace, or the unrepresentable-path
  fallback's auth policy beyond D7 (which covers every loopback dial).
- A `~/.pi` shared across kernels/pid namespaces (host + VM/container
  bind-mount): pids are meaningless there, so D1 cannot protect it. Unsupported.
- Not sending the local token in clear on loopback dials — split into change
  `loopback-credential-proof` (see Risks).

## Decisions

### D1 — Owner proven gone

The pidfile becomes `"<pid> <ownerStartMs>\n"`, `ownerStartMs =
processStartedAt(process.pid)` at bind time (D3); a bare `"<pid>\n"` when that
returns `null`. A failed pidfile write is logged (the path becomes
unreclaimable until cleanup). On a `refused` probe of a path whose `lstat` is a
socket, the owner is provably gone when the recorded pid is:

1. not alive (unchanged); or
2. alive, and `processStartedAt(pid)` differs from a well-formed
   `ownerStartMs` by more than 2 s — the pid names a different process; or
3. **legacy bare-pid file:** alive, and `processStartedAt(pid) >
   mtime(<sock>.pid) + 2 s`; or
4. `process.pid` itself, and the in-module registry (D4) holds no live
   listener for that path — #744's deterministic self-collision, even when the
   start-time probe fails.

Anything else — missing pidfile, unparseable pid, malformed second field (not
legacy, not well-formed → not proven), `null` start time, unreadable mtime, a
non-socket — is **not** proven: fail closed.

*Assumption:* macOS `ps -o lstart` reports the start time captured at fork
(stable across later clock steps). If false, a clock step > 2 s plus a
saturated live owner could satisfy rule 2 on macOS; pinned as an assumption,
not measured (no clock-step spike).
*Dropped: `process.ppid`* — a dashboard spawned by a live incumbent would
unlink its parent's saturated-but-live socket on macOS.
*Alternative — issue's `{pid, bootId, startTime}`*: boot id adds nothing over
start-time equality. Older builds still parse the pid
(`Number.parseInt("123 1790…") === 123`).

### D2 — Reclaim needs the refusal AND a socket inode AND D1

On Linux, spike 1 shows `refused` already means no listener, so a D1
misjudgement (clock step/slew, `USER_HZ`) cannot unlink a live socket there.
On macOS D1 is the sole discriminator. The `no-listener` branch uses `lstat`:
a path that does not exist is bound without unlinking; a dangling symlink or
any non-socket fails closed (→ D5 fallback).

*Alternative — Linux `refused` + socket inode alone.* Rejected in doubt
review: it overrides "unknown owner data fails closed" and rests a MUST
invariant on one kernel measurement.

### D3 — `processStartedAt(pid)` in `shared/platform/process.ts`

Linux: `/proc/<pid>/stat` after the last `)` → field 22 ÷ `USER_HZ` (100) +
`btime`. Elsewhere: `ps -o lstart= -p <pid>` with `LC_ALL=C`. Any failure →
`null`. Used only by the gateway in this change.

### D4 — In-module ownership registry; owned-only unbind

`gateway-socket-bind.ts` keeps a `Map<path, http.Server>` of sockets this
process bound. `unbindGatewaySocket(server, path)` deletes the registry entry
first (always), closes the listener (libuv unlinks the path), then — under
`<sock>.lock` — removes a remaining `sock` / `.pid` only when the pidfile
still names this process; it no longer deletes `.lock`. Closes the race where
a stopping owner's post-close unlink loop deletes a successor that bound in
the ENOENT window, and makes same-process re-binds (`/api/restart`) see their
own path as free. Lock retries are unchanged: `ELOCKED` is a non-conflict
error (D5) and aborts startup with a message naming the lock file — raising
retries past `stale` would let a waiter break a stalled-but-live holder's lock
and reopen B3.

### D5 — Hardened loopback fallback

- **Trigger:** `GatewaySocketConflictError`, or a listen error meaning the
  filesystem cannot host a unix socket (`EOPNOTSUPP` / `ENOTSUP` /
  `EAFNOSUPPORT`; logged as such — the existing "unsupported socket path"
  scenario). Any other error aborts startup naming path and cause. With the
  TCP opt-in, any socket error keeps today's behaviour: log and keep serving
  the opt-in listener.
- `startOnSocket` tears down `wss` on bind failure **only if it created it**;
  `transport()` gets the `noServer` guard `address()` has.
- The fallback listener requires a bridge ticket or a valid local token — no
  tokenless grace. `requireTicketOnLoopback` is a single gateway-wide option
  today (`server.ts:990`), so the fallback `start()` gets a per-listener
  override.
- The fallback awaits `listening` / `error`; any error → abort naming the
  socket path and the port.
- Refusal log: path, probe verdict, recorded owner pid.

### D6 — Spawn pin follows the served transport (incl. tmux)

`process-manager.ts` gets a lazily-read transport getter set by `server.ts`
after the gateway starts. The existing unconditional `delete
env.PI_DASHBOARD_SOCKET` stays; `PI_DASHBOARD_SOCKET` is re-pinned only when
the gateway serves `unix` at that path; getter unset → no socket pin. After a
fallback the URL pin is `ws://127.0.0.1:<piPort>` (a literal, so a bridge
never lands on a `[::1]` squatter). The tmux command passes `PI_DASHBOARD_URL`
and `PI_DASHBOARD_SOCKET` (empty when unpinned = unset) via `-e`, like the
spawn token.

### D7 — Fallback is visible

`/api/health` gains `gateway: { listeners: Array<"unix" | "tcp" | "loopback" |
"loopback-fallback">, fallbackReason?: "occupied" | "unsupported" }` — every
active bridge listener (`tcp` = the explicit opt-in; `loopback` = Windows or an
unrepresentable socket path; `loopback-fallback` = refused/unsupported bind).
No path or pid (the endpoint is unauthenticated). The server log carries the
detail.

## Risks / Trade-offs

- [Same-identity clone] A fallback means another dashboard with the same HOME
  + `piPort` holds the socket; both present one instance id. → Accepted (user
  decision); refusal log names the holder pid; health shows the fallback.
- [Rendezvous after fallback] Unpinned bridges derive the socket path from
  the record's `piPort` and reach whoever serves the socket — or fail visibly
  once the holder dies, even if the fallback instance later owns the record,
  because a fallback never rebinds. → Restart.
- [Loopback token exposure — tracked] Bridges send the local token in clear on
  every loopback dial, and the token also exempts HTTP auth. On POSIX the
  fallback makes that reachable: once a fallback dashboard exits, another OS
  user can bind `127.0.0.1:<piPort>`, receive the pinned spawned bridges and
  harvest the token. → Accepted for this change (multi-user hosts only; same
  exposure already exists on Windows and on the CLI's loopback HTTP calls).
  Fix tracked in change `loopback-credential-proof` (proof of possession +
  server counter-proof; its proposal records the failed first design).
- [Stranded spawned sessions] Spawned sessions pinned to a fallback stay
  pinned if it exits; restart them.
- [Mixed versions / rollback] The pidfile format is compatible both ways, but
  an older build still unlinks `sock`/`.pid`/`.lock` unconditionally on stop
  and can remove a newer successor's socket during overlap — NOT safe until
  all instances upgrade.
- [Legacy mtime rule] An mtime skewed backwards (restore, `cp -p`) can make a
  live legacy owner look reused on macOS; harm also requires a saturated live
  listener.
- [Same-uid pidfile tampering] No new capability (a forged dead pid already
  works); same-uid is inside the `0700` boundary.
- [libuv close-time unlink] `server.close()` unlinks by name without the
  lock; if an older build already replaced the path, a newer stopping owner's
  close can remove it. → Only in mixed-version overlap.

## Migration Plan

Pidfile gains an optional second field; old builds parse the pid unchanged.
No config or wire change. Rollback = revert; an older build regains the reboot
wedge and the aborting fallback.

## Security review (task 4.1)

Pass over reclaim conditions, fallback auth and the unbind race, at implementation time:

- **Reclaim** requires lstat==socket AND probe `refused` AND owner gone (D1/D2); `live`/`timeout`/`indeterminate` and every malformed or unreadable input fail closed. Verified by test-plan E1–E8, X13.
- **Fallback auth**: the fallback `WebSocketServer` is built with a per-listener `requireLocalCredential`, so `decideBridgeUpgrade` runs with `requireTicketOnLoopback: true`; the opt-in TCP listener keeps its grace (X8, X9). `startLoopbackFallback` refuses to start without `bridgeAuth` (no accidental open listener).
- **Unbind race**: removal happens under the bind lock and only when no server in this process owns the path and the pidfile names this pid; `.lock` is never deleted (X10).
- **Known limit, pre-existing**: `isProcessAlive` maps `EPERM` to "dead", so a pidfile naming a live process of another user reads as gone; same-uid tampering is inside the `0700` boundary (already accepted under Risks).
- No new finding blocks the change.
