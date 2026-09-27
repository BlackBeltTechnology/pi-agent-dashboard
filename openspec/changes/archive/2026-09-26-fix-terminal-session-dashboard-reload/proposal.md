## Why

`/reload` from the dashboard does nothing for a terminal-hosted pi session until a human types `/__dashboard_reload` in its TUI (GitHub #725). It is worse than a one-time bootstrap. The captured `globalThis.__pi_dashboard_reload_fn__` closes over a command ctx whose runner pi invalidates on the first `ctx.reload()`. The next bridge instance never re-captures it, so every dashboard reload after the first fails with `Reload failed: This extension ctx is stale…`.

`fix-out-of-band-reload` (design.md L108) rejected the in-process alternative only because `pi.sendUserMessage` hardcoded `expandPromptTemplates: false`. That premise is obsolete. Since pi 0.84.2, `sendUserMessage(text, {expandPromptTemplates: true})` runs `_tryExecuteExtensionCommand`, which hands the handler a fresh `createCommandContext()` with `reload()`. `retire-slash-dispatch-via-expand-prompt-templates` already relies on this for every extension slash command. Verified on pi 0.87.1: `dist/core/agent-session.js` L1212/L1218 and `dist/core/extensions/runner.js` `createCommandContext().reload`.

## What Changes

- The bridge's `reload()` dispatches its own `/__dashboard_reload` through `pi.sendUserMessage("/__dashboard_reload", {expandPromptTemplates: true})`, gated on the running pi being ≥ 0.84.2. It reuses `readRunningPiVersion` and the SemVer gate from `slash-dispatch.ts`.
- The `__dashboard_reload` handler settles a bridge-armed deferred when `ctx.reload()` resolves or rejects. The bridge awaits that deferred with a timeout, because `ExtensionAPI.sendUserMessage` is void and swallows rejections. The deferred is the only way to observe the outcome. The cross-instance handoff slot lives on `process`, following the bridge's existing `BRIDGE_KEY` convention (it survives jiti cache invalidation and vm-sandboxed contexts; `globalThis` does not).
- The handler no longer stores a reusable reload fn (`RELOAD_KEY`). The single-use/stale-fn failure mode goes away because every reload uses a fresh command ctx. Typing `/__dashboard_reload` in the TUI still reloads.
- On pi < 0.84.2, or when the self-dispatch times out (extension disabled, command not registered), the bridge emits a terminal `command_feedback` `error`. `NO_RELOAD_PATH_REASON` is reworded to say "upgrade pi to ≥ 0.84.2" and no longer points at a manual TUI bootstrap.
- A second dashboard `/reload` while one is in flight for the same session is refused with `error` "reload already in progress". The server refuses it before forwarding; the bridge refuses too, as a guard against a nested `ctx.reload()`.
- The server arms a feedback deadline when `dispatchReload` returns `"forwarded"`. If no terminal `/reload` `command_feedback` arrives from the bridge within `FORWARDED_RELOAD_DEADLINE_MS` (75 s, above the bridge's 60 s finish timeout), the server emits the `error` itself and drops a late bridge feedback for that reload (unless a retry has since been forwarded). The watch survives the reload's own unregister/re-register. This covers the window where the reload fails after `session_shutdown` and the requesting bridge's error is lost.
- Headless sessions are unchanged: they keep kill-and-respawn. Replacing respawn with in-process reload for RPC sessions is out of scope and is noted as a follow-up.
- No protocol change. The `dispatchReload` ladder order is untouched; the forward step gains the in-flight refusal and the deadline.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `headless-reload`: the requirement "Server-side reload dispatch" changes. Its terminal-hosted scenario stops requiring a captured `globalThis[RELOAD_KEY]`: the bridge self-dispatches `/__dashboard_reload` via `sendUserMessage({expandPromptTemplates:true})`. The blanket ban on `pi.sendUserMessage` is narrowed to the server/keeper path. The requirement "Reload feedback is truthful, singular, and keyed `/reload`" also changes: the single-use-captured-fn scenario is replaced by old-pi, timeout and handler-rejection scenarios. The capability's `## Purpose` text, which says reaching `ctx.reload()` "needs an upstream pi change", is corrected.

## Impact

- **Code (extension)**: `packages/extension/src/bridge.ts` (the `reload` option, the `__dashboard_reload` registration, the `session_start` handoff), `packages/extension/src/command-handler.ts` (`NO_RELOAD_PATH_REASON` wording, new reasons, `ReloadOutcome` gains `handedOff`), and `packages/extension/src/slash-dispatch.ts` (export the version gate for reuse).
- **Code (server)**: `packages/server/src/rpc-keeper/dispatch-reload.ts` (in-flight forwarded-reload refusal + deadline watch) and the inbound bridge-event path in `packages/server/src/event-wiring.ts` (settle the watch on a terminal `/reload` `command_feedback`; drop late feedback after expiry).
- **Tests**: `packages/extension/src/__tests__/` bridge reload and command-handler suites; `packages/server/src/rpc-keeper/__tests__/` dispatch-reload suite.
- **Rebuild**: extension (`npm run reload`) + server restart (`POST /api/restart`). Terminal sessions pick up the new bridge on their next TUI reload or restart.
- **Compatibility**: pi < 0.84.2 (the extension's peer range still allows ≥ 0.80.10) gets an explicit error instead of today's bootstrap hint. A new server with an old (bootstrapped) bridge: the old bridge's `completed` is sent after its own disconnect and is lost (a latent bug today, where the pill never resolves), so the server's deadline turns it into a terminal `error` after 75 s. This lasts until the terminal session restarts onto the new bridge. A new bridge with an old server: no deadline, same as today. No persisted state and no protocol version bump.
- **Rollback**: revert the extension and server files. The `__dashboard_reload` command stays registered in both versions. The deadline watch is in-memory only.
- **Resolved by design**: `ctx.reload()` fires `session_shutdown`, which tears down the requesting bridge's connection (its later sends are buffered and never flushed). Completion is therefore reported by the reloaded bridge instance on `session_start {reason:"reload"}` (design D4); the spike (task 1.1) confirms the premise.
- **Related**: GitHub #725. Supersedes the terminal-hosted part of `fix-out-of-band-reload` D5.

## Discipline Skills

- **`doubt-driven-review`**: this reverses a recorded rejection from `fix-out-of-band-reload`. Re-verify the pi premise (`expandPromptTemplates` honored, fresh command ctx carries `reload`) on the pinned pi version before the design stands.
- **`systematic-debugging`**: the feedback-delivery spike across bridge teardown, and the stale-ctx failure on the second reload, both need evidence (logs from a real TUI session), not assumptions.
- **`scenario-design`**: derive the reload scenarios: first reload, repeated reloads, old pi, extension disabled, timeout, handler rejection, busy session, concurrent reload, server deadline.
- **`observability-instrumentation`**: the new server deadline is a timer-driven path; log arm/settle/expire with the session id so a lost reload is diagnosable from `server.log`.
