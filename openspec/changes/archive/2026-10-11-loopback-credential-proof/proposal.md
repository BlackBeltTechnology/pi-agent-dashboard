## Why

Any loopback listener a bridge dials receives the HOME's local token in clear
(`X-Pi-Local-Token`, sent on every loopback dial on every platform —
`extension/src/local-token-header.ts`, `bridge.ts:1245,1251,2088`), and the CLI sends it
raw over loopback HTTP (`server/src/cli.ts:597,686,711,757,780,826,1014`; Electron main and `scripts/reload-all.sh:64` too). The token also exempts
HTTP API requests from auth (`auth-plugin.ts:437,533,628`, `localhost-guard.ts:407`, `local-proof.ts:74`, `pairing-routes.ts:115`, `user-routes.ts:74`, `local-proof-routes.ts:28`, `server.ts:1946,2014`).
A process holding the dialled port — including another OS user who binds it
after the dashboard exits, or binds `[::1]:<port>` while the dashboard holds
only `127.0.0.1` — harvests a full local credential, receives the bridge, and
can drive the agent. Identity is verified only after the upgrade, too late.

Split out of `fix-gateway-socket-stale-owner` (whose POSIX loopback fallback
widens the exposure from Windows-only to POSIX), where a first design (D7 there)
failed doubt review. design.md answers each constraint below (see its
constraint map).

## What Changes

- Every local-credential caller (bridge, CLI, Electron main, `reload-all.sh`)
  sends an HMAC proof of possession (`X-Pi-Local-Proof`) bound to the dialled
  address literal + port, a timestamp and a nonce — never the raw token.
- The server verifies the proof against the connection's OWN local
  address/port (a relayed proof earns no credentialed admission), freshness, a
  listener-bind-time floor and a replay cache. The verdict is stamped once per
  request at the listener edge and read by every HTTP/WS exemption site.
- The gateway answers a verified bridge proof with a counter-proof header.
  Dashboard-spawned bridges (marked per endpoint via env, incl. tmux `-e`)
  verify it in the `'upgrade'` event, before `'open'`; a missing/invalid
  counter-proof aborts the dial, quarantines reconnects and is reported only
  through a later verified connection or an owner-only log.
- Per-dial credential factory in `ConnectionManager` (fresh nonce per dial);
  the bridge pre-connects TCP and binds the proof to the address actually
  reached, so `localhost` dials keep today's resolution.
- Raw `X-Pi-Local-Token` stays ACCEPTED (deprecated, logged) until the 1.0.0
  horizon shared with D10b; new clients never send it.
- A presented-but-invalid proof is treated as tokenless (grace applies where it
  exists); refused where no grace exists.

**BREAKING (bounded):**
- New bridges no longer send the raw token, so a PRE-proof server's no-grace
  loopback fallback refuses them.
- Marked spawned bridges refuse a downgraded (pre-proof) server at their
  marked endpoint.
- New CLI/Electron calls through a NAT'd/published port (docker) are no longer
  admitted by the local credential.

**What this does NOT fix (stated residuals, see design):**
- Unmarked bridges (manual `pi`, rendezvous, `wsl-tmux`, null-path spawns)
  can still be received or MITM'd by a squatter. They just no longer leak the
  token.
- A token already harvested from a legacy client forges proofs until it is
  rotated, which the follow-up `close-loopback-legacy-window` owns.
- The pre-existing D10b tokenless grace and the non-strict genuine-local HTTP
  trust are unchanged.

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
   `undefined` without `bridgeAuth` (`pi-gateway.ts:1060`); exclude unix-socket
   upgrades on the shared `wss`.
5. **Terminal identity failure:** aborting in `'upgrade'` surfaces as
   `error`/`close` and `handleDisconnect` reconnects as transient — needs a
   terminal outcome, backoff/quarantine, and a report channel that does not run
   through the squatter's socket (`bridge.ts:1139-1142`: stdout discarded).
6. **Enforcement marker lifecycle:** an env marker set at spawn (a) does not
   reach tmux panes unless passed via `-e` (`process-manager.ts:556-574`),
   (b) is inherited by descendants, (c) must not break rollback to pre-proof
   servers, `/dashboard-connect` to older instances (`extension/src/connect-target.ts:118`),
   or remote/mDNS migration (proof is loopback-only).
7. **Unmarked bridges** (manual `pi`, rendezvous endpoints, last-resort
   `ws://localhost:<piPort>`, `bridge.ts:1131`) stay exposed to a squatter
   that omits the proof — state scope explicitly.
8. **D10b grace interplay:** today an invalid credential on loopback falls
   through to the tokenless grace (`bridge-upgrade-auth.ts:150-164`); decide
   whether a presented-but-invalid proof is refused (breaks wrong-HOME, WSL2
   clock drift, docker userland-proxy cases) or treated as tokenless.
9. **Replay cache:** insert after MAC check; TTL ≥ window, no early eviction
   (or refuse on overflow); bounded nonce length/charset; canonical `ts` units;
   key = token bytes vs string; cache + clock injected to keep
   `decideBridgeUpgrade` pure (`bridge-upgrade-auth.ts:103`); restart empties it.
10. **CLI HTTP path** (`cli.ts:686-826`) leaks the same token.
11. **Legacy raw-token acceptance** keeps the hole open for old bridges — needs a
    sunset or a stated accepted risk.

Minors: no-grace-yet-pre-proof servers (grace closes in 1.0.0); clock-step
tolerance for `|now − ts|`; spec text for Windows "without a valid local token"
scenarios must account for proofs.

## Capabilities

### Modified Capabilities

- `pi-gateway-auth`: local-credential proof of possession on loopback dials;
  server counter-proof for spawned bridges; identity-failure handling.
- `local-ipc-allowlist-token`: "valid local token" now means a verified proof
  (or the legacy raw header inside the deprecation window) on every HTTP/WS
  exemption site.

## Impact

- New: `shared/src/local-credential-proof.ts` (pure mint/verify/binding).
- Extension: `local-token-header.ts`, `bridge.ts`, `connection.ts`.
- Server: `auth/local-token.ts`, `auth/local-proof.ts`, `auth/auth-plugin.ts`,
  `auth/localhost-guard.ts`, `routes/pairing-routes.ts`, `routes/user-routes.ts`,
  `routes/local-proof-routes.ts`,
  `pi/bridge-upgrade-auth.ts`, `pi/pi-gateway.ts`,
  `spawn-process/process-manager.ts`, `cli.ts`, `server.ts` (wiring).
- Electron: `lib/local-proof-bootstrap.ts`, `lib/server-lifecycle.ts`,
  `lib/runtime-overlay-main.ts`. Script: `scripts/reload-all.sh`.
- No persisted-format change; token file unchanged. Rollback = revert; see
  design Migration Plan for spawned-session stranding.

## Discipline Skills

- `security-hardening` — credential-on-the-wire, relay, replay.
- `doubt-driven-review` — protocol design before it stands.
- `observability-instrumentation` — identity-failure reporting off the hijacked channel.
