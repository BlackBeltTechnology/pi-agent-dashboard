# gateway-socket-bind.ts — index

Binds the gateway unix-domain socket without ever destroying a live one (D9, defect B3).

## Exports

- `bindGatewaySocket({socketPath, createServer?, probe?})` → `http.Server`, `0600` in a `0700` dir. Serializes probe/unlink/bind under an exclusive `proper-lockfile` lock on the companion `<socketPath>.lock` — a socket cannot itself be locked, and `EADDRINUSE` cannot guard the sequence because `bind()` only raises it when the path EXISTS.
- `probeSocket(path, timeoutMs)` → `"no-listener" | "live" | "indeterminate"`. Only `ENOENT` authorises an unlink: `ECONNREFUSED` is ambiguous (leftover file vs saturated backlog), so it fails closed.
- `GatewaySocketConflictError` — thrown instead of capturing a path that may still be serving.
- `unbindGatewaySocket(server, path)` — close + unlink the socket AND the `<path>.lock` sentinel, idempotent w.r.t. a missing file.

Tests: `__tests__/gateway-socket-bind.test.ts` (test-plan X1, X2, X3, E18).
See change: add-pi-gateway-transport-identity.
