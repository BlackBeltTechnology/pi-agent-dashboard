## Why

A dashboard restarted after a reboot (or after pid recycling) can refuse to
start at all ([#744](https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/744)).
The leftover gateway socket's owner is identified by a bare pid; when that
number is reassigned — deterministically, in a container with stable startup
ordering — the dead owner looks alive, the socket is never reclaimed, and the
loopback fallback then crashes into its own orphan guard. Spikes (see
`design.md` § Evidence) reproduced every link of the chain on macOS and Linux.

## What Changes

- **Reclaim a stale socket whose last owner is provably gone.** The pidfile
  records the owner's process start time next to its pid; a live pid whose
  start time differs is a different process. Our own pid is never mistaken
  for a live owner.
- **A refusal alone never authorises a reclaim.** A socket that refuses
  connections is removed only when its last owner is also provably gone; a
  non-socket file at the path is never removed. (Linux's refusal is reliable,
  macOS's is not — spike 1 — so requiring both keeps either platform safe.)
- **A stopping dashboard removes only a socket it still owns**, under the bind
  lock — no racing deletion of a successor's socket.
- **Hardened loopback fallback.** When the socket bind is legitimately refused,
  the dashboard serves bridges on `127.0.0.1:<piPort>` requiring the local
  token (no tokenless grace) instead of aborting; if that port is unavailable,
  startup aborts with a clear error. Today the fallback always throws the
  orphan guard. This **amends** the scenarios "A live socket is never
  unlinked", "Default start binds no externally reachable bridge port" and the
  POSIX local-authorisation requirement.
- **Pin spawned sessions to the transport actually served**, never to another
  instance's socket — including sessions launched in tmux, whose panes today
  ignore the spawn environment.
- **The fallback is visible** in `/api/health` (transport + reason category).
- **Process start time without `ps`.** One shared helper reads `/proc` on
  Linux (our `docker/` image has no `ps`). The autostart lock's `ps`-less
  pid-reuse defect (spike 2) is a follow-up change — `/proc` start times shift
  with wall-clock steps, so it needs a different comparison.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `pi-gateway-transport`: "A stale local endpoint fails closed" — reclaim
  conditions, ownership-checked unbind, loopback fallback instead of abort,
  spawn pinning after a fallback; "The non-loopback bridge listener is opt-in"
  — a POSIX loopback listener is bound by default only as that fallback.
- `pi-gateway-transport`: "Local bridge transport is platform-appropriate and
  protocol-identical" — POSIX bridges may use the loopback fallback; "Endpoint
  selection is observable" — the fallback is reported in health.
- `pi-gateway-auth`: "Local bridge authorisation restricts access to the owning
  user" — the POSIX loopback fallback listener requires the local token or a
  ticket, with no tokenless grace.

## Impact

- `packages/server/src/pi/gateway-socket-bind.ts` — owner-staleness decision,
  socket-inode gate, pidfile owner start time, in-module ownership registry,
  locked owned-only unbind, lock retries outlasting `stale`.
- `packages/server/src/pi/pi-gateway.ts` — failed `startOnSocket` leaves no
  `wss`; `transport()` never throws; fallback listener with mandatory local
  token; awaited listen.
- `packages/server/src/server.ts` — fallback path, error handling, refusal log,
  spawn-transport wiring.
- `packages/server/src/spawn-process/process-manager.ts` — pin from the served
  transport; pins ride tmux `-e`.
- `packages/server/src/pi/bridge-upgrade-auth.ts` — per-listener no-grace
  option for the fallback.
- `/api/health` — `gateway` field.
- `packages/shared/src/platform/process.ts` — new `processStartedAt(pid)`.
- Persisted format: `<sock>.pid` gains an optional second field; older builds
  still parse the pid. No wire, message or config change. The pidfile is
  compatible in both directions, but an older build's unconditional unbind can
  still remove a newer successor's socket during upgrade overlap (design Risks).
- Accepted, tracked risk: on multi-user POSIX hosts a port squatter can
  harvest the local token from fallback-pinned bridges after the fallback
  dashboard exits — fixed separately in `loopback-credential-proof`.

## Discipline Skills

- `systematic-debugging` — the fix is driven by spike reproductions turned
  into failing tests first.
- `doubt-driven-review` — relaxing the D9 fail-closed rule and opening a
  loopback listener are takeover/auth-safety decisions; reviewed before they
  stand.
- `security-hardening` — same-uid-writable pidfile, loopback fallback auth
  (no tokenless grace), never unlinking a live socket.
