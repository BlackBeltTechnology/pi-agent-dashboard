## Context

The proposal identified the symptom (typed `/ctx-stats` reaches LLM as plain text) and named the culprit line in `bridge.ts` (`pi.sendUserMessage(...)` — pi's own bypass-extension-commands path). The proposed one-line fix was to call `pi.session.prompt(...)` instead.

That fix turns out to be **impossible with pi 0.70's public ExtensionAPI**. Verified by reading `~/.nvm/.../pi-coding-agent/dist/core/extensions/types.d.ts:770-922` and `loader.js:155-260`:

```
ExtensionAPI exposes:
  - sendMessage           (custom messages, doesn't dispatch slashes)
  - sendUserMessage       (raw user input — explicitly bypasses dispatcher)
  - registerCommand       (handlers stored privately on the runner)
  - getCommands           (returns SlashCommandInfo[] — name+description, NO handler)
  - events                (EventBus — extension↔extension channel, NOT a route to session.prompt)
  - exec, setSessionName, getActiveTools, ...

ExtensionAPI does NOT expose:
  - prompt
  - session
  - dispatchCommand
  - any path to _tryExecuteExtensionCommand
```

Pi's `agent-session.js:1715` calls `runner.bindCore({ sendMessage, sendUserMessage, appendEntry, setSessionName, ... })` — there is no `prompt` action wired in, so even reaching into the runtime via reflection wouldn't yield it. The slash-command interception is a privilege of pi's external `prompt()` entry point (called from the TUI's input handler and from RPC mode's `case "prompt"` arm), never delegated to extensions.

This forces a re-scope. The original proposal's diff (`pi.sendUserMessage` → `pi.session.prompt`) cannot be written. The fix has to happen at a different layer. This design lays out the three viable layers and recommends one.

## Goals / Non-Goals

**Goals:**
- Make `/ctx-stats`, `/curator`, `/agents`, and any future `pi.registerCommand`-registered slash command actually run their handler when typed in the dashboard chat input.
- Preserve every existing routing behavior: bang commands, `/compact`, `/quit`, `/reload`, `/new`, `/model`, `/flows*`, `/__dashboard_reload`, prompt templates, skill expansion (`/skill:foo`), passthrough text, image-bearing messages.
- No new browser-client UI. Slash commands should "just work" the same way they do in pi's TUI — autocomplete already shows them, typing+Enter should dispatch them.
- Telemetry: when an extension command runs, surface its lifecycle (`started` → `completed` / `error`) as `command_feedback` events so users see "✓ /ctx-stats" in chat instead of silence.

**Non-Goals:**
- New extension types or argument syntax for slash commands.
- Cross-extension command invocation (extension A triggering extension B's `/foo`). Out of scope; same constraint exists in pi TUI.
- Replacing the bridge with direct server↔pi RPC. Mentioned as an option below but rejected — too invasive for the symptom's severity.
- Surfacing extension-command errors as toasts/notify cards. Deferred to a follow-up. This change emits `command_feedback` events; the client already renders those.

## Decisions

### Decision 1: Dispatch path — upstream pi API addition (Path B), with a dashboard-side stopgap (Path D)

We considered four paths. Summary table:

| Path | Approach | Fix scope | Ships when | Recommendation |
|---|---|---|---|---|
| A | Bridge looks up command via `getCommands()` and self-dispatches | impossible — handler ref is private | n/a | rejected |
| B | Add `pi.dispatchCommand(text)` to pi `ExtensionAPI` | upstream pi-coding-agent + 3-line bridge change | pi 0.71+ | **primary** |
| C | Server bypasses bridge for slashes, writes RPC `prompt` to pi stdin | invasive — touches pi-gateway.ts, browser-handlers, server, command-handler | now | rejected (too invasive) |
| D | Bridge detects known extension commands via `getCommands()`, surfaces a `command_feedback { status: "error", message }` instead of silently sending to LLM | dashboard-only, ~20 lines | now | **stopgap until pi 0.71+** |

**Path B chosen as primary.** Rationale:
- Pi already has the dispatch logic implemented (`agent-session.js:798 _tryExecuteExtensionCommand`). Exposing it is a 5-line addition to `ExtensionAPI` + `bindCore` + `loader.js`'s api-object factory.
- Conceptually clean: extensions already have `sendUserMessage` (raw user input bypassing slash dispatch) and `sendMessage` (custom messages). Adding `dispatchCommand` (raw user input WITH slash dispatch) closes the obvious gap.
- The bridge change is exactly what the original proposal anticipated: replace `pi.sendUserMessage(text, {deliverAs:"followUp"})` with `pi.dispatchCommand(text, {streamingBehavior:"followUp"})` (or whatever shape upstream chooses). Three lines.

**Path D chosen as interim.** Rationale:
- Avoids the worst UX failure mode (silent send-to-LLM) without waiting on upstream.
- Strictly additive: when `pi.dispatchCommand` is unavailable, the bridge inspects `pi.getCommands()` for a name match and emits a `command_feedback { status: "error", message: "Extension slash command '/<name>' is registered but cannot be dispatched from the dashboard chat (waiting on pi 0.71+ for `pi.dispatchCommand` API). Use the extension's tools or invoke from pi TUI." }` instead of sending to the LLM.
- Removable as a single block once Path B ships and the bridge starts using `pi.dispatchCommand`.

**Path C rejected.** Server-as-direct-RPC-client would require:
- Tracking which pi process owns which session (server already does via `headless-pid-registry`, but it's PID-only — no stdin handle)
- Capturing pi's stdin from the spawn site (`process-manager.ts`'s `spawnPiSession`) and exposing it through `pi-gateway.ts`
- Browser-handlers/session-action-handler.ts splitting `send_prompt` between "extension command → server-side RPC inject" and "everything else → bridge"
- Reworking the bridge's command-handler to skip the slash branch

The architectural cost is far higher than the symptom warrants, and it leaves the bridge architecturally inconsistent (bridge owns most session ops; suddenly a fraction route around it).

**Path A rejected** — the handler is private to the runner, exposed nowhere on the api object.

### Decision 2: Detection rule for Path D

The bridge's `sessionPrompt` fallback detects extension slash commands by intersecting the typed text's command name against `pi.getCommands()` filtered to `source === "extension"` AND not in `DASHBOARD_NATIVE_COMMANDS` (the existing filter applied in `bridge-context.ts::filterHiddenCommands`). Skill commands (`source: "skill"`), prompt templates (`source: "prompt"`), and bridge-native commands (`__dashboard_reload`) are NOT treated as extension commands and continue through the existing template-expansion path.

The intersection is computed once per `sessionPrompt` invocation (no caching) — `getCommands()` is already O(1) cached on pi's runtime side.

### Decision 3: When `pi.dispatchCommand` is available — feature detection

The bridge feature-detects `typeof (pi as any).dispatchCommand === "function"`. If true: route slash commands through it. If false: apply Path D's stopgap. No version-string sniffing.

This way, the same bridge build works against pi 0.70 (stopgap kicks in) and pi 0.71+ (dispatch kicks in) without recompilation.

### Decision 4: Telemetry events

- **Before dispatch**: emit `command_feedback { command: "/<name>", status: "started" }`. Mirrors the existing pattern for `/reload`, `/new`, `/model`, etc.
- **After dispatch (Path B path)**: emit `command_feedback { command: "/<name>", status: "completed" }`. Pi's `_tryExecuteExtensionCommand` already swallows handler exceptions and emits `extension_error` events on the runner — no per-command try/catch needed in the bridge. The dashboard already renders `extension_error` as a chat error row.
- **Stopgap path (Path D)**: emit `command_feedback { command: "/<name>", status: "error", message: "<unsupported reason>" }` and DO NOT call `sendUserMessage`. This is a deliberate UX improvement over today's silent fall-through.

### Decision 5: Test shape

A regression test in `packages/extension/src/__tests__/bridge-slash-command-routing.test.ts` (new file). Constructs a stub pi object with both `dispatchCommand` (when present) and `sendUserMessage` (always present). Drives `command-handler.handle(...)` with various send_prompt payloads and asserts:

| Input | `dispatchCommand` calls | `sendUserMessage` calls | `command_feedback` |
|---|---|---|---|
| `/ctx-stats` (extension cmd, dispatch available) | 1 | 0 | started + completed |
| `/ctx-stats` (extension cmd, no dispatch) | 0 | 0 | started + error |
| `/skill:foo` (skill) | 0 | 1 (expanded) | none |
| `/some-prompt-template` | 0 | 1 (expanded) | none |
| `hello world` (passthrough) | 0 | 1 (raw) | none |
| `/compact` | 0 | 0 (routed via compact() instead) | started + completed |
| `/flows:new` (flow command) | 0 | 0 (routed via events.emit) | completed |

The test pins the contract that extension slash commands NEVER fall through to `sendUserMessage`. If a future refactor accidentally re-introduces the bug, the test fails on the `sendUserMessage` call count.

## Risks / Trade-offs

- **[Upstream dependency for full fix] → Path D ships standalone.** The complete fix requires a pi-coding-agent change. Until pi 0.71+ lands and propagates to user installs, the dashboard will visibly refuse to dispatch extension slash commands instead of silently corrupting the conversation. That's a UX regression for any user who previously typed e.g. `/curator` and saw the LLM hallucinate a response — but it's a clearer signal of the underlying limitation. Document in CHANGELOG.

- **[Path D false-positives if `getCommands()` includes commands that ARE dispatchable through some other route] → Whitelist of bridge-native names.** The bridge's own `__dashboard_reload` is hidden via `filterHiddenCommands`, so it won't appear. The flows family (`/flows*`) IS in `getCommands()` from pi-flows extension AND is short-circuited by the bridge's flow fast-path before reaching the fallback. The detection rule must therefore run AFTER the flow fast-path check, which is the natural placement (it's already the fallback branch). No additional bookkeeping needed.

- **[Path D breaks `/agents`, `/curator`, `/websearch` etc. that currently send to LLM and "kind of work" because the LLM hallucinates a sensible response] → Acceptable.** Today's "kind of works" is non-deterministic and confuses users about what these commands actually do. Failing loudly is strictly better; users can still invoke the underlying tools (`web_search`, `subagent`, etc.) directly.

- **[`pi.dispatchCommand` upstream API shape might differ from what we assume] → Implementation pinned to feature detection, no version assumption.** If pi 0.71+ chooses a different name (`pi.runCommand`, `pi.invokeCommand`), the bridge's feature-detect check needs to update — but the test contract is unchanged, just the symbol probed. Worst case: a follow-up PR after upstream lands.

- **[`command_feedback` events are not all rendered identically in the dashboard chat] → Verify with existing renderer.** The client's `event-reducer.ts` handles `command_feedback` with `status` ∈ `{started, completed, error}` for `/reload`, `/new`, `/model`, `/compact`. Same renderer applies; no client changes expected.

- **[Multi-line slash text (e.g. `/skill:foo\nuser context`) classified as "passthrough" by `parseSendPrompt`] → unaffected.** `parseSendPrompt` only emits `type: "slash"` for single-line slashes. Multi-line text routes via the passthrough → `sendUserMessage` path (the comment in command-handler.ts:282 calls this out explicitly). The fix is scoped to single-line slash text.

## Migration Plan

Two-step rollout, gated by feature detection:

1. **Step 1 (this change, dashboard-only):** Add Path D's stopgap to bridge. Detect extension slash commands via `pi.getCommands()` filter and emit `command_feedback { status: "error" }` instead of falling through to `sendUserMessage`. Add the regression test. Ships in next dashboard release without waiting on upstream.

2. **Step 2 (upstream + dashboard, follow-up):** Open a PR against `mariozechner/pi-coding-agent` adding `pi.dispatchCommand(text, options?)` to `ExtensionAPI`. Once merged + released as pi 0.71, update the dashboard's bridge to feature-detect `dispatchCommand` and use it when available. Path D stays in place as a fallback for users still on pi 0.70. The same regression test covers both paths via the table in Decision 5.

**No data migration**, no schema changes, no settings migration. Bridge-only on the dashboard side.

**Rollback strategy**: revert the bridge commit. Behavior reverts to today's silent send-to-LLM. No persistent state to clean up.

## Open Questions

1. **Should Path D's error `command_feedback` carry a structured `code` field?** e.g. `{ status: "error", code: "EXTENSION_COMMAND_NOT_DISPATCHABLE", command, message }`. Useful for future programmatic handling (auto-suggest equivalent tool calls, etc.). Defer unless the client renderer benefits — currently it just shows the human message.

2. **Should the autocomplete dropdown display extension slash commands differently when `dispatchCommand` is unavailable?** e.g. greyed-out + tooltip "requires pi 0.71+". Out of scope for this change (no client UI changes), but worth a follow-up if Path D's error events feel like a poor experience in practice.

3. **What's the reasonable upstream PR shape for `pi.dispatchCommand`?** Likely:
   ```ts
   /** Dispatch a slash command (e.g. "/foo args"). If no extension command matches,
    * the text is passed through to the LLM as a regular user message. */
   dispatchCommand(text: string, options?: { streamingBehavior?: "steer" | "followUp" }): Promise<void>;
   ```
   Resolved when Step 2 is filed; not blocking for this change.

4. **Does pi-flows' typed `/flows*` commands actually run via the existing flow fast-path, or do they too fall through to `sendUserMessage`?** Testing notes in proposal said the fast-path catches button-triggered flow management, not typed text. **Action**: empirically verify before tasks.md, since the answer changes whether `/flows:new` typed in chat is also a stopgap target. Likely already broken the same way; if so, this change fixes it for free.
