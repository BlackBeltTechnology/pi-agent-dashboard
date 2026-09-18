# Add a chat gateway (inbound human↔agent chat over Discord, extensible)

## Why

Humans cannot drive a pi session from a chat app. The dashboard controls sessions from a
browser; there is no way to talk to your agent from Discord/Slack/Telegram. The pi
ecosystem has ~41 one-off bridges (pi-discord-remote, pi-messenger-bridge,
@gamalan/pi-gateway, …) — each re-implements its own hub, session store, and interactive
handling, and none integrate with the dashboard's existing session registry.

The dashboard is already ~80% of a chat gateway: a persistent multi-session hub with a
session registry, a WebSocket event stream, a first-response-wins interactive prompt
router (`PromptBus`), and a REST/WS control surface (`spawn`/`prompt`/`abort`/`resume`).
What is missing is a **platform-adapter layer in front of it** that maps inbound chat
messages to session prompts and streams session output back to chat.

**Not to be confused with `add-connector-layer`** (active). That change is the *outbound*
direction — the agent *calls* third-party APIs (Slack post-message, GitHub create-issue)
as LLM tools. This change is the *inbound* direction — a human *chats to* the agent from a
messaging app. They are orthogonal and share no code; the only overlap is the word
"Slack". Naming here is deliberately `chat-gateway`, not `connector`.

Verified enabling facts (current code):
- The server **broadcasts `prompt_request` to all subscribers** of a session and accepts
  `prompt_response` from **any** subscriber (`browser-gateway.ts` `sendToSubscribers` +
  `case "prompt_response"`; `subscription-handler.ts` fan-out + `replayPendingUiRequests`).
  So a chat adapter can be a *second subscriber* — a headless client — with **no bridge or
  server protocol changes**.
- `PromptBus` (`packages/extension/src/prompt-bus.ts`) already does multi-surface
  fan-out + first-response-wins + cross-surface dismissal. pi's `ask_user` already flows
  through it. A chat surface answering dismisses the web card too, for free.
- `GET /api/sessions` exposes the live session registry (id, cwd, status), enabling a
  chat channel to **attach to a session already open in your terminal** — a capability no
  existing pi chat package has.
- The dashboard already ships a server-side plugin runtime
  (`dashboard-plugin-runtime`), the natural packaging for the gateway + its settings UI.

## What Changes

Introduce a **chat-gateway**: a server-side component that fronts the dashboard as a
*headless browser-protocol client* and speaks chat platforms through a pluggable adapter
layer. **Discord is the only platform shipped in this change**; the adapter interface is
extensible so Slack/Telegram/etc. slot in later without core rework.

- **Platform adapter (Discord)** — a vendored, pi-agnostic transport adapter (derived from
  `@gamalan/pi-gateway`'s MIT `PlatformAdapter`: `connect/sendMessage/editMessage/
  setTyping/sendInteractive` + `onMessage` callback). Only the adapter is platform code;
  the hub is the dashboard. gamalan's own hub (spawned `pi --mode rpc`, HTTP/WS daemon,
  SQLite) is **discarded** as redundant.
- **Headless client seam** — the gateway consumes the same `event`/`prompt_request`/
  `prompt_dismiss` streams the browser consumes, and drives sessions via the existing
  `subscribe`/`send_prompt`/`prompt_response`/`abort` surface. No new protocol.
- **Channel→session routing** — a sticky routing table
  `(platform, channelId, threadId?) → {sessionId, cwd, boundBy, source}`. Session-boundary
  granularity: per-thread where the platform has threads, else per-channel.
- **cwd-binding resolver** — the coding-agent-specific problem (a chat message has no
  project). A precedence resolver over four binding sources — (a) attach to an existing
  dashboard session, (b) spawn in an allowed root, (c) fixed channel→cwd config map,
  (d) default workspace — **gated by a mandatory `allowedRoots` whitelist**. Every binding
  resolves *into* `allowedRoots` or is rejected. Bindings are sticky and persisted.
- **Interactive over chat** — reuse `PromptBus` `prompt_request`/`prompt_response`. The
  Discord adapter renders `select/confirm/input/editor` as buttons/modals;
  `multiselect`/`batch` via a thin composition shim. First-response-wins and reconnect
  replay come from the existing machinery.
- **Auth** — L1 identity allowlist + pairing code (who may talk); L2 binding authority
  (who may bind a channel→cwd — admin-only; grants code-exec); L4 isolation (DMs isolated,
  group channels opt-in).
- **L3 tool enforcement** — a companion in-session `tool_call` interceptor loaded into
  gateway-**spawned** sessions that enforces a deny-first tool policy **hard** via
  `{block:true}` (NOT gamalan's jailbreakable prompt-injection guard). Tools needing
  approval escalate via `ctx.ui.confirm` → PromptBus → a Discord yes/no. Sessions reached
  via *attach-to-existing* (source a) are owner-trusted and ungated by design.
- **Settings surface** — a dashboard-plugin settings panel: Discord bot token,
  `allowedRoots`, fixed channel→cwd map, user allowlist, per-channel bindings view.

**Out of scope (follow-ups):** non-Discord adapters (Slack/Telegram/…); per-turn origin
tool policy for shared group channels (v1 = per-channel policy); switchable `/project`
re-binding (v1 = sticky); background/detached task sessions.

## Capabilities

### Added Capabilities

- `chat-gateway`: an inbound chat control plane that connects messaging platforms
  (Discord in this change) to dashboard sessions as a headless browser-protocol client —
  channel→session routing, an `allowedRoots`-gated cwd-binding resolver, streamed
  input/output, interactive prompts via the existing PromptBus, layered auth, and hard
  in-session tool-policy enforcement — without any bridge or server protocol change.

## Impact

- **Additive, no behavior change when unconfigured.** With no Discord token set, the
  gateway is inert; existing dashboard/bridge/session behavior is untouched.
- **No bridge or server protocol changes.** The gateway is a client of the existing
  browser-protocol (`subscribe`/`send_prompt`/`prompt_response`/`abort` ⟷ `event`/
  `prompt_request`/`prompt_dismiss`). This is the core structural invariant.
- **New code:** a `chat-gateway` dashboard plugin (server component holding the Discord
  connection + the routing/binding/auth logic; a settings panel) + a vendored Discord
  adapter + a companion in-session tool-guard extension. `discord.js` is the only new
  runtime dependency (adapter-local).
- **Vendoring:** the adapter subset is vendored from `@gamalan/pi-gateway` (MIT) with
  attribution, not taken as an npm dependency (upstream is young/churning). gamalan's
  prompt-injection tool guard is explicitly replaced with hard `{block:true}` enforcement.
- **Security surface (significant — code executes):** a chat user can drive a pi session
  that runs code. Controls: `allowedRoots` whitelist (spawn boundary), L1 allowlist +
  pairing, L2 admin-only binding, L3 hard tool policy + chat approval, L4 DM isolation.
  Threat model in `design.md`.
- **Persistence:** the sticky binding store + allowlist live under `~/.pi/dashboard/`
  (JSON, matching existing dashboard state), not a new SQLite DB.

## Discipline Skills

- `security-hardening` — a chat user drives code execution in a real directory. The
  `allowedRoots` spawn boundary, the L1–L4 auth stack, and the hard in-session tool guard
  (with chat approval escalation) are the core safety controls; threat-model them and gate
  every untrusted path (inbound message, binding, tool call).
- `observability-instrumentation` — the gateway spans two boundaries (chat platform ↔
  dashboard sessions); per-channel binding/auth/tool-approval decisions and delivery
  failures must be diagnosable in logs when "my Discord message did nothing".
