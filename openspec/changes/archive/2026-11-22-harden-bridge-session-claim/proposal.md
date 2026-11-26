## Why

The security map (`docs/security/residual-risks.md`) lists three Medium findings on the
bridge session claim path. All share one gap: **a session id is a bare name, and nothing
binds a claim on it to the origin the session was registered from.**

- **WS-02** — `decideClaim` replaces a *live* bridge with no probe when the newcomer
  self-reports the incumbent's `pid` (`server/src/pi/bridge-contention.ts:96-100`); the pid
  is public in browser payloads. The new socket's origin then overwrites the record's
  `originDeviceId` (`pi-gateway.ts:977-982`), so prompts for the victim route to the
  attacker.
- **WS-03** — with no incumbent, or a closed one (reconnect grace, post-restart), any
  claimant is accepted (`bridge-contention.ts:88-90`); a non-register first frame
  auto-claims an existing record and creates a placeholder with no origin that reads
  hub-local (`pi-gateway.ts:836-866`); the session-move commit also takes the entry
  (`:740-829`). No code compares the claimant's origin to the record's.
- **WS-05** — `plugin_request` reaches the handler with `{ sessionId }` only
  (`server/src/plugin-request-lane.ts:22-25,57`). The frame carries no session id
  (`shared/src/protocol.ts:1099-1107`); the gateway attributes it to the socket's
  `currentSessionId` (`pi/pi-gateway.ts:1100-1106`), which a socket that does **not** own the
  entry can set with a first frame naming a live-held id (`:845-852`), and no ownership gate
  covers `plugin_request` (the gate at `:880-882` covers `plugin_pi_message` only; the named-id
  gate `:886-887` needs a `sessionId` field the frame lacks). So origin-checking the *recorded*
  origin of the named session would judge the victim, not the sender. The Gmail handler leases a live OAuth
  access token on account level alone (`gmail-plugin/src/server/lease.ts:1-5`); the vault,
  by contrast, refuses remote and deprecated admissions. A sibling lane handler (flows
  report) stores bridge-claimed absolute paths that the hub later reads from its own disk.

**Premise correction** (found while tracing the root, see design): the register and
`VERIFY-AB` say any paired device of *any tier* can mint a bridge ticket. The route is
already `operate` (`shared/src/route-tiers.ts:512`; `bearer-device-auth` spec). Only the
decider lacks the check (`server/src/auth/bridge-ticket-eligibility.ts:67-79`), so it is
reachable below `operate` only where the route tier gate is exempt: a `legacy`-mode
trusted-network device, or a genuinely-local caller. Real reach of WS-02/03/05 is
therefore an **`operate`** paired device on the Docker image (`PI_GATEWAY_TCP=1`) or with the
TLS bridge listener (`tls.acceptBridges`), not any tier. The suggested "require `control`+"
would *loosen* the shipped rule and is rejected. The findings are trust-boundary breaks (a
remote device taking a hub-local or another device's session, leasing hub-held secrets),
not a tier escalation, and keep their Medium rating.

## What Changes

Four decisions, each confirmed by operator 2026-10-26 (`/tmp/secmap/batch2/DECISIONS-B.md`):

- **D1 — origin binding (WS-02, WS-03).** `decideClaim` gains the record's origin and the
  newcomer's origin; a mismatch against any completed (non-placeholder) record is a
  terminal `origin-mismatch` refusal, before the unheld / closed / placeholder / same-pid
  rules, whatever the record's status. The same decision guards the first-frame auto-claim
  (dropped, socket left open but unrouted, closed after 3 origin-refused first frames) and the move commit; the placeholder records its creator's origin. A placeholder is the first-frame-created record only (`source:"unknown"` and no `sessionFile`); a
  `sessions_list`-seeded history record (`event-wiring.ts:2759-2775`, has a `sessionFile`) is bound, is seeded with
  the reporting socket's origin, and its `sessionFile`/`sessionDir` is rewritten (`:2775-2780`) only by a reporter
  of the same origin. Same-pid fast accept
  now applies only within one origin. A refused first frame or move commit has none of the
  side effects of a refused register (no watchdog clear, heartbeat reset, placeholder or ghost
  cleanup, event). An id change refused for origin does **not** close the socket (it keeps
  its current session; non-terminal reply), unlike a register refusal.
- **D2 — ticket mint enforces `operate` itself (root).** `decideBridgeTicketMint` reads the
  bearer's tier; below `operate` a bearer falls through to the genuinely-local branch or is
  refused. Route tier unchanged.
- **D3 — lane carries origin + channel; credential handlers opt in (WS-05).**
  `registerPiRequestHandler(type, handler, { hubLocalOnly })` (additive). The gateway first
  gates `plugin_request` on `connections.get(currentSessionId) === ws` (as for
  `plugin_pi_message`, `pi-gateway.ts:880-882`) and hands the lane the **sending socket's own**
  origin and channel. The lane passes `{ sessionId, origin, channel }` and refuses a
  `hubLocalOnly` handler unless the socket is hub-local **and** locally admitted (unix /
  local-proof / in-process; `grace`, `legacy-token`, `local-ticket` and `device-ticket` are
  not local), replying `origin_denied: …`. Registered hub-local-only: `gmail/lease`, `gmail/accounts`, flows
  report. Browser and craft-web handlers are recorded as deferred.
- **D4 — scope of the binding.** Every non-placeholder record in every status; refusal is
  terminal and leaves the record untouched.
- **Observability.** One rate-limited line per refusal (claim, lane, ticket), reusing the
  contention counter and `/api/health`; an origin refusal uses its own line
  `[bridge-claim] origin-refused session=<id> recorded=<class> presented=<class>` (no pids);
  no payload, token or full device id.
- **Docs:** register status (WS-02/03/05 + new row WS-05b for the deferred handlers),
  `websocket-and-bridge.md` and `credentials-and-secrets.md`, CHANGELOG.

**BREAKING** (user-visible):

1. **Remote sessions lose Gmail.** A session registered from a paired device (or over a
   non-local admission: `grace`, `legacy-token`, `local-ticket`, or a `device-ticket` that
   reads hub-local by address) gets `origin_denied` from `gmail/lease` and `gmail/accounts`
   (so `gmail_accounts` lists nothing) until it reconnects hub-local.
2. **Cross-origin re-registration is refused.** A session id recorded for one origin cannot
   be re-registered from another until the record is archived/removed (e.g. a transcript
   copied to another machine and resumed under the same id, or a device re-paired after
   revoke). The refusal names the reason.
3. **Flow file previews for remote sessions disappear.** They never worked correctly (they
   read the hub's same-path file).
4. **Observe/control `legacy` trusted-network devices can no longer mint a bridge ticket.**
5. **Hub-disk-created records bind as hub-local.** Records the hub creates from its own disk
   (bootstrap, directory scan, scanner: `event-wiring.ts:2041-2056`,
   `browser-handlers/directory-handler.ts:89-104`, `session/session-bootstrap.ts:50-65`) carry
   no `originDeviceId`, so a remote-attributed bridge on the same host (a ticket-admitted TLS
   connection is remote whatever the peer address, `pi-gateway.ts:547-551`) or a shared/synced
   `HOME` that resumes such a session is terminally refused. This is intended (it is what
   closes WS-03 for hub sessions); remedy: archive the record or fork the session from the hub.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bridge-connection-contention`: MODIFIED "A same-process reconnect is not a contention"
  (origin precondition; copied from the blocking `scope-pids-to-namespace` delta), "One live
  bridge connection per session id" (origin precondition on closed-incumbent re-register and
  id change; id-change origin refusal keeps the socket), "Contention is observable"
  (origin-refusal log line); ADDED "A claim is bound to the session's recorded origin", "An origin refusal is
  terminal and leaves the record untouched", "Every routing-taking path obeys the origin
  binding".
- `pi-gateway-auth`: MODIFIED "Remote bridges authenticate as paired devices" (ticket mint
  requires `operate`, enforced by the mint).
- `plugin-bridge-request-lane`: MODIFIED "Reply privacy" (the lane carries host-observed
  origin and channel; hub-local-only handlers); ADDED "Handlers receive the sending
  session's origin and channel", "A credential-bearing handler refuses a session that is not
  hub-local", "A request is attributed only to the socket that owns its session".
- `flows-plugin`: ADDED "A flow-file report is accepted only from a hub-local session" (remote or
  deprecated-admission sessions are denied; previews answer the existing unreported response).
- `gmail-plugin`: MODIFIED "Server-held refresh tokens and leases" and "Account-scoped tools"
  (hub-local sessions only, including account listing).
  MODIFIED "Settings section is readable and guarded" (scope-limit copy: any hub-local
  dashboard session can use every account within its level; remote-origin sessions cannot lease).
- `session-listing`: MODIFIED "Server creates records for undiscovered sessions" (seeded record
  carries the reporting socket's `originDeviceId`; `sessionFile`/`sessionDir` rewritten only for
  the same origin; new scenario for the other-origin case).

## Impact

- Server: `pi/bridge-contention.ts`, `pi/pi-gateway.ts` (claim, first-frame, commit,
  placeholder, `refuse`, `plugin_request` ownership gate), `event-wiring.ts` (dispatch meta, `sessions_list` seed/rewrite), `auth/bridge-ticket-eligibility.ts`, `server.ts` (mint call
  site, lane dispatch wiring), `plugin-request-lane.ts`, `routes/system-routes.ts` (no new
  field; reuses counters).
- Plugin runtime: `dashboard-plugin-runtime/src/server/server-context.ts` (optional third
  argument on `registerPiRequestHandler`, `PluginRequestHandler` meta type).
- Plugins: `gmail-plugin/src/server/index.ts`, `flows-plugin/src/server/flow-files.ts`.
- Shared: none. Client: none. Extension (bridge): none (the terminal `register_rejected`
  and `<code>: <detail>` lane errors are already handled).
- Migration/rollback/compat: see design (no stored schema, no wire change, additive
  plugin seam, revert-safe).

## Discipline Skills

- `security-hardening` — trust-boundary binding of a claim to its credential-derived
  origin, fail-closed lane policy for credential-bearing handlers.
- `doubt-driven-review` — D1/D4 set a compatibility line (cross-origin re-registration is
  refused) and D3 adds a plugin-seam parameter; review before they stand.
- `observability-instrumentation` — three new refusal log lines (`[bridge-claim]
  origin-refused`, lane `origin_denied`, bridge-ticket tier refusal), rate-limited, reusing
  the contention counter.

## Ownership / not in scope

| Finding | Status | Owner |
|---|---|---|
| WS-02 same-pid displacement | Closed here (D1) once shipped | this change |
| WS-03 unbound claim of unheld/closed ids | Closed here (D1, D4), incl. first-frame and move-commit roads | this change |
| WS-05 lane without origin (incl. attribution of a non-owning socket's `plugin_request` to a victim session) | Closed for Gmail + flows report (D3) | this change |
| Bridge-ticket mint below `operate` (root) | Premise corrected; decider hardened (D2) | this change |
| WS-05b `browser/*` and craft-web lane handlers drive hub resources for any origin | **Deferred**, new register row; no stored secret | unowned residual (Low-Medium) |
| Same-device takeover of its own sessions; same-uid on the unix socket | Accepted, documented | — |
| Hub-disk-created records (no origin) are bound hub-local: a remote-attributed same-host bridge or a shared/synced `HOME` resuming them is terminally refused | **Residual**, documented; remedy: archive the record or fork from the hub | none |
| Unheld-id squat: with no record, the first claimant's origin is adopted; a legitimate bridge of another origin arriving later is terminally refused until the record is archived | **Residual**; remedy: archive the squatted record (the claim does not need a prior secret) | none |
| Unattributed remotes are one origin class | Accepted residual (container bridges) | — |
| Id-change origin refusal has no per-socket cap (id-probing oracle; each refusal is logged and counted) | **Accepted residual**; first-frame path caps at 3, this path cannot close the socket without silencing its own session | none |
| WS-01 tokenless loopback grace | Out of scope | `close-loopback-legacy-window` |
| PID namespace scoping | Out of scope | `scope-pids-to-namespace` |
