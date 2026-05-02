## Why

Pi extensions that register slash commands via `pi.registerCommand(name, { handler })` are silently broken in dashboard sessions. When the user types e.g. `/ctx-stats` or `/curator` in chat, the registered handler **never runs** — the literal string is sent to the LLM as a regular user message instead.

The bug surfaces with every npm extension that ships its own slash commands (context-mode, pi-web-access, pi-agent-browser, pi-subagents). The TUI works correctly because pi's TUI uses `session.prompt()`, which intercepts extension commands. The dashboard bridge bypasses this interception by routing through `pi.sendUserMessage()`, which pi's own source comments mark as the "skip command handling" path:

```js
// agent-session.js:1002 (pi-coding-agent)
// Use prompt() with expandPromptTemplates: false to skip command handling and template expansion
await this.prompt(text, { expandPromptTemplates: false, ... });
```

The result is a degraded extension ecosystem in the dashboard: any pi extension distributed through npm/git that relies on `pi.registerCommand` will *appear* to work (event handlers fire, tools register, MCP servers spawn), yet its slash-command UX is dead. The user has no way to tell the difference until they type a command and see the LLM repeat the slash text back at them.

## What Changes

- `packages/extension/src/bridge.ts::sessionPrompt` (the slash-fallback callback wired into `command-handler.ts`'s `parsed.type === "slash"` branch): replace the `pi.sendUserMessage(expanded, { deliverAs: "followUp" })` call with `pi.session.prompt(expanded, { streamingBehavior: "followUp" })` (or the equivalent accessor on the bridge's `pi` API surface) so pi's `_tryExecuteExtensionCommand` runs before the text falls through to the LLM.
- The flows fast-path (`flow:run` emit) and the bridge's own `__dashboard_reload` registration stay as-is — they intentionally pre-empt pi's dispatcher.
- Skill expansion (`/skill:foo`) and prompt-template expansion (`expandPromptTemplateFromDisk`) MUST continue to work for typed slash text that doesn't match a registered command. Pi's `prompt()` already calls `_expandSkillCommand` and `expandPromptTemplate` after the extension-command check, so this path is preserved.
- Add a regression test under `packages/extension/src/__tests__/` that asserts the bridge's slash-fallback wiring routes through an API that DOES dispatch extension commands (i.e. `pi.session.prompt`-equivalent), not `pi.sendUserMessage`. Use a stub `pi` object whose `sendUserMessage` would fail the test if hit.

This is a pure routing fix — no protocol changes, no extension-API additions. The pi 0.70 contract already supports both code paths; the bridge just picks the wrong one for typed slash commands.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `command-routing`: the requirement covering `parsed.type === "slash"` dispatch must be rewritten so the fallback path invokes pi's extension-command interception instead of `sendUserMessage`. Existing requirements covering bang commands, `/compact`, `/quit`, `/reload`, `/new`, `/model`, and management/flow commands stay unchanged.

## Impact

**Affected code**
- `packages/extension/src/bridge.ts` — `sessionPrompt` fallback branch (~3 lines)
- `packages/extension/src/command-handler.ts` — the `parsed.type === "slash"` branch's `else` arm that calls `pi.sendUserMessage(parsed.text)` directly (when `options?.sessionPrompt` isn't provided) needs the same fix
- `packages/extension/src/__tests__/` — new regression test pinning the routing contract

**Affected behavior**
- Every pi extension that ships slash commands via `pi.registerCommand` becomes usable from the dashboard chat input. This includes (verified at proposal time): `/ctx-stats`, `/ctx-doctor` (context-mode); `/websearch`, `/curator`, `/google-account`, `/search` (pi-web-access); `/agents` (pi-subagents); future extensions.
- Typed `/flows`, `/flows:new`, `/flows:edit`, `/flows:delete` will now ALSO route through pi's dispatcher instead of the bridge's flow fast-path — but pi-flows registers these names via `pi.registerCommand` too, so the registered handler runs identically. The flow fast-path stays as a fallback for the case where pi-flows is unavailable; **NEEDS DESIGN**: confirm that running pi's dispatcher first does not double-dispatch (pi handler emits its own events).
- No protocol changes. No browser-client changes. No server changes. Bridge-only fix.

**Risks**
- pi's extension-command dispatcher swallows the message (returns `handled: true`) but the handler may throw or fail silently — current bridge has no telemetry on this. Design phase should evaluate whether to surface command-handler errors as `command_feedback { status: "error" }` events.
- Some extension commands may make synchronous assumptions about being run from a TUI context (e.g. expect `ctx.ui.select` / `ctx.ui.input` to render in-terminal). The dashboard's PromptBus already routes those to chat dialogs, so this should be neutral — but worth a smoke test against `/curator` (pi-web-access) and `/agents` (pi-subagents).
- `pi.sendUserMessage` is still exposed and called from other bridge paths (passthrough text, image-bearing messages, multi-line slash text). Those paths are correct as-is and should stay unchanged. The fix is scoped to the slash-without-images fallback.

**Out of scope**
- Adding new extension command types or argument syntax.
- Surfacing extension-command errors as toasts — separate proposal if desired.
- Re-architecting the bridge's `pi` API accessor (`pi.session.prompt` vs `pi.prompt` etc.). Whatever shape pi 0.70 ExtensionAPI exposes is what the fix uses.
