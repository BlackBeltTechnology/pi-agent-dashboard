## 1. Empirical pre-check

- [x] 1.1 Verify open question 4 from `design.md`: type `/flows:new` (and `/flows:edit`, `/flows:delete`) in dashboard chat and confirm whether they currently fall through to `sendUserMessage` (broken) or hit the bridge's flow fast-path (working). Captured in `notes/preflight-empirical-checks.md` Q1: typed `/flows:*` falls through to `sendUserMessage`; the `flow_management` ws-message path (kebab buttons) is unrelated. `MANAGEMENT_COMMAND_EVENTS` in `command-handler.ts` is currently `{}` (empty), so no typed text reaches `pi.events.emit("flows:new-request")`.
- [ ] 1.2 Reconcile spec routing-order with code reality. Spec steps 8/9 (`/flows:new` → `flows:new-request`, `/flows:edit` → `flows:edit-request`) describe behavior that does NOT exist in the current code (only the `flow_management` ws-message path emits those events). Per design intent, typed `/flows:*` is fixed via Path B (extension dispatch — pi-flows registers these names as extension commands). Update `specs/command-routing/spec.md`:
  - DELETE routing steps 8 and 9 from the "Command routing order" requirement.
  - Renumber subsequent steps (10 → 8 user-defined flow run, 11 → 9 extension command, 12 → 10 fall-through, 13 → 11 default).
  - REPLACE the "Routing precedence — flow fast-path beats extension dispatch" scenario: input `/flows:new` (no user-defined flow with that name, but IS in `pi.getCommands()` with `source:"extension"`) → step 9 (extension dispatch) fires, NOT a non-existent step 8/9.
  - Keep the kebab-button `flow_management` ws-message path documented separately (it's not part of the typed-text command-routing requirement).

## 2. Pure helper + types

- [ ] 2.1 Add `isExtensionSlashCommand(text, commandList)` to `packages/extension/src/bridge-context.ts` next to the existing `filterHiddenCommands` (it already owns the `DASHBOARD_NATIVE_COMMANDS` set). Export it from the same module. Implementation per ADDED Requirement "Extension slash command detection" — pure predicate, no pi calls, no mutation.
- [ ] 2.2 Add unit tests covering all 8 scenarios in the ADDED Requirement (`packages/extension/src/__tests__/extension-slash-command-detection.test.ts`). Each scenario from the spec → one `it()` block. No stub pi needed — pure string + array input.

## 3. Bridge wiring (stopgap path — Path D)

- [ ] 3.1 In `packages/extension/src/bridge.ts::sessionPrompt`, immediately AFTER the existing flow fast-path block and BEFORE the template-expansion fallback, add the extension-command branch: call `pi.getCommands()` (wrap in `try { … } catch { commands = [] }` per task 3.4), run `isExtensionSlashCommand(text, commands)`, and if true:
  - emit `command_feedback { command: text, status: "started" }` via `connection.send` (or whatever the existing `command_feedback` emit path is — match the `/reload`, `/new`, `/model` siblings already in `command-handler.ts`)
  - feature-detect via `hasDispatchCommand(pi)` (task 5.2)
  - if true: `await (pi as any).dispatchCommand(text, { streamingBehavior: "followUp" })` inside a `try/catch`. On resolve emit `command_feedback { command: text, status: "completed" }`. On rejection emit `command_feedback { command: text, status: "error", message: <err.message or stringified err> }` (task 3.5).
  - if false: emit `command_feedback { command: text, status: "error", message: <reason citing pi 0.71+ requirement> }` and `return` without invoking the fallback
  - Guarantee EXACTLY ONE `started` event and EXACTLY ONE terminal event (`completed` OR `error`) per `sessionPrompt` invocation. No duplicate emits on either branch (spec requirement "SHALL NOT emit duplicate command_feedback events on the dispatch path").
- [ ] 3.2 Apply the SAME change to `packages/extension/src/command-handler.ts`'s slash branch's ELSE arm (line ~263, where `options?.sessionPrompt` is undefined and the code falls through to `pi.sendUserMessage(parsed.text)`). The two code paths must stay in lockstep — both routes must apply the extension-command branch before `sendUserMessage`. Consider extracting the branch into a shared helper (`dispatchOrStopgap(pi, text, commandList, sink)`) to avoid drift; place in `bridge-context.ts` or a new `slash-dispatch.ts`.
- [ ] 3.3 Audit every other `pi.sendUserMessage(...)` call site in `command-handler.ts` (search shows 5 sites: passthrough fallback, image-bearing path, multi-line slash path) and confirm NONE of them should also gate through the extension-command branch. The intent is: only typed single-line `/slash` text gates; everything else (multi-line, image-bearing, no-slash) goes raw to the LLM as before. Add inline comments at each `sendUserMessage` site explaining why it's exempt.
- [ ] 3.4 Defensive guard around `pi.getCommands()`. Although the bridge re-captures `bc.pi` on every `session_start` (so `assertActive()` should not fire under normal flow), a stale-ctx race during dispose is theoretically reachable. Wrap the `getCommands()` call inside the new branch in `try { commands = pi.getCommands() } catch (err) { console.warn("[dashboard] getCommands stale", err); commands = [] }`. The empty list silently falls through to the existing template-expansion / sendUserMessage path (preserves today's behavior for that race window). Add unit-test coverage in `bridge-slash-command-routing.test.ts` (task 4.x): stub `pi.getCommands` to throw → assert no crash, no `command_feedback` emitted, fallback `sendUserMessage` called.
- [ ] 3.5 Error handling when `pi.dispatchCommand` rejects. The Path B branch in task 3.1 MUST `await` inside a `try/catch`. On rejection: emit `command_feedback { command: text, status: "error", message: err instanceof Error ? err.message : String(err) }` and DO NOT fall through to `sendUserMessage` (the dispatch attempt was the user's intent — re-sending the literal text would double-send). Cover this in task 4.x with a stub whose `dispatchCommand` rejects with `new Error("boom")`; assert exactly one `started` + one `error` event with the message, zero `sendUserMessage` calls.

## 4. Regression test pinning routing contract

- [ ] 4.1 Create `packages/extension/src/__tests__/bridge-slash-command-routing.test.ts`. Stub `pi` exposes:
  - `getCommands()` returning a small fixture (one extension cmd `ctx-stats`, one skill `skill:foo`, one prompt template `review`, one bridge-native `__dashboard_reload`)
  - `dispatchCommand` (sometimes function, sometimes undefined — toggled per test)
  - `sendUserMessage` — recorded as a call spy; failing the test if hit when it shouldn't be
  - `events.emit` — recorded for flow paths
  - other minimum surface for `createCommandHandler` to construct without throwing
- [ ] 4.2 Drive `commandHandler.handle({ type: "send_prompt", sessionId: "test", text: "<input>" })` for each row of the table in `design.md` Decision 5. Assert call counts + emitted `command_feedback` events match exactly. Cover both `dispatchCommand` available and unavailable.
- [ ] 4.3 Add an explicit anti-regression assertion: `/ctx-stats` MUST never reach `sendUserMessage` regardless of whether `dispatchCommand` is available. Comment the test with `// regression: see openspec/changes/fix-extension-slash-commands-in-dashboard/` so future refactors find it.
- [ ] 4.4 Add a no-duplicate-feedback assertion: for every dispatch path (Path B success, Path B reject, stopgap), assert the recorded `command_feedback` events for the input contain EXACTLY ONE `started` and EXACTLY ONE terminal event (`completed` xor `error`). Pins spec requirement "SHALL NOT emit duplicate command_feedback events on the dispatch path".
- [ ] 4.5 Add a unit test for `hasDispatchCommand(pi)` (task 5.2). Cover three cases: function present → `true`; field absent → `false`; field present but not a function (e.g. `{ dispatchCommand: "yes" }`) → `false`.

## 5. Type definitions + feature detection helper

- [ ] 5.1 Add an optional `dispatchCommand` field to the bridge's local `pi` API type (the `as any` cast in `bridge.ts` is OK, but tighten where reasonable). If pi 0.71 ships before this change archives, replace the cast with the upstream type.
- [ ] 5.2 Centralize the feature-detection in a one-liner helper `hasDispatchCommand(pi): boolean` in `bridge-context.ts`. Used by both call sites in tasks 3.1 and 3.2 to avoid duplicate `typeof === "function"` casts. Implementation: `return typeof (pi as any)?.dispatchCommand === "function"`. Test coverage in task 4.5.
- [ ] 5.3 Audit `DASHBOARD_NATIVE_COMMANDS` (in `packages/extension/src/bridge-context.ts`) against the bridge-registered command set. Confirm `__dashboard_reload` is present. Confirm no other bridge-side `pi.registerCommand(...)` call sites exist that need entries (search: `pi.registerCommand(`). If any are missing, add them. Document the resulting set in a one-line comment above its declaration.

## 6. Documentation + AGENTS.md

- [ ] 6.1 Update `AGENTS.md` "Key Files" entries for `command-handler.ts`, `bridge.ts`, and `bridge-context.ts` with one-line summaries of the new behavior (extension-command stopgap + feature-detected dispatch). Cite this change name (`fix-extension-slash-commands-in-dashboard`) so future readers find the design doc.
- [ ] 6.2 Add a CHANGELOG entry under `## [Unreleased]` noting:
  - Extension slash commands (e.g. `/ctx-stats`, `/curator`, `/agents`) now visibly fail with a `command_feedback` error in the dashboard chat instead of silently sending to the LLM
  - Full dispatch will activate automatically once pi 0.71+ ships `pi.dispatchCommand`
  - Reference the upstream PR (file in step 8) when its URL is known

## 7. Manual verification

- [ ] 7.1 Run `npm run build && curl -X POST http://localhost:8000/api/restart && npm run reload`. In a fresh dashboard session, type `/ctx-stats` (context-mode is already installed in this dev env). Confirm:
  - On pi 0.70: chat shows the started+error `command_feedback`, the LLM is NOT prompted
  - On pi 0.71+ (when available): chat shows started+completed and `ctx.ui.notify` renders the stats card
- [ ] 7.2 Repeat for `/curator` (pi-web-access), `/agents` (pi-subagents) — same expected outcomes.
- [ ] 7.3 Repeat for `/skill:openspec-explore` to verify skill-expansion path is unaffected (still routes through template-expansion → `sendUserMessage`).
- [ ] 7.4 Repeat for `/totally-unknown-command` to verify unknown slashes still passthrough as today.
- [ ] 7.4a Verify the `command_feedback { status: "error", message }` row renders the `message` string in the dashboard chat (not just the status). If the client renderer (`event-reducer.ts` + `CommandFeedback*` component) only displays `started`/`completed` strings today, file a follow-up client task — but smoke-test first to confirm the fix delivers a visible UX signal, not silent server-side state.
- [ ] 7.5 Confirm `/flows`, `/flows:new`, `/flows:edit`, `/flows:delete` still work (flow fast-path takes precedence regardless of extension-command branch).

## 8. Upstream follow-up (separate change, not blocking this one)

- [ ] 8.1 File a PR against `mariozechner/pi-coding-agent` adding `dispatchCommand(text, options?)` to `ExtensionAPI` (declared in `core/extensions/types.d.ts`, wired in `core/extensions/loader.js::createExtensionAPI`, bound in `core/agent-session.js::bindCore`). Implementation delegates to `session.prompt(text, { expandPromptTemplates: true, streamingBehavior: options?.streamingBehavior })`. Reference this design doc in the PR description.
- [ ] 8.1a Pin the argument-shape contract once upstream PR merges. Open Question 3 in `design.md` proposes `{ streamingBehavior?: "steer" | "followUp" }`; if upstream picks a different shape (e.g. `{ deliverAs }`, `{ mode }`), update task 3.1's call site, the regression test in 4.x, and the spec scenario "Extension command dispatched via pi.dispatchCommand" before pi 0.71 propagates to the dashboard's pinned minimum.
- [ ] 8.2 Once upstream PR merges and pi 0.71 releases: open a follow-up dashboard change `use-pi-dispatchCommand-when-available` (already covered by feature detection — likely just removing the stopgap `error` branch once the dashboard's pinned pi minimum bumps). Confirm the existing regression test still passes.
