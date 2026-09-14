## Context

See proposal.md — Why. Constraints that shape the approach:

- `packages/mcp-server-plugin/src/server/protocol.ts` hardcodes
  `SUPPORTED_PROTOCOL_VERSIONS = ["2026-07-28"]`; `resolveProtocolVersion`
  requires BOTH the `MCP-Protocol-Version` header and
  `params._meta["io.modelcontextprotocol/protocolVersion"]`. Legacy clients
  send neither on `initialize` (version lives in `params.protocolVersion`) and
  only the header afterwards. `dispatch.ts` lists `initialize` /
  `notifications/initialized` in `REMOVED_METHODS` and answers them with a
  "method unsupported" JSON-RPC error.
- `routes.ts` runs auth → body-limit → parse, then intercepts
  `subscriptions/listen` by method name BEFORE version resolution (which
  `dispatchRpc` performs itself, `dispatch.ts:173`). A `listen` today never has its
  version checked — a latent gap this change closes as a side effect of D1.
- `dispatchRpc` has no `ping` case; anything not in the allowlist is
  `404 / -32601`. `buildDiscoverResult` advertises
  `{ tools: { listChanged: false }, subscriptions: { listen }, resources: {
  subscribe: false } }` — keys that do not exist in any 2025
  `ServerCapabilities` schema.
- `bearer-auth.ts` sets `request.isAuthenticated = true` for ANY valid device
  bearer; `localhost-guard.ts` `networkGuard` admits `isAuthenticated` and
  configured trusted networks with no credential. Nothing on the request
  records HOW it was authenticated.
- With auth disabled (default) the Host-admission gate (`auth/host-gate.ts`)
  runs in `report` mode: an unrecognised `Host` is logged, not refused. The
  mutation-origin gate admits `Origin` == `Host`. Together that means a
  DNS-rebinding page can reach loopback-guarded `POST` routes with a readable
  response. `/api/pair/approve` survives this only because it needs the
  pairing `code` + typed `confirmCode` the page does not hold.
- `PairedDeviceRegistry.add(label)` already returns the plaintext once; the only
  caller is `PairingManager.approve`. Neither validates the label: `add` maps an
  empty/whitespace label to `"device"`, and there is no length limit anywhere.
  `PairedDevice` / `PairedDeviceView` have no `source` field. Sibling REST routes
  return the `ApiResponse` envelope `{ success, data }`; the client
  `paired-devices-api.ts` unwraps `data`. `pairing-routes.ts` splits routes into `PUBLIC_PAIRING_PREFIXES`
  (auth-exempt) and guarded routes (`/api/pair/payload`, `/api/pair/approve`,
  `GET/DELETE /api/paired-devices`).
- `/mcp` `authenticate()` resolves a bearer to `kind:"session"` (in-memory MCP
  token registry) or `kind:"device"` (`PairedDeviceRegistry.verify`). Nothing
  else. That resolution is untouched by this change.
- `wire-mcp-session-token` (active) owns session-token delivery to local pi
  sessions; this change must not overlap it.

## Goals / Non-Goals

**Goals:**
- A Streamable-HTTP client on revision `2025-03-26`, `2025-06-18` or
  `2025-11-25` (Claude Code, Claude Desktop, Cursor) can `initialize` against
  `/mcp`, keep-alive with `ping`, and call tools, using a device token.
  (Clients on the 2024-11-05 HTTP+SSE transport — `GET /sse` — are out of
  reach and stay so.)
- Underlying dispatch, auth, guard, and tool allowlist stay single-path; the
  legacy layer is a thin adapter in front of the same dispatcher.
- A local operator can obtain a device token from Settings (or `curl`) in under
  a minute, without the QR ceremony.

**Non-Goals:**
- SSE / GET stream for legacy clients (`subscriptions/listen` stays modern-only).
- JSON-RPC batch arrays (allowed by `2025-03-26`): `parseRpcRequest` keeps
  rejecting arrays; no known client batches.
- Real per-session state for legacy clients (the `Mcp-Session-Id` is opaque and
  unrecorded).
- OAuth / dynamic client registration for MCP (the 2025 spec's auth chapter).
  Bearer-only is enough for a self-hosted dashboard.
- Changing session-token minting or the self-target guard.
- A CLI wrapper (`pi-dashboard mcp-token`). `curl` against the new route covers
  scripting; a wrapper can come later without spec change.

## Decisions

### D1 — Era adapter in front of the existing dispatcher, not a second dispatcher

`protocol.ts` grows `LEGACY_PROTOCOL_VERSIONS = ["2025-03-26", "2025-06-18",
"2025-11-25"]`, keeps `MODERN_PROTOCOL_VERSION = "2026-07-28"`, and
`SUPPORTED_PROTOCOL_VERSIONS` becomes the union of both — so
`buildDiscoverResult` (unmodified spec: "list every protocol version the
server supports") and every `UnsupportedProtocolVersion` message automatically
name all four. `resolveProtocolVersion` returns
`{ era: "modern" | "legacy", version }`. `ProtocolVersionFailure` gains
`"AmbiguousHeader"`; `rpcError` carries only `data.type`, so the supported
list goes in the error `message`. All three legacy revisions are served
with identical behaviour: none of them changed the `initialize` result shape,
`tools/list`, `tools/call`, `ping`, or notification handling in a way this
server exposes (11-25 added tasks/elicitation-url/tool-result `_meta`, none
advertised here). Resolution order:

0. Repeated `MCP-Protocol-Version` header (`string[]`) → `AmbiguousHeader`
   (`400`, like `HeaderMismatch`), for every method including `initialize`. Today a repeated header is
   "treated as absent"; with a legacy default that would silently downgrade,
   so it becomes an explicit refusal first.
1. Method is `initialize` → version from `params.protocolVersion` only
   (header and `_meta` are not consulted; the 2025 spec sends neither on
   `initialize`). In the
   legacy set → era legacy, echoed back. `2026-07-28` → the method is
   reported unsupported (`404 / -32601`, same shape as today's
   `REMOVED_METHODS`; the modern era has no handshake). Any other *string* →
   era legacy with version `2025-11-25` — the 2025 spec's negotiation rule:
   "if the server does not support the requested version it MUST respond with
   a version it does support"; SDK clients treat an `initialize` error as
   fatal, a downgrade they can accept or disconnect from. Missing/non-string
   `protocolVersion` → `UnsupportedProtocolVersion` with `data.supported`
   listing the revisions (malformed, not negotiable).
2. Otherwise header present → must be a known version; if `params._meta`
   declares the version key they must agree (existing `HeaderMismatch`).
   Header alone is sufficient for legacy; modern still requires the `_meta`
   key (unchanged E13).
3. Header absent, `_meta` **declares the version key** → as today: modern
   requires the header (`MissingHeader`).
4. Header absent and no version key (whether `_meta` is absent or carries
   only other keys such as `progressToken`) → legacy `2025-03-26` (2025-spec
   "SHOULD assume" rule). This is the one loosening of today's E15; it is
   what makes a client that omits the header after `initialize` still work. A
   modern client can only land here by sending no version marker at all — no
   conformant `2026-07-28` client does, and the version-key-present branch
   still refuses.

**Single resolution site.** `resolveProtocolVersion` runs once in `routes.ts`
before the `subscriptions/listen` interceptor, and the resolved
`{ era, version }` is passed into `dispatchRpc` as a parameter. The internal
re-resolution in `dispatchRpc` (`dispatch.ts:95-102`) is deleted — two sites
would drift. This is the one structural edit to `dispatch.ts`; the per-method
cases below it are untouched. Closes the existing gap where a `listen` never
had its version checked.

Dispatch then branches on era + method for the legacy-only surface:
- `initialize` → static `InitializeResult` (`protocolVersion` per rule 1,
  `capabilities: { tools: { listChanged: false } }` — deliberately NOT the
  discover object, whose `subscriptions`/`resources` keys are foreign to the
  2025 `ServerCapabilities` schema and would fail strict SDK validation —
  `serverInfo` from the plugin manifest), plus
  `Mcp-Session-Id: <random 128-bit hex>` header. Nothing stored.
- any `notifications/*` (initialized, cancelled, roots/list_changed, …) →
  `202`, empty body. Nothing acted upon. Method prefix decides; a stray `id`
  is ignored.
- `ping` → `{}` result.
- `subscriptions/listen` → `404 / -32601` (the `REMOVED_METHODS` shape);
  no stream.

Every other method flows into the existing per-method cases of `dispatchRpc`,
so the tool allowlist, guard, and per-tool tests need no era variant. Modern
era keeps rejecting `initialize`, `notifications/*` and `ping` exactly as
today.

*Alternatives:* (a) a separate `/mcp/legacy` route — rejected: clients don't
know to use it, and `mcp.json` provisioning would need a second entry. (b)
adopting the official `@modelcontextprotocol/sdk` `StreamableHTTPServerTransport`
— rejected: it owns sessions statefully and would replace, not wrap, the
existing stateless dispatcher; also a new runtime dependency for the plugin.

### D2 — `Mcp-Session-Id` is opaque and unrecorded

The 2025 spec lets the server require the id on subsequent requests and return
`404` for unknown ids. We do neither: any request dispatches regardless of the
header's presence or value. Rationale: a server restart would otherwise force
every client into a re-`initialize` it may not attempt; and there is nothing to
key state on. The id is minted only so clients that *store and echo* it are
happy.

### D3 — Streaming stays modern-only

Legacy Streamable-HTTP streaming means SSE on a `GET /mcp` and/or SSE-framed
POST responses. Both contradict spec-bound scenarios ("GET rejected with 405",
"no standalone GET stream"). Tools + discover cover the Claude Code use case
(driving sessions, reading state). Revisit only if a concrete client needs push.

### D4 — Direct issuance reuses `PairedDeviceRegistry.add`, adds `source`

`add(label, source = "pairing")` — existing caller and its empty→`"device"`
defaulting unchanged. `PairedDevice` and `PairedDeviceView` (server AND the
client mirror type) gain `source: "pairing" | "manual"`; the JSON loader
defaults a missing field to `"pairing"` (no migration script; file rewritten on
next write). `POST /api/paired-devices` lives in `pairing-routes.ts` next to
`GET`/`DELETE` and calls `registry.add(label, "manual")`. Response is the
standard envelope: `200 { success: true, data: { device, token } }` (siblings
return `200`).

Label validation is new (nothing to mirror): the route requires
`typeof label === "string"` (sibling routes do the same for `code`), trims,
then rejects empty or longer than a new exported `MAX_DEVICE_LABEL_BYTES = 64`
(UTF-8 byte length, `Buffer.byteLength`) with `400` BEFORE calling `add`. `approve` is left as is.

*Alternative:* a dedicated `mcp-tokens` registry inside the mcp-server plugin —
rejected: `/mcp` already accepts device tokens; a third token kind would need
its own list/revoke UI and another `authenticate()` branch for nothing.

### D5 — Auth posture of the mint route: operator credential + unconditional Host admission

`networkGuard` is NOT enough: it admits any paired-device bearer (so a phone
paired over a tunnel could clone itself past revocation) and any
trusted-network address with no credential. The mint route therefore gets a
dedicated `operatorGuard` preHandler that admits exactly:

1. a dashboard login session (`request.authVia === "session"`), or
2. a valid `X-Pi-Local-Token`, or
3. `isGenuinelyLocal(request)` (loopback, no forwarding headers) in ANY auth
   mode — the same-host browser / `curl localhost` case. This is not a
   loosening: `auth-plugin.ts` already exempts a genuinely-local request from
   login before it looks at the cookie, so a loopback browser with OAuth on
   holds no cookie and is nonetheless fully trusted everywhere else;

AND, in every case, `isHostAdmitted(Host)` in **enforce** semantics regardless
of the global gate mode (`403` otherwise). To make (1) distinguishable from a
device bearer, the two `onRequest` hooks that set `isAuthenticated` also set a
new additive `request.authVia: "session" | "device"` marker (`auth-plugin.ts`,
`bearer-auth.ts`); nothing else reads it yet.

Rationale: approve is protected by ceremony secrets the caller must hold; a
direct mint has none. Loopback-only must not be forgeable by DNS rebinding
(the attacker's `Host` is never admitted) and a device credential must not be
escalatable to an unrevocable one. Browser callers are admitted when local
(any auth mode) or logged in (auth on, e.g. via tunnel). A tunnel browser with
auth OFF has no credential and cannot mint from Settings — accepted; that
configuration is already unsafe for every mutating route. CLI callers use
`curl http://localhost:8000/...` or the local token.

`X-Pi-Local-Token` is NOT made mandatory: the browser cannot present it, and
the Settings flow is the primary consumer. The `source: "manual"` marker plus
the Settings badge keep manual rows auditable and revocable.

*Alternatives:* flipping the global host gate to `enforce` — out of scope (a
rollout decision with its own change). Reusing `networkGuard` as-is — rejected
for the cloning hole above. Note `/api/pair/approve` and
`DELETE /api/paired-devices/:id` keep their weaker `networkGuard` posture (a
device bearer can revoke sibling rows today; approve's docblock already flags
Phase C hardening). Out of scope here — the new `authVia` marker makes
tightening `DELETE` a one-line follow-up, filed as such.

### D6 — Settings flow renders the snippet client-side

`PairedDevicesSection` gets a "Create token for an MCP client" button →
label input → `POST` → one-shot panel with token + `claude mcp add --transport
http pi-dashboard <base>/mcp --header "Authorization: Bearer <token>"`. `<base>`
= the client's existing `getApiBase()` (`paired-devices-api.ts`), which
resolves to the origin the user is looking at (tunnel users see the tunnel
origin). Strings go through the component's `i18nT` convention. No server-side
snippet generation — keeps the route a pure token mint. Mint returns `200` like
its sibling POSTs in `pairing-routes.ts`.

### D7 — `mcp.json` provisioning unchanged

The provisioned pi entry keeps `protocolVersion: "2026-07-28"` pinned. Legacy
support is for foreign clients; pi's own adapter stays on the strict path.

## Risks / Trade-offs

- [Legacy default when no header] → Only applies to requests with neither a
  header nor a `_meta` version; a `_meta`-only or repeated-header request is
  still refused. A modern client is misclassified only if it sends no version
  marker at all, which no conformant `2026-07-28` client does. Tested
  explicitly, including the `string[]` header case.
- [Real clients `DELETE /mcp` on shutdown] → `405` is spec-permitted ("server
  MAY"); SDK clients ignore the status. FAQ line.
- [Copy-paste snippet puts the bearer in shell history] → FAQ notes revoke +
  re-mint; same class as any CLI bearer.
- [Client caches `Mcp-Session-Id` across dashboard restart] → D2: id is never
  checked, so restarts are invisible to the client.
- [Loopback process mints a tunnel-valid bearer with auth off] → D5 + `source`
  badge + revoke; documented in FAQ. A same-host process already holds the
  local token and the filesystem; no new trust boundary.
- [Host admission accepts `*.local` and IP-literal hosts] → DNS rebinding
  arrives with the attacker's registrable domain, never an IP literal; an mDNS
  spoof needs a LAN foothold, which is outside this route's threat model (same
  as every other admitted-host route). Documented, not mitigated here.
- [Unknown-version `initialize` downgrades to `2025-11-25`] → a client newer
  than 11-25 that cannot speak it disconnects per spec instead of receiving a
  fatal error; strictly better for it, neutral for everyone else.
- [Pairing path still writes unbounded labels] → out of scope; only the new
  route validates. Noted for a follow-up.
- [Stale docblocks contradict new behaviour] → `protocol.ts` Decision-10
  docblock ("single entry"), `routes.ts` `send()` ("NOT setting
  Mcp-Session-Id anywhere") and `provisioning.ts` ("spec-bound to ignore
  both", "serves exactly one revision") are rewritten in the same task that
  changes them.
- [Archive sync: main-spec `## Purpose` / preamble still says single-revision]
  → the REMOVED+ADDED delta replaces the requirement block; the closeout task
  sweeps the preamble by hand (archive-sync trap).
- [Token shown in Settings could be shoulder-surfed / left in DOM] → one-shot
  panel, cleared on dismiss, not stored in React state longer than the panel.
- [Snippet base URL wrong behind a reverse proxy] → snippet is editable text;
  FAQ notes to substitute the reachable URL.
- [Dual-era `resolveProtocolVersion` complexity] → keep it a pure function with
  a table-driven test over (method × header × _meta) combinations.
- [`paired-devices.json` schema drift] → additive field with loader default; no
  version bump needed.

## Migration Plan

- Server + plugin change: `curl -X POST :8000/api/restart`. No data migration;
  first registry write after upgrade adds `source` to existing rows.
- Client: `npm run build` + restart.
- Rollback: revert; old code ignores the extra `source` field on read.

## Open Questions

- Whether to also surface the token-mint flow on the mobile/PWA Settings surface
  (same component; layout only). Does not affect specs or tasks.
