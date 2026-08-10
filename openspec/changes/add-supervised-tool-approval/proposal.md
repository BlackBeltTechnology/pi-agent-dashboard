# Add supervised mode (dashboard tool-approval gate)

## Why

The dashboard runs every pi session in **full access** — pi executes `bash`, `write`, and
`edit` immediately, with no per-action approval. This is pi's deliberate default: pi ships
**no built-in permission popups** (`README.md:495` — *"No permission popups. Run in a
container, or build your own confirmation flow with extensions"*) and **no built-in
sandbox** (`docs/security.md:31`). Confirmation is something the host is expected to build.

t3code offers a **Supervised** runtime mode: a global toggle that switches a session to
approval-on-request, prompting in-app before each command/file action. Users who run
untrusted prompts, review-as-you-go, or drive a session from a phone want the same "let me
approve risky actions" control in this dashboard — without dropping to a container.

**A spike (captured in `design.md`) confirms this is buildable entirely on infrastructure
we already ship.** Verified enabling facts (current code):

- pi exposes a **`tool_call` event that fires before a tool executes and can block it**
  (`node_modules/@earendil-works/pi-coding-agent/docs/extensions.md:743-757`): a handler
  returning `{ block: true, reason?: string }` cancels the tool. The pipeline diagram
  annotates it `tool_call (can block)` (`extensions.md:303`).
- `isToolCallEventType("bash", event)` narrows the hook to specific tools with typed args
  (`extensions.md:768`), so the gate can target `bash`/`write`/`edit` and let read-only
  tools (`read`, `grep`, …) pass untouched.
- `ctx.ui.confirm(...)` works in **RPC mode** (`hasUI` is `true` in TUI *and* RPC —
  `extensions.md:938`) and **already renders in this dashboard today**: our bridge calls it
  in `packages/extension/src/role-model-tools.ts:208`, routed through `PromptBus` to the
  web client's interactive renderer.
- The approve/deny round-trip therefore needs **no new session protocol** — it reuses the
  existing `prompt_request` → `prompt_response` PromptBus path that already powers
  `ask_user`, `multiselect`, and `update_roles`.

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

- **Bridge `tool_call` interceptor** — a hook in `packages/extension` that, when a session
  is supervised, matches the tool against a configurable **risky-tool set** (default:
  `bash`, `write`, `edit`) and escalates via `ctx.ui.confirm(...)` with a human-readable
  summary of the action (command text / target path + diff preview). Approve → let the tool
  run; deny → return `{ block: true, reason }` so pi cancels it. Non-risky tools and
  non-supervised sessions pass through with zero overhead.
- **Per-session mode toggle** — a Full-access ↔ Supervised control in the session UI. The
  toggle sets a session-scoped `supervised` flag the bridge reads. A machine default MAY
  live in shared config (`~/.pi/dashboard`), with the per-session toggle overriding it.
  (Exact dashboard→bridge signalling is a `design.md` decision; the approval round-trip
  itself needs no protocol change.)
- **Approval renderer** — reuse the existing interactive-renderer surface with a
  tool-approval variant: show tool name, command/args or file+diff, and Approve / Deny
  (Deny optionally carries a reason back to the agent). First-response-wins and reconnect
  replay come from PromptBus for free.
- **Read-only preset (bonus, optional)** — pi ships `pi.setActiveTools(["read", "bash"])`
  and a `--tools` allowlist (`extensions.md:1614-1631`); a one-click "read-only" preset
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
- **Relationship to `add-chat-gateway` (active).** That change's "Hard in-session tool
  policy" uses the *same* `tool_call` + `{block:true}` + `ctx.ui.confirm` mechanism, but for
  **gateway-spawned Discord sessions**. This change is the **dashboard/browser surface** of
  the same primitive. They should **share the risky-tool predicate + the interceptor
  helper**; the surfaces (Discord buttons vs web approve/deny card) differ. Not a duplicate.
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
