# gateway-socket-bind.ts — index

Binds the gateway unix-domain socket without ever destroying a live one (D9, defect B3).

## Exports

- `bindGatewaySocket({socketPath, createServer?, probe?})` → `http.Server`, `0600` in a `0700` dir. Serializes probe/unlink/bind under an exclusive `proper-lockfile` lock on the companion `<socketPath>.lock` — a socket cannot itself be locked, and `EADDRINUSE` cannot guard the sequence because `bind()` only raises it when the path EXISTS.
- `probeSocket(path, timeoutMs)` → `"no-listener" | "live" | "indeterminate"`. Only `ENOENT` authorises an unlink outright: `ECONNREFUSED` is ambiguous (leftover file vs saturated backlog), so it fails closed.
- Probe verdicts are `no-listener | live | refused | timeout | indeterminate`. `refused` and `timeout` are NOT one verdict: a timeout is what a live listener with a saturated backlog looks like, so it never authorises an unlink (@review Audit).
- Stale-path reclamation: bind writes `<path>.pid` (`0600`, unlink-then-`wx`) as `"<pid> <ownerStartMs>"` (bare pid when `processStartedAt` is null; failure logged). Unlink needs ALL of: `lstat` is a socket (non-socket/symlink → conflict), probe `refused`, owner provably gone — pid dead, OR alive with start time off by >2 s, OR legacy bare pid started after pidfile mtime+2 s, OR own pid with no live listener in the in-module registry (#744). Missing/unparseable/malformed/null start → refuse. `live` always wins.
- `GatewaySocketConflictError(path, detail, {verdict?, ownerPid?})` — thrown instead of capturing a path that may still be serving; `info` feeds the server refusal log.
- `unbindGatewaySocket(server, path)` — drops the registry entry, closes the listener, then under the bind lock removes socket + `.pid` ONLY if nothing else here serves the path and the pidfile names this process. Never deletes `.lock`. Idempotent, never throws.
- Registry: `Map<path, http.Server>` of sockets this process bound.

Tests: `__tests__/gateway-socket-bind.test.ts` (test-plan X1, X2, X3, E18, E1–E8, X10–X13).
See change: add-pi-gateway-transport-identity.
See change: fix-gateway-socket-stale-owner.
