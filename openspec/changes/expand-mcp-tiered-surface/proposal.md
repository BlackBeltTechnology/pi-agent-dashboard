# expand-mcp-tiered-surface

## Why

The dashboard MCP endpoint (`POST /mcp`, `packages/mcp-server-plugin/`) exposes
4 tools — `list_sessions`, `send_prompt`, `spawn_session`, `abort` — plus the
`subscriptions/listen` stream. The dashboard itself exposes ~234 REST routes
(190 core + 44 plugin) and ~75 browser-WS verbs. An external agent tool (Claude
Code, Cursor, a headless orchestrator on another machine) holding a
paired-device token can therefore *watch* a session and *poke* it, but cannot
answer an `ask_user`, change model or thinking level, read a tool result or a
session diff, drive git/worktrees, toggle OpenSpec tasks, install a package,
restart the server, or do anything else the browser can. The user must fall
back to the browser or to raw REST with the same bearer.

The 4-tool surface was deliberate: `add-dashboard-mcp-server` Decision 1
rejected wrapping the WS verbs/REST ("5 of 19 context members"), and Decision
13 refused a kill ladder because *any* token holder would hold it. Both
arguments assumed one flat trust level per token. This change re-argues them
under **tiered tokens**: once a bearer carries a tier, exposing the whole
surface no longer means exposing `force_kill` and `packages remove` to a
read-only observer.

Tiering **only** `/mcp` would be theatre: today `bearer-auth.ts` marks any
valid device token `isAuthenticated`, and `networkGuard` then admits it on every
REST route and on `/api/ws-ticket` — an "observe" MCP token could still
`POST /api/restart` or mint a WS ticket and send `force_kill`. So the tier is
enforced **wherever the bearer is accepted**: REST, WS-ticket minting, and
`/mcp`.

Two adjacent gaps surface the same moment:

1. **Pairing an agent tool is hard to do right.** The pending
   `mcp-legacy-clients-and-token-issuance` change gives a same-host GUI user a
   token + `claude mcp add` snippet from Settings. It has no tier concept, the
   snippet base URL is whatever origin the browser saw (not necessarily what a
   *second* machine can reach), and a headless host has no CLI to mint at all.
2. **Tool definitions do not scale by hand.** 4 hand-written entries in
   `tools.ts` are fine; ~130 are not — every REST field change silently drifts
   the MCP schema.

## What Changes

- **Tiered paired-device tokens.** Each registry row gains
  `tier: "observe" | "control" | "operate"`, chosen at mint time. Defaults
  follow the issuance path: the phone pairing ceremony (`source: "pairing"`,
  a browser that needs the whole dashboard) defaults to `operate`; direct
  mint for MCP clients (`source: "manual"`, Settings + CLI) defaults to
  `observe`. Existing rows without a tier load as `operate` — they were
  minted with full access and keep it; the Paired Devices list shows the
  tier so the operator can re-mint narrower ones. Tier is derived from the
  bearer on every request — no session state, fits the stateless dispatcher.
- **Tier enforced on REST and WS-ticket, from one route→tier map.**
  `packages/shared/src/route-tiers.ts` assigns a tier to every REST route
  (method + path pattern); unlisted routes require `operate` (fail closed).
  The server's bearer path resolves the principal's tier (device row tier;
  browser cookie session, local token, genuine-loopback and trusted-network
  principals are `operate`, i.e. unchanged) and refuses a route above it with
  403 + `WWW-Authenticate: Bearer error="insufficient_scope"`. `/api/ws-ticket`
  is `operate`-only, so browser-WS verbs need no per-verb tiering. The MCP
  manifest's REST-bound rows take their tier from the same map — one source.
  Same-machine principals (browser, local token, pi sessions) see no change.
- **Tier-filtered tool surface, GitHub-MCP style.** `tools/list` returns only
  the caller's tier (observe ⊂ control ⊂ operate). `tools/call` on a tool above
  the caller's tier is refused with HTTP 403 + `WWW-Authenticate: Bearer
  error="insufficient_scope" scope="<tier>"` (MCP authorization spec §Scope
  Challenge), logged like the existing self-target refusal. Every tool carries
  `annotations.readOnlyHint` / `destructiveHint`.
- **Full capability coverage, from a manifest.** A single reviewed manifest
  (`tools.manifest.ts`) lists every exposed tool: name, tier, description,
  transport binding (REST method+path or `ServerPluginContext` member or WS
  verb), request/response TS type from `packages/shared/src/rest-api.ts`.
  `inputSchema` is generated from the TS types (same pattern as
  `bus-client/src/codegen/generate-verbs.ts`); a completeness test proves every
  manifest row resolves to a real route/handler and every REST route + WS verb
  is either in the manifest or on an explicit denylist with a reason.
  Domains covered: session lifecycle (incl. `resume`, `shutdown`,
  `stop_after_turn`, `retry`, `archive`, `rename`, `tags`), session I/O
  (`prompt_response` to answer `ask_user`, `extension_ui_response`,
  `set_model`, `set_thinking_level`, `flow_control`, followup-queue edit),
  session reads (events/seq, tool-result, attachments, session-diff,
  session-file, transcript), git + worktrees, files (read/tree/grep/write/
  mkdir), OpenSpec (tasks/toggle/attach/config), goals, automation, models/
  providers/roles/presets, packages/plugins/resources, config/preferences,
  health/doctor/restart, tunnel, pairing (list/revoke only), pi-core update.
  Denylist (no MCP tool; REST tier `operate` unless stated): `ws-ticket`,
  the `/api/pair/*` ceremony routes (challenge/payload/poll/redeem/approve —
  not the new `reachable-urls` read), `/auth/*`, `/v1/*` and model-proxy, provider API-key
  **read and write** (key material never crosses MCP in either direction),
  `test/force-shed`, `electron/*`, UI-only verbs (`reorder_*`, drawers,
  workspace collapse, terminals).
- **`force_kill` at `operate` tier.** Re-argues `add-dashboard-mcp-server`
  Decision 13: the exclusion rested on "any token holder"; at `operate` the
  holder is by construction the dashboard operator. Kept out of `control`.
- **Tier-aware, reachability-aware pairing for agents.** The Settings
  "Create token for an MCP client" flow (from `mcp-legacy-clients-and-token-issuance`)
  gains a tier picker and a base-URL picker populated from a new
  `GET /api/pair/reachable-urls` that merges
  `tunnel/tunnel-endpoints.ts#localEndpoints()` (loopback + LAN IPv4) with the tunnel URL and
  configured public URLs (`PairingManager`'s `getReachableUrls` dep covers only
  the latter two today), so the emitted `claude mcp add` snippet works from the
  machine that will run the agent. New CLI `pi-dashboard token create --tier <t> --label <l>
  [--url <base>]` mirrors it for headless hosts via the local token, printing
  one snippet per reachable URL unless `--url` is given. No new
  pairing ceremony: an agent config file can paste a bearer; the QR ceremony
  exists for phones.
- **Optional down-scoping by URL.** `/mcp/observe`, `/mcp/control` accept any
  token of that tier or higher and cap the surface at the path's tier, so one
  `operate` token can be handed to several agents at different scopes without
  minting more (GitHub `/mcp/readonly` pattern). Should-have; falls out of the
  same filter.
- **Docs.** `packages/mcp-server-plugin/README.md` tool catalogue is generated
  from the manifest; `docs/architecture.md` §MCP endpoint gains the tier model;
  FAQ: "which tier do I give Claude Code / Cursor", "connect from another
  machine".

Not changing: the dispatcher's stateless contract and dual-era handshake
(`mcp-legacy-clients-and-token-issuance`), the self-target guard (extended to
new session-targeting tools, not weakened), session-token minting over the
bridge (`wire-mcp-session-token`), the pairing ceremony transport, REST/WS
themselves (MCP is a façade). Exception: a WS verb that is handled
server-side (not a plain bridge forward) and has no REST twin —
`extension_ui_response` (mutates gateway state), `force_kill`,
`kill_process`, `stop_after_turn`, `retry` — gets a thin REST route sharing
the extracted handler (`POST /api/session/:id/extension-ui-response`;
`POST /api/session/:id/lifecycle { action }`), so MCP and browser run one code path; plus a read
route for reachable URLs used by the pairing UI/CLI. These are the only
routes added for MCP's sake, and each removes a duplicated code path rather
than adding one.

## Ordering

Applies **after** `mcp-legacy-clients-and-token-issuance` lands (depends on
`POST /api/paired-devices`, `source`, the Settings create-token flow, and
`request.authVia`) and after `wire-mcp-session-token`. Manifest rows bind to
routes as they exist at apply time; the completeness test is what catches
drift from other in-flight changes.

## Capabilities

### New Capabilities

- `mcp-tool-tiers`: tier model on paired-device tokens; tier-filtered
  `tools/list`; spec-shaped `insufficient_scope` refusal; tool annotations;
  URL down-scoping; manifest + codegen + completeness test as the contract for
  "every non-denylisted capability is reachable over MCP".

### Modified Capabilities

- `dashboard-mcp-server`: `Requirement: Tool surface is a guarded allowlist
  over the plugin server context` is REMOVED and replaced by `Requirement: Tool
  surface is a tier-filtered manifest over REST, WS verbs and the plugin
  server context` (self-target scenarios carried over and extended to every
  session-targeting tool; the `force_kill` exclusion scenario becomes an
  `operate`-only scenario).
- `bearer-device-auth`: `Requirement: Long-lived opaque bearer tokens in a
  revocable registry` — rows carry `tier`; issuance paths (pairing approve,
  direct mint, CLI) take a tier with per-source defaults; listing shows it;
  missing tier reads as `operate`. New requirement: a device bearer's tier
  gates REST routes and `/api/ws-ticket`.

## Impact

- `packages/mcp-server-plugin/src/server/tools.ts` → replaced by
  `tools.manifest.ts` + generated `tools.generated.ts`; `dispatch.ts` /
  `routes.ts` gain tier lookup, list filtering, 403 challenge, `/mcp/<tier>`
  variants; new `codegen/` + completeness test.
- `packages/server/src/pairing/paired-devices.ts` — `tier` field
  (`paired-devices.json` gains a field; default `operate` on read).
  `pairing-routes.ts` — tier on `POST /api/paired-devices` and
  `/api/pair/approve`; new `GET /api/pair/reachable-urls`.
  `auth/bearer-auth.ts` — decorates `request.principalTier` for
  bearer-admitted requests; new `auth/route-tier-gate.ts` refuses above-tier
  routes for off-host bearer principals; `server.ts` — new
  `host.verifyDeviceTokenTier` service (old key untouched for published-plugin
  skew); `/api/ws-ticket` gated at `operate`.
- `packages/shared/src/route-tiers.ts` — new; the route→tier map.
- `packages/server/src/cli.ts` — `token create` subcommand.
- `packages/client/src/components/connectivity/PairedDevicesSection.tsx`,
  `paired-devices-api.ts` — tier + base-URL pickers, tier badge in list.
- `packages/shared/src/rest-api.ts` — types become the schema source; any
  route lacking a request type gets one (surfaces as manifest test failures).
- `packages/mcp-server-plugin/README.md`, `docs/architecture.md`,
  `docs/faq.md`.
- **Security surface:** the `operate` tier reaches config, provider auth keys,
  package install, restart and `force_kill` from any network the bearer
  reaches (tunnel included). Mitigations: tier is fixed at mint and shown in
  the Paired Devices list; refusals are logged; `destructiveHint` on every
  destructive tool; default tier in every issuance UI is `observe`.
  Read-side tools (`file read`, `session-file`, `transcript`) at `observe`
  expose repo contents and prompts to the token holder — same as the browser
  today, stated explicitly in the FAQ.
- **Context cost for the LLM:** ~45 tools at observe, ~85 at control, ~130 at
  operate. Tiering is the context-trimming mechanism; GitHub-style dynamic
  toolsets deliberately not adopted at this size.

## Discipline Skills

- `security-hardening` — tier model on a credential; `operate` reaches
  config/process control; the REST tier gate must only ever refuse, never
  admit; tool names are public (README catalogue), so the 403 challenge
  leaks nothing beyond the required tier.
- `doubt-driven-review` — re-opening `add-dashboard-mcp-server` Decisions 1
  and 13 before they stand; manifest-vs-hand-written table.
- `observability-instrumentation` — tier refusals and tier-of-caller on every
  `/mcp` log line and `/api/health#mcp`.
- `review-code` — before commit.
