# chat-gateway-exploration — index

Explore-mode design record. Status: exploration only, no OpenSpec change, no impl. Seeds future `openspec/changes/chat-gateway/`. Date 2026-07, mode openspec-explore. Claims grounded in fetched source.

## §1 Goal
Survey pi chat integrations. Decide if general chat-gateway API warranted vs one-off bridges. Determine architecture for pi-agent-dashboard. Reference NousResearch Hermes.

## §2 Landscape — 41 pi chat packages, 5 families
Families: (1) in-session extension bridge (`pi.on`+`sendUserMessage`); (2) standalone SDK bot (`createAgentSession`); (3) relay-server; (4) inter-agent (orthogonal); (5) notify-only.
Two already generalize: `pi-messenger-bridge` (tintinweb, 5 platforms, `ITransportProvider`) and `@gamalan/pi-gateway` (extension+rpc+daemon, 6 platforms, `PlatformAdapter`).
Convergence: bridge, gamalan, Hermes all landed same adapter shape → canonical adapter interface is right abstraction.

## §3 Reference deep-dives
- §3.1 `@gamalan/pi-gateway` (MIT, fork of 0xKobold). Clean adapter contract `src/adapters/base.ts` = crown jewel, zero pi coupling. But `src/index.ts` = 2,323-line parallel hub (spawns own `pi --mode rpc`, own HTTP+WS daemon, own SQLite) — duplicates dashboard. ask-user bridge rpc-mode-only. Security weakness: `security/tool-policy.ts` enforces via prompt injection = advisory only, jailbreakable.
- §3.2 NousResearch Hermes. `BasePlatformAdapter` ABC, ~20 adapters, `platform_registry.py`, normalized `MessageEvent`/`SessionSource`, `build_session_key(...)`, freshness-window resume. Transferable: schema, adapter interface, session-key, `chat_type ∈ {dm,group,channel,thread}`. Not transferable: LLM loop, Honcho, multi-tenant.
- §3.3 pi substrate this repo ships: RPC (`docs/rpc.md`), PromptBus (`packages/extension/src/prompt-bus.ts`, multi-adapter first-response-wins), browser protocol (`packages/shared/src/browser-protocol.ts`), server (`browser-gateway.ts`, `sendToSubscribers`), REST (`POST /api/session/spawn`, `/:id/resume`, `/:id/prompt`).

## §4 Central verdict — extract, don't wrap or fork
gamalan = parallel hub reimplementing dashboard. Wrap ❌, fork ❌, **adopt adapters + reuse dashboard hub ✅**. Reusable pi-agnostic MIT ~40KB: `adapters/*`, `interactive.ts`, schema, `security/*`. Discard: `index.ts` hub, rpc, daemon, SQLite, rpc-mode ask-user. Prefer vendoring over npm dep (3 days old, fork-of-fork).

## §5 Resolved architecture — chat gateway = headless dashboard client
Chat adapter = second subscriber ("browser" speaking Telegram/Slack/Discord). No bridge/server protocol changes. Gateway speaks browser-protocol: inbound `subscribe`/`send_prompt`/`abort`/`prompt_response`; outbound `event`/`prompt_request`/`prompt_dismiss`.

## §6 Interactive (ask_user) — free
PromptBus already multi-surface fan-out + first-response-wins + dismissal. `InteractivePrompt.method` ↔ `PromptRequest.type` 1:1 for select/confirm/input/editor; multiselect/batch need thin shim.

## §7 Session routing — bridges two identity spaces
Chat identity `(platform, channelId, userId, threadId)` → dashboard `sessionId + cwd`. Routing table `(platform, channelId, threadId?) → {sessionId, cwd, boundBy, policy}`. Boundary: Telegram per-channelId; Slack/Discord thread per-threadId. Spawn-correlation: `/spawn` async, watch `session_register` by cwd+recency.

## §8 cwd-binding — RESOLVED
`resolve_cwd` precedence: persisted binding → fixed config map → defaultCwd → interactive bind. INVARIANT: result ∈ `allowedRoots[]`. Sources: (a) attach existing session ★unique, (b) spawn fresh, (c) fixed channel→cwd map, (d) defaultCwd. Target = personal + team. Sticky = one cwd per channel/thread.

## §9 Auth — 4 layers
L1 identity (pairing/allowlist), L2 binding (privileged, grants code-exec), L3 tool policy (see §10), L4 isolation (DM isolated, group opt-in).

## §10 L3 tool enforcement — RESOLVED
Only real enforcement: in-session `pi.on("tool_call")→{block:true}`. Replace gamalan prompt-guard with hard block. Placement: companion tool-guard extension in gateway-SPAWNED sessions (not core bridge). Escalation via `ctx.ui.confirm`→PromptBus→chat. Spawned (b/c/d) load guard; attached (a) owner-trusted no guard. v2: per-turn origin policy.

## §11 New vs reused
NEW: headless WS client, routing+spawn-correlation, cwd resolver+allowedRoots, L3 placement, multiselect/batch shim. REUSE: gamalan adapters (vendored MIT), PromptBus, browser protocol, `GET /api/sessions`, gamalan security shapes. ADAPT: Hermes granularity, gamalan store concepts.

## §12 Open questions / deferrals
v2: per-turn origin policy, `/rebind`, background sessions. Confirm: vendoring vs npm mechanics, persistence for sticky binding store. Discipline skills: `security-hardening` min, likely `observability-instrumentation`.

## §13 Next steps
1. `openspec-new-change chat-gateway` seed design.md from §5–§10. 2. proposal.md scope + 4-layer auth. 3. Prototype: headless client + one vendored adapter (Telegram).
