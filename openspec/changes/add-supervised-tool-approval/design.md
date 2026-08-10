# Design — supervised mode (dashboard tool-approval gate)

## Origin

This change is one of six candidate adaptations mapped from a research pass over
[`pingdotgg/t3code`](https://github.com/pingdotgg/t3code) (a minimal multi-provider web GUI
for coding agents). t3code's **Runtime modes** feature (`docs/architecture/runtime-modes.md`)
offers a global switch:

- **Full access** (their default): `approvalPolicy: never`, `sandboxMode: danger-full-access`.
- **Supervised**: `approvalPolicy: on-request`, `sandboxMode: workspace-write`, prompting
  in-app for command/file approvals.

We already run pi sessions full-access. The question was whether "supervised" is buildable
against pi's runtime. A spike answered it.

## Spike — how pi surfaces tool approvals in `--mode rpc`

**Question:** when the dashboard spawns pi `--mode rpc`, do pi's built-in tool actions
(`bash`/`write`/`edit`) emit an interceptable approval we can render in the browser, or does
pi self-decide and run them silently?

**Answer: pi has no built-in approval prompt — by design — but exposes a blockable
`tool_call` hook that lets an extension build one. All rails to surface it in the dashboard
already exist and are proven in our own code.**

Verified facts (file:line, current dependency version in `node_modules/@earendil-works/pi-coding-agent`):

| Fact | Source | Consequence |
|---|---|---|
| "No permission popups. … build your own confirmation flow with extensions." | `README.md:495` | pi will run bash/edit with **no prompt** unless the host builds one. Nothing to "catch" passively. |
| "Pi does not include a built-in sandbox." | `docs/security.md:31-35` | We **cannot** replicate t3code's `workspace-write` in-process. OS confinement = container/VM only. |
| `tool_call` event: "Fired … before the tool executes. **Can block.**" Return `{ block: true, reason? }`. | `docs/extensions.md:743-757` | The interception point. An extension can veto a tool before it runs. |
| Pipeline diagram: `tool_call (can block)` | `docs/extensions.md:303` | Confirms block is a first-class capability, not a side effect. |
| `isToolCallEventType("bash", event)` / typed inputs | `docs/extensions.md:760-800` | Gate can target specific tools + inspect args (command text, file path). |
| `ctx.ui.confirm` guarded by `hasUI`, which is **`true` in TUI and RPC modes** | `docs/extensions.md:938` | Confirm dialogs work in the RPC sessions the dashboard spawns. |
| Our bridge **already** calls `ctx.ui.confirm(...)` and it renders in the dashboard | `packages/extension/src/role-model-tools.ts:205-212` | The confirm→PromptBus→web-renderer→response path is live and proven today. |
| `turn_start`/`turn_end` already first-class client-side | `packages/client/src/lib/event-reducer.ts` | Same interception family is available for the sibling checkpointing feature. |
| `pi.setActiveTools(["read","bash"])`, `--tools` allowlist | `docs/extensions.md:1614-1631`, `README.md:574` | A "read-only" preset is essentially free. |

**Composed mechanism (the whole feature):**

```
        agent emits a bash tool call  (e.g. `rm -rf build`)
                     │
   pi fires  tool_call  ── before execution, blockable ──►  bridge hook
                     │
        supervised(session)?  &&  risky(toolName, args)?
                     │ yes
        ctx.ui.confirm("Approve bash?", "rm -rf build")
                     │   (PromptBus → prompt_request → web interactive renderer)
        ┌────────────┴─────────────┐
     approve                      deny
        │                          │
   return (undefined)      return { block:true, reason:"denied in dashboard" }
        │                          │
   pi runs the tool          pi cancels the tool, tells the agent
```

Every arrow above is either pi-native (`tool_call` block) or already shipping in this repo
(`ctx.ui.confirm` → PromptBus → renderer). No new session protocol for the approval loop.

**Blocker status: cleared.** Pre-spike this feature was "MEDIUM, gated by unknown"; post-
spike it is "MEDIUM, unblocked, mostly UI + one bridge hook."

## Design decisions

### D1 — Approval gating only; sandboxing is out of scope (delegated to containers)
pi refuses an in-process sandbox on purpose. We honor that: Supervised gates **whether** a
risky tool runs; it does **not** confine what an approved tool can touch. The UI copy MUST
avoid words like "sandboxed" / "safe" and instead say "approve each action." Users needing
real isolation run the session in the Docker path. This is the single most important framing
decision — it prevents a false security boundary.

### D2 — Risky-tool set is a matcher, default `{bash, write, edit}`
Read-family tools (`read`, `grep`, `ls`, …) never gate. The default gated set is the three
mutating/exec tools. The set is configurable (shared config) so a team can add custom tools
or relax `edit`. Matching uses `isToolCallEventType` for typed args so the prompt can show
the actual command / path + a diff preview, not an opaque tool name.

### D3 — Reuse PromptBus; do not invent an approval channel
Approve/deny is a `ctx.ui.confirm` (or a richer custom interactive payload) over the
existing PromptBus. This inherits first-response-wins, cross-surface dismissal, reconnect
replay, and the answered-prompt history card for free — the same guarantees `ask_user` has.

### D4 — Mode flag wiring (open, two viable options)
The bridge hook needs to know a session is supervised. Options:
- **(a) Session-scoped control message** dashboard → bridge (`set_supervised {on}`), toggled
  live from the session UI. Most direct; adds one small control message (not an event-
  protocol change).
- **(b) Shared-config default** (`~/.pi/dashboard`, alongside `askUserPromptTimeoutSeconds`)
  read at session start, with (a) as the live override.
Recommendation: ship (b) for the default + (a) for the live per-session toggle. Final call
belongs to implementation; both are small.

### D5 — Deny semantics fail closed
An unanswered approval (PromptBus timeout) or an explicit deny returns `{ block: true }`.
The agent receives the `reason` and continues (it may replan). We never silently run a tool
whose prompt was dismissed. Mirrors `add-chat-gateway`'s "unanswered approval fails closed."

### D6 — Share the primitive with `add-chat-gateway`
chat-gateway's L3 "Hard in-session tool policy" is the same `tool_call` + `{block:true}` +
`ctx.ui.confirm` pattern for Discord-spawned sessions. Extract the interceptor + risky-tool
predicate into a shared helper both consume; only the presentation differs (Discord
buttons vs the dashboard approve/deny card). Avoids two divergent tool-guards.

## Open questions

1. **Parallel tool calls.** pi preflights sibling tool calls sequentially then runs them
   concurrently (`extensions.md:749`). With several risky calls in one assistant message, do
   we present N prompts, or one batched approval? v1: N sequential prompts (simplest);
   revisit batching if noisy.
2. **Diff preview cost.** For `edit`/`write`, computing a diff preview at approval time —
   render inline in the card, or a compact summary + expand? Lean compact + expand.
3. **Live toggle mid-turn.** If the user flips Supervised on while a turn is running, does it
   take effect for the next tool call in that turn? Hook reads the flag per call, so yes —
   confirm that is the desired UX.
4. **Non-`ctx.ui.confirm` richer payload.** A yes/no confirm is enough for v1, but a custom
   interactive type (Approve / Deny+reason / Always-allow) may want a dedicated renderer.
   Start with confirm; grow into a custom renderer if D-follow-up (persistent allow-rules)
   lands.

## Alternatives considered

- **Wrap pi in an OS sandbox to mirror `workspace-write`.** Rejected: pi explicitly declines
  a partial in-process sandbox; the only real confinement is a container, which we already
  offer. Building a fake one would mislead users (D1).
- **Replace built-in tools with gated custom tools.** Rejected: heavier, brittle across pi
  upgrades, and redundant — the `tool_call` block hook is the supported extension point.
- **Server-side gating instead of in-bridge.** Rejected: the block decision must happen
  in-process with pi (the hook runs in the extension); the server has no pre-execution veto.
