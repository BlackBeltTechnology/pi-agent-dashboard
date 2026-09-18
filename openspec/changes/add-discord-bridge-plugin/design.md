## Context

See `proposal.md` — Why. Design-relevant current state:

- `ServerPluginContext` (`packages/dashboard-plugin-runtime/src/server/server-context.ts:622`) already exposes everything this bridge needs in-process: `onEvent(sessionId, event)`, `onSessionEnded`, `onSessionResolved`, `sendToSession`, `spawnSession` / `abortSession` (trusted-gated), `getPluginConfig` / `updatePluginConfig`, `provide` / `consume`, and `fastify`.
- Workspaces are not a bespoke concept: they live in the preferences store as `workspaces: [{ id, name, collapsed, folders }]` and are broadcast to clients as `workspaces_updated`.
- The tier vocabulary (`observe` / `control` / `operate`) and the route→tier table live in `packages/shared/src/route-tiers.ts`.
- Plugins are loaded with failure isolation and surface state in `/api/health.plugins[]`; plugin config persists through the plugin-config store.

The constraint that shapes almost every decision below: **`ctx.*` calls are not tier-gated.** The tier table gates HTTP routes. A server plugin calling `ctx.sendToSession` bypasses it entirely. So authorization is something this plugin must own, not something it inherits.

## Goals / Non-Goals

**Goals:**
- One authorization chokepoint that every Discord-originated action passes through, testable without a live guild.
- Bindings that survive restart and that never lose a thread's history.
- A projection layer whose default reveals as little as possible, tunable upward by an operator.
- A design that `add-discord-worktree-commands` can extend by adding commands only — never by loosening the gate.

**Non-Goals:**
- No sharding. One dashboard ↔ one guild; multi-guild is not modelled.
- No Discord-side persistence of session state. Discord is a view and an input device; the dashboard remains the source of truth.
- No live-guild integration test in CI.
- No mirroring of sessions outside a bound workspace — absence of a binding means absence of a surface.

## Decisions

### D1 — In-process headless plugin, not an external bot process

Chosen over an external bot talking to `/mcp` or the REST API with a paired-device token.

*Why:* the projection layer needs the raw forwarded event stream; `ctx.onEvent` gives it without polling or a second WebSocket client. Failure isolation, config persistence, settings UI, and health reporting come free. The dashboard opens no inbound surface — the gateway connection dials out — so this works on loopback with no tunnel.

*Cost, accepted:* the bot token lives in the dashboard process, and the bot dies with the dashboard. Both are acceptable for a tool that exists to drive that dashboard.

*Alternative rejected:* external bot + bearer token. It would inherit the route tier gate for real, which is a genuine advantage — but it must then poll or subscribe for events, re-implement session discovery, and hold a `control`-tier bearer token that outlives any single run. Net security is not better; complexity is worse.

### D2 — Authorization is a single pure function, called per action

```
resolve(authorContext, binding) -> Tier | null
       |
       +- author is bot or webhook          -> null        (hard, first check)
       +- snowflake entry                   -> tier
       +- mapped roles (max, capped control)-> tier
       +- take max, then clamp to ceiling
       +- disarmed && action-bearing        -> refuse
       +- verb in NON_DELEGABLE             -> refuse
```

`NON_DELEGABLE` is a module constant, not config: device-token minting, provider writes, package install, tunnel connect. The function is pure over `(author, roles, config, binding)` — every branch is unit-testable with no Discord client.

*Why a chokepoint rather than per-command checks:* `add-discord-worktree-commands` adds ~8 commands on top of this. Per-command checks would let one of them forget. The command dispatcher takes a resolved tier as an argument and cannot run without one.

*Why roles cap at `control`:* role membership is controlled by whoever holds Manage Roles in the guild, which is not necessarily the dashboard operator. Mapping a role to `operate` would silently delegate credential minting to a Discord admin. `operate` therefore requires a snowflake the operator typed.

### D3 — Two stores: operator config vs. runtime bindings

| Data | Store | Why |
|---|---|---|
| token, principals, role map, ceiling, mirror levels, disarm flag | plugin config (`getPluginConfig`/`updatePluginConfig`) | operator-authored, edited from settings UI, already persisted and redactable |
| workspace↔channel, session↔thread, question↔message | own JSON store in the plugin's data dir | mutates on every session; writing it through plugin config would thrash the operator's config file |

The command log is a third, append-only file with a ring-buffer retention bound.

### D4 — `@discordjs/core` + `@discordjs/ws` + `@discordjs/rest`, not `discord.js`

The modular packages give the gateway, REST, and rate-limit handling without the full client's entity cache, which would hold guild state in the dashboard process for no benefit — this plugin reads its state from the dashboard, not from Discord.

*Two privileged intents are required and must be enabled in the Discord developer portal:*
- `GUILD_MEMBERS` — to read role membership (only needed when role mappings are used; snowflake-only deployments can skip it).
- `MESSAGE_CONTENT` — **required for plain-text-as-prompt.** Without it the bot receives empty `content` for messages that do not mention it.

This is a real deployment prerequisite, not a footnote: if an operator cannot enable `MESSAGE_CONTENT`, plain-text prompting silently does nothing and only slash commands work. The plugin MUST detect the missing intent at connect time and report it in health rather than appearing to work.

### D5 — Actions go through `ctx.*`, with the gate re-implemented locally

`sendToSession` / `abortSession` are called in-process rather than looping back through `POST /api/session/:id/prompt`. Looping through HTTP would reuse the tier gate, but requires the plugin to hold a bearer token for its own host — a credential sitting in the same process as the thing it authenticates to, which is security theatre.

*Consequence, stated plainly:* D2's chokepoint is the ONLY thing standing between a Discord message and a running agent. It carries the weight the route tier table carries for HTTP. This is why it is a pure function with exhaustive unit tests, and why `doubt-driven-review` is named in the proposal.

### D6 — Channel creation is a single call with overwrites

Discord has no transactional create-then-permission. A create followed by a permission PATCH leaves a window where a channel named after a client project is readable by the whole guild. The create payload therefore carries `permission_overwrites` denying `VIEW_CHANNEL` to `@everyone`. If the bot lacks the permission to do that, **no channel is created** — a visible failure beats a leaky success.

Deletion never propagates in either direction: workspace deleted → binding inactive, channel and history remain; thread deleted → binding dropped, session untouched.

### D7 — Projection is a per-thread buffered reducer

Raw forwarded events → filter by mirror level → coalesce within a short window → post. One in-flight post per thread, queued behind it, so a streaming session cannot exceed the platform's per-channel rate budget. Anything dropped or shortened carries an explicit elision marker; the layer never presents a partial rendering as complete.

Mirror level applies to the passive stream only. Explicitly pulled content is gated by tier instead — otherwise the filter would be a privacy control that a `/pi show` walks straight past.

### D8 — Questions: components first, text reply as the durable path

Discord interaction tokens expire ~15 minutes after the interaction; a pi question can stay open for hours. So the components are the fast path and a text reply in the thread is the path that always works. The question↔message mapping lives in the binding store, and answer delivery is idempotent — first answer wins, whether it arrived from a component, a text reply, or the dashboard UI.

### D9 — Thread creation is driven by `onEvent` / `onSessionEnded`, not polling

A session whose cwd falls inside a bound workspace's `folders` gets a thread on first event. Cwd matching is prefix-based on resolved absolute paths, and is also what enforces scope containment in the command path — the same matcher, used for both, so the surface and the permission can never disagree.

## Risks / Trade-offs

- **The bot token is a credential for the dev machine** → stored redacted, never returned by a read API; `operate` deny-list means a leaked token still cannot mint a longer-lived credential.
- **The plugin's own gate is the whole security boundary (D5)** → pure-function design, exhaustive table-driven tests, `doubt-driven-review` before it lands, and a design that a follow-up change extends only by adding commands.
- **Guild permission drift** — an operator maps a role today; someone gains Manage Roles tomorrow → settings surface names who can assign each mapped role; tier is re-resolved per message so revocation is immediate.
- **`MESSAGE_CONTENT` intent missing** → detected at connect, reported in health; plain-text prompting fails loudly rather than silently.
- **Mirrored content is permanently retained and indexed by Discord** → minimal default level, per-binding tuning, and an explicit statement in docs that a bound channel is as trusted as its least-trusted member. This is mitigated, not solved.
- **Thread sprawl** — a busy workspace produces many threads → threads are created only for sessions inside a bound workspace; Discord's own archive behavior handles the long tail; the plugin never auto-deletes.
- **Rate limits under heavy streaming** → per-thread coalescing with a single in-flight post; elision markers when the budget is exceeded.
- **A guild outage or token revocation** → the dashboard is unaffected; the plugin reports unhealthy and reconnects with backoff.

## Migration Plan

Additive and opt-in. The plugin ships disabled; no existing route, schema, or stored shape changes. Enabling requires an operator to create a Discord application, enable the intents, and paste a token.

*Rollback:* disable the plugin. Bindings persist but go inert; channels and their history remain in the guild (by D6's never-delete rule), so re-enabling reattaches rather than re-creating. Removing the package leaves orphaned Discord channels that an operator deletes by hand — deliberate, since the alternative is a plugin that can mass-delete channels.

## Open Questions

- Retention bound for the command log (entry count vs. age) — tunable later without touching specs or task shape.
- Whether mirror level should be settable per-thread in addition to per-binding. Per-binding is specified; a per-thread override is additive.
- Naming scheme for auto-created channels when two workspaces share a display name — a disambiguation suffix is an implementation detail of D6.
