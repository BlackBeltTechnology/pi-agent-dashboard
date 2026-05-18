## Why

Two issues with the dashboard bridge's extension slash-command dispatch path:

**Issue 1 — dispatch hardcodes `streamingBehavior: "followUp"`.** When a dashboard user sends a steering message (Enter key during streaming), the bridge should route extension commands with `streamingBehavior: "steer"` so pi delivers them after the current turn's tool calls rather than queuing as followUp. But `tryDispatchExtensionCommand` hardcodes `"followUp"` and has no `delivery` parameter.

**Issue 2 — Path D stopgap emits misleading pi-version error.** Users on pi 0.74.1 see the stopgap error "requires pi 0.71+ (pi.dispatchCommand). Invoke from the pi TUI" when typing extension slash commands from the dashboard. Two problems: (1) `dispatchCommand` was never added to pi's ExtensionAPI and pi 0.71 does not exist — the error references a fictional feature. (2) `pi.sendUserMessage()` hardcodes `expandPromptTemplates: false`, which skips pi's `_tryExecuteExtensionCommand` — so removing the stopgap entirely and falling through to `sendUserMessage` does NOT dispatch extension commands; they become regular LLM messages. Path D is replaced with an honest error: the command cannot be dispatched for non-headless sessions; headless sessions need `useRpcKeeper: true` in dashboard config.

**Issue 3 — global prompt templates not resolved by `expandPromptTemplateFromDisk`.** Users with prompt templates installed at `~/.pi/agent/prompts/` (e.g. `/session-summary`) cannot invoke them from the dashboard because `resolveTemplate`'s `pi.getCommands()` fallback only queries for `source: "skill"`, so prompt templates registered via pi's prompt-template system (`source: "prompt"`) are not found. `pi.getCommands()` already returns every prompt template with its absolute path — the lookup just needs to also check for `source: "prompt"`.

## What Changes

- **MODIFIED**: `packages/extension/src/slash-dispatch.ts` — `tryDispatchExtensionCommand` gains optional `delivery?: "steer" | "followUp"` parameter, used for `streamingBehavior` on the `dispatchCommand` call (Path B). Path D replaced: instead of the misleading "pi 0.71+" stopgap, emits `command_feedback {status: "error"}` with an actionable hint to enable `useRpcKeeper: true` for headless sessions, and returns `true`. No fallthrough to `sendUserMessage` (which cannot dispatch extension commands — `expandPromptTemplates: false` skips `_tryExecuteExtensionCommand`).
- **MODIFIED**: `packages/extension/src/bridge.ts` — `sessionPrompt` callback gains `delivery` parameter, passed through to `tryDispatchExtensionCommand` and used as `deliverAs` on the `sendUserMessage` fallback.
- **MODIFIED**: `packages/extension/src/command-handler.ts` — `sessionPrompt` callback type updated to include `delivery` parameter. `msg.delivery` passed to `tryDispatchExtensionCommand` at the non-bridge call site (slash else-arm) for correct `streamingBehavior` propagation.
- **MODIFIED**: `packages/shared/src/protocol.ts` — `SendPromptToExtensionMessage` gains optional `delivery?: "steer" | "followUp"` field.
- **MODIFIED**: `packages/extension/src/bridge-context.ts` — `hasDispatchCommand` detection improved with `in`-operator fallback for getter-backed / Proxy-hidden properties.
- **MODIFIED**: `packages/extension/src/prompt-expander.ts` — `resolveTemplate` Step 3 adds parallel `source: "prompt"` lookup alongside existing `source: "skill"` lookup in `pi.getCommands()`, enabling global prompt template expansion from the dashboard.

## Capabilities

### Modified Capabilities

- `extension-slash-command-dispatch`: Path D stopgap replaced. Instead of the misleading "requires pi 0.71+" error, non-headless extension commands now get an actionable error message directing users to enable `useRpcKeeper: true` in dashboard config for headless sessions (which support extension command dispatch via the RPC keeper).

## Impact

- **MODIFIED files** (implementation):
  - `packages/extension/src/slash-dispatch.ts` — delivery param + Path D removal
  - `packages/extension/src/bridge.ts` — delivery param plumbing
  - `packages/extension/src/command-handler.ts` — delivery param type + msg.delivery pass-through
  - `packages/shared/src/protocol.ts` — delivery field on `SendPromptToExtensionMessage`
  - `packages/extension/src/bridge-context.ts` — `hasDispatchCommand` improvement
  - `packages/extension/src/prompt-expander.ts` — global prompt template resolution (pi.getCommands() prompt lookup)
- **MODIFIED files** (tests):
  - `packages/extension/src/__tests__/bridge-slash-command-routing.test.ts` — delivery tests, Path D behavior update
  - `packages/extension/src/__tests__/command-handler.test.ts` — delivery propagation test
- **Backward compatibility**: Extension commands from the dashboard that previously got the misleading "pi 0.71+" stopgap error now get an accurate, actionable error explaining that extension command dispatch requires headless mode with `useRpcKeeper: true`. The `delivery` field on `SendPromptToExtensionMessage` is optional; clients that don't send it get `"followUp"` behavior (unchanged). Global prompt templates (e.g. `/session-summary`) now resolve and expand correctly when invoked from the dashboard. Non-extension slash commands without matching templates remain unaffected (passed to LLM as raw text).

## Depends On

- `fix-extension-slash-commands-in-dashboard` — establishes the slash-command routing order and `tryDispatchExtensionCommand` helper. This change fixes its Path D stopgap issue.
- `add-steering-message` (`feat/add-steering-message` branch) — adds `delivery` field to the protocol and `sessionPrompt` callback. This change wires `delivery` through to `tryDispatchExtensionCommand` for correct `streamingBehavior`.
