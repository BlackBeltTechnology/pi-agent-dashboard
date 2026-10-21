# Add supervised mode (dashboard tool-approval gate)

## Why

The dashboard runs every pi session in **full access** — pi executes `bash`, `write`, and
`edit` immediately, with no per-action approval. This is pi's deliberate default: pi "does
not ask for approval before every tool call", and safety comes from OS or virtualization
limits, not from the agent (`node_modules/@earendil-works/pi-coding-agent/docs/security.md:3-7`).

> Citations re-verified 2026-10-19 against `@earendil-works/pi-coding-agent@1.3.0` (the
> pinned floor) and current `develop`.

t3code offers a **Supervised** runtime mode that prompts in-app before each command/file
action. Users who run untrusted prompts, review as they go, or drive a session from a phone
want the same control here — without dropping to a container.

**Since this proposal was first drafted, the agent path gate shipped**
(`ask-agent-file-access-in-chat`, `packages/extension/src/path-gate/`). It asks before
`read`/`write`/`edit` leave the session's workspace — and in doing so it proved every rail
supervised mode needs:

- pi's `tool_call` event "can mutate input or block execution" (`docs/extensions.md:106`);
  handlers run in load + registration order and the first block wins (`:98`;
  `dist/core/extensions/runner.js:957-971`).
- `ctx.hasUI` is `true` in RPC mode (`docs/extensions.md:254`, `docs/rpc-extension-ui.md:25`).
- A bridge `tool_call` gate registered outside the error-swallowing `safe()` wrapper, with
  its own try/catch → block (`bridge.ts:1950-1956`, `path-gate/handler.ts:333-337`).
- `PromptBus.requestWithId` + `cancel(id)` so the gate owns one clock and can withdraw a
  card on every surface (`prompt-bus.ts:139-145,230-252`).
- A 120 s timeout key, a Security-tab toggle, an attention flag + toast, all fail-closed
  (`packages/shared/src/config.ts:840-845`, `SettingsPanel.tsx:2613`,
  `server/src/event-wiring.ts:377-390`).
- **The policy engine is shipped too.** `packages/chat-gateway/src/guard/`
  (`createToolCallGuard` + pure `decideToolCall`, archived change `add-chat-gateway`)
  decides allow / approve / deny per tool name.

Supervised mode is therefore **composition and extraction**, not a new mechanism: the path
gate's transport and fail-closed shape + the chat-gateway policy engine, widened to an
allow-first posture.

**Honest scope boundary.** t3code's Supervised is approval-on-request *and* an OS
`workspace-write` sandbox. pi has no in-process sandbox by design. This change delivers the
**approval half only**; write-confinement stays with the Docker/container path. "Supervised"
must never read as a sandbox.

## What Changes

Introduce **supervised mode**: a per-session toggle that gates risky agent tool calls behind
an in-dashboard Allow once / Deny prompt.

- **Shared tool-gate module (extraction first)** — lift `decideToolCall` + the guard core out
  of `packages/chat-gateway/src/guard/` into a surface-agnostic workspace package, widen
  `ToolDefaultAction` with `"allow"`, and migrate chat-gateway to consume it. chat-gateway's
  deny-first, fail-closed behaviour is held by its existing test assertions. **A refactor of
  shipped security code**: the guard hardcodes chat copy, prefixes reasons
  `chat-gateway:`, and discards `event.input`, so it gains an injected `ApprovalSurface`
  (design `D9`).
- **Policy-shape widening (`defaultAction: "allow"`)** — supervised =
  `{ approval: <supervisedMode.tools>, defaultAction: "allow" }`. Type, resolution
  ternary, config normaliser and env parser change together or `"allow"` silently becomes
  `deny` (design `D7`). Not exposed in chat-gateway's config schema.
- **Bridge `tool_call` gate** — the **fourth** bridge handler, registered after the path
  gate, outside `safe()`, with its own try/catch → block and a per-session prompt mutex
  (design `D8`). Non-supervised sessions: a flag check, **p95 < 1 ms** added latency.
  Unclassified tools run and are logged (design `D2`).
- **Composition with the path gate** — path gate first. In a Supervised session the path
  gate's prompt for a risky out-of-workspace call also shows the command / diff, and
  allowing it on the dashboard or terminal counts for both gates: one prompt per call
  (design `D14`). YOLO does not answer supervised approvals (design `D15`).
- **Chat gateway excluded** — supervised approvals (and supervised-enriched path prompts)
  are answered on the dashboard or the terminal only; the gateway never posts them to a
  channel. MODIFIED delta to `chat-gateway` "Interactive prompts rendered natively via
  PromptBus" (design `D17`).
- **Unclassified tools run** — allow-first: only the configured set is gated; tool
  annotations are ignored; unclassified tools are logged (design `D2`).
- **Per-session mode toggle** — a Full access ↔ Supervised chip in the composer toolbar's
  leading cluster (folds into `＋` below 420 px; see `add-composer-dock`); machine default from shared config, live toggle
  via a session-scoped control message; read per tool call (design `D4`). Hidden on
  gateway-spawned sessions whose guard is active (design `D12`). The mode is recorded in
  the session file and in server metadata, per session id, so reload, restart and
  reconnect never drop a session to Full access (design `D4`). No UI → risky calls block at
  once (design `D5`).
- **Approval card** — a PromptBus `select` (`Allow once` / `Deny`, the path gate's labels)
  with `metadata.kind = "supervised-tool-approval"`; the dashboard renders a dedicated card
  (command / path + collapsed diff, countdown, Deny with a reason); every other surface
  shows the plain options (design `D3`). The gate's deadline stays inside the bus-wide
  prompt timeout, so its timer is the one effective clock (design `D10`).
- **Attention** — `awaitingToolApproval` flag beside `awaitingFileAccess`; every consumer
  reads one shared predicate, so the "Needs you" label, lane, urgency and toast all cover
  both (design `D16`).
- **Config + Settings** — `supervisedMode.{default, timeoutSeconds (120, min 10), tools}`
  in `~/.pi/dashboard`, mirroring `agentPathGate`; a Security-tab section next to "Agent
  file access" (design `D10`).
- Mockup: `mockups/` (in this change) — mode chip, approval card, settings section.

**Out of scope (follow-ups):**
- OS/filesystem sandboxing (`workspace-write`) — delegated to the Docker path.
- Persistent allow-rules ("always allow `npm test`").
- YOLO coverage of supervised approvals.
- Read-only preset via `pi.setActiveTools` (`docs/extensions.md:165`) — cheap, but a separate affordance.

## Capabilities

### Modified Capabilities

- `chat-gateway`: "Interactive prompts rendered natively via PromptBus" excludes supervised
  approval prompts and supervised-enriched path prompts (dashboard/terminal only).

### Added Capabilities

- `supervised-tool-approval`: a per-session supervised mode that intercepts risky agent tool
  calls via pi's blockable `tool_call` hook and gates them behind an in-dashboard
  Allow once / Deny prompt over PromptBus, composed after the agent path gate, with a
  configurable risky-tool set and an approval-only scope that leaves OS confinement to the
  container path.

## Impact

- **Additive; default unchanged.** Full access stays the default; the gate is inert unless
  the session is Supervised.
- **No session event-protocol change for the approval loop.** Approval rides
  `prompt_request` / `prompt_response`. New wire data, all for mode/ownership, not the
  approval loop: the `set_supervised` control message; the bridge's current mode and
  `toolGateOwner` as fields on the existing session registration; the mode in persisted
  session metadata (design `D4`, `D12`).
- **Question stack.** Supervised prompts are read-only in the question stack — never
  answered over REST, never LLM-briefed (design `D17`).
- **Env hardening.** `PI_EXT_CHAT_GATEWAY_GUARD_POLICY` is now validated; an env
  `defaultAction` other than `deny`/`approve` resolves to `deny` (today it already falls
  through to deny in `decideToolCall`; validation makes it explicit).
- **New code:** a `tool_call` gate + risky-tool matcher in `packages/extension`; path-gate
  prompt enrichment + `toolCallId` hand-off (D14, additive to `agent-path-confinement`; no
  requirement changes); a bus-timeout read accessor on PromptBus (D10); a gateway skip for supervised prompts in
  `packages/chat-gateway` (D17); metadata pass-through at the two client prompt sites (D3); a mode chip, an approval card branch on
  `SelectRenderer`, a Security-tab section in `packages/client`; `awaitingToolApproval`
  derivation in `packages/server`; `supervisedMode` in `packages/shared` config.
- **Refactor of shipped security code.** The chat-gateway guard
  (`packages/chat-gateway/src/guard/{index,policy}.ts`, `./guard` export, governed by
  `openspec/specs/chat-gateway/spec.md` "Hard in-session tool policy for spawned
  sessions") is extracted. That requirement and the `./guard` export path are preserved.
  Rollback = revert the whole change as one unit.
- **Handler coexistence.** Bridge `tool_call` handlers today: forwarder (`safe`), fan-out
  admission (`safe`, `Agent` only), path gate (unwrapped) — `bridge.ts:1912-1956`. First
  block wins, so order is load-bearing; supervised registers last. The fan-out permit
  window for a later-blocked `Agent` call needs a spike (design `D8`).
- **Shipped specs touched by composition** (only `chat-gateway` is modified, above): `agent-path-confinement`
  ("No other tool SHALL be gated by this capability" — supervised is a separate
  capability), `access-grant-yolo` (scope stays "path gate only"),
  `session-attention-routing` (a new sibling flag, same no-modal pattern),
  `path-containment-guard` (independent; first-block-wins in any order).
- **Observability.** "Who answered" is unobtainable without a protocol change
  (`useSessionActions.ts:183`); v1 logs the answering surface.
- **Windows.** `powershell` (`docs/cli.md:144`) is in the default set.
- **Double-gating.** A gateway-spawned session keeps the gateway's stricter policy; the
  supervised gate self-disables there and the toggle is replaced by a note (design `D12`).
- **Security surface.** Supervised reduces risk (a human gate) but is not a sandbox: an
  approved tool runs with full user permissions. Untrusted or unattended work belongs in the
  container path.

## Discipline Skills

- `security-hardening` — the feature is a safety control gating code execution; the
  risky-tool set, fail-closed deny paths, unclassified-tool handling, and "approval ≠
  sandbox" wording are the threat-model surface.
- `observability-instrumentation` — every decision (tool, summary, outcome, surface) is
  logged durably so "why did the agent stop" is diagnosable.
- `doubt-driven-review` — extracting a shipped, spec-governed fail-closed control and
  widening its enum is a hard-to-reverse refactor; stress-tested before it stands.
- `performance-optimization` — the p95 < 1 ms per-call budget on non-supervised sessions.
