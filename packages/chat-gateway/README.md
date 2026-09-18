# @blackbelt-technology/pi-dashboard-chat-gateway-plugin

Dashboard plugin that drives dashboard pi sessions from a chat platform —
**Discord ships first**, behind a pluggable `PlatformAdapter` contract
(vendored MIT `base.ts`; see `NOTICE`).

Headless browser-protocol client: it consumes the same session frames the React
client does (an in-process `subscribeSession` seam) and speaks the existing
`send_prompt` / `prompt_response` / `spawnSession` control lane, so **no bridge
or server protocol changes**.

- **Settings section** (`settings-section` → `ChatGatewaySettings`) — bot token
  (write-only), mandatory `allowedRoots` whitelist, fixed `channelKey → cwd`
  map, default cwd, L1 allowlist, L2 admins, L4 group-channel opt-in, steer
  prefix, plus a read-only bindings view.
- **Inbound** — allowlisted message → bind (admin-only) / attach / resume / spawn
  → `send_prompt`; a `!`-prefixed message forces `delivery: steer`.
- **Outbound** — assistant deltas edit ONE Discord message in place (throttled),
  chunking past 2000 chars into a new message; `prompt_request` renders native
  Discord controls, with `multiselect`/`batch` sequenced into sub-prompts.
- **L3 tool guard** — a companion `tool_call` extension (exported at
  `./guard`) loaded into gateway-**spawned** sessions; deny-first, fail-closed.

Security posture: **inert** until a token is set (no adapter, no socket, no
timer). Every spawn cwd passes a real-path `allowedRoots` containment boundary,
including on resume. Binding is admin-gated; interactive clicks are
re-authorized; the bot token is `writeOnly` and never logged or returned.

Setup: [`docs/chat-gateway.md`](../../docs/chat-gateway.md).
See change: `add-chat-gateway`.
