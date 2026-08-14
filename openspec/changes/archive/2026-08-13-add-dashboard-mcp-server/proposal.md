# add-dashboard-mcp-server

> **STATUS: UNPARKED at user direction — proceed with known risk.** Planning
> stopped after doubt cycle 2 on escalation, then resumed by explicit decision to
> generate tasks for the full scope rather than narrow it.
>
> One carried risk, accepted knowingly: the Blocking Contradiction below is
> **unresolved**. `tasks.md` group 1 makes resolving it — and the six other spec
> gaps the test plan surfaced — a hard prerequisite to any code, rather than
> assuming it away.
>
> `scenario-design` has since run. `test-plan.md` holds 87 scenarios (84
> automated, 3 manual-only), 13 of which carry `[NEEDS CLARIFICATION]` markers
> that map one-to-one onto the group-1 gate tasks. Every automated row is folded
> to exactly one test task; the manifest, not any task tag, is the
> automated-versus-manual source of truth.
>
> Retained value: the protocol research, the substrate analysis, and two doubt
> cycles of verified corrections. Rethink Scope remains the recommended
> alternative if group 1 proves intractable.

## Blocking Contradiction

The `mcp.json` provisioning goal and the self-target reentrancy guard cannot both
hold as currently specified. The provisioned entry must carry a credential:

- **Session-scoped token** → dies with its session → the provisioned entry
  silently stops working, and no re-provision trigger is defined.
- **Device-scoped token** → the caller has no originating session → the
  self-target guard does not cover the one case it exists for, a local pi
  session driving itself.

Cycle 2 surfaced a candidate resolution not yet taken: the **bridge WebSocket**
already proves session identity server-side (`packages/server/src/pi/pi-gateway.ts`
— `connections.get(sessionId)`). That is the only channel where a session-bound
credential can be minted with attribution by connection rather than by client
claim. Minting remains entirely unspecified in every artifact — all five token
scenarios are verify-side.

## Rethink Scope

The change is too wide. Cycle 2 findings cluster into three separable pieces,
at least two of which stand alone:

1. **Transport-only MCP endpoint** — stateless `2026-07-28` conformance,
   `server/discover`, read-only tools (`list_sessions`), device-token auth. No
   session-targeting writes, so no reentrancy guard and no minting problem.
   Small, coherent, independently valuable.
2. **Session-bound credentials** — WS-minted per-session tokens, lifecycle,
   revocation, persistence across restart. A security change in its own right,
   and a prerequisite for any write verb.
3. **`mcp.json` provisioning + adapter version floor** — depends on (2) for a
   credential and on a `PluginRequirements` version-floor field that does not
   exist.

## Why

MCP revision **`2026-07-28`** (the current spec) made the protocol **stateless by
mandate**, not by option. It removed protocol-level sessions and the
`Mcp-Session-Id` header, removed the `initialize` / `notifications/initialized`
handshake, removed the HTTP GET stream endpoint, and made `server/discover` a
MUST. Cross-call state is now carried by **server-minted handles passed as
ordinary tool arguments** (SEP-2567), and every request self-describes its
protocol version and client capabilities in `_meta` (SEP-2575).

That shape fits this dashboard well:

| MCP `2026-07-28` idiom | pi-dashboard reality (already exists) |
|---|---|
| server-minted handle in tool args | `sessionId` (uuid, server-issued) |
| no per-connection state | REST/bus handlers are already stateless |
| list endpoints don't vary per connection | verb registry is static and global |
| `subscriptions/listen` long-lived stream | `ServerPluginContext.onEvent()` |
| plugin-owned HTTP route | `ServerPluginContext.fastify` (9 plugins already) |

Exposing the dashboard as an MCP server lets Claude Desktop, Cursor, another pi,
or a phone over the existing zrok tunnel **drive a pi session fleet** — spawn,
prompt, abort, observe — without any of them needing dashboard-specific client
code.

## What Changes

- Add an **`mcp-server` dashboard plugin** that registers a single stateless
  `POST /mcp` route on `ServerPluginContext.fastify`, conforming to protocol
  revision `2026-07-28`.
- Implement `server/discover` (a spec MUST) advertising supported protocol
  versions, capabilities, and `serverInfo`.
- Explicitly handle `GET`/`DELETE` on `/mcp` to return **405** — a POST-only
  route otherwise falls through to the server's `setNotFoundHandler`, which in
  `--dev` proxies to Vite and answers **200 with SPA HTML**.
- Map a **curated allowlist** of `ServerPluginContext` capabilities to MCP tools,
  guarded by a completeness test. The context exposes 18 members; the allowlist
  is deliberate and hand-maintained.
- Map `subscriptions/listen` onto `ServerPluginContext.onEvent()`, adding the
  per-session filtering `onEvent` does not itself provide.
- Mint a **per-session MCP token** so a caller's originating session is
  server-known and unspoofable, enabling self-target refusal. Paired-device
  bearers are device-scoped and carry no session identity.
- Require a credential on **every** `/mcp` request, including loopback —
  `/mcp` opts out of the `createNetworkGuard` loopback allowance. That guard
  remains unchanged for all other routes.
- Provision the dashboard's own MCP entry into `~/.pi/agent/mcp.json` using the
  existing merge-only + atomic discipline, with `protocolVersion: "auto"`.

**Prerequisite:** `pi-mcp-adapter >= 2.20.0` for `protocolVersion` selection
(`>= 2.21.0` for endpoint probing). The locally installed adapter is **2.19.0**,
which cannot negotiate `2026-07-28`. See Decision 5 — `PluginRequirements` has
no way to express this floor.

## Discipline Skills

`security-hardening` (a new credential type, plus a bearer boundary that becomes
load-bearing under zrok exposure), `observability-instrumentation` (a new
externally-reachable endpoint needs runtime evidence),
`doubt-driven-review` (applied — see Cycle log).

## Impact

- **New:** `packages/mcp-server-plugin/` (manifest + server entry + route).
- **New:** per-session MCP token issuance/verification, alongside
  `packages/server/src/pairing/paired-devices.ts`.
- **Modified:** `packages/server/src/auth/` — `/mcp` strict-auth path.
- **Modified:** `~/.pi/agent/mcp.json` provisioning, reusing the merge-only
  atomic writer pattern from `packages/apple-tools/src/mcp-config.ts`.
- **Possibly modified:** `packages/shared/src/dashboard-plugin/manifest-types.ts`
  — `PluginRequirements` version floor (Decision 5).
- **Docs:** `docs/architecture.md` (protocol + auth boundary), `README.md`.

**Not modified:** `slot-types.ts` and `dashboard-plugin-runtime`. An earlier
draft proposed a new non-UI `SlotId`; that was based on a false premise. See
Decision 2.

## Cycle Log

**Doubt cycle 1** (single-model + cross-model on `@propose-review-1`) overturned
two decisions and corrected six factual claims:

- Decision 2 **inverted** — `ServerPluginContext.fastify` exists and 9 plugins
  already register routes. No new `SlotId` needed.
- Decision 4 **re-resolved** — paired-device bearers carry no session identity,
  making the original self-target guard unimplementable. Resolved to a
  per-session MCP token.
- Corrected: verb count (71 → 73), the `/mcp` slash-command citation, the
  `abortSpawnedRun` → `abortSession` mapping, the localhost-guard contradiction,
  the `mcp.json` scope contradiction, and the statelessness/`subscriptions/listen`
  tension.
