## Why

Any loopback listener a bridge dials receives the HOME's local token in clear
(`X-Pi-Local-Token`, sent on every loopback dial on every platform —
`extension/src/local-token-header.ts`, `bridge.ts:1158`), and the CLI sends it
raw over loopback HTTP (`server/src/cli.ts:609-642`). The token also exempts
HTTP API requests from auth (`auth-plugin.ts:297`, `pairing-routes.ts:100`).
A process holding the dialled port — including another OS user who binds it
after the dashboard exits, or binds `[::1]:<port>` while the dashboard holds
only `127.0.0.1` — harvests a full local credential, receives the bridge, and
can drive the agent. Identity is verified only after the upgrade, too late.

Split out of `fix-gateway-socket-stale-owner` (whose POSIX loopback fallback
widens the exposure from Windows-only to POSIX), where a first design (D7 there)
failed doubt review. This change is DRAFT — design not yet written.

## What Changes (direction, to be designed)

- Bridges prove possession of the local credential instead of transmitting it,
  and spawned bridges verify the server's counter-proof before registering or
  acting on any message.
- The CLI's loopback HTTP calls stop sending the raw token.
- Old bridges/servers keep interoperating during a defined window.

## Known design constraints (from the failed D7 doubt review)

Blockers:
1. **Relay/MITM:** a server proof bound only to the client nonce can be relayed —
   a squatter forwards the bridge's upgrade to the real dashboard and passes its
   proof back. Proofs MUST be bound to the dialled endpoint (literal
   `127.0.0.1:<port>`, never `localhost`) and verified against the server's own
   listener address, or use a server-chosen challenge.
2. **Client-proof replay:** a captured client proof is a one-use bearer against
   any same-HOME dashboard within the window unless endpoint-bound (all
   instances of a HOME share the token, `local-token.ts:38-60`).

Majors:
3. **Per-dial headers:** `ConnectionManager.openSocket` reuses construction-time
   headers (`connection.ts:866-867`, `applyCredentials` only on re-target), so a
   nonce proof is reused on reconnect. Needs a per-dial header factory (keep the
   injectable `WebSocketImpl` test seam).
4. **Verification hook:** verify in the client `ws` `'upgrade'` event
   (`ws/lib/websocket.js:938-945`), before `'open'` flushes buffered
   `session_register` (`connection.ts:885-900`). Server side: `wss.on('headers',
   (headers, req))` (`ws/lib/websocket-server.js:372-426`) with the verdict
   carried from `verifyClient` via a `req`-keyed WeakMap; `verifyClient` is
   `undefined` without `bridgeAuth` (`pi-gateway.ts:1126`); exclude unix-socket
   upgrades on the shared `wss`.
5. **Terminal identity failure:** aborting in `'upgrade'` surfaces as
   `error`/`close` and `handleDisconnect` reconnects as transient — needs a
   terminal outcome, backoff/quarantine, and a report channel that does not run
   through the squatter's socket (`bridge.ts:1141-1146`: stdout discarded).
6. **Enforcement marker lifecycle:** an env marker set at spawn (a) does not
   reach tmux panes unless passed via `-e` (`process-manager.ts:493-513`),
   (b) is inherited by descendants, (c) must not break rollback to pre-proof
   servers, `/dashboard-connect` to older instances (`connect-target.ts:118`),
   or remote/mDNS migration (proof is loopback-only).
7. **Unmarked bridges** (manual `pi`, rendezvous endpoints, last-resort
   `ws://localhost:<piPort>`, `bridge.ts:1069-1071`) stay exposed to a squatter
   that omits the proof — state scope explicitly.
8. **D10b grace interplay:** today an invalid credential on loopback falls
   through to the tokenless grace (`bridge-upgrade-auth.ts:146-160`); decide
   whether a presented-but-invalid proof is refused (breaks wrong-HOME, WSL2
   clock drift, docker userland-proxy cases) or treated as tokenless.
9. **Replay cache:** insert after MAC check; TTL ≥ window, no early eviction
   (or refuse on overflow); bounded nonce length/charset; canonical `ts` units;
   key = token bytes vs string; cache + clock injected to keep
   `decideBridgeUpgrade` pure (`bridge-upgrade-auth.ts:21`); restart empties it.
10. **CLI HTTP path** (`cli.ts:609-642`) leaks the same token.
11. **Legacy raw-token acceptance** keeps the hole open for old bridges — needs a
    sunset or a stated accepted risk.

Minors: no-grace-yet-pre-proof servers (grace closes in 1.0.0); clock-step
tolerance for `|now − ts|`; spec text for Windows "without a valid local token"
scenarios must account for proofs.

## Capabilities

### Modified Capabilities

- `pi-gateway-auth`: local-credential proof of possession on loopback dials;
  server counter-proof for spawned bridges.

## Impact

`extension/src/local-token-header.ts`, `bridge.ts`, `connection.ts`;
`server/src/auth/local-token.ts`, `pi/bridge-upgrade-auth.ts`, `pi/pi-gateway.ts`,
`spawn-process/process-manager.ts`, `cli.ts`.

## Discipline Skills

- `security-hardening` — credential-on-the-wire, relay, replay.
- `doubt-driven-review` — protocol design before it stands.
- `observability-instrumentation` — identity-failure reporting off the hijacked channel.
