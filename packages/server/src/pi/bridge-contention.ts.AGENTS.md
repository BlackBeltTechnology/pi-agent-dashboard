# bridge-contention.ts — index

Pure decision logic behind the one-live-bridge-per-session-id invariant, plus the contention record and rate limiter. Split out of `pi-gateway.ts` because the decisive `OPEN`-but-not-writable socket state is not constructible from a real client socket — synthetic sockets make it testable.

Exports `decideClaim(ClaimInput) → accept | probe | refuse | displace` (accept reasons: `unheld`, `same-socket`, `incumbent-closed`, `placeholder`, `same-pid`), `resolveProbe(incumbent, pongedWithinWindow)` implementing the two-factor rule (pong ⇒ alive; no pong but `_socket.writable` ⇒ busy, still alive; neither ⇒ dead ⇒ displace), `isSocketAlive` (mirrors the ping reaper's own definition), `formatContentionLine` (names session id + both pids, renders `unknown` for a missing pid, deliberately NOT matching `[gateway] session registered: <id> cwd=`), and `createContentionTracker` (per-id records, cumulative `count()`, `contendedIds()`, `clear()`, and a 1-per-id-per-5s emission gate).

Constants: `CONTENTION_PROBE_WINDOW` 5s, `CONTENTION_RECORD_TTL` 60s, `CONTENTION_RATE_LIMIT` 5s. `WS_OPEN` inlined so the module stays free of the `ws` import.

See change: fix-duplicate-bridge-registration.
