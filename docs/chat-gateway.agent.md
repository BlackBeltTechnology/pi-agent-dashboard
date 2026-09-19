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
- Discord Developer Portal: create application, add Bot, copy token, enable **Message Content Intent**.
- OAuth2 URL Generator: scopes `bot`, `applications.commands`; perms Send Messages, Read Message History, Embed Links; authorize to guild.

## Dashboard Configuration
- Settings → General → Chat Gateway (`ChatGatewaySettings`).
- `token` write-only schema property: redacted from responses, never logged.

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
- Command log: append-only ring buffer in `command-log.json` (0600) bounded by `auditRetention` (default 10000, max 1000000); synchronous rewrite for durability.
- Command log validation/error: `isEntry` drops entries missing valid `outcome` on load; write errors report via `onPersistFailure` to `/api/health.plugins[]` instead of throwing.

## Configuration Reference
- `enabled` (boolean, default true), `token` (string, writeOnly), `allowedRoots` (string[], default []), `fixedMap` (object), `defaultCwd` (string).
- `allowlist` (string[]), `admins` (string[]), `groupChannels` (string[]), `steerPrefix` (string, default `!`), `editThrottleMs` (number, default 1000).
- `toolPolicy` (`allow`, `approval`, `defaultAction: "deny"`), `guardExtension` (string).
- `teamControls`: `ceiling` (enum, default `observe`), `disarmed` (boolean, default false), `auditRetention` (integer, default 10000, max 1000000).
- `teamControls.bindings.<id>`: `principals` (map ID → tier), `roles` (map role ID → tier <= control), `mirrorLevel` (enum, default `names-only`), `ceiling` (enum).
- History: `See change: add-chat-gateway, add-chat-gateway-team-controls`.
