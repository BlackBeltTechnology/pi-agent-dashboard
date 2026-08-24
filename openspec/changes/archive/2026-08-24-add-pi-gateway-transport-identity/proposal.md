# Give the pi gateway a transport and an identity

## Why

The bridge↔server connection is the least-defended and most-churned surface in
the system. Two facts drive this change.

### Fact 1 — the gateway port has no authentication

`packages/server/src/auth/` protects the HTTP/WS port (`:8000`) with OAuth,
bearer device auth, a CIDR network guard, CORS, CSP, single-use WS tickets, and
an Ed25519 server identity. The pi gateway (`:9999`) has **none of it**.
`grep -n 'token|auth|secret' packages/server/src/pi/pi-gateway.ts` returns only
comments, one of which states outright that a check "is not a claim about the
gateway port's own authentication."

Anything that reaches `:9999` can register as any `sessionId`, displace a live
bridge, and receive `send_prompt` / `set_model` routing.

That is survivable only while the port is loopback-bound. It is not:
`piGateway.start(config.piPort, config.host)` follows `--host` /
`PI_DASHBOARD_HOST`, and `docker/Dockerfile` already carries `EXPOSE 8000 9999`
with `.env.example` documenting that the bind host "must be `0.0.0.0`".

The planned feature — *a locally started pi joins a remote dashboard* — removes
the loopback assumption deliberately and permanently.

### Fact 2 — endpoint resolution is a name lookup that can lie

The local transport is a TCP port reached through mDNS. That indirection is
unauthenticated and its answer can be wrong, which has produced a sustained
stream of defects: `mdns-server-discovery`, `diagnose-empty-mdns-scan`,
`fix-bridge-autostart-port-resolution`, and the open
`fix-bridge-mdns-migration-hijack`, where a loopback-bound stale worktree
dashboard advertised itself under a LAN hostname and captured every newly
spawned bridge for ~23 hours.

Discovery does not merely add noise — it **overrides explicit intent**.
`server-auto-start.ts` documents this in the rationale for `PI_DASHBOARD_NO_MDNS`:

> Without this, a co-located real dashboard advertising on mDNS would be
> discovered here and override the bridge's explicit `PI_DASHBOARD_URL`,
> hijacking the connection off the isolated gateway.

So the remote-join feature is broken today by the local discovery path, and the
current defence is a second environment variable the operator must remember.

### What this change rests on

Two mechanisms already exist and are simply not wired to the bridge:

- `openspec/specs/server-identity-keypair` — *"a persistent Ed25519 identity
  whose public-key fingerprint is stable across changing URLs … so a client can
  pin the identity and detect an impostor."* This is exactly the property the
  hijack defeated. The browser is protected by it. The bridge is not.
- `home-lock.ts` — a per-HOME advisory lock asserting **one dashboard instance
  per `<canonicalHomedir>/.pi/`**, carrying a stable per-instance `identity`
  already verified against `/api/health`.

A local transport keyed to the rendezvous record therefore needs no *discovery*:
the record names exactly one instance, and reading it is deterministic.

## What Changes

- **The local endpoint SHALL be resolved from a `HOME`-derived rendezvous
  record, never from network discovery.** `home-lock.ts` defines the right
  record shape (`piPort`, `httpPort`, stable `identity`) but is **currently
  unwired — `acquireOrAttach` has no production caller and no lock file exists
  on disk**. Writing that record is therefore in scope here, not assumed.
- **The local transport SHALL be a unix domain socket on POSIX and a
  loopback-bound WebSocket on Windows, carrying the existing WebSocket protocol
  unchanged.** The server-side liveness surface (`ping`/`pong`, `terminate()`,
  `wss.clients`, `readyState`) is preserved over a unix socket, so
  `bridge-contention.ts` is unaffected. The **client** is not unchanged:
  `ConnectionManager` defaults to `globalThis.WebSocket`, which rejects
  `ws+unix://`, so it SHALL be constructed with the `ws` package — a swap also
  forced by the Windows token header.
- **The socket path SHALL be per instance** (`gateway-<piPort>.sock`), because
  N-dashboards-per-HOME is shipped and documented behaviour for worktree
  servers. The per-HOME rendezvous record names the default instance; a
  non-lock-holding instance serves only bridges pinned to it.
- **Binding SHALL NOT unlink a socket that has a live listener.** A stale path
  is cleaned up; an occupied path is a startup conflict, never a silent capture.
- **Local authorisation SHALL restrict access to the owning OS user.** On POSIX
  that is socket ownership — mode `0600` inside a `0700` directory, no token and
  no port at all. On Windows, where `chmod` is a documented no-op, it is the
  existing `local-token.ts` credential presented on the upgrade.
- **An explicitly configured endpoint SHALL be pinned.** `PI_DASHBOARD_SOCKET`,
  `PI_DASHBOARD_URL`, and a configured instance identity SHALL NOT be overridden
  by any discovered candidate.
- **A bridge SHALL stick to the instance it registered with.** Re-targeting
  requires that the current endpoint is unpinned, has failed, and that the
  candidate's identity verifies.
- **A session SHALL be movable to another instance on explicit request.** The
  bridge SHALL register with the target before leaving the origin, SHALL pin the
  target because an explicit move is explicit intent, and SHALL tell the origin
  it moved so the session reads as *moved* rather than dead. This is the same
  pin/bind/verify mechanism with a human trigger, and it is the only manual
  recovery for a bridge attached to the wrong instance — which has no answer
  today.
- **A remote-joined session's transcript SHALL be reachable by the dashboard it
  joined, and SHALL survive the session ending.** `session-scanner.ts` reads
  `~/.pi/agent/sessions/**/*.jsonl` from the **local** filesystem via
  `resolvePiSessionsDir()`, which a remote dashboard cannot do. This is not a
  remote-only gap: `memory-event-store.ts` is lossy by design, so the `.jsonl`
  is the only complete record and six existing capabilities depend on reading
  it. Four mechanisms are recorded with tradeoffs in the design; the choice is
  deferred, the invariants are not.
- **No filesystem path SHALL cross the bridge, and a bridge SHALL serve only
  its own session.** The server requests by `sessionId`; the bridge resolves the
  file. Otherwise the id becomes the traversal parameter the path was not.
- **A remote session SHALL be read-only once its bridge has ended.** Resume and
  spawn need a process on the pi host; after exit there is none. The refusal
  SHALL be explicit and explained rather than a control that fails obscurely.
- **Remote bridges SHALL authenticate as paired devices**, reusing
  `paired-devices.ts`, `bearer-auth.ts`, and `ws-ticket.ts` with a new `bridge`
  `WsRouteScope`; the durable bearer never rides the WebSocket.
- **A remote bridge SHALL pin the server's Ed25519 fingerprint** and refuse an
  endpoint that cannot prove possession, making the hijack class unrepresentable
  rather than merely guarded.
- **No externally reachable bridge listener SHALL bind by default.** On POSIX no
  bridge TCP port is bound at all; on Windows the local listener is pinned to
  `127.0.0.1` regardless of the configured bind host. A non-loopback listener is
  opt-in, and when bound it accepts only authenticated bridges.

- **NOT in scope, and why:**
  - *Guarded/reversible mDNS migration, health-checked candidates, and honest
    advertisement.* Owned by the open `fix-bridge-mdns-migration-hijack`, which
    fixes a live defect on the current TCP path and should land independently.
    This change deliberately declares **no delta on `mdns-discovery`** to avoid
    a conflicting modification of the same capability; it constrains discovery
    only from the new capability's side, as a lower-precedence source.
  - *Retiring mDNS.* Discovery remains useful for suggesting servers to a human.
    It stops being an authority, not a feature.
  - *Resume and spawn for remote sessions.* Excluded as a stated product
    boundary, not an omission — see the read-only requirement above. A
    same-HOME move keeps its history because both instances scan the same
    files; a cross-host move does not.
  - *A host-resident daemon.* The only thing that could lift that boundary;
    named in the design, not proposed.
  - *A P2P transport (iroh/libp2p).* Evaluated and rejected — see
    `docs/plans/iroh-transport-research.md`. The properties wanted from it
    (identity == address, impostor detection) are obtained here from mechanisms
    already in the repo, without a native dependency.
  - *Session-identity churn* (`spawn-correlation-token`,
    `fix-spawn-correlation-ttl-coupling`, `fix-duplicate-bridge-registration`).
    A cryptographic bridge identity should eventually simplify these, but they
    are tracked separately and this change does not rewrite them.

## Open Questions

Which transcript-access shape should be built? Four are recorded in the design
with measured tradeoffs — push-at-register, pull-on-demand, federate via the
origin dashboard, or log-ship with a byte cursor — and the choice is deferred to
implementation, when the remote-join usage pattern is known. The invariants (no
path on the wire, registration never blocked on transfer, sessions carry an
origin) constrain all four, so deferring the choice does not defer the design.

Separately: does a host-resident daemon belong on the roadmap? It is the only
thing that would lift the read-only boundary, and the natural home for serving a
transcript after a session ends. Named, not proposed.

## Capabilities

### New Capabilities

- `pi-gateway-transport` — how a bridge and a server locate and connect to each
  other: local socket transport, HOME-derived addressing, endpoint precedence,
  and stickiness.
- `pi-gateway-auth` — how a bridge proves who it is and verifies who the server
  is: socket ownership locally, paired-device bearer plus fingerprint pinning
  remotely.
- `remote-session-history` — how a dashboard obtains, retains, and bounds the
  session data of a bridge running on another host.

### Modified Capabilities

None. (`mdns-discovery` is intentionally untouched — see NOT in scope.)

## Impact

- **Users:** the default local connection stops depending on a port, a
  multicast advertisement, and a race. Isolated and worktree instances separate
  by construction. Remote join becomes a supported, authenticated path instead
  of an env var plus an unauthenticated port.
- **Security:** closes an unauthenticated control surface that Docker already
  exposes, before a feature makes it routable.
- **Risk:** the transport carries every session's traffic, so a regression
  strands every bridge at once and the local path needs a fallback during
  rollout. The guarantee is also not uniform: on POSIX the `--host 0.0.0.0`
  exposure becomes unrepresentable because nothing listens, while on Windows a
  loopback listener exists and the local token is the only guard. Windows
  additionally surfaces a **pre-existing** gap — `chmod` is a no-op there, so the
  owner-only property of `local/token`, `identity.key`, and `paired-devices.json`
  rests on inherited NTFS ACLs that this change is the first to depend on
  explicitly, and which must be verified rather than assumed.
- **Blast radius:** `packages/server/src/pi/`, `packages/server/src/auth/`,
  `packages/extension/src/` (connection targeting), `packages/shared/src/`
  (path helpers, config), `docker/`.

## Discipline Skills

- `security-hardening` — the change exists to close an unauthenticated control
  surface and to add an authenticated remote path; threat-modelling the socket
  permissions, the Windows local-token guarantee, and the pairing flow is the
  core of the work.
- `doubt-driven-review` — the default transport for every session is being
  replaced. It is irreversible in practice once shipped and strands every bridge
  if wrong; the decision needs adversarial review before it stands.
- `observability-instrumentation` — the failure this change prevents cost ~23
  hours precisely because it was silent. Endpoint selection, pinning, refusal,
  and any fallback must be visible at runtime.
- `scenario-design` — the interesting cases are edge cases: stale socket files,
  two HOMEs, a pinned endpoint that is down, a paired device that was revoked, a
  Windows rendezvous record naming a port another process now holds, and rollout
  with a mixed-version bridge and server.

## Carved out for a follow-up change

Two pieces were deliberately NOT built here, and the spec deltas were narrowed
to stop claiming them rather than left asserting behaviour that does not exist:

1. **Serving a retained remote transcript.** Retention is write-only: chunks are
   received and stored, but nothing reads them back and no API exposes them.
   Making §11 useful needs a read path plus a rendered view. Until then the
   retained copy is durable storage with no consumer.
2. **The browser E2E arms that depend on it** — test-plan #F6 (task 12.52),
   pre-attach history rendering.

The client surfaces that WERE built (moved badge, remote-origin display, resume
gating, live gateway endpoint) cover test-plan #F1-#F5.

3. **Nothing.** An earlier draft carried a third item describing a terminal
   bridge close on `develop`, reported from a parallel debugging session. That
   report was RETRACTED by its author: the sampled sessions had never been
   prompted, and an idle session legitimately holds no gateway TCP connection.
   No bridge defect on `develop` is established, and none is claimed here.
