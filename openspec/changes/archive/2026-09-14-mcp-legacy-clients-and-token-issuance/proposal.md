## Why

The dashboard's MCP endpoint (`POST /mcp`, `packages/mcp-server-plugin/`) is
unreachable by the very clients its design names as targets — Claude Code,
Claude Desktop, Cursor — for two independent reasons:

1. **Protocol.** `/mcp` serves exactly one revision, `2026-07-28` (SEP-2575,
   stateless), and rejects `initialize` outright (`dispatch.ts` `REMOVED_METHODS`).
   Shipping Claude Code speaks the `2025-06-18` / `2025-11-25` Streamable-HTTP era:
   it opens with `initialize` and expects `Mcp-Session-Id`. The first request fails.
2. **Credential.** `/mcp` requires a bearer on every request, loopback included,
   and the only credential kind an external client can hold is a paired-device
   token. Today that token is minted **only** through the phone-oriented QR
   pairing ceremony (`PairingManager.approve` → `registry.add`): secure-origin
   URLs only, a second-party redeem, an 8-digit typed confirm code. A user on the
   same laptop has no reasonable way to obtain one. Every other local credential
   (loopback allowance, `X-Pi-Local-Token`, the JWT cookie) is deliberately
   ignored by `/mcp`.

Result: `claude mcp add --transport http pi-dashboard http://localhost:8000/mcp`
cannot work for anyone, and there is no documented path to make it work.

## What Changes

- **`/mcp` accepts legacy-era clients alongside `2026-07-28`.** Requests
  declaring `2025-03-26`, `2025-06-18` or `2025-11-25` MAY open with
  `initialize` / `notifications/initialized`; the server answers the handshake,
  accepts notifications and `ping`, and issues an opaque `Mcp-Session-Id`. Dispatch stays stateless underneath — the session id
  is a compatibility token, not state the server depends on. `2026-07-28`
  callers keep today's strict, handshake-free contract. The
  `subscriptions/listen` streaming surface remains `2026-07-28`-only; legacy
  clients get tools + discover, not event streaming.
- **Direct paired-device token issuance for a local operator.** A new
  operator-gated (login session / local token / genuine loopback — never a
  device bearer) `POST /api/paired-devices { label }` mints a device token
  without the pairing
  ceremony, returning the plaintext exactly once. Rows minted this way are
  distinguishable from pairing-minted rows (`source: "manual" | "pairing"`) in
  `GET /api/paired-devices` and the Settings → Security → Paired Devices list.
- **Settings UI affordance.** Paired Devices section gains "Create token for an
  MCP client": prompts for a label, shows the token once, and renders a
  ready-to-paste `claude mcp add --transport http … --header "Authorization:
  Bearer …"` snippet (URL from the dashboard's own reachable base).
- **Docs.** FAQ entry "How do I connect Claude Code / Cursor to the dashboard
  MCP"; `docs/architecture.md` §MCP endpoint updated for dual-revision handling.

Not changing: token kinds, the self-target guard (device callers have no
originating session and stay outside it), the tool allowlist, the pairing
ceremony itself, session-token minting over the bridge
(`wire-mcp-session-token` owns that).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `dashboard-mcp-server`: `Requirement: Stateless MCP endpoint conforming to
  revision 2026-07-28` is REMOVED and replaced by `Requirement: Dual-era MCP
  endpoint` (its modern-era scenarios carried over verbatim) — a dual-revision
  contract:
  `2025-03-26` / `2025-06-18` / `2025-11-25` negotiate via `initialize` + `Mcp-Session-Id`,
  `2026-07-28` stays handshake-free, other versions still fail with
  `UnsupportedProtocolVersion`. `Requirement: Event streaming uses
  subscriptions/listen` gains a scenario stating legacy revisions do not receive
  streaming.
- `bearer-device-auth`: `Requirement: Long-lived opaque bearer tokens in a
  revocable registry` — adds direct issuance through an auth-gated endpoint,
  plaintext-once semantics identical to pairing, and a `source` discriminator on
  listed rows.

## Impact

- `packages/mcp-server-plugin/src/server/protocol.ts`, `dispatch.ts`,
  `routes.ts` — version negotiation, `initialize` handling, `Mcp-Session-Id`
  emission for legacy revisions.
- `packages/server/src/pairing/paired-devices.ts` — `source` field on rows
  (`paired-devices.json` gains a field; existing rows default to `"pairing"`).
- `packages/server/src/routes/pairing-routes.ts` — new `POST /api/paired-devices`.
- `packages/client/src/components/connectivity/PairedDevicesSection.tsx`,
  `packages/client/src/lib/pairing/paired-devices-api.ts` — create-token flow +
  snippet.
- `docs/faq.md`, `docs/architecture.md`, `packages/mcp-server-plugin/README.md`.
- Security surface: with auth disabled (the default) a same-host process can
  mint a durable bearer that is valid over a tunnel. Unlike `/api/pair/approve`
  (protected by ceremony secrets) the mint route has none, so it additionally
  enforces Host admission even while the global gate is report-only — closing
  the DNS-rebinding path a loopback-only check leaves open. The `source` marker
  exists so the operator can audit and revoke such rows.

## Discipline Skills

- `security-hardening` — new credential-minting endpoint; plaintext-once
  handling; loopback-minted tokens valid remotely.
- `doubt-driven-review` — re-opening a spec-bound statelessness decision
  (Decision 5 / E9 in `add-dashboard-mcp-server`) before it stands.
- `review-code` — before commit.
