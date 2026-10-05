# chat-gateway.md — index

Pull-only condensed map. Source: docs/chat-gateway.md.

## Architecture & Operation
- Inbound chat control plane (`@blackbelt-technology/pi-dashboard-chat-gateway-plugin`).
- Headless browser-protocol client in server process; subscribes via `ctx.subscribeSession`.
- Drives sessions via raw-control lane: `send_prompt`, `prompt_response`, `abortSession`, `spawnSession`.
- No bridge protocol changes; no server wire changes.
- Streaming deltas edit throttled (`editThrottleMs`, default 1000 ms); chunks responses >2000 chars.
- Interactive prompts (`ask_user`, `confirm`, `select`, `multiselect`, `batch`) map native buttons/menus; web response dismisses Discord controls.
- Inert without `token`: no adapter, no socket, no timer; defers `discord.js` import.
- State directory (`~/.pi/dashboard/chat-gateway/`): `bindings.json` (routing), `channels.json` (provisioning), `command-log.json` (audit, 0600), `disarm.json` (latch, 0600).

## Discord Bot Setup
- Discord Developer Portal: create application, add Bot, copy token.
- Bot → Authorization Flow: turn **Requires OAuth2 Code Grant** OFF. Invite fails `Integration requires code grant` when ON.
- Privileged Gateway Intents: enable **Message Content Intent** + **Save Changes**. Off/unsaved fails login: `[discord] login failed (...): Used disallowed intents` in `server.log`.
- OAuth2 URL Generator: scopes `bot`, `applications.commands`; perms View Channels, Send Messages, Embed Links, Read Message History, Manage Channels, Manage Roles, Create Public Threads, Create Private Threads, Send Messages in Threads; integer `378225642512`. Do NOT grant Administrator (bypasses channel overwrites).
- Invite URL shape: `https://discord.com/oauth2/authorize?client_id=<APP_ID>&scope=bot%20applications.commands&permissions=378225642512&guild_id=<GUILD_ID>`; authorize to guild. Bot absent from guild → `provision_failed: Unknown Guild`.

## Dashboard Configuration
- Settings → General → Chat Gateway (`ChatGatewaySettings`).
- `token` write-only schema property: redacted from responses, never logged.
- Partial write keeps omitted keys: body merges over stored config; schema defaults fill only never-stored keys (`fix-plugin-config-partial-write`).

## Mandatory Spawn Boundary (`allowedRoots`)
- Whitelist `allowedRoots` governs spawn and attach; empty array blocks all.
- Fail-closed; realpath containment (`fs.realpathSync.native`) checked on every transition and resume; resolves nearest existing ancestor before prefix check; blocks traversal/symlink escapes.

## Channel-to-Session Binding Resolution
- Identity `(platform, channelId, threadId)`; key format `platform:channelId:threadId`.
- Precedence:
  1. Persisted binding (`~/.pi/dashboard/chat-gateway/bindings.json`): routes prompt; resumes ended via transcript; unreachable error if disconnected.
  2. `fixedMap[channelKey]` (within `allowedRoots`): spawns new session.
  3. `defaultCwd` (within `allowedRoots`): spawns new session.
  4. Interactive attach: bound channel filters running sessions to bound workspace folders (`isWithinWorkspace`); refuses if 0 (names folders) or >1. Unbound channel filters `allowedRoots`; refuses if 0 or >1.
  5. Refusal: fails `allowedRoots` or no target.
- Spawn/resume carry triggering message as `initialPrompt` (steer prefix stripped); host queues per cwd (`pendingInitialPromptRegistry`), runs it as first turn. Reply: `your message will run once it is up`.
- Spawn/resume pass `lifecycle: { hidden: true }` unless `sessionVisibility: "shown"`; applied on first register only, never on reattach.
- Spawn binding written on host `onSessionResolved`; correlate via plugin-OWNED `pluginRef.chatSpawnToken` (+ `bindSource`). Core-reserved keys (`spawnToken`, `source`, `sessionId`, `cwd`, …) stripped before owner notify (`CORE_RESERVED_REF_KEYS`) — never correlate on them.
- Troubleshooting: `bindings.json` absent after spawn + command-log only `spawn_session` → correlation broken. See change: fix-chat-gateway-spawn-correlation.
- Thread per conversation (`threadPerConversation`, default true): channel-root guild message (not DM, no `threadId`, not `!disarm`, has `messageId`, adapter has `startThread`) = NEW conversation. Authorized via `team.authorizeRequest` verb `spawn_session`; never routed into channel-root binding. Then `adapter.startThread(channelId, messageId, name)` opens public thread (Discord `autoArchiveDuration: 1440`, needs **Create Public Threads**); name = message text, steer prefix stripped, whitespace collapsed, ≤100 chars. Message re-addressed (`channelId = threadId`, `threadId`, `parentChannelId = root`) → `ensureBinding` spawn with `initialPrompt` → key `discord:<threadId>:<threadId>`. Reply + stream inside thread; follow-ups reuse session. L4/team resolve via parent channel. Refused/DM never thread. `startThread` failure → `warn` `chat-gateway: could not open a thread (...)`, answer in channel root. `false` = one shared channel-root session.
- Restart respawn (fixed, `fix-plugin-hidden-across-restart`): post-`/api/restart` re-register can be `registerReason:"spawn"` (no token, `dashboardSpawned:true`); old non-reattach path re-decided `hidden` via headless heuristic → false; next save persisted `false`. Fix writes core-owned `pluginHidden:true` (`event-wiring.ts`), restored via `session-to-meta.ts`/`sessionFromMeta` (`session-scanner.ts`); register order reattach → `existing.hidden`, else `visibilityIntent`, else `existing.pluginHidden===true` → hidden, else heuristic. Pre-fix sessions lack `pluginHidden` → not migrated.

## Reach Dashboard Sessions from Discord
- Two whole-message commands pull DASHBOARD sessions into chat; any other text (incl. steer-prefixed) is a prompt.
- `!sessions` (verb `list_sessions`, observe): numbered list (max 25) of live, non-hidden sessions in scope (bound-workspace folders else `allowedRoots`); name, status, short id, `<#thread>` when attached. Cached per channel (`lastListing`).
- `!attach <number|id-prefix>` (chat-local `attach_session`, observe, scope check on target cwd): opens thread on command message named after session (`attachInThread`), binds `source:"attach"` keyed `discord:<threadId>:<threadId>` (`parentChannelId` = channel), subscribes, confirms. Already attached → points at existing thread. Inside a thread → refused. Prompts in thread still authorized `send_prompt` (control). Attached sessions never hidden.
- `!close` — whole message, INSIDE bound thread, chat-local `close_session` (control); audited. Gateway-started live session → `seam.shutdownSession` → `ctx.shutdownSession` → `browserGateway.shutdownSession` (dashboard Shutdown body; host refusal → nothing changes). Attached (`source:"attach"`, incl. auto-mirror) → detach only; session keeps running. Both: binding removed, unsubscribe when last binding, confirmation, thread archived (`archiveThread`, Discord `setArchived(true)`). Channel root → hint; unbound thread → `Nothing to close here`; `!close the file` stays steer. No channel deletion from chat. Other close paths: dashboard Shutdown, `POST /api/session/<id>/shutdown`, `/abort` (current run only), Discord archive/delete, 24h auto-archive.
- Code: `gateway.ts` (`SESSIONS_COMMAND`, `ATTACH_COMMAND`, `CLOSE_COMMAND`, `scopeFor`, `attachableSessions`, `maybeAutoMirror`, `handleCloseCommand`, `closeTarget`, `endOwnedSession`, `unbind`); seam `onSessionEvent` + `SeamSession.name/hidden` + `HostSeam.shutdownSession`; `tier.ts`; `team/controller.ts` `boundChannelIds()`; adapters `archiveThread?` (`base.ts`), `archiveThread` (`discord.ts`).
- Auto-mirror (`mirrorDashboardSessions`, default false; settings checkbox `chat-gateway-mirror-dashboard-sessions`; team-controls only): at gateway start + first appearance on host `onEvent` stream, every live, non-hidden, unbound session in a bound workspace gets a `🖥 Dashboard session: <name>` post + thread. Once per run (`mirrorConsidered`); persisted bindings → no duplicates after restart. Sends activity to Discord at channel mirror level; opt-in. See change: chat-gateway-attach-dashboard-sessions.

## L1 Pairing Flow
- Mints 6-digit code at startup; logged once (`"L1 pairing code <code>"`).
- Settings / HTTP API never display code.
- DM-only (`isDM: true`); guild attempts ignored. Code expires 15m (`DEFAULT_TTL_MS = 900_000`); locks after 10 failed attempts (`DEFAULT_MAX_ATTEMPTS = 10`).
- Valid code appends Discord `userId` to `allowlist`; persists config via `updatePluginConfig`; replies `"Paired. Session control happens in a workspace-bound channel, not here."`.
- DMs enrollment-only under team controls: DM adds user to L1 allowlist; DM cannot carry workspace binding; DM session control refused.

## Authorization Semantics
- Fail-closed; refusals emit distinct reasons:
  - L1 User Identity (`allowlist`): `not_allowlisted`.
  - L2 Bind Authority (`admins`, must be in allowlist): `not_admin`.
  - L4 Channel Isolation (`groupChannels` guild allowlist; DMs bypass): `group_channel_not_opted_in`.
  - Malformed/empty user ID: `ambiguous_identity`.
- Steering: `steerPrefix` (default `!`) dispatches delivery mode `steer`; regular dispatches `followUp`.

## L3 Tool Guard (`toolPolicy` + `guardExtension`)
- Optional boundary for gateway-SPAWNED sessions only; attached sessions ungated.
- `guardExtension`: package subpath or absolute path; required for loading.
- Decision engine: `allow` > `approval` > `defaultAction` (`"deny"` default or `"approve"`).
- Fail-closed: returns `{ block: true }` on pi `tool_call` event. Requires extension `priority <= 100`.

## Inspection Endpoint
- `GET /api/chat-gateway/bindings`: active when configured and running (404 otherwise).
- Guarded by `networkGuard`; never returns pairing code.
- Returns `bindings[]` (`platform`, `channelId`, `threadId`, `sessionId`, `cwd`, `boundBy`, `source`, `createdAt`) + `status` (`running`, `boundChannels`, `pendingSpawns`).

## Team Controls
- Multi-user governance under L1 allowlist / L2 admins; optional to `createChatGateway`.
- Implemented: tier model, chokepoint, workspace scoping, bound-workspace attach confinement, outbound filter/pacer, audit log (`command-log.json`), channel provisioning (`channels.json`), binding store (`bindings.json`), durable disarm latch (`disarm.json`), per-thread mirror levels, dashboard config surface (tasks 8.x), L3 Playwright specs (10g.1–10g.6; 10g.7 at L1). Remaining: manual test guild QA (9.6, 10h.1, 10h.2).
- Tier ladder: `observe` < `control` < `operate`.
- Verb tiers read from `GENERATED_TOOLS`; allowed chat verbs restricted to `CHAT_COMMAND_ALLOWLIST` (includes `disarm`).
- Chat-local verbs declare tier in `CHAT_LOCAL_VERB_TIERS` (`disarm` -> `observe`).
- `NON_DELEGABLE` verbs (`mint_device_token`, `set_providers`, `install_package`, `tunnel_connect`) refused across all tiers.
- Global ceiling defaults to `observe`; `clampTier` caps, never raises.
- Resolution: explicit ID outranks role; roles cap at `control`; `operate` requires explicit ID.
- Single chokepoint: `team.authorizeRequest(...)` → `Grant | Refusal`; `dispatchToSession` requires Grant.
- Nine refusal reasons: `non_human_author`, `unbound_channel`, `no_principal_mapping`, `scope_violation`, `disarmed`, `non_delegable_verb`, `verb_not_allowlisted`, `verb_unknown_tier`, `insufficient_tier`.
- Direct messages enrollment-only: DM cannot carry workspace binding; `unbound_channel` in DM directs author to bound channel; other refusal reasons report verbatim.
- Interactive prompts: `>= control` required; invoker-only if principal initiated turn.
- Workspace scoping: binding only narrows `allowedRoots`; outside folders inert; interactive attach confines to bound workspace folders; free-text cwd never resolves; `scope_violation` inside chokepoint.
- Host trust failure: no-op from host trust-gated verb marks layer unhealthy, refuses commands; sticky.
- Outbound filtering: mirror levels `names-only` (default), `names-and-diffs`, `full-transcript`. Structured payloads only; assistant prose mirrors verbatim (`FILTER_BOUNDARY_NOTE`). Raising level forward-only; truncation adds `… [elided N characters]`.
- Outbound pacing: 5 msgs / 5 s per channel (`RATE_WINDOW_MS = 5000`, `RATE_MAX_POSTS = 5`); 1 in-flight per thread; coalesces excess. Mirroring independent of disarm/tier.
- Disarm command: `!disarm` whole message (`/^\s*!\s*disarm\s*$/i`); conversational instructions with steer prefix (`!`) ignored; `>= observe` can disarm; passive mirroring continues.
- Disarm latch: global across layer (never per-binding; prevents failing open); survives restart via `disarm.json` (0600, atomic rename); boot seeds from file, falls back to config only if unpersisted; re-arm dashboard-only; single `setDisarmed` writer.
- Lifecycle: workspace deletion deactivates binding; channel deletion drops binding, keeps sessions.
- Provisioned channel: gateway serves the channel IT provisions per `teamControls.bindings.<workspaceId>` (`channels.json`), not pre-existing; created top-level (no category), named after workspace (e.g. `#pi-dashboard`); add new channel id to `groupChannels` (L4), else messages ignored.
- Provisioned channel carries bot-self member allow (`DiscordChannelOps.selfId()`, `BOT_SELF_ALLOW`); without it `@everyone` VIEW deny locks bot out (403 `Missing Access` 50001). Channels provisioned before fix need one-time bot overwrite.
- Command log: append-only ring buffer in `command-log.json` (0600) bounded by `auditRetention` (default 10000, max 1000000); synchronous rewrite for durability.
- Command log validation/error: `isEntry` drops entries missing valid `outcome` on load; write errors report via `onPersistFailure` to `/api/health.plugins[]` instead of throwing.

## Configuration Reference
- `enabled` (boolean, default true), `token` (string, writeOnly), `allowedRoots` (string[], default []), `fixedMap` (object), `defaultCwd` (string).
- `allowlist` (string[]), `admins` (string[]), `groupChannels` (string[]), `threadPerConversation` (boolean, default true; settings checkbox `chat-gateway-thread-per-conversation`), `mirrorDashboardSessions` (boolean, default false; settings checkbox `chat-gateway-mirror-dashboard-sessions`; team-controls only), `sessionVisibility` (enum `hidden`|`shown`, default `hidden`; settings select `chat-gateway-session-visibility`), `steerPrefix` (string, default `!`), `editThrottleMs` (number, default 1000).
- `toolPolicy` (`allow`, `approval`, `defaultAction: "deny"`), `guardExtension` (string).
- `teamControls`: `ceiling` (enum, default `observe`), `disarmed` (boolean, default false), `auditRetention` (integer, default 10000, max 1000000).
- `teamControls.bindings.<id>`: `principals` (map ID → tier), `roles` (map role ID → tier <= control), `mirrorLevel` (enum, default `names-only`), `ceiling` (enum).
- History: `See change: add-chat-gateway, add-chat-gateway-team-controls, fix-chat-gateway-bot-self-overwrite, fix-chat-gateway-spawn-correlation, hide-chat-gateway-sessions, chat-gateway-thread-per-conversation, chat-gateway-attach-dashboard-sessions, fix-plugin-config-partial-write, chat-gateway-close-command`.
