# Design — expand-mcp-tiered-surface

## Context

See proposal.md — Why. Current state relevant to the approach:

- `packages/mcp-server-plugin/src/server/tools.ts` — 4 hand-written tools,
  each bound to one `ServerPluginContext` member; `assertContextPartitionTotal`
  proves the 19-member context is fully triaged (5 allowlisted / 14 denied).
- `auth.ts#authenticate` yields `McpCaller = { kind: "device", deviceId } |
  { kind: "session", sessionId, ... }`; `dispatch.ts#dispatchRpc` is stateless
  and takes the caller per request; `guard.ts` implements the self-target
  refusal.
- `packages/server/src/pairing/paired-devices.ts` — `PairedDevice { id, label,
  createdAt, lastSeen, hash }` (+ `source` after
  `mcp-legacy-clients-and-token-issuance`), `add(label, source)`,
  `verify(token) → id`. `server.ts` registers `host.verifyDeviceToken:
  (token) => string | null` on the plugin service board; the MCP plugin's
  `AuthDeps.verifyDeviceToken` has the same signature.
- `packages/server/src/auth/bearer-auth.ts` — `onRequest` hook: any valid
  device token sets `request.isAuthenticated = true`. `localhost-guard.ts`
  `networkGuard` admits genuine-loopback, trusted networks, or
  `isAuthenticated`. `/api/ws-ticket` is `preHandler: networkGuard`. Net: a
  device bearer is full-access on REST and WS today — tier must be enforced
  here, not only in `/mcp`.
- `auth/mutation-origin-gate.ts` admits requests with no `Origin` header
  (non-browser clients), so `fastify.inject` calls are not CSRF-blocked.
- `packages/shared/src/rest-api.ts` — 144 exported types, only 23 named
  `*Request`; many routes have no request type. Browser-WS verbs are fully
  typed as union members of `BrowserToServerMessage` in
  `browser-protocol.ts`.
- `packages/bus-client/src/codegen/generate-verbs.ts` — precedent: TS compiler
  API walks a union, emits a checked-in `generated/verbs.ts`, test asserts
  freshness.
- `browser-gateway.ts` switch: most session-I/O WS verbs (`prompt_response`,
  `flow_management`, model/thinking changes) are one-line forwards to
  `piGateway.sendToSession`; a few (`extension_ui_response`) also mutate
  gateway state (`pendingUiRequests`). No programmatic dispatch export exists.
- `PairingManager`'s `getReachableUrls` dep (`server.ts`) returns only the
  tunnel URL + `resolvePublicBaseUrls(config)` (+ loopback under
  `PI_E2E_SEED`); loopback + LAN IPv4 endpoints are computed separately by
  `tunnel/tunnel-endpoints.ts#localEndpoints()`. No mDNS `.local` name is
  produced anywhere.
- External reference points: GitHub MCP server (`/mcp/readonly`, toolsets,
  `readOnlyHint`); MCP authorization spec §Scope Challenge
  (`WWW-Authenticate: Bearer error="insufficient_scope"`).

Constraints: dispatcher stays stateless (spec'd); dual-era handshake untouched;
`tools/list_changed` stays `false` (tier never changes within a token's life).

## Goals / Non-Goals

**Goals:**
- One reviewed manifest is the sole source of the tool surface; schemas and
  README catalogue are derived, never hand-edited.
- Tier decided by data on the credential, enforced in one place before any
  tool logic runs.
- Reuse REST handlers as the execution path for most tools — MCP stays a
  façade with no second implementation of business rules.
- The completeness test makes "a route was added and MCP forgot it" a build
  failure, not a docs drift.

**Non-Goals:**
- Per-tool or per-session dynamic scopes, OAuth issuance, or tier changes
  without re-minting.
- GitHub-style runtime toolset enable/disable — surface is ≤130 tools;
  tiering is the trimming mechanism.
- Exposing WS streaming verbs (`subscribe`, `watch_files`, terminals) as tools
  — `subscriptions/listen` remains the only stream.
- A generic "call any REST route" tool (would bypass the manifest and the
  denylist).

## Decisions

### D1. Tier lives on the registry row; defaults follow the issuance source

`PairedDevice` gains `tier: Tier` (`"observe" | "control" | "operate"`,
ordered). `verify(token)` returns `{ id, tier } | null`; the loader reads a
row without `tier` as `operate` (those tokens were minted with full access;
narrowing them silently would break every paired phone and every existing
MCP client). Defaults at mint: `source: "pairing"` → `operate` (a phone
browser drives the whole dashboard), `source: "manual"` → `observe`. Both
paths accept an explicit tier.

Service-board skew (`mcp-server-plugin` is published separately and may
run against an older/newer host): `server.ts` registers a **new** key
`host.verifyDeviceTokenTier: (token) => { id, tier } | null` and leaves
`host.verifyDeviceToken` unchanged. The plugin consumes the new key when
present and otherwise falls back to the old one with `tier: "operate"` (an
old host has no tiers — every token is full-access there). An old plugin on
a new host keeps using the old key and is unaffected.

`McpCaller` gains `tier`; the `session` kind is hard-wired to `control`.
`routes.ts` reads the path suffix (`/mcp`, `/mcp/observe`, `/mcp/control`) and
caps: `effectiveTier = min(caller.tier, pathCap)`. Any other `/mcp/<x>`
suffix is registered explicitly as 404 JSON so it does not fall through to
the SPA handler (a `/mcp/*` catch-all for every method); non-POST methods
on `/mcp/observe` and `/mcp/control` get the same 405 discipline as `/mcp`.

*Alternatives:* tier claim inside the token string (rejected — tokens are
opaque hashes by spec; would need a signed format); tier in a separate
`tiers.json` (rejected — two files to keep consistent; revoke must clear
both); legacy rows → `observe` (rejected — silent behaviour break for every
existing token).

### D1b. One route→tier map; enforced in core wherever a bearer is accepted

`packages/shared/src/route-tiers.ts` exports `ROUTE_TIERS: { method, path,
tier }[]` — one entry per REST route (method + Fastify path pattern) — and
`routeTier(method, pattern): Tier` which returns `operate` for an unlisted
route (fail closed). It is the single source for both the REST gate and the
MCP manifest's `rest` rows (D3).

`auth/bearer-auth.ts` additionally sets `request.principalTier` whenever it
verifies a device token. New `auth/route-tier-gate.ts` runs as a global
`onRequest` hook registered **after every admission hook** (`bearer-auth`
and the cookie auth plugin — note `bearer-auth` is currently registered
before the auth plugin, so the gate must be added after both), on `/api/*`
only. It applies **only when admission rests on the bearer**, using the
`request.authVia` marker introduced by `mcp-legacy-clients-and-token-issuance`:

```
if (request.authVia !== "device") return;                  // cookie session, local token, undecorated → other rules decide
if (isGenuinelyLocal(ip, headers) || inTrustedNetwork(ip)) return;  // same helpers networkGuard uses; loopback/LAN trust is unchanged
if (rank(routeTier(method, routeOptions.url)) > rank(principalTier)) → 403
```

`ROUTE_TIERS` and the gate cover `/api/*` only; `/mcp`, `/auth/*`, `/v1/*`
have their own admission and are outside the map (the completeness test's
route set R is likewise restricted to `/api/*`).

403 body `{ error: "insufficient_scope", scope }` + `WWW-Authenticate: Bearer
error="insufficient_scope", scope="<tier>"`, logged as `auth.tier_refused`
`{ deviceId, method, route, principalTier, requiredTier }`. `/api/ws-ticket`
is listed at `operate`, so a `control`/`observe` bearer from off-host cannot
obtain a browser-WS session and WS verbs need no per-verb tiering.

Consequences, stated: a genuinely-local or trusted-network caller presenting
an `observe` token is still full-access on REST (exactly as today — local
processes are trusted via `~/.pi` and the local token regardless); the tier
is a boundary for **off-host** callers, which is the case that motivates
this change. The MCP filter (D2) applies to every caller irrespective of
network position. A request with no resolvable principal keeps today's
401/403 path; the gate never *admits*.

*Alternatives:* tag routes with `config: { tier }` at each `fastify.route`
call (rejected — 234 call sites across core + plugins, no single reviewable
list, and the MCP manifest would need a second source); per-verb WS tiering
(rejected — ticket-level `operate` is simpler and WS is a browser surface).

### D2. Enforcement point: one filter in `dispatchRpc`, before the guard

`tools/list` → `manifest.filter(t => rank(t.tier) <= rank(effectiveTier))`.
`tools/call` → lookup by name in the **full** manifest; if found but above
tier → HTTP 403 + `WWW-Authenticate: Bearer error="insufficient_scope",
scope="<tool.tier>"`, JSON-RPC error `{ code: -32001, message:
"insufficient_scope", data: { scope } }`, and an `mcp.tier_refused` log line
`{ caller, tool, callerTier, requiredTier }`; if not found → existing
unknown-tool error (`-32601`). The two are deliberately distinguishable: the
scope challenge is what lets a client prompt for a higher-tier token (MCP
authorization spec), and tool names are public in the README catalogue —
there is nothing to hide. Order inside `tools/call`: tier check → argument
validation (existing) → self-target guard → handler; an above-tier call with
malformed arguments gets the 403.

*Alternative:* filter at the route layer per path (rejected — `tools/call`
must still see the full manifest to produce the scope value).

### D3. Manifest shape and the three binding kinds

```ts
interface ToolRow {
  name: string;               // snake_case, unique; verb_object, e.g. list_sessions, get_session_diff
  tier?: Tier;                // required for session/context rows; rest rows derive it from ROUTE_TIERS
  description: string;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean };
  input: string;              // exported type name in packages/shared
  sessionTargeting?: true;    // explicit; invariants test enforces it (see D6)
  bind:
    | { kind: "rest"; method: "GET"|"POST"|"PUT"|"PATCH"|"DELETE"; path: string; fixed?: Record<string, unknown> }  // fixed = constant body fields
    | { kind: "session"; message: string }   // ctx.sendToSession bridge forward
    | { kind: "context"; member: AllowlistedMember };
}
```

Naming: one tool per capability. When a REST route and a WS verb implement
the same capability (`abort`, worktree create, `set_model`,
`set_thinking_level` — both have REST twins in `session-api.ts`), the REST
route is bound and the verb goes on the denylist with reason
`duplicate-of:<tool>`.

- `rest` — executed via `fastify.inject()` (D4); tier from `ROUTE_TIERS`.
  Covers ~90% of rows.
- `session` — for WS verbs that are pure `piGateway.sendToSession` forwards
  with no REST twin (`prompt_response`, `flow_management`, followup-queue
  edits). Each row's binder is the verb's field mapping, generated from the
  union member type. Binds through the already-allowlisted
  `sendToSession` member; the message type is the bridge message name.
- `context` — the 4 existing tools, unchanged. Their REST twins
  (`/api/session/:id/prompt`, `/api/session/:id/abort`, spawn) go on the
  denylist with reason `duplicate-of:<tool>` — the exception to "REST
  wins" that keeps the existing contract byte-identical.

WS verbs handled server-side with no REST twin — `extension_ui_response`
(mutates `pendingUiRequests`), `force_kill`, `kill_process`,
`stop_after_turn`, `retry` (all dispatched in
`browser-handlers/session-action-handler.ts`, not forwards) — get a thin REST
route in core whose handler is extracted from the switch case and called
from both: `POST /api/session/:id/extension-ui-response` and one
`POST /api/session/:id/lifecycle { action: "force_kill" | "kill_process" |
"stop_after_turn" | "retry" }`. The lifecycle route sits at `control` in
`ROUTE_TIERS`; its handler refuses `force_kill`/`kill_process` with the same
403/`insufficient_scope` shape unless the principal is `operate` (or not a
device bearer) — the one action-level tier check, kept inside the handler
because `onRequest` runs before body parsing. The four MCP tools bind to
that route with `bind.fixed: { action }` and declare their own tier
(`force_kill`, `kill_process` → `operate`; the invariants test allows a
`rest` row's declared tier to be **higher** than the route's, never lower). These are the sanctioned "routes for MCP's sake": each removes a
duplicated code path. `prompt_resync_request` / `subagent_resync_request`
are UI plumbing and go on the denylist.

*Alternative:* a core-provided `dispatchBrowserCommand(msg)` resource driving
the gateway switch through a virtual connection (rejected — gateway replies
are broadcasts, not request/response; correlating a result is exactly what
REST already solves).

### D4. REST-bound tools execute through `fastify.inject` with caller identity

`bind.kind === "rest"` rows run `fastify.inject({ method, url, payload,
headers, remoteAddress: caller.ip })`. `remoteAddress` is the real client
IP (Fastify's inject default is `127.0.0.1`, which would make
`isGenuinelyLocal` admit every injected call credential-free and skip
trusted-network admission for tunnel callers). Identity propagation:

- device caller → forward the caller's own `Authorization: Bearer` header;
  `bearer-auth` resolves `principalTier` from the row and the route-tier gate
  (D1b) enforces it — the MCP tier filter (D2) and the REST gate agree by
  construction because both read `ROUTE_TIERS`. `lastSeen`/audit identity
  stay correct.
- session caller (`wire-mcp-session-token`) → REST does not know session
  tokens; inject with `remoteAddress: "127.0.0.1"`, no bearer and **no
  forwarding headers** (forwarding them would defeat `isGenuinelyLocal`).
  The request is admitted as genuinely local — the same trust a pi
  session's bridge already holds on this host. Its `control` tier is
  enforced by the MCP filter (D2) before inject; the REST gate is not
  needed for it. No internal nonce/credential is introduced.
- Headers forwarded from the originating `/mcp` request for **device**
  callers: `host` (so `createHostGate` sees the admitted host in enforce
  mode), `x-forwarded-for` / `x-forwarded-proto` / `x-real-ip` (so
  `isGenuinelyLocal` and trust-proxy resolution see the tunnel origin, not
  the loopback socket), `authorization`. `host` is forwarded for session
  callers too. `origin` is never forwarded — header-less mutations are
  admitted by the CSRF gate for non-browser clients.
- Path parameters are `encodeURIComponent`-ed when interpolated into the
  inject URL, and an argument containing `/`, `?`, `#` or `%` is rejected
  with a validation error before inject (no smuggling of extra segments
  under the caller's credential).
- Route skew (a newer published plugin on an older host): at activation the
  plugin checks every `rest` row with `fastify.hasRoute({ method, url })`;
  rows whose route is absent are dropped from the advertised surface with
  one `mcp.manifest_route_missing` warning per row. The freshness and
  completeness tests in-repo keep the in-repo pair exact; this check keeps a
  skewed pair honest.

Path/query/body mapping: the manifest's `input` type is split by the codegen
into path params (`:id` segments), query (for `GET`) and JSON body (others);
the generated binder module carries that split so `dispatch.ts` has no
per-tool code. Two path conventions coexist: `/api/session/:id/*`
(`session/session-api.ts`) and `/api/sessions/:sessionId/*`,
`/api/events/:sessionId/*` (`routes/`). For the `:id` family the codegen
names the tool argument `sessionId` and maps it to `:id`, so every
session-targeting tool has the same argument name and the guard reads one
field. Response: the REST envelope `{ success, data | error }` maps to
MCP `content[0].text = JSON.stringify(data)` / `isError: true`.

`fastify` stays a **denied** context member for callers — the plugin uses it
internally; `assertContextPartitionTotal` gains a third bucket
`INTERNAL_ONLY = ["fastify"]` so the partition stays total.

*Alternative:* import route handler functions directly (rejected — bypasses
Fastify schema validation, hooks, host admission, and the REST bearer path).

### D5. Schema codegen from TS types; generated files checked in

`packages/mcp-server-plugin/src/codegen/generate-tools.ts` (pattern:
`bus-client/src/codegen/generate-verbs.ts`) uses `ts-json-schema-generator`
(new **devDependency**, codegen-only) over `packages/shared/src` to emit
`src/server/generated/tools.ts` — `{ name, tier, description, annotations,
inputSchema, bind, paramSplit }` per row — and
`packages/mcp-server-plugin/README.md` `<!-- tools:start/end -->` block.
`npm run codegen -w @blackbelt-technology/pi-dashboard-mcp-server`. A vitest
freshness test regenerates into memory and asserts equality with the
checked-in file.

Routes whose request shape has no exported type get one added to
`rest-api.ts` as part of binding them (the type is the schema — no
duplication).

*Alternatives:* hand-written TypeBox per tool (rejected — 130 schemas drift);
Fastify route schemas as source (rejected — most routes register none).

### D6. Completeness test — total partition over routes + verbs

`__tests__/manifest-completeness.test.ts`:
1. Boot the server in test mode, read `fastify.printRoutes()`-equivalent
   (`fastify.routes` via `onRoute` hook) → set R.
2. `enumerateUnion(browser-protocol.ts, "BrowserToServerMessage")` → set V.
   R is restricted to `/api/*`.
3. `{ bind.path of manifest.rest } ∪ { bind.message of manifest.session }`
   must equal (R ∪ V) − `DENYLIST`, where `DENYLIST: { pattern, reason }[]`
   lives beside the manifest. Any leftover on either side fails with the
   offending name. `context` rows are checked separately: each member is in
   `ALLOWLISTED_CONTEXT_MEMBERS`.
4. Every route in R has a `ROUTE_TIERS` entry (the runtime default is
   `operate`, but an unlisted route is an un-triaged one and fails the test).
5. Tier invariants from the spec: observe ⇒ readOnlyHint; destructiveHint ⇒
   not observe; `force_kill` is operate + destructive; every row whose
   schema has `sessionId`, or whose `rest` path contains `:sessionId` or
   starts with `/api/session/:id`, is marked `sessionTargeting` (explicit
   flag, mechanically checked); every description ≤ 120 chars; tool names
   unique; every `rest` row's derived tier equals `ROUTE_TIERS`.

Location and determinism: the test lives in
`packages/server/src/__tests__/mcp-manifest-completeness.test.ts` (the server
package owns `createServer` and already boots it in tests); it imports the
manifest + denylist from `@blackbelt-technology/pi-dashboard-mcp-server`
(workspace devDependency). It boots with the existing server test config,
collects routes via an `onRoute` hook, and treats plugin-contributed routes
from whatever plugins that config loads as part of R; routes behind a flag
that is off in that config are listed in `DENYLIST` with reason
`conditional:<flag>` so they are still triaged.

Plugin routes (`packages/*-plugin/src/server`) are included in R because they
register on the same Fastify instance.

### D7. Tier assignment policy (initial manifest)

| Tier | Contents |
|---|---|
| observe | all `GET`s that are neither secrets nor fleet enumeration: sessions/events/tool-results/attachments/diff/session-file/transcript, git status/branches/changed-files/PRs, file read/tree/grep, openspec tasks/config, goals read, automation read, models/providers/roles list, plugins/packages list, health, doctor, tunnel status |
| control | spawn/resume/abort/stop_after_turn/shutdown/retry/archive/rename/tags; send_prompt, prompt_response, extension_ui_response, set_model, set_thinking_level, flow_control, followup edit; git checkout/commit/commit-draft/worktree {create,init,merge,pr}; file write/mkdir; openspec toggle/attach; goals write; automation toggle/run; roles/presets set |
| operate | force_kill, kill_process; restart; config/preferences write; provider auth status/login flows (no key material); packages install/remove/update; plugins enable/disable; resources; tunnel start/stop; paired-device list + revoke; reachable-urls; pi-core update |

Secrets never cross MCP in any tier: provider API-key **read and write**
routes are denylisted. Fleet-enumeration reads (paired-devices list,
reachable-urls) sit at `operate`, not `observe`.

`destructiveHint` means "irreversibly destroys state or kills a process
without the session's cooperation": `force_kill`, `packages remove`,
worktree delete. `shutdown`/`stop_after_turn`/`abort` are cooperative
lifecycle signals at `control` without the hint; `git checkout` at
`control` carries `destructiveHint` (discards work) — the invariant is
"destructive ⇒ not observe", not "destructive ⇒ operate".

### D8. Issuance surfaces take `tier`; defaults per source

`POST /api/paired-devices { label, tier? }` (default `observe`) and `POST
/api/pair/approve` (tier chosen on the approving UI, default `operate`)
validate `tier` against the enum. Settings create-token flow: tier radio
with one-line descriptions, base-URL select from `GET
/api/pair/reachable-urls` — a new read route (tier `operate`) that merges
`tunnel-endpoints.ts#localEndpoints()` (loopback + LAN IPv4) with the
tunnel URL and configured public URLs; it is the one `/api/pair/*` route with
an MCP tool (`get_reachable_urls`) and is excluded from the ceremony
denylist pattern by name. Browser origin preselected.
CLI `pi-dashboard token create` (new `case "token"` in `cli.ts`) calls the
same route with the local token and prints the token once, then one
`claude mcp add` snippet per URL from `GET /api/pair/reachable-urls` (or a
single snippet for `--url`).

### D9. Re-argued prior decisions

- `add-dashboard-mcp-server` D1 (curated allowlist over context): superseded
  by D3–D6 — the allowlist becomes a manifest with a total partition over a
  wider domain; the property it protected (every exposure is a triaged
  decision) is preserved by the denylist-with-reason.
- `add-dashboard-mcp-server` D13 (no kill ladder): the argument was "any
  token holder". Under D1/D1b here, `force_kill` holders are `operate`
  tokens minted knowingly with a destructive-tier warning, and a lower-tier
  token cannot reach the WS `force_kill` verb either (ws-ticket is
  `operate`). `abort` remains the only `control`-tier stop.
- `mcp-legacy-clients-and-token-issuance` D5 ("networkGuard is NOT enough:
  it admits any paired-device bearer"): D1b is the general answer to that
  observation.

## Risks / Trade-offs

- [`fastify.inject` bypasses nothing but adds a serialization hop per call]
  → acceptable; MCP calls are human-paced. Measure once in the harness;
  budget < 20 ms overhead.
- [Session callers inject as loopback with no credential] → that is the
  trust a pi session already holds on the host; their tier is enforced by
  the MCP filter before inject, and the self-target guard still runs.
  Introducing an internal credential to make REST aware of them was
  rejected: nothing distinguishes an injected request from a wire request
  inside Fastify hooks, so such a credential would be a master key.
- [REST tier gate is a new refusal on a 234-route surface; a mis-tiered
  entry breaks a phone or a plugin] → phones and browsers are `operate`
  (unchanged); only explicitly narrowed tokens can be refused; the
  completeness test forces every route into `ROUTE_TIERS`; the D7 table is
  the review checklist.
- [Legacy rows read as `operate`] → same access they already had; the tier
  badge in Paired Devices makes it visible; FAQ tells operators to re-mint
  narrower tokens for agents.
- [Manifest of ~130 rows is itself a large review surface] → rows are
  one-liners; codegen owns the verbose part; the tier table in D7 is the
  review checklist, and the invariants test mechanically enforces
  observe⇒readOnly and destructive⇒operate.
- [`observe` exposes repo contents and prompts] → same as today's browser;
  documented in FAQ; tier descriptions in the UI say so.
- [Pending change `mcp-legacy-clients-and-token-issuance` may shift shapes
  before this applies] → completeness + freshness tests fail loudly; the
  MODIFIED `Settings offers an MCP-client token flow` requirement in this
  change's delta targets that change's post-archive text and must be
  re-validated at apply time.
- [LLM context cost at `operate` (~130 tools)] → `/mcp/observe` and
  `/mcp/control` let an operator hand one token to agents at smaller scopes;
  descriptions kept ≤ 120 chars.
- [Completeness test in `packages/server` fails when any workspace plugin
  adds a route until the manifest/denylist is updated] → intended: routes
  and their MCP triage ship together in this monorepo; the failure names
  the route.
- [Adding request types to `rest-api.ts` for untyped routes touches many
  files] → type-only, mechanical; no runtime change; done per domain in
  tasks.

## Migration Plan

1. Land registry `tier` + loader default first (rows without `tier` →
   `operate`; no file migration needed), then `ROUTE_TIERS` + the REST gate
   with every route listed at `operate` — zero behaviour change — then lower
   tiers domain by domain alongside step 3.
2. Land manifest/codegen/dispatch with the 4 existing tools as the initial
   manifest; completeness test seeded with a temporary denylist covering
   everything else — proves the pipeline before the surface grows.
3. Grow the manifest domain by domain, shrinking the temporary denylist to
   the final reasoned one.
4. Issuance UI/CLI last; existing tokens keep working as `operate`.

Rollback: revert; registry rows with `tier` are ignored by the older loader
(JSON round-trip preserves unknown fields — asserted by a test in task 1.1).

## Open Questions

- Whether `/api/pair/approve` should take the tier from the approving
  browser (this design) or from the requesting device payload (rejected for
  now: the device is untrusted at that moment). Safe to revisit after ship
  without touching specs.
