## Why

The dashboard already exposes every verb a remote control surface needs (`/api/session/:id/prompt`, `/abort`, `/spawn`, the worktree and OpenSpec routes) behind a fail-closed tier gate, but the only ways to reach them are a browser session or a paired-device bearer token. A team cannot watch or steer a running agent from where the team already is.

Discord supplies the missing pieces for free: an outbound-only gateway (no inbound port, no tunnel), per-channel access control, threads that model per-session conversations, and native slash-command autocomplete that removes free-text input from privileged parameters. This change lands the bridge and — critically — its authorization model, so that a later change can safely ride spawn/worktree/ship commands on top of a security posture that already stands on its own.

## What Changes

- New headless dashboard plugin `packages/discord-plugin/` (`claims: []`, server entry + `settings-section` contribution). Connects OUTBOUND to the Discord gateway; the dashboard opens no new inbound surface.
- **Principal authorization**: Discord snowflakes and Discord roles map to the existing `observe | control | operate` tiers from `packages/shared/src/route-tiers.ts`. Configured in dashboard settings only — never mutable from a Discord message. Defaults closed (`observe`).
- **Tier ceiling** is an operator setting, with a non-configurable deny-list *inside* `operate`: `mint_device_token`, `set_providers`, `install_package`, `tunnel_connect` never route through chat, because they produce credentials or state that outlive the grantee's Discord membership.
- **Role→tier mapping** permitted up to `control`; `operate` requires an explicit snowflake. Settings UI surfaces WHO can assign each mapped role, making the delegation visible.
- **Workspace ↔ channel binding**: the plugin auto-creates one text channel per dashboard workspace, supplying explicit `permission_overwrites` in the create call (deny `@everyone` VIEW_CHANNEL). Channels are renamed on workspace rename and NEVER auto-deleted.
- **Session ↔ thread binding**: each session gets a thread in its workspace channel. Threads outlive sessions; a message in a dead thread offers resume rather than silently spawning.
- **Scope containment**: a command issued in a bound channel may only reach sessions whose `cwd` lies under that channel's workspace. The target is resolved from the binding, never from user input.
- **Event projection** with an operator-tunable filter. Default posture: assistant text + tool NAMES only — no payloads, no diffs, no terminal output.
- **Plain text = prompt** for a `control`-tier principal inside a bound thread. Messages from bots and webhooks (`author.bot || webhook_id`) are always ignored; tier is re-resolved per message, never cached.
- **`ask_user` → Discord buttons**, with a text-reply fallback once the ~15-minute interaction token expires.
- **Audit**: every bot-initiated session is tagged `discord:<snowflake>` + `channel:<id>` via the existing `set_session_tags` bridge verb, plus an append-only command log.
- **Disarm switch**: any `observe` principal can halt all bot-initiated actions.

Out of scope here, deliberately: `/pi spawn`, `/pi worktree`, `/pi ship|pr|merge`. Those land in `add-discord-worktree-commands` on top of this authorization model.

## Capabilities

### New Capabilities
- `discord-bridge-plugin`: plugin manifest, lifecycle, outbound gateway connection, reconnect/backoff, failure isolation, settings-section surface, bot-token storage.
- `discord-principal-authorization`: snowflake and role → tier resolution, configurable ceiling, the in-`operate` deny-list, per-message re-resolution, non-principal (bot/webhook/observe) rejection, disarm switch.
- `discord-workspace-channel-binding`: workspace↔channel auto-creation with atomic permission overwrites, rename-on-rename, never-auto-delete, session↔thread mapping, thread-outlives-session and resume-on-dead-thread behavior, cwd scope containment.
- `discord-event-projection`: session-event → Discord-message rendering, the default mirror filter (assistant text + tool names), operator-tunable filter levels, collapse/debounce, and the rule that explicitly pulled content is tier-gated rather than filter-gated.
- `discord-ask-user-interactions`: `ask_user` question → Discord component rendering for confirm/select/multiselect/input, interaction-token expiry handling, text-reply fallback, and invoker-only button press enforcement.
- `discord-command-audit`: session tagging with Discord provenance and the append-only command log.

### Modified Capabilities
<!-- None. This change consumes existing route tiers and bridge verbs without altering their requirements. -->

## Impact

- **New package**: `packages/discord-plugin/` — server entry, `dashboard/` settings section. New runtime dependency on a Discord gateway/REST client library, and a Discord application with the Server Members privileged intent (required to read role membership; snowflake-only deployments do not need it).
- **Consumes, does not modify**: `packages/shared/src/route-tiers.ts` (tier vocabulary), `set_session_tags` bridge verb, `POST /api/session/:id/prompt`, `/abort`, `/resume`, the `/ws` subscriber feed, plugin config persistence, and the `settings-section` plugin claim.
- **Secrets**: the Discord bot token is stored in plugin config on the dashboard host.
- **Privacy posture, stated explicitly**: mirrored content leaves the machine and is retained and indexed by Discord. A bound channel is as trusted as its least-trusted member. The filter sets the default blast radius; it does not make a channel private.
- **Docs**: new `docs/discord-bridge.md`; architecture pointer row; `docker/` env for the bot token if the all-in-one image should carry it.
- **Tests**: unit coverage for tier resolution and binding; the Discord gateway is stubbed — no live-guild test in CI.

## Discipline Skills

- `security-hardening` — a shared credential that reaches a code-executing agent: tier resolution, the `operate` deny-list, channel permission overwrites, bot/webhook rejection, token storage.
- `observability-instrumentation` — the append-only command log, session provenance tags, and gateway connection/health surfacing in `/api/health.plugins[]`.
- `doubt-driven-review` — the authorization model is the irreversible part: a later change rides spawn and ship on top of it, so it must be stress-tested before it stands.
- `review-code` — standard pre-commit pass once the plugin lands and tests pass.
