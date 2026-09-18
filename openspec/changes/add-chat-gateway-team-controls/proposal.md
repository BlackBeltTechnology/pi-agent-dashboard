# Team controls for the chat gateway (tiered authorization, workspace binding, output filter, audit)

## Why

`add-chat-gateway` makes a *person* able to drive their own agent from Discord. It does not make a *team* able to share one: its authorization is binary (L1 allowlist — you may drive sessions, or you may not; L2 admin — you may bind a channel), its binding unit is a bare `cwd`, its output stream is unfiltered, and it keeps no attributable record of who caused what.

Hand that to three teammates and every one of them can prompt every bound session, read every mirrored diff, and leave no trace. The gap is not transport — chat-gateway solved transport. The gap is **who may do how much, where, and what was it**.

This change adds that layer:

- **tiered authorization** — reuse the dashboard's own `observe | control | operate` vocabulary instead of a boolean allowlist, mapped per binding,
- **workspace as the binding unit** — bind a *dashboard workspace* (a named set of folders) to a private channel, rather than a hand-typed path per channel,
- **an output filter** — a default that does not mirror diffs and terminal output into a room, tunable upward by an operator,
- **an audit trail** — Discord provenance on sessions plus an append-only command log with a reason on every refusal.

## Dependency

**Hard dependency on `add-chat-gateway`.** This change consumes its plugin, its headless-client seam, its routing table, its PromptBus interactive rendering, its adapter, and its `allowedRoots` invariant. It adds no transport and duplicates none of that. Every requirement here presumes chat-gateway has landed; it is not implementable before then.

Division of ownership:

| Concern | Owner |
|---|---|
| Discord adapter, gateway connection, token, intents | `add-chat-gateway` |
| Headless-client seam, `subscribe`/`send_prompt`/`prompt_response`/`abort` | `add-chat-gateway` |
| Channel→session routing, per-thread session granularity | `add-chat-gateway` |
| `ask_user` → native Discord controls, 3s defer, dismissal | `add-chat-gateway` |
| `allowedRoots` containment, real-path resolution, L3 tool policy | `add-chat-gateway` |
| **Which principal may cause which verb, at what tier** | this change |
| **Workspace→channel binding + private channel provisioning** | this change |
| **What a channel is allowed to see** | this change |
| **Who caused it, and why a refusal happened** | this change |

## What Changes

- **Host seam (the one non-plugin change)**: `ServerPluginContext` gains `listWorkspaces()` and `onWorkspacesChanged()`. Workspaces live in the preferences store, are mutated only by browser-WS verbs, and are exposed on no plugin-facing surface — a workspace-keyed binding is impossible without this. Read-only; store-anchored; the plugin never mutates a workspace.
- **Tiered authorization layered over L1/L2**: a principal (Discord snowflake, or a mapped role) resolves to `observe | control | operate` **per binding** — a principal mapped for one channel gains nothing in another. Layered, not replacing: chat-gateway's L1 allowlist and L2 admin-binding still gate first; this layer can only narrow what an already-allowlisted principal may do.
- **Verb tiers are read, never re-declared**: the required tier for a verb comes from `GENERATED_TOOLS` (`mcp-server-plugin`'s `./manifest` export — the table that carries an effective tier on every row), so the chat surface and the MCP surface cannot drift apart.
- **Tier ceiling** per deployment, plus a non-configurable deny-list *inside* `operate`: `mint_device_token`, `set_providers`, `install_package`, `tunnel_connect` never route through chat, because they mint credentials or state that outlive the grantee's Discord membership.
- **Roles map up to `control` only**; `operate` requires an operator-typed snowflake, because role membership is controlled by whoever holds Manage Roles, who is not necessarily the operator. The settings surface names who can assign each mapped role.
- **Reasoned refusals**: authorization returns a grant or a refusal carrying a specific reason (non-human author, unbound channel, no mapping, disarmed, non-delegable verb, insufficient tier, scope violation). The log records the reason; a refusal is never an undifferentiated silence.
- **Workspace→channel binding**: a workspace binds to one auto-provisioned private text channel — `permission_overwrites` supplied *in the create call* (no world-readable window), and **reconciled** when the mapping changes so a revoked principal loses read access. Channels are renamed on workspace rename and never auto-deleted.
- **Workspace binding never widens `allowedRoots`**: a workspace folder outside `allowedRoots` is refused, not adopted. This layer may only narrow chat-gateway's spawn boundary.
- **Scope containment**: a command in a bound channel may only reach sessions whose cwd lies within that channel's workspace; the target comes from the binding, never from user input.
- **Output filter**: per-binding mirror level, defaulting to assistant text + tool names only — no tool payloads, no diffs, no terminal output. Explicitly pulled content is tier-gated rather than filter-gated. The filter bounds *structured payloads*; assistant prose is mirrored as written, and that boundary is stated rather than papered over.
- **Answering a question is tier-gated**: chat-gateway renders the controls; this layer decides who may press them — at least `control`, invoker-only for an invoker-raised question, any `control` principal for a question no Discord user invoked (so an autonomous session cannot deadlock).
- **Audit**: Discord provenance as a persisted plugin-owned ref via `ctx.assignSessionRef`, plus an append-only command log with ring-buffer retention (operator-configurable, default 10,000 entries), readable from the dashboard and never from Discord.
- **Disarm switch**: any `observe` principal halts all action-bearing commands; only the dashboard re-arms. Mirroring continues while disarmed.

## Capabilities

### New Capabilities
- `plugin-workspace-seam`: read-only workspace accessor + change subscription on `ServerPluginContext`; host-side, available to any plugin.
- `chat-gateway-tier-authorization`: per-binding principal→tier resolution over the shared verb-tier table, ceiling, the in-`operate` deny-list, per-message re-resolution, reasoned refusals, non-human-author rejection, the disarm switch, and the tier gate on answering questions.
- `chat-gateway-workspace-binding`: workspace as a binding source, private channel provisioning with atomic overwrites, synchronous overwrite reconciliation, rename-follows/never-delete lifecycle, deterministic cwd→workspace resolution, the `allowedRoots`-narrowing invariant, and scope containment.
- `chat-gateway-output-filter`: per-binding mirror levels with a minimal default, the structured-payload-only boundary, tier-gated pulls, elision markers, and posting paced to the platform's per-channel limit.
- `chat-gateway-audit`: persisted Discord provenance on sessions and the append-only command log with reasoned refusals.

### Modified Capabilities
- `chat-gateway`: three requirements gain this layer — the cwd-binding resolver gains a workspace source (still `allowedRoots`-bounded), layered authorization gains the tier dimension above L1/L2, and interactive prompts gain a tier gate on who may answer.
- `dashboard-plugin-runtime` server context: additive read-only workspace seam; no existing member changes shape.

## Impact

- **Modifies the host**: `ServerPluginContext` + its wiring in `packages/server/` gain the workspace seam, with tests. The only place this change is not plugin-contained.
- **Extends, does not fork, chat-gateway**: the team-control logic ships inside chat-gateway's plugin rather than as a second Discord plugin — two plugins holding two gateway connections to one guild would double-post and split the routing table.
- **Trust level**: the plugin must carry a manifest priority inside the host's trusted range (`priority <= 100`); `assignSessionRef` and other session-affecting verbs silently no-op for untrusted plugins, and a silent no-op is the failure mode that looks like a Discord problem and is not.
- **Consumes**: `GENERATED_TOOLS` from `mcp-server-plugin/manifest` (verb→tier), `ctx.assignSessionRef`, `ctx.onEvent` / `onSessionEnded`, `ctx.listWorkspaces` / `onWorkspacesChanged` (new), plugin config persistence with write-only redaction, `registerBrowserHandler` for the log view. No new HTTP route.
- **Privacy posture, stated explicitly**: mirrored content leaves the machine and is retained and indexed by Discord. A bound channel is as trusted as its least-trusted member. The filter sets the default blast radius; it does not make a channel private, and it cannot bound what the model chooses to write in prose.
- **Docs**: a team-controls section in chat-gateway's doc rather than a second document; architecture pointer row.
- **Tests**: unit coverage for tier resolution, binding resolution, overwrite reconciliation, and the host seam; Discord REST/gateway stubbed — no live-guild test in CI.

## Discipline Skills

- `security-hardening` — this layer *is* the authorization surface for a shared credential that reaches a code-executing agent: tier resolution, the `operate` deny-list, the `allowedRoots`-narrowing invariant, channel overwrite reconciliation, token-adjacent config.
- `observability-instrumentation` — the append-only command log with reasoned refusals, persisted session provenance, and health surfacing for the new seam.
- `doubt-driven-review` — the tier model is the irreversible part: it decides what a teammate can do to a machine, and a later change may ride ship/merge verbs on it.
- `review-code` — standard pre-commit pass once the layer lands and tests pass.
