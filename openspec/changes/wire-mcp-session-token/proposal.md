## Status

**ACTIVE.** `spike-mcp-credential-delivery` completed; its `findings.md` measured
every `pi-mcp-adapter` behaviour the two doubt cycles argued about. D2 and D5 are
rewritten against those measurements (delivery moves to the `env` slot of
`requestHeadersCommand`; the reply moves off the broadcast bus onto the
session-private extension lane), and D6/D7 were added for the two problems the
spike proved the adapter will not solve on its own.

## Why

`/mcp` is provisioned into `~/.pi/agent/mcp.json` on every server start, but the
entry carries no credential — and `/mcp` requires a bearer on **every** request
including loopback (by design). Nothing anywhere in `packages/extension/` ever
sends the `mcp/mint-token` bridge message the design names as the delivery path
(`docs/architecture.md:1022`), so the minting handler has no caller. Result: a
local pi session that connects to the provisioned entry gets `401` and the
dashboard MCP surface is unreachable from the machine it provisions itself onto.
Verified live: `mcp connect pi-dashboard` → `401`; the same request with a
paired-device bearer → `200` with the full tool surface.

## What Changes

- Deliver a working credential to the local pi session so the provisioned
  `pi-dashboard` MCP entry authenticates without operator hand-editing.
- Evaluate two delivery mechanisms in `design.md` and pick one:
  - **A — per-session token over the bridge.** The bridge extension sends
    `mcp/mint-token` on registration and receives the plaintext once. Caller
    resolves as `{kind:"session", sessionId}`, so the self-target guard stays a
    real control. Costs: a reply path the bridge protocol does not yet have,
    re-mint on reconnect/restart, and a credential held in process memory for
    the session's lifetime.
  - **B — static provisioned token in the Pi-global `mcp.json`.** The server
    mints one long-lived credential at provisioning time and merges it into
    `headers`. Simple and already inside the existing writer's merge semantics,
    but the caller has **no originating session**, so the self-target guard
    (`Requirement: A session cannot drive itself through the MCP endpoint`)
    becomes structurally inert for every local pi caller, and the credential
    outlives any session.
- The chosen mechanism is specified as new requirements on the existing
  `dashboard-mcp-server` capability; whichever loses is recorded in `design.md`
  as a rejected alternative with its reason.
- Revocation, restart and reconnect behaviour is specified, not left implicit:
  the registry is in-memory, so every restart invalidates every token and the
  delivery path must re-run rather than leave a stale header on disk.

## Capabilities

### New Capabilities

(none — this closes a gap in an existing capability)

### Modified Capabilities

- `dashboard-mcp-server`: adds the credential-delivery requirement that makes
  the already-specified per-session token reachable by a local pi session, and
  extends `Requirement: Dashboard MCP entry is provisioned into the user MCP
  config` with the credential the entry needs to actually authenticate.

## Impact

- `packages/shared/src/protocol.ts` — new session-private `ServerToExtensionMessage`
  member carrying the minted plaintext (the `credentials_updated` lane).
- `packages/extension/src/` — new bridge-side mint caller; handles the mint reply
  **inside the bridge** and assigns the credential into its own `process.env`,
  never re-emitting it onto `pi.events`.
- `packages/mcp-server-plugin/src/server/index.ts` — `mcp/mint-token` gains its
  first real caller, plus a mint-at-registration hook; the dead `return { token }`
  is replaced by an `emitEventToSession` reply, since handler return values are
  discarded by the dispatcher.
- `packages/mcp-server-plugin/src/server/provisioning.ts` — writes the
  `requestHeadersCommand` auth field into the reserved entry.
- `packages/mcp-server-plugin/src/server/routes.ts` — the auth throttle is keyed
  on `request.ip`, which is `127.0.0.1` for every local session; it must stop
  treating them as one source.
- `~/.pi/agent/mcp.json` — gains a dashboard-owned auth field (no secret in it);
  the "operator-added `headers` survive a refresh" merge rule interacts.
- `docs/architecture.md` §MCP endpoint — the minting sequence diagram currently
  documents a path that has no client.

## Discipline Skills

- `security-hardening` — a bearer credential is written to disk and merged into a
  user-owned config; file mode, leak surface, and the restart/revocation window
  are in scope.
- `doubt-driven-review` — mechanism B silently disables an existing security
  requirement (the self-target guard) for every local caller; that trade-off must
  be stress-tested before it stands.
- `review-code` — non-trivial change touching an auth boundary.
