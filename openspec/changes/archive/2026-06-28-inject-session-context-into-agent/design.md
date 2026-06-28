## Context

The dashboard's "attached proposal" feature lives entirely on the server/UI side. `DashboardSession.attachedProposal` drives the chip in the session header, the artifact letters, and idempotent auto-rename. Today it never reaches the pi agent: `applyAttachProposal` in `packages/server/src/browser-handlers/session-meta-handler.ts` mutates session state and emits `session_updated` to browsers only — no message crosses `pi-gateway` to the bridge.

The bridge (`packages/extension/src/bridge.ts`) does have everything else it needs:
- The dashboard session id lives on `bc.sessionId` (NOT `pi.sessionId` — pi's extension API exposes no such field). The bridge sets it from `ctx.sessionManager.getSessionId()` and reads it at every `sendStateSync` (`session-sync.ts` uses `bc.sessionId`).
- `BridgeContext` already carries per-session mutable state (cached model, git info, etc.).
- The bridge already registers many `pi.on(...)` event handlers, including a pass-through `before_agent_start` subscription that forwards the event to the dashboard (`bridge.ts` `passThroughEventTypes`). pi chains `before_agent_start` results, so the new SP-mutating handler coexists with that forwarder.

Pi exposes one relevant API (verified in the installed pi 0.80.2 `dist/core/extensions/types.d.ts`):
1. **`before_agent_start` event** — fires after user submits prompt, before the agent loop. `BeforeAgentStartEventResult.systemPrompt?: string` replaces the chained per-turn system prompt (multiple extensions chain). The event carries `systemPrompt: string` and `systemPromptOptions: BuildSystemPromptOptions` (with `cwd: string`).

This is the only pi API this change relies on. The session id is supplied by the bridge (`bc.sessionId`), not pi. No upstream pi changes are required.

The pre-existing `pendingAttachRegistry` (`packages/server/src/pending-attach-registry.ts`) already enqueues `attachProposal` intents per cwd before spawning, and `event-wiring.ts`'s `pi-gateway.onSessionRegistered` consumes them on first `session_register` by calling the shared `applyAttachProposal` helper. That already mutates `DashboardSession.attachedProposal` server-side. What's missing is propagation back to the bridge for that same session.

## Goals / Non-Goals

**Goals:**
- The agent's per-turn system prompt SHALL include `sessionId` and `cwd` for every turn of every session.
- When `session.attachedProposal` is set, the agent's per-turn system prompt SHALL include the change name and the canonical artifact paths.
- Attach/detach mid-session SHALL be reflected on the agent's NEXT turn without restart, fork, or reload.
- The mechanism SHALL survive bridge reattach (server replays current attached state on `session_register`).
- Zero changes to client UI, OpenSpec skills, or pi upstream.
- Zero new on-disk state (the SP fragment is recomputed each turn from in-memory `BridgeContext`).

**Non-Goals:**
- Auto-prompting the agent on attach ("Now working on X — please read the proposal"). Silent SP injection only; the user prompts when ready.
- A `whoami`-style custom tool. The SP fragment is sufficient and cheaper than a tool round-trip.
- Per-session env vars or files keyed by sessionId. Out of scope; can be layered later if needed.
- Modifying the agent's system prompt outside `before_agent_start` (e.g., via pi's `context` event). The chained per-turn SP is the right seam.
- Communicating attached state to other extensions or skills via a shared bus.

## Decisions

### Decision 1: Per-turn SP fragment via `before_agent_start` (vs. one-shot first-turn message, vs. file + skill consults)

Use `pi.on("before_agent_start", ...)` returning `{ systemPrompt }` to **splice-replace** the trailing `Current working directory: <cwd>` line of `event.systemPrompt` with our context fragment every turn. Pi's `buildSystemPrompt` (verified in `dist/core/system-prompt.js`) terminates every SP — both `customPrompt` and default branches — with:

```
Current date: <YYYY-MM-DD>
Current working directory: <cwd>
```

We match the literal `\nCurrent working directory: ` prefix on the last line and replace from that prefix through end-of-string with our fragment (which itself includes `cwd`, so no information is lost). If the anchor is not found (future pi versions or third-party SP overrides), fall back to **append** — the fragment is still delivered, just at the tail.

**Why:**
- Always fresh — picks up attach/detach mutations on the very next user turn.
- No chat pollution — never adds turns the user didn't type.
- Survives fork/resume — the handler is registered ONCE at activation on the captured `pi`; the same `pi` keeps the listener across reseating and the getter reads the live `sessionId`/`attachedChange`, so no re-registration on `session_start` is needed (re-registering would stack duplicate handlers).
- No skill changes — the agent simply sees the change name and can run stock `openspec-*` skills with that argument.

**Alternatives considered:**
- *One-shot injected user message on attach.* Would force a synthetic turn the user didn't ask for, costs tokens permanently in session history, and gets stale immediately on detach.
- *State file at `~/.pi/agent/sessions/<id>/context.json` + skill consults it.* Requires teaching every skill, agent only sees state when a relevant skill runs, and adds disk I/O. The earlier exploration converged on SP injection as cleaner once `before_agent_start` was confirmed available.
- *Wholesale replace `event.systemPrompt`.* Would clobber other extensions' contributions and pi's body. Splice-replace touches only the trailing cwd line.
- *Prepend to whole SP.* Pushes pi's body further down; the first thing the model reads is dashboard plumbing rather than its role.
- *Append at end.* Works as the fallback when the anchor is missing, but in the common path B3 is preferred because it subsumes the existing cwd line instead of duplicating it.
- *Splice after the opening `You are an expert coding assistant…` line.* Anchor is also stable, but inserts a dashboard block in the middle of pi's role description; B3's tail position is less disruptive.

### Decision 2: Server→bridge propagation as a new dedicated message (vs. piggyback on `session_updated`)

Add a new `ServerToExtensionMessage` variant `attach_proposal_changed { sessionId, attachedChange: string | null }` and dispatch it from `applyAttachProposal` in `session-meta-handler.ts`.

**Why:**
- Keeps the existing `session_updated` browser-broadcast contract untouched; it's a browser-protocol message, not a pi-gateway one.
- Single small server seam (`applyAttachProposal`) covers WS attach, REST attach, REST detach, attach via `pendingAttachRegistry.consume`, and attach via auto-detection — they all funnel through `applyAttachProposal`.
- The bridge can route it through a small dedicated handler instead of rebuilding session state from a generic update payload.

**Alternatives considered:**
- *Reuse `session_updated` as a bridge-bound message.* `session_updated` is part of the browser protocol (`browser-protocol.ts`), not the pi-gateway protocol. Routing it through pi-gateway too would muddy the layer separation.
- *Have the bridge fetch attach state via REST.* Extra round-trip and races against `before_agent_start` timing. Push is cheaper.

### Decision 3: Replay attach state on `session_register` (vs. assume it survives in bridge memory)

`pi-gateway.onSessionRegistered` (in `event-wiring.ts`) SHALL look up the registering session's current `attachedProposal` from the in-memory `DashboardSession` and, when non-null, push an `attach_proposal_changed` to that bridge. This runs after the existing `pendingAttachRegistry.consume` step, so a fresh spawn gets attach via the registry and a reattaching bridge gets the same value via replay.

**Why:**
- After dashboard restart the bridge reattaches with empty `BridgeContext.attachedChange`. Without replay the agent loses awareness until the user explicitly re-attaches.
- The replay path uses the exact same message type as live updates, so the bridge has a single inbound code path.
- Idempotent — sending the current value to a bridge that already has it is a no-op write.

**Alternatives considered:**
- *Persist `attachedChange` in bridge state across reattach.* The bridge has no per-cwd persistent store today, and inventing one duplicates the server's source of truth.
- *Bridge requests state via `request_state_sync`.* Adds a round-trip and a new request shape; replay-on-register is simpler.

### Decision 4: Conditional fragment lines (vs. always-on full block)

The SP fragment SHALL always include the `sessionId`/`cwd` line, and SHALL include the attached-change line ONLY when `attachedChange` is non-empty. Detach is therefore silent — the next turn's fragment simply omits the line.

**Why:**
- Keeps token cost minimal when no proposal is attached (~30 tokens vs. ~60).
- Detach without an explicit "you have been detached" announcement matches how attach itself is silent — symmetry, no synthetic turns.
- Agents handle absence gracefully; they only need the line when it's actionable.

**Alternatives considered:**
- *Always include the line, with `none` when unset.* Slightly more uniform but pays the token cost in the common no-attach case.
- *Inject a one-off "detached" message on detach.* Pollutes chat for no benefit.

### Decision 5: Place the injector in a new `dashboard-context-injector.ts` (vs. inline in `bridge.ts`)

Add `packages/extension/src/dashboard-context-injector.ts` exporting a single `registerDashboardContextInjector(pi, bc)` function. `bridge.ts` calls it once after the existing module composition wiring.

**Why:**
- `bridge.ts` is already a composition root; new behaviour lives in dedicated modules (matching `session-sync.ts`, `model-tracker.ts`, `flow-event-wiring.ts`).
- Keeps `before_agent_start` handler discoverable and unit-testable without booting the full bridge.
- Mirrors the style mandated by `bridge-context.ts` + `bridge-context.ts` shared-state pattern.

## Risks / Trade-offs

- **[Risk] Token tax on every turn.** ~30 tokens always-on, +~30 with attached change. **Mitigation:** small absolute cost; conditional attached-change line keeps the no-attach case minimal; can be made opt-out via config later if needed.

- **[Risk] Multiple `before_agent_start` handlers chain unpredictably.** Other future extensions may also contribute. **Mitigation:** the injector reads `event.systemPrompt` (the chained value) and only mutates the trailing cwd line; it never touches earlier content. If another handler runs after ours and re-appends a `Current working directory:` tail, our splice on the next turn still finds the latest one (regex matches the LAST occurrence).

- **[Risk] Pi changes the trailing-line format.** B3 depends on the literal `\nCurrent working directory: ` anchor in `dist/core/system-prompt.js`. **Mitigation:** the injector falls back to append when the anchor is missing, so the fragment is always delivered. A repo-lint test asserts the anchor still exists in the installed pi version (skips if pi not resolvable).

- **[Risk] pi session reseating on fork drops the registered handler.** In practice the same `pi` instance persists across fork/resume, so the once-registered handler keeps firing. **Mitigation:** register once at activation, read live state via the getter, and guard with `isActive()` so a stale generation (after `/reload` re-activates on the same `pi`) contributes nothing.

- **[Risk] Race: bridge attaches before server pushes replay.** If the bridge's first `before_agent_start` fires before `attach_proposal_changed` arrives, the first turn omits the attached-change line. **Mitigation:** the replay is sent synchronously inside `pi-gateway.onSessionRegistered`, before the bridge can submit a user prompt; `pendingAttachRegistry.consume` already runs in this same hook for the spawn-with-attach case. Acceptable residual: dashboard-restart reattach with already-streaming agent — the in-flight turn does not see the line, but the next one does.

- **[Risk] Agent may hallucinate that the SP fragment is user instruction.** **Mitigation:** fragment is wrapped in a clearly-marked block (e.g., a `── pi-dashboard session context ──` separator) and uses declarative phrasing ("You are session …"). Format finalized in spec scenarios.

- **[Cache] Anthropic prompt-cache impact: negligible.** Pi-ai sends the system prompt as a single `system: [{ type: "text", text, cache_control: { type: "ephemeral" } }]` block — one breakpoint at the end of the SP. Today the SP ends with `Current date: <YYYY-MM-DD>\nCurrent working directory: <cwd>`; turn-to-turn cache hits work because both lines are stable within a session/day. B3 replaces the trailing cwd line with our fragment (`sessionId` + `cwd` + optional `attachedChange`). Within a session `sessionId`/`cwd` are stable and `attachedChange` only mutates on user attach/detach, so the SP stays byte-identical turn-to-turn — cache hits exactly as today. Attach/detach causes one cache miss the next turn, then stable again. Daily date rollover still causes one miss (unchanged). Assumes our injector runs last in the `before_agent_start` chain; if another handler appends more text our regex still matches the last cwd anchor, and on anchor miss the fallback append leaves the prefix intact — same cache cost.

- **[Trade-off] No structured access from the agent (no tool, no env var).** Acceptable for v1 — the SP is enough for skill-driven workflows. A `whoami`-style tool can be added later without breaking this design.

- **[Trade-off] Detach is silent.** An agent mid-investigation will simply stop seeing the attached-change line on the next turn and may continue referencing the change from earlier turns' context. Acceptable: the dashboard chip is the user-visible source of truth; the SP fragment mirrors it.

## Migration Plan

1. Land protocol additions and bridge `BridgeContext` field (additive — does not affect older bridges; they ignore the new message type).
2. Land server-side dispatch in `applyAttachProposal` and replay in `pi-gateway.onSessionRegistered`. Older bridges silently ignore the new message variant on the wire.
3. Land bridge injector and `before_agent_start` handler. Existing sessions pick up the SP fragment on the next user turn.
4. No data migration. No persisted state introduced. Rollback = revert the three commits.

## Open Questions

- Final wording of the SP fragment (`── pi-dashboard session context ──` block contents). Frozen in spec scenarios; may be tuned post-merge after observing agent behaviour.
- Whether to also emit the fragment for non-interactive/headless sessions. Default: yes — same code path. Can be gated later if it interferes with headless flows.
