# gateway-socket-bind.ts — index

Binds the gateway unix-domain socket without ever destroying a live one (D9, defect B3).

## Exports

- `bindGatewaySocket({socketPath, createServer?, probe?})` → `http.Server`, `0600` in a `0700` dir. Serializes probe/unlink/bind under an exclusive `proper-lockfile` lock on the companion `<socketPath>.lock` — a socket cannot itself be locked, and `EADDRINUSE` cannot guard the sequence because `bind()` only raises it when the path EXISTS.
- `probeSocket(path, timeoutMs)` → `"no-listener" | "live" | "indeterminate"`. Only `ENOENT` authorises an unlink outright: `ECONNREFUSED` is ambiguous (leftover file vs saturated backlog), so it fails closed.
- Probe verdicts are `no-listener | live | refused | timeout | indeterminate`. `refused` and `timeout` are NOT one verdict: a timeout is what a live listener with a saturated backlog looks like, so it never authorises an unlink (@review Audit).
- Stale-path reclamation: bind writes `<path>.pid` (`0600`, unlink-then-`wx` so a planted symlink is not followed); only a `refused` probe plus a recorded pid that `isProcessAlive` says is gone authorises the unlink. Missing/unparseable pidfile → refuse. A `live` probe always overrides the pidfile. Without this a SIGKILLed dashboard wedges its own path forever (@review finding 1, D9 cycle-5 amendment).
- `GatewaySocketConflictError` — thrown instead of capturing a path that may still be serving.
- `unbindGatewaySocket(server, path)` — close + unlink the socket, the `<path>.pid` and the `<path>.lock` sentinel, idempotent w.r.t. a missing file.

Tests: `__tests__/gateway-socket-bind.test.ts` (test-plan X1, X2, X3, E18).
See change: add-pi-gateway-transport-identity.
