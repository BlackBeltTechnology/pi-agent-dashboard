# Chat Gateway — Explore-Mode Design Record

> Status: **exploration only** (no OpenSpec change, no implementation). Captures the
> investigation into connecting pi to chat platforms (Discord/Slack/Telegram/…) via a
> generalized chat-gateway, and the resolved architecture. Seeds a future
> `openspec/changes/chat-gateway/` proposal + design.md.
>
> Date: 2026-07. Mode: openspec-explore. All claims below are grounded in fetched
> source (npm registry, gamalan/pi-gateway @ main, NousResearch Hermes, and this
> repo's `packages/`), not speculation.

---

## 1. Goal

Survey the pi ecosystem's chat integrations, decide whether a *general* chat-gateway
API is warranted (vs one-off bridges), and — if so — determine the right architecture
for **this repo** (pi-agent-dashboard), considering NousResearch's Hermes as an
adaptable reference.

## 2. Landscape — 41 pi chat-related packages, 5 families

Pulled from the npm registry (search across discord/slack/telegram/whatsapp/matrix/
gateway/relay/intercom terms, filtered to pi-relevant). Five architectural families:

```
1. IN-SESSION EXTENSION BRIDGE          2. STANDALONE SDK BOT
   (pi.on + sendUserMessage)               (createAgentSession, own loop)
   pi-messenger-bridge ★  (5 platforms)    pi-slack-bot
   pi-matrix-bridge                        pi-telegram-service
   @arvoretech/pi-slack-*                  @mariozechner/pi-mom
   @artyomspace/pi-telegram-connect        arisa
   @gamalan/pi-gateway ★  (6 platforms)  one pi session ↔ one chat (extension)
                                          bot owns N sessions, 1 per thread (SDK)

3. RELAY-SERVER MODEL                    4. INTER-AGENT (not human chat — orthogonal)
   pi-chaos-relay (TG + email)             pi-intercom, pi-messenger, pi-messenger-swarm

5. NOTIFY-ONLY (one-way)
   @wienerberliner/pi-telegram, discord-presence, @artale/pi-notify

★ = already multi-platform generalized
```

**Two packages already generalize** chat across platforms:

| Package | Shape | Abstraction | Streaming | ask_user | Sessions |
|---|---|---|---|---|---|
| pi-messenger-bridge (tintinweb) | extension, 5 platforms | `ITransportProvider` (5 methods) | final-only | ✗ | single pending pointer |
| **@gamalan/pi-gateway** | extension + rpc subprocess + daemon, 6 platforms | `PlatformAdapter` (11 methods) | ✅ text_delta→editMessage | ✅ inline keyboards | ✅ SQLite per-chat |

Convergence signal: pi-messenger-bridge, gamalan, and Hermes independently landed on the
**same adapter shape** — strong evidence a canonical adapter interface is the right
abstraction.

## 3. Reference deep-dives

### 3.1 @gamalan/pi-gateway (MIT, itself a fork of 0xKobold/pi-gateway)

- Lean deps (`better-sqlite3`, `ws`), active (22 versions in 3 days), `>= pi 0.80.3`.
- **Clean, Hermes-style adapter contract** (`src/adapters/base.ts`): `PlatformAdapter`
  with `connect/send/editMessage/setTyping/sendInteractive` + `AdapterCallbacks`
  (`onMessage/onInteractiveResponse/…`). Zero pi coupling in the adapter layer — it talks
  to the hub only through callbacks. **This is the crown jewel.**
- **But `src/index.ts` is a 2,323-line self-contained parallel hub**: spawns its OWN
  `pi --mode rpc` subprocess, runs its OWN HTTP+WS daemon, OWN SQLite session store, OWN
  cron/config-watcher. All of that **duplicates what pi-agent-dashboard already is.**
- **`ask-user` bridge is rpc-mode-only** (`extensions/pi-gateway-ask-user-rpc.ts`):
  intercepts `ask_user_question` only when `ctx.mode==="rpc"` in a gateway-spawned pi.
  Does not transplant to dashboard sessions.
- **Security weakness:** `security/tool-policy.ts` enforces tool limits by **prompt
  injection** (`buildPolicyGuard()` prepends a "DO NOT call blocked tools" directive).
  Advisory only — jailbreakable. Insufficient for a coding agent that can run `bash`.

### 3.2 NousResearch Hermes

- Mature multi-platform gateway: `BasePlatformAdapter` ABC + ~20 platform adapters +
  `platform_registry.py` plugin system + normalized `MessageEvent`/`SessionSource`
  schema + deterministic `build_session_key(platform, chat_id, user_id, thread_id,
  scope_id, profile)` + freshness-window session resume + an experimental cross-language
  relay/connector WS contract.
- **Transferable to pi:** normalized message schema, adapter interface, session-key
  derivation, plugin-registration hooks, `chat_type ∈ {dm,group,channel,thread}`.
- **Not transferable:** their LLM loop, Honcho user-modeling, self-improvement,
  scale-to-zero, multi-tenant trust model. pi has its own agent runtime.

### 3.3 pi substrate this repo already ships

- **RPC** (`docs/rpc.md`): `prompt`/`steer`/`follow_up`/`abort`, JSONL events.
- **PromptBus** (`packages/extension/src/prompt-bus.ts`): a **multi-adapter,
  first-response-wins prompt router** with a `PromptAdapter` interface
  (`onRequest→PromptClaim | onResponse | onCancel`). Already ships TUI + dashboard
  adapters. Cross-surface dismissal built in.
- **Browser protocol** (`packages/shared/src/browser-protocol.ts`): `subscribe`,
  `send_prompt`, `abort`, `prompt_response` (browser→server); `event`/`event_replay`,
  `prompt_request`/`prompt_dismiss`/`prompt_cancel` (server→browser).
- **Server** (`packages/server/src/browser-gateway.ts`, `browser-handlers/
  subscription-handler.ts`, `event-wiring.ts`): fans `prompt_request` to **all**
  subscribers (`sendToSubscribers`), accepts `prompt_response` from **any** subscriber,
  replays pending prompts to late/reconnecting subscribers.
- **REST** (`api-reference.md`): `POST /api/session/spawn {cwd}` (async — returns a
  message, not the id; new session self-registers by cwd), `POST /:id/resume
  {continue|fork}`, `GET /api/sessions` (live registry with cwd/status/source),
  `POST /:id/prompt` (502 if bridge disconnected), `/:id/rename`, `/:id/abort`.

## 4. Central verdict — extract, don't wrap or fork

`@gamalan/pi-gateway` is a **parallel hub** that reimplements what the dashboard already
is. So it is neither "wrap" nor "fork":

```
gamalan index.ts (2323 lines)              pi-agent-dashboard (already ships)
  spawns its OWN pi --mode rpc      ═╗
  runs OWN HTTP+WS daemon            ║  ⟶  Bridge in every session + Dashboard Server
  OWN SQLite session store           ║  ⟶  dual WebSocket + session registry
  OWN cron/config-watch             ═╝  ⟶  REST prompt/abort/spawn/branch
        ↑ ALL REDUNDANT                        ↑ you already run this
```

| Option | Verdict |
|---|---|
| Wrap (npm dep, run as-is) | ❌ Second competing hub; chat sessions invisible to dashboard |
| Fork wholesale | ❌ Inherit 63 KB of hub logic the dashboard already does better |
| **Adopt adapters, reuse dashboard hub** | ✅ **Recommended** |

**Reusable (pi-agnostic, MIT, ~40 KB):** `adapters/*` (base + 6 platforms),
`interactive.ts`, the `PlatformMessage`/`InteractivePrompt` schema, `security/*`.
**Discard:** `index.ts` hub, spawned rpc, daemon, SQLite, the rpc-mode ask-user hack.

Prefer **vendoring** the adapter subset (MIT + attribution) over an npm dependency —
the package is 3 days old, 22 versions, 3 stars, single maintainer, fork-of-a-fork.

## 5. Resolved architecture — the chat gateway is a *headless dashboard client*

Verified: the dashboard server broadcasts prompt requests to all session subscribers and
accepts responses from any. So a chat adapter is just a second subscriber — a "browser"
that speaks Telegram/Slack/Discord instead of React. **No bridge or server protocol
changes required.**

```
 Telegram/Slack/Discord ─▶ [gamalan adapters, vendored MIT] ─┐ send_prompt
                                                             ▼
   ┌──────────── CHAT GATEWAY (headless browser-protocol client) ─────────────┐
   │  channel/thread ⇄ sessionId routing · cwd-binding resolver · auth/policy  │
   └──────────────────────────────┬───────────────────────────────────────────┘
      subscribe / send_prompt /    │  event / prompt_request / prompt_dismiss
      prompt_response / abort       ▼
                       Dashboard Server (UNCHANGED)
                        • sendToSubscribers fan-out   • PromptBus relay
                        • session registry + spawn     • pending-prompt replay
                                      ▲
                       event / prompt_request │ prompt_response
                                      ▼
                       Bridge + PromptBus (in each pi session, UNCHANGED)
```

Exact browser-protocol vocabulary the gateway speaks:

```
INBOUND (chat→agent)                    OUTBOUND (agent→chat)
subscribe {sessionId, lastSeq?}    ◀──  event / event_replay
send_prompt {sessionId, text,             → text_delta,tool_*,message_end
  images?, delivery:steer|followUp}       → adapter.sendMessage / editMessage
abort {sessionId}                  ◀──  prompt_request {promptId, prompt{question,
prompt_response {sessionId,               type,options,metadata}}
  promptId, answer?, cancelled?,          → adapter.sendInteractive (inline keyboard)
  source, images?}                 ◀──  prompt_dismiss / prompt_cancel {promptId}
                                          → adapter.cleanupInteractive
```

## 6. Interactive (ask_user) — the "hard 20%" is essentially free

Because PromptBus already does multi-surface fan-out + first-response-wins + dismissal,
and `prompt_request`/`prompt_response` is already a normalized, WS-relayed protocol:

- pi's `ask_user` already fans out to the gateway (as a subscriber).
- First-response-wins dismisses the web card AND the chat keyboard together.
- Reconnect-replay covers a gateway that drops and rejoins.
- gamalan's rpc-mode ask-user hack is **discarded** — use the dashboard-native path.

`InteractivePrompt.method` ↔ `PromptRequest.type` map 1:1 for `select/confirm/input/
editor`; `multiselect`/`batch` need a thin composition shim in the adapter layer.

## 7. Session routing — bridges two identity spaces

```
CHAT IDENTITY                          DASHBOARD IDENTITY
(platform, channelId, userId,  ─map─▶  sessionId (server-assigned) + cwd (a PROJECT)
 threadId)                             ← the coding-agent-specific crux
```

Gateway owns a routing table: `(platform, channelId, threadId?) → {sessionId, cwd,
boundBy, policy}`. State machine: lookup → spawn / attach / resume(continue) / handle
502. Session-boundary granularity (adopt Hermes' `chat_type`+`thread_id`):

| Platform shape | Boundary |
|---|---|
| Telegram DM/group | per-channelId |
| Slack/Discord thread | per-threadId |
| Discord channel (no thread) | per-channelId |

Spawn-correlation wrinkle: `POST /spawn` is async and does not return the sessionId —
the gateway must watch for the new `session_register` matching cwd+recency (same pattern
as the dashboard's auto-resume).

## 8. cwd-binding — RESOLVED (the coding-agent-specific problem)

A chat message has no project; a pi session needs a cwd. Reframed as a **resolver with a
precedence chain over binding sources, gated by an `allowedRoots` whitelist** — not three
competing "modes".

```
resolve_cwd(platform, channelId, threadId?):
  1. persisted binding for this channel/thread   → use it (STICKY)
  2. fixed config map        (source c)          → bind + persist
  3. defaultCwd              (source d)          → bind + persist
  4. interactive bind        (sources a, b)      → prompt, then persist
  INVARIANT: result ∈ allowedRoots[]  — else reject. No exceptions.

BINDING SOURCES (all four in v1):
  (a) attach to an existing dashboard session  ← GET /api/sessions, pick a live one  ★ unique
  (b) spawn fresh in an allowedRoot
  (c) fixed channel→cwd map (config)            ← team default
  (d) defaultCwd                                ← single-workspace fallback
```

Decisions taken:
- **Target = both** personal (phone remote for my machine) and team (workspace→projects).
- **`allowedRoots` = mandatory security boundary** — every source resolves *into* it.
- **attach-to-existing-session included in v1** — the differentiating feature; reuses the
  dashboard's live session registry (no other pi chat package can do this: the phone
  becomes a remote for a session already open in your terminal).
- **Sticky** — one cwd per channel/thread; new thread = new binding. (`/rebind` later.)

Personal vs team differ only in *which sources dominate* + *how heavy L2 binding-auth is* —
not in architecture. "Both" costs the fixed-map parser + the L2 admin gate on top of the
personal path; no rearchitecture.

## 9. Auth — 4 layers (heavier than any generic bot, because code executes)

```
L1  IDENTITY     chat userId → known operator?      (gamalan pairing codes / allowlist)
L2  BINDING      who may bind a channel → a cwd?     PRIVILEGED (grants code-exec).
                                                     Admin-only for team; trivial for
                                                     single-owner personal.
L3  TOOL POLICY  which tools may a chat turn use?    ← see §10 (enforced at bridge)
L4  ISOLATION    shared group = shared cwd+context?  DM isolated; group opt-in.
```

## 10. L3 tool enforcement — RESOLVED

- **Only real enforcement point:** an in-session `tool_call` interceptor
  (`pi.on("tool_call") → {block:true}`) — documented in `extensions.md` *as a permission
  gate*. gamalan's prompt-guard is advisory-only and must be **replaced with hard
  `{block:true}` enforcement** for a coding agent.
- **Where:** a companion **tool-guard extension** loaded into gateway-SPAWNED sessions
  (not the core bridge — keeps chat concerns separate).
- **Policy model:** reuse gamalan's `ToolPolicy` shape (allow/deny, deny-first, per-user/
  platform, secure-baseline defaults) — enforced hard.
- **Escalation:** tool ∉ hard allow/deny → `ctx.ui.confirm(...)` → PromptBus → chat
  renders "Allow bash `…`? yes/no". Reuses the validated interactive path; the chat user
  becomes the permission gate (pi-chaos-relay's approvalMode, done natively).
- **Trust boundary aligns with binding source:**
  - SPAWNED sessions (b/c/d) → load the tool-guard → hard enforcement + chat approval.
  - ATTACHED sessions (a) → your own already-open session → owner-trusted, no guard.
  (You can't retrofit an interceptor into a running session anyway — and don't need to.)
- **Deferred to v2:** per-turn origin policy for shared group channels (different users,
  different rights). v1 = per-session/per-channel policy.

## 11. New vs reused (net build surface)

| Concern | Source |
|---|---|
| Headless browser-protocol WS client | **NEW** (≈ the React client transport, minus React) |
| Platform transport adapters | **REUSE** gamalan `adapters/*` (vendored, MIT) |
| Streaming, interactive, race-handling, reconnect-replay | **REUSE** existing PromptBus + browser protocol |
| Routing table + spawn-correlation | **NEW** |
| cwd-binding resolver + `allowedRoots` | **NEW** (the coding-agent-specific problem) |
| attach-to-existing-session | **REUSE** `GET /api/sessions` |
| Session granularity (`chat_type`+`thread_id`) | **ADAPT** Hermes |
| idle/daily reset, background sessions | **ADAPT** gamalan store concepts |
| L1 allowlist + pairing, L3 policy shape | **REUSE** gamalan `security/` |
| L3 tool enforcement (hard) | **NEW placement** — companion tool-guard extension |
| `multiselect`/`batch` chat shim | **NEW** (thin) |

## 12. Open questions / deferrals

- **v2:** per-turn origin tool policy (shared group channels); `/rebind` / `/project`
  switchable cwd; background-task sessions (spawn detached, deliver on `agent_end`);
  interactive channel-binding UX for team self-service.
- **Confirm before spec:** vendoring vs npm-dependency mechanics + attribution; exact
  persistence for the sticky binding store (JSON under `~/.pi/dashboard/` vs SQLite).
- **Discipline skills** the future proposal should name (per repo convention):
  `security-hardening` (L1–L4, allowedRoots, tool enforcement) at minimum; likely
  `observability-instrumentation` (per-channel session activity) too.

## 13. Suggested next steps

1. `openspec-new-change chat-gateway` → seed `design.md` from §5–§10 here.
2. proposal.md: scope = personal + team v1; sources (a)(b)(c)(d); sticky; `allowedRoots`;
   4-layer auth; hard L3 via companion extension. Name `security-hardening` discipline.
3. Prototype spike: the headless browser-protocol client subscribing to one live session +
   one vendored adapter (Telegram) rendering `event` + `prompt_request` → validate the
   "headless dashboard client" model end-to-end before committing to all platforms.
