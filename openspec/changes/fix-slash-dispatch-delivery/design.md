## Context

The dashboard bridge's slash-command dispatch path (`slash-dispatch.ts`) routes extension commands through three paths:

- **Path B**: `pi.dispatchCommand(text, { streamingBehavior })` — planned pi 0.71+ API. Never shipped.
- **Path C**: server-routed dispatch via `dispatch_extension_command` WS message — headless RPC sessions only. Fires when `connection` is present AND `isHeadlessRpcSession()` is true.
- **Path D**: error feedback — fires when neither B nor C is available (non-headless or no connection). Emits `command_feedback {status: "error"}` with a hint to enable `useRpcKeeper: true` for headless sessions. Returns `true` — the caller does NOT fall through to `sendUserMessage`.

The `sessionPrompt` callback in `bridge.ts` receives a `delivery` parameter (from `add-steering-message`) but `tryDispatchExtensionCommand` does not accept or use it.

## Goals / Non-Goals

**Goals**

- Pass `delivery` through to `tryDispatchExtensionCommand` so Path B uses correct `streamingBehavior` ("steer" vs "followUp").
- Fix the Path D stopgap so extension commands work in non-headless sessions (tmux/wt) on pi 0.74+.
- Keep Path B and Path C unchanged in behavior when `delivery` is absent.

**Non-Goals**

- Remove Path B or Path C.
- Add a new dispatch mechanism.
- Change the PromptQueue or queue_state protocol.

## Decisions

### Decision 1: Path D emits error with rpc-keeper hint (was misleading stopgap, then silent fallthrough attempt)

**Problem**: The original Path D stopgap told users "requires pi 0.71+ (pi.dispatchCommand)" — but `dispatchCommand` was never added to pi's ExtensionAPI and pi 0.71 does not exist. An attempted fix made Path D return `false` to fall through to `sendUserMessage`, but pi's `sendUserMessage()` hardcodes `expandPromptTemplates: false`, which skips `_tryExecuteExtensionCommand` — so extension commands sent via `sendUserMessage` become regular LLM messages instead of being dispatched.

**Root cause**: Two independent facts: (1) `dispatchCommand` never shipped, making the original stopgap reference a fictional feature. (2) `sendUserMessage` cannot dispatch extension commands due to the `expandPromptTemplates: false` hardcode in pi core. The RPC keeper path (Path C) is the only channel that can dispatch extension commands from the dashboard.

**Decision**: Path D emits `command_feedback {status: "error"}` with an actionable message directing users to enable `useRpcKeeper: true` for headless sessions, and returns `true`. Path C remains gated by `isHeadlessRpcSession()` — it only works for headless sessions with a keeper sidecar. Tmux/wt sessions have no keeper and thus no dispatch channel; the error message acknowledges this.

**Trade-off**: Non-headless (tmux/wt) sessions get an honest error instead of the previous misleading "pi 0.71+" message or the attempted silent fallthrough (which would silently deliver the command to the LLM). This is strictly better — the error is accurate and actionable (enable headless + keeper config). True tmux dispatch requires a future server-side injection mechanism (e.g. `tmux send-keys`).

### Decision 2: `delivery` parameter defaults to `"followUp"`

The `delivery` parameter on `tryDispatchExtensionCommand` defaults to `"followUp"` when absent (via `delivery ?? "followUp"`). This matches the existing behavior and is backward-compatible with callers that don't pass delivery.

### Decision 3: `hasDispatchCommand` uses `in`-operator fallback

The pure `typeof` check may miss getter-backed or Proxy-hidden properties. Added a fallback that uses the `in` operator and a guarded `typeof` on the resolved value. This is defensive — no production scenario needs it since `dispatchCommand` never shipped. Preserved for future pi versions.

### Decision 5: `resolveTemplate` queries `pi.getCommands()` for prompt templates

**Problem**: `resolveTemplate` only checked `pi.getCommands()` for `source: "skill"` entries. Prompt templates registered with `source: "prompt"` (e.g. `/session-summary` installed by pi at `~/.pi/agent/prompts/`) were not found.

**Decision**: Add a parallel `source: "prompt"` probe in Step 3 of `resolveTemplate`, immediately after the skill lookup. Both probes share the same resolution loop over candidate-name variants, preserving original-form-first precedence. `pi.getCommands()` already returns every prompt template (global + project + package) with its absolute path, so no additional directory scanning is needed.

**Trade-off**: The `pi.getCommands()` call is already present for skills; the additional `.find()` is O(n) on the same array and adds negligible cost. `SlashCommandInfo` objects carry the path at `sourceInfo.path` — the lookup uses `c.sourceInfo?.path` directly. No fs operations added.

### Decision 4: No `started` command_feedback for Path B until `dispatchCommand` ships

Path B's `started` feedback emission was moved inside the `hasDispatchCommand` guard (alongside the `completed`/`error` emission). Previously, `started` was emitted before the path-decision block, which would leave a dangling `started` event when Path D returned `false` without a terminal event. Now each path emits its own feedback (or none, for the new Path D).

## Routing order (post-change)

```
1. !<cmd>        → bash + LLM (handleBashCommand)
2. !!<cmd>       → bash only (handleBashCommand)
3. /compact      → compact()
4. /quit, /exit  → shutdown()
5. /reload       → reload()
6. /new          → spawnNew()
7. /model <p/m>  → setModel()
8. user-defined flow name → pi.events.emit("flow:run")
9. extension command + dispatchCommand → pi.dispatchCommand(text, { streamingBehavior }) [Path B — dead code]
9b. extension command + connection + headless → dispatch_extension_command WS message [Path C — headless RPC only]
9c. extension command + non-headless or no connection → command_feedback {error} with rpc-keeper hint [Path D — error feedback]
10. template expansion + sendUserMessage (with deliverAs from delivery param)
11. passthrough text → sendUserMessage
```

## References

- `feat/add-steering-message` branch — introduces `delivery` on `SendPromptToExtensionMessage` and `sessionPrompt` callback.
- `fix-extension-slash-commands-in-dashboard` — establishes routing-order spec and `tryDispatchExtensionCommand`.
- `add-rpc-stdin-dispatch-with-keeper-sidecar` — Path C headless RPC dispatch mechanism.
- Pi source (`agent-session.js`): `_tryExecuteExtensionCommand()` at `prompt()` line 695-700 handles extension commands internally via registered handlers.
