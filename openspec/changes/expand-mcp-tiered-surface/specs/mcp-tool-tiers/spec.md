## Purpose

Scopes what an MCP client can see and do on the dashboard by a tier carried on
its bearer token, so the full REST/WS capability surface can be exposed over
MCP without handing every token holder destructive control.

## ADDED Requirements

### Requirement: Tiers are ordered and carried by the bearer
Every MCP caller SHALL resolve to exactly one tier from the ordered set
`observe < control < operate`. The tier SHALL be derived on each `/mcp`
request from the presented credential and SHALL NOT depend on connection or
session state. A paired-device token's tier SHALL be the tier recorded on its
registry row. A per-session MCP token (bridge-minted) SHALL resolve to
`control`. A credential whose row lacks a tier SHALL resolve to `operate`
(the access it was issued with).

#### Scenario: Paired-device token carries its tier
- **WHEN** a request to `/mcp` presents a paired-device bearer whose registry row has `tier: "control"`
- **THEN** the caller's tier SHALL be `control` for that request

#### Scenario: Tier-less row keeps full access
- **WHEN** a request presents a paired-device bearer whose registry row has no `tier` field
- **THEN** the caller's tier SHALL be `operate`

#### Scenario: Session token resolves to control
- **WHEN** a request presents a per-session MCP token
- **THEN** the caller's tier SHALL be `control`

### Requirement: tools/list advertises only the caller's tier
`tools/list` SHALL return exactly the tools whose tier is at or below the
caller's tier. Tools above the caller's tier SHALL NOT appear in the result.
(Tool names themselves are public in the generated catalogue; the filter
limits what a client is offered, not what it can know exists.)

#### Scenario: Observe caller sees only observe tools
- **WHEN** an `observe` caller invokes `tools/list`
- **THEN** every returned tool SHALL be an `observe`-tier tool
- **AND** no `control`- or `operate`-tier tool name SHALL appear

#### Scenario: Operate caller sees everything
- **WHEN** an `operate` caller invokes `tools/list`
- **THEN** the result SHALL contain every tool in the manifest

#### Scenario: Tier sets are nested
- **WHEN** `tools/list` results for `observe`, `control` and `operate` callers are compared
- **THEN** the `observe` set SHALL be a subset of the `control` set
- **AND** the `control` set SHALL be a subset of the `operate` set

### Requirement: Out-of-tier calls are refused with a scope challenge
`tools/call` naming a tool above the caller's tier SHALL be refused with HTTP
`403` and a `WWW-Authenticate: Bearer error="insufficient_scope"
scope="<required tier>"` header and a JSON-RPC error whose `data.scope` names
the required tier. The refusal SHALL be recorded with caller identity, tool
name, caller tier and required tier. It SHALL NOT invoke the tool's handler
and SHALL take precedence over the self-target guard.

#### Scenario: Observe caller invokes a control tool
- **WHEN** an `observe` caller invokes `tools/call` for `send_prompt`
- **THEN** the response status SHALL be `403`
- **AND** the `WWW-Authenticate` header SHALL contain `error="insufficient_scope"` and `scope="control"`
- **AND** the tool SHALL NOT execute

#### Scenario: Refusal is logged
- **WHEN** an out-of-tier call is refused
- **THEN** a log record SHALL carry the caller identity, tool name, caller tier and required tier

#### Scenario: In-tier call unaffected
- **WHEN** a `control` caller invokes `tools/call` for `send_prompt`
- **THEN** the tier check SHALL NOT refuse the call

### Requirement: Tier can be capped by endpoint path
`POST /mcp/observe` and `POST /mcp/control` SHALL behave as `/mcp` with the
caller's tier capped at the path's tier. A credential whose own tier is below
the path's tier SHALL keep its own tier. `/mcp/operate` and any other
`/mcp/<suffix>` SHALL answer 404 JSON for every HTTP method, not the SPA
fallback; non-POST methods on `/mcp/observe` and `/mcp/control` SHALL answer
as `/mcp` does. The uncapped surface is `/mcp`.

#### Scenario: Operate token capped to observe
- **WHEN** an `operate` caller invokes `tools/list` at `/mcp/observe`
- **THEN** the result SHALL equal the `observe` caller's `tools/list` result

#### Scenario: Capped path refuses above-cap call
- **WHEN** an `operate` caller invokes `tools/call` for `restart_server` at `/mcp/control`
- **THEN** the response SHALL be the `insufficient_scope` refusal with `scope="operate"`

#### Scenario: Cap never raises
- **WHEN** an `observe` caller invokes `tools/list` at `/mcp/control`
- **THEN** the result SHALL equal the `observe` caller's `tools/list` result at `/mcp`

### Requirement: Every tool declares behavioural annotations
Every advertised tool SHALL carry MCP `annotations` with `readOnlyHint` and
`destructiveHint` set explicitly. Every `observe`-tier tool SHALL have
`readOnlyHint: true`. Every tool that kills a process without the session's
cooperation, irreversibly deletes data, or removes a package SHALL have
`destructiveHint: true`; no `destructiveHint` tool SHALL be `observe`-tier.
Cooperative lifecycle signals (`abort`, `stop_after_turn`, `shutdown`) are
not destructive.

#### Scenario: Observe tools are read-only
- **WHEN** the manifest is enumerated
- **THEN** every `observe`-tier tool SHALL have `annotations.readOnlyHint === true`

#### Scenario: Destructive tools are never observe-tier
- **WHEN** the manifest is enumerated
- **THEN** no tool with `annotations.destructiveHint === true` SHALL be `observe`-tier
- **AND** `force_kill` SHALL be `operate`-tier with `destructiveHint: true`

### Requirement: The tool surface is complete over a reviewed manifest
The advertised tool set SHALL be defined by a single reviewed manifest. Every
REST route and browser-WS command verb of the dashboard (core and bundled
plugins) SHALL be either bound to a manifest tool or listed on an explicit
denylist with a stated reason. Each tool's input schema SHALL be generated
from the shared request type of the route or verb it binds to, and the
generated output SHALL be checked in and verified fresh by an automated test.
A manifest row that binds to a route or verb that does not exist, or a route
or verb that is neither bound nor denylisted, SHALL fail the test suite.

#### Scenario: Unbound route fails the build
- **WHEN** a REST route is registered that appears in neither the manifest nor the denylist
- **THEN** the completeness test SHALL fail naming the route

#### Scenario: Dangling manifest row fails the build
- **WHEN** a manifest row binds to a route or verb that is not registered
- **THEN** the completeness test SHALL fail naming the row

#### Scenario: Stale generated schema fails the build
- **WHEN** a shared request type changes and the generated tool schema is not regenerated
- **THEN** the freshness test SHALL fail

#### Scenario: Denylisted surfaces are not advertised
- **WHEN** an `operate` caller invokes `tools/list`
- **THEN** the result SHALL NOT contain a tool for the pairing ceremony, WS-ticket minting, model-proxy or `/v1/*` routes, API-key routes, `/auth/*`, Electron-only routes, load-shedding test hooks, or UI-only verbs

### Requirement: Session-targeting tools are covered end to end
The `control` tier SHALL include tools to answer a pending `ask_user`
prompt, answer a pending extension UI request, set a session's model and
thinking level, edit the followup queue, resume, shut down, retry,
stop-after-turn, rename, tag and archive a session. The `observe` tier SHALL
include tools to read a session's events from a sequence number, a tool
result, an attachment, a session diff, a session file and a transcript.

#### Scenario: ask_user answered over MCP
- **WHEN** a `control` caller invokes the prompt-response tool for a session with a pending `ask_user`
- **THEN** the session's pending prompt SHALL be resolved with the supplied answer

#### Scenario: force_kill requires operate
- **WHEN** a `control` caller invokes `force_kill`
- **THEN** the call SHALL be refused with `scope="operate"`
- **AND** an `operate` caller invoking it SHALL terminate the session's process
