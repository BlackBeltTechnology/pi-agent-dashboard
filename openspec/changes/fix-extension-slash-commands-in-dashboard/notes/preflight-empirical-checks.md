# Preflight empirical checks

Performed during explore mode before `/opsx:apply` to resolve open questions
in `tasks.md` task 1.1 and design.md "Open Question 4". Pin these answers so
the implementing agent can skip re-verification.

## Q1: Are typed `/flows:new`, `/flows:edit`, `/flows:delete`, `/flows`, `/roles` already broken in dashboard chat the same way as `/ctx-stats`?

**Answer: YES.** All pi-flows-registered slash commands fall through to
`sendUserMessage` in dashboard chat today. The flow buttons in the kebab
menu mask the bug because they route via the `flow_management` ws message
type (different handler entirely).

### Trace

`bridge.ts::sessionPrompt` (line ~561) gates flow dispatch on:

```ts
const flowsList = getFlowsList();   // pi-flows' "flow:list-flows" event probe
if (flowsList.some(f => f.name === cmdName)) {
  pi.events.emit("flow:run", { flowName: cmdName, task });
  return;
}
```

`getFlowsList()` returns USER-DEFINED flows (names the user authored in the
flow architect, e.g. `deploy-prod`, `review-pr`). It does NOT include the
pi-flows extension's own registered slash commands. So `cmdName === "flows:new"`
never matches a user-defined flow, and the branch falls through to the
`sendUserMessage` fallback.

### Empirical proof

Spawning `pi --mode rpc` (the same mode the dashboard uses) and sending
the RPC `prompt` command directly — which calls `session.prompt(text)` and
DOES run `_tryExecuteExtensionCommand`:

```bash
$ echo '{"type":"prompt","message":"/flows:new","id":"1"}' | pi --mode rpc
{"type":"extension_ui_request","method":"input","title":"Describe what the flow should do:"}
```

The pi-flows extension correctly handles `/flows:new` and calls
`ctx.ui.input(...)` for the task description. The dashboard chat's
`send_prompt` path doesn't reach this code because the bridge translates
typed slash commands into `pi.sendUserMessage(text, { deliverAs: "followUp" })`,
which pi explicitly documents as the "skip command handling" path
(`agent-session.js:1002`).

### Spec impact

- The fix in this change will START making typed `/flows:*` work in dashboard
  chat. Today they're silently broken (text sent to LLM, which often
  hallucinates plausible flow output).
- Tasks 7.5 in `tasks.md` becomes a positive verification — confirm the
  command STARTS working after the fix, not just stays working.
- CHANGELOG should call out this implicit fix beyond `/ctx-stats`.

## Q2: Which `pi.sendUserMessage` call sites in `command-handler.ts` need the extension-command gate?

**Answer: only 2 of the 5 sites — `command-handler.ts:264` (mirror of `bridge.ts:572`).**

### All 5 sites mapped

| Line | Path                                   | Needs gate? | Why |
|------|----------------------------------------|-------------|-----|
| 264  | slash else-arm (no `options.sessionPrompt`) | **YES**     | Same logical path as `bridge.ts:572` — fired when bridge wiring isn't provided (older callers). Must apply identical extension-command branch. |
| 286  | passthrough → `sendUserMessageWithImages` for multi-line slashes (`/skill:foo\nuser ctx`) and image-bearing input | NO  | Multi-line slashes are intentionally NOT extension commands. The pure helper `isExtensionSlashCommand` (ADDED Requirement) rejects multi-line input, so the gate would no-op even if applied. Keep as-is. |
| 453  | inside `sendUserMessageWithImages` — image-bearing content array | NO  | Internal helper. Caller (line 286) already past the gate decision. |
| 455  | inside `sendUserMessageWithImages` — fallback when no valid images survive validation | NO  | Same — internal helper. |
| 458  | inside `sendUserMessageWithImages` — text-only path | NO  | Same — internal helper. |
| 495  | `handleBashCommand` — sends `$ <cmd>\n<output>` after `!cmd` runs | NO  | Bash output forwarding to LLM. Has nothing to do with slash routing. |

### Conclusion for `tasks.md` task 3.3

The audit is complete. Only `bridge.ts:572` and `command-handler.ts:264` need
the extension-command branch. The remaining sites stay verbatim. Task 3.3's
inline-comment requirement ("explain why each `sendUserMessage` site is
exempt") still applies — it serves as a forward-defense against future
contributors re-introducing the bug at a different site.

## Result

- Task 1.1 → answered: typed `/flows:*` is broken; fix improves UX beyond `/ctx-stats`.
- Task 3.3 → audit complete: 2 sites need the gate (already covered by 3.1/3.2), 3 are correctly exempt.
- No spec or design updates needed — both artifacts already cover these cases via the routing-order requirement (step 11) and the `isExtensionSlashCommand` multi-line rejection scenario.

The change is ready for `/opsx:apply` without further blocking questions.
