## Why

The Discord chat gateway serves exactly one server. Its inbound filter is a flat, guild-agnostic channel list (`groupChannels`), its admins and allowlist are global, and provisioning targets one `teamControls.guildId`. An operator who invites the same bot into several servers can't tell them apart. They can't keep one server request-only while another drives sessions, and they can't give each server its own admins or tiers. A bot added to a new server also has no visible state: the operator can't see that it's there or why it's silent.

This change is the base of a four-change stack (A `chat-gateway-multi-guild` → B `chat-gateway-query-mode`, C `chat-gateway-agent-tools`, D `chat-gateway-discord-moderation`). It introduces the per-server record, the per-server `mode` field and the server-scoped authorization rules. The later changes build on these. `query`-mode behaviour itself is B's.

## What Changes

- **One bot, many servers.** One token and one discord.js client still serve every guild the bot is a member of. Adding more tokens is out of scope. Every inbound message and interaction carries its `guildId`.
- **Per-server record** `guilds.<guildId>`: `enabled`, `mode` (`interactive` | `query`), `label`, `admins`, optional `allowlist`, `channels` (L4 opt-in), server-scoped `principals` / `roles` / `ceiling`, `provisioning.enabled`. There is no global mode default. An absent `mode` means `query`.
- **Discovery.** Servers the bot is in but the operator has not configured are auto-listed in settings with their live name. They are shown as `query` and stay **inert**: no inbound handling and no outbound.
- **Drop rule.** A message or interaction from a guild that is not configured **and** enabled is dropped silently. This holds even when its channel id appears in some channel list. A channel counts only on the record of the guild it belongs to.
- **Outbound gate.** Nothing is sent to a channel in a non-enabled guild. Mirroring, threads and provisioning happen only in `interactive` servers.
- **`query` servers in this change** refuse every interactive action (spawn, resume, attach, `send_prompt`, abort, thread, mirror, provision). After the L1/L4 checks, a whole-message `!` command, except `!disarm`, gets the reply `Refused: query_mode.` Plain text gets no reply, and a user who is not allowlisted gets none either. Refusal replies in a guild are throttled by a setting (`limits.refusalRepliesPerMinute`, `0` = unlimited). The read commands arrive in B.
- **Per-server admins** replace the global `admins` for that server's L2 bind authority. A per-server `allowlist` replaces the global allowlist for that server when present. Otherwise the global allowlist (DM pairing) applies.
- **Per-server tiers.** The server-scoped `principals` / `roles` grant tiers only to requests that have no workspace binding (B's verbs). They never widen a binding. A server's `ceiling` may only lower `teamControls.ceiling`. The global ceiling still caps everything.
- **Per-server provisioning.** `teamControls.bindings.<ws>.guildId` names the server for each binding. A binding provisions only into an enabled `interactive` server with `provisioning.enabled`. This replaces `teamControls.guildId`. Reconcile is per binding (a disabled server never blocks another server's binding) and a provisioned channel never silently changes server.
- **Per-server disarm.** `!disarm` halts only the server it was sent from, works in both modes, and is open to anyone `observe`+ there (emergency brake). The dashboard keeps a global disarm-all and is the only way to re-arm, one server (`rearm`) or all (`rearm_all`); a team-controls save never clears a server latch. Latches persist per server in `disarm.json`. The shipped global latch file is migrated as the global latch, so nothing is silently re-armed.
- **Live write lane.** Guild config is written through a validated browser-handler lane (`chat_gateway_guilds_config`) as record-level patches with a required `expectedRevision` (`revision_required` when absent, `revision_changed` on a stale tab; top-level keys replace, an explicit `clear` removes optional keys), serialized with the team-controls lane, and applied without a restart. Writes are judged on what they change, enabling a server requires an explicit allowlist choice, and chat-origin writes use a narrowed writer (origin server, `mode`/`channels` only, server admins only). Prompt-button answers are scoped to the server that rendered them. The adapter reads its inbound scope through a getter.
- **Migration.** When no guild record exists and a legacy key is non-empty (`groupChannels`, `admins`, `teamControls.guildId`), they are normalized at read time into synthesized `legacy` records. The resulting behaviour matches today's, and an unrelated save cannot disable it (no schema default on `guilds`/`limits`). The first guild write adopts them (refused while a legacy channel id is unresolved unless the operator discards it): it writes `guilds` and the per-binding `guildId`, and clears the legacy keys so that a rolled-back older version fails closed rather than open.
- **Limits are settings.** A new `limits` object (`maxGuilds`, `maxBindings`, `maxMappings`, `maxDiscoveredGuilds`, `maxReservedBytes`, `refusalRepliesPerMinute`, `legacyResolveTimeoutMs`, `pairingTtlMinutes`, `pairingMaxAttempts`) replaces the hardcoded `MAX_BINDINGS`, `MAX_MAPPINGS_PER_BINDING` and the pairing TTL/attempt constants (A edits the pairing requirement and `auth.ts`) and bounds the new surfaces. `MAX_BINDINGS` and `MAX_MAPPINGS_PER_BINDING` keep their current values as defaults. `maxGuilds` defaults to `0`: unlimited. One convention applies everywhere: **`0` = unlimited**.
- **Rollback-safe records.** The guild-record validator accepts and preserves the keys reserved for later changes (`query`, `index`, `moderation`) without interpreting them, so rolling back from B, C or D to A keeps every server loadable. They are cloned, size-bounded and prototype-checked.
- **Session bindings know their server.** The persisted `Binding` gains an optional `guildId` (older versions ignore it; pre-upgrade bindings are back-filled lazily and fail closed until resolved). Pending prompts of a server that stops being interactive are cleaned up locally (the dashboard can still answer), and auto-mirror is re-evaluated when a server becomes interactive again.
- **Settings UI.** `ChatGatewaySettings` gains a per-server list (Servers group). The binding row in the team-controls panel gains a server selector. The legacy admins and channels fields move into the per-server rows.
- **Audit.** Command-log entries carry `guildId`.

## Capabilities

### New Capabilities
- `chat-gateway-guilds`: per-server record, discovery, drop and outbound rules, per-server mode field and the `query` refusal boundary, per-server admins and allowlist, per-server disarm state and its migration, legacy normalization and adoption, server list in settings, `limits` with the `0` = unlimited convention.

### Modified Capabilities
- `chat-gateway`: the adapter serves several servers over one connection; layered authorization resolves L1, L2 and L4 per server; the configuration surface lists servers; `!sessions`, `!attach`, `!close`, thread-per-conversation and auto-mirror apply only in `interactive` servers.
- `chat-gateway-tier-authorization`: server-scoped tier mapping for server-scoped verbs that never widens a binding (disarm alone takes the higher of binding and server tier); the server ceiling may only lower the global ceiling; the disarm switch becomes per server.
- `chat-gateway-workspace-binding`: a channel is provisioned in its binding's server, and only when that server is enabled, `interactive` and provisioning-enabled; a write that changes the access mapping of an active provisioned channel in a server that is not is refused `access_unreconciled` (decided, A-T7).
- `chat-gateway-audit`: entries record the server.
- `chat-gateway-output-filter`: mirroring only into enabled `interactive` servers.

## Discipline Skills

- `security-hardening`: the trust boundary moves from "channel" to "server + channel". The drop rule must be fail-closed. Each server's admins and tiers must not leak across servers, and adoption must not widen access on rollback.
- `doubt-driven-review`: the legacy-key migration and adoption write are irreversible config rewrites, and rollback behaviour is part of the contract. The `disarm.json` shape change must stay fail-closed for legacy files and older versions.
- `observability-instrumentation`: a new write lane and discovery events need to be visible. There are counters for dropped messages per reason, and health reports provisioning failures per guild.
- `review-code`: before commit.

## Impact

- Code: `packages/chat-gateway` only: `src/configSchema.json`, `src/shared/types.ts`, `src/server/config.ts`, a new `src/server/guilds.ts`, `src/server/auth.ts`, `src/server/gateway.ts`, `src/server/routing.ts`, `src/server/index.ts`, `src/server/team/{team-config,provisioner,provisioning-store,authorize,controller,disarm-store,audit,surface}.ts`, `src/adapters/{base,discord,fake}.ts`, `src/client/{ChatGatewaySettings,team-controls-panel}.tsx`. No core, bridge or protocol change. The manifest `priority` stays at 100.
- Docs: `docs/chat-gateway.md` (via DocScribe) and the `packages/chat-gateway/**/AGENTS.md` rows.
- Compatibility: an existing single-server install keeps working with no config edit, through read-time normalization. Discord permissions and intents are unchanged.
- Rollback: older versions ignore `guilds` and `limits`. After adoption the legacy keys are cleared, so an older version is inert in every guild until the operator re-adds `groupChannels`, `admins` and `teamControls.guildId`. DM pairing and existing provisioned channels are unaffected. A live per-server disarm makes an older version halt every server (fail-closed). See design.md, Rollback and D10.
- Cross-change: B, C and D depend on this change's names. There is no requirement overlap with `add-supervised-tool-approval`, which only modifies "Interactive prompts rendered natively via PromptBus", or with `add-web-chat-plugin`, a separate plugin whose design rejected a chat-gateway adapter.
