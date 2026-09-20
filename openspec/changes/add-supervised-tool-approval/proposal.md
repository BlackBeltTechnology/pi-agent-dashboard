# Add supervised mode (dashboard tool-approval gate)

## Why

The dashboard runs every pi session in **full access** — pi executes `bash`, `write`, and
`edit` immediately, with no per-action approval. This is pi's deliberate default: pi ships
**no built-in permission popups** (`README.md:503` — *"No permission popups. Run in a
container, or build your own confirmation flow with extensions"*) and **no built-in
sandbox** (`docs/security.md:33`). Confirmation is something the host is expected to build.

> Citations in this change were re-verified against `@earendil-works/pi-coding-agent@0.85.1`.

t3code offers a **Supervised** runtime mode: a global toggle that switches a session to
approval-on-request, prompting in-app before each command/file action. Users who run
untrusted prompts, review-as-you-go, or drive a session from a phone want the same "let me
approve risky actions" control in this dashboard — without dropping to a container.

**A spike (captured in `design.md`) confirms this is buildable entirely on infrastructure
we already ship.** Verified enabling facts (current code):

- pi exposes a **`tool_call` event that fires before a tool executes and can block it**
  (`node_modules/@earendil-works/pi-coding-agent/docs/extensions.md:778-792`): a handler
  returning `{ block: true, reason?: string, terminate?: boolean }` cancels the tool. The
  pipeline diagram annotates it `tool_call (can block)` (`extensions.md:304`).
- `isToolCallEventType("bash", event)` narrows the hook to specific tools with typed args
  (`extensions.md:780`), so the gate can target `bash`/`write`/`edit` and let read-only
  tools (`read`, `grep`, …) pass untouched.
- `ctx.ui.confirm(...)` works in **RPC mode** (`hasUI` is `true` in TUI *and* RPC —
  `extensions.md:972`) and **already renders in this dashboard today**: the bridge patches
  `ctx.ui.confirm` onto PromptBus (`packages/extension/src/bridge.ts:2870`) and
  `ask-user-tool.ts:438` calls it, routed to the web client's interactive renderer.
- The approve/deny round-trip therefore needs **no new session protocol** — it reuses the
  existing `prompt_request` → `prompt_response` PromptBus path that already powers
  `ask_user` and `multiselect`.
- **The interceptor itself is already shipped.** `packages/chat-gateway/src/guard/`
  (`createToolCallGuard` + the pure `decideToolCall` policy engine, change
  `add-chat-gateway`, now archived) implements exactly this loop — `tool_call` →
  `ctx.ui.confirm` → fail-closed timeout → `{ block: true, reason }` — with unit tests and
  injectable timers. This change therefore **extracts and reuses** that primitive rather
  than building a second one.

**Honest scope boundary.** t3code's Supervised mode is two things: approval-on-request
*and* an OS `workspace-write` sandbox. pi has no in-process sandbox by design
(`security.md:31-35` — *"a partial in-process sandbox would be easy to misunderstand as a
security boundary"*). This change delivers the **approval-gating half only**. Real
write-confinement stays delegated to the **Docker/container path** we already ship. The two
compose: Supervised gates human intent; the container confines the blast radius. This
boundary is stated so "Supervised" is never mistaken for a sandbox.

## What Changes

Introduce **supervised mode**: a per-session toggle that gates risky agent tool calls
behind an in-dashboard approve/deny prompt.

- **Shared tool-gate package (extraction first)** — lift `createToolCallGuard` +
  `decideToolCall` out of `packages/chat-gateway/src/guard/` into a surface-agnostic
  workspace package, widen `ToolDefaultAction` with an `"allow"` arm (see below), and
  migrate chat-gateway to consume it. One primitive, two surfaces; the chat-gateway spec's
  deny-first + fail-closed behavior is held by its existing tests, which move unchanged.
  **This is a refactor of shipped security code, not a file move**: the guard today
  hardcodes chat wording, prefixes reasons `chat-gateway:`, and discards `event.input` — so
  it gains an injected presenter + logger (design `D9`).
- **Policy-shape widening (`defaultAction: "allow"`)** — the shipped policy is
  **deny-first**: a tool named by neither `allow` nor `approval` is denied
  (`policy.ts` — *"There is no 'unknown tool' allow path"*). Supervised mode is the
  inverse — **allow-first with a risky set**: unknown tools run, only the risky set
  escalates. Supervised is therefore expressed as
  `{ approval: ["bash","powershell","write","edit","Agent"], defaultAction: "allow" }`.
  Widening the *type* is not enough — the resolution ternary, the config normalizer, and the
  env parser all need coordinated edits or `"allow"` silently resolves to `deny` (design
  `D7`). The new arm is opt-in and is **not** exposed in chat-gateway's config schema, so its
  fail-closed posture is unchanged.
- **Bridge `tool_call` interceptor** — register the shared guard in `packages/extension`
  under the session `supervised` flag, with a human-readable summary of the action
  (command text / target path + diff preview). Approve → let the tool run; deny →
  `{ block: true, reason }`. Non-risky tools and non-supervised sessions raise **no prompt
  and no approval round-trip** (the handler itself still runs — "zero overhead" would be
  inaccurate). The gate is the **third** `tool_call` handler in the bridge and must fail
  closed on its own errors rather than trusting the host (design `D8`). Budget on a
  non-supervised session: **p95 added latency per `tool_call` under 1ms**.
- **Per-session mode toggle** — a Full-access ↔ Supervised control in the session UI. The
  machine default lives in shared config (`~/.pi/dashboard`) and is read at session start; a
  session-scoped control message carries the live toggle. The flag is read **per tool call**,
  so a mid-turn flip affects the next call in that same turn (design `D4`). Approval timeout
  is its own key, `supervised.approvalTimeoutSeconds`, default **120s**.
- **Approval renderer** — reuse the existing interactive-renderer surface with a
  tool-approval variant: show tool name, command/args or file+diff, and Approve / Deny
  (Deny optionally carries a reason back to the agent). First-response-wins and reconnect
  replay come from PromptBus for free.
- **Read-only preset (bonus, optional)** — pi ships `pi.setActiveTools(["read", "bash"])`
  and a `--tools` allowlist (`extensions.md:1677-1693`); a one-click "read-only" preset
  that disables mutating tools is a cheap adjacent affordance.

**Out of scope (follow-ups):**
- OS/filesystem sandboxing (`workspace-write`) — deliberately delegated to the Docker path;
  pi exposes no in-process sandbox to wire.
- Persistent allow-rules ("always allow `npm test`") — v1 prompts per action; a remembered
  allowlist is a follow-up.
- Auto-timeout policy for unanswered approvals beyond the existing PromptBus timeout.

## Capabilities

### Added Capabilities

- `supervised-tool-approval`: a per-session supervised mode that intercepts risky agent
  tool calls via pi's blockable `tool_call` hook and gates them behind an in-dashboard
  approve/deny prompt (reusing the existing PromptBus interactive surface), with a
  configurable risky-tool set and an explicit approval-only scope that leaves OS
  confinement to the container path.

## Impact

- **Additive; default behavior unchanged.** Full access stays the default — a
  non-supervised session behaves exactly as today (the `tool_call` gate is inert unless the
  session is supervised).
- **No session event-protocol change for the approval loop.** Approve/deny rides the
  existing `prompt_request`/`prompt_response` PromptBus path. Enabling the mode may add one
  small session-scoped control signal (dashboard → bridge) to set the `supervised` flag.
- **New code:** a `tool_call` interceptor + risky-tool matcher in `packages/extension`; a
  session mode toggle + a tool-approval interactive renderer variant in `packages/client`;
  optional shared-config default.
- **Refactor of shipped security code.** `add-chat-gateway` is **archived and shipped**;
  its L3 guard lives at `packages/chat-gateway/src/guard/{index,policy}.ts`, is exported as
  the `./guard` subpath of `@blackbelt-technology/pi-dashboard-chat-gateway-plugin`,
  configured via `toolPolicy`/`guardExtension` (`docs/chat-gateway.md`), and is governed by
  the shipped `openspec/specs/chat-gateway/spec.md` requirement *"Hard in-session tool
  policy for spawned sessions"*. Extraction MUST preserve that requirement and keep the
  `./guard` export path working (or migrate its consumers in the same change). Rollback =
  revert the extraction commit; the guard has no persisted state.
- **Handler coexistence (three handlers, first-block-wins).** The bridge already registers
  a `tool_call` pass-through forwarder (`bridge.ts:2563`) **and** a blocking subagent
  fan-out admission gate (`:2602`). Its own comment (`:2579-2585`) records that
  `runner.emitToolCall` returns on the *first* blocking handler, so ordering is
  behaviorally load-bearing. The supervised gate is the third, registered last.
- **Fail-closed is the gate's own job.** `bridge.ts:898-915` wraps every handler in
  `safe()`, which swallows throws and rejections and returns `undefined` — i.e. *allow*.
  Relying on pi's documented throw-is-fail-safe behavior would make the gate fail **open**
  on internal error. The gate catches internally and returns `{ block: true }`.
- **Observability scope correction.** "Who answered" is not obtainable without a protocol
  change this change forbids — `prompt_response.source` is a fixed adapter label
  (`useSessionActions.ts:168`). v1 logs the answering **surface**, not the person.
- **Windows.** `powershell` is a built-in pi tool (`README.md:588`); omitting it from the
  default risky set would leave shell execution ungated on a supported platform.
- **Double-gating.** A gateway-spawned session with supervised on would register two gates;
  the gateway's stricter deny-first policy wins and the supervised gate does not register
  there (design `D12`).
- **Security surface:** Supervised **reduces** risk (adds a human gate) but is **not** a
  sandbox — a denied tool is blocked, but an approved tool runs with full user permissions.
  The UI must not imply OS confinement. Untrusted/unattended work still belongs in the
  container path. Threat model + wording guidance in `design.md`.

## Discipline Skills

- `security-hardening` — the feature *is* a safety control gating code execution; the
  risky-tool set, the deny-path fail-closed semantics, and the "approval ≠ sandbox" wording
  are the core threat-model surface.
- `observability-instrumentation` — every approve/deny decision (tool, args summary,
  outcome, who answered) must be logged so a supervised session's action history is
  auditable and "why did the agent stop" is diagnosable.
- `doubt-driven-review` — extracting a shipped, spec-governed fail-closed security control
  into a shared package and widening its default-action enum is an irreversible-feeling
  refactor of live code; the extraction shape gets stress-tested before it stands.
