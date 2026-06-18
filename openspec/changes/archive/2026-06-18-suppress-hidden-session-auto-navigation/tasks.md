## 1. Lock in the regression with failing tests

- [x] 1.1 Create `packages/client/src/hooks/__tests__/useMessageHandler.hidden-nav.test.ts`. Mirror the style of any existing `useMessageHandler` test. Build a harness that constructs the handler via `useMessageHandler(setters, deps)` with a spy `navigate`, a real `pendingSpawnsRef` (a `Map`), a spy `clearSpawningCwd`, and a `spawningCwdsRef` (`Set`).
- [x] 1.2 Scenario "hidden session never navigates (Tier 1)": seed `pendingSpawnsRef` with an entry keyed `rq_42`; dispatch `session_added { session: {…, hidden: true}, spawnRequestId: "rq_42" }`. Assert `navigate` NOT called, the `rq_42` entry STILL present in `pendingSpawnsRef`, `clearSpawningCwd` NOT called. Assert the session WAS added to the session map (via `setSessions`).
- [x] 1.3 Scenario "hidden session never navigates (Tier 2)": add the session's `cwd` to `spawningCwdsRef`; dispatch `session_added { session: {…, cwd, hidden: true} }` (no `spawnRequestId`). Assert `navigate` NOT called, `clearSpawningCwd` NOT called, cwd still in `spawningCwdsRef`.
- [x] 1.4 Scenario "hidden worker does not consume real spawn correlation (Tier 2.5)": seed `pendingSpawnsRef` with a `kind:"spawn"` entry `{ cwd:"/repo", placeholderCwd:"/repo" }` keyed `rq_99`; dispatch `session_added { session: {…, cwd:"/repo", hidden: true} }` (no matching `spawnRequestId`). Assert entry `rq_99` STILL present and `navigate` NOT called. Then dispatch the real `session_added { session:{…, cwd:"/repo", hidden:false}, spawnRequestId:"rq_99" }` and assert `navigate` called with that session's id and `rq_99` removed.
- [x] 1.5 Positive control "visible session still navigates": dispatch `session_added { session:{…, hidden:false}, spawnRequestId:"rq_7" }` with `rq_7` seeded. Assert `navigate` called and entry removed (proves the guard is `hidden`-specific, not a blanket block).
- [x] 1.6 Run `npm test -- useMessageHandler.hidden-nav 2>&1 | tee /tmp/pi-test.log`; confirm 1.2–1.4 fail (current code navigates / consumes) and 1.5 passes. Capture the red baseline.

## 2. Add the hidden guard

- [x] 2.1 In `packages/client/src/hooks/useMessageHandler.ts`, in the `case "session_added"`, keep the `setSessions((prev) => …)` map update unconditional (hidden card must still appear).
- [x] 2.2 Wrap the entire Tier 1 / Tier 2 / Tier 2.5 correlation+navigate block (the `if (msg.spawnRequestId && …) { … } else if (spawningCwdsRef…) { … } else { … }` cascade) in `if (!msg.session.hidden) { … }`.
- [x] 2.3 Add a one-line comment citing this change name explaining why hidden sessions are excluded from correlation+navigation (headless workers share the parent cwd).
- [x] 2.4 Re-run `npm test -- useMessageHandler.hidden-nav`; all four scenarios from §1 pass.

## 3. Verify no regression

- [x] 3.1 `npm test 2>&1 | tee /tmp/pi-test.log` then `grep -nE 'FAIL|✗|✘' /tmp/pi-test.log` — confirm zero new failures (spawn-correlation and placeholder-spawn-card suites still green).
- [x] 3.2 `npm run reload:check` — type-check passes.
- [x] 3.3 Manual check in a running dashboard: open a session, trigger a subagent / `memory` worker, confirm the ChatWindow stays on the current session and the worker appears only as a Hidden-tier card. Then spawn a real session from a folder and confirm it still auto-selects.

## 4. Documentation

- [x] 4.1 Delegate to a docs subagent (caveman style): update the `useMessageHandler.ts` row in `docs/file-index-client.md` with `See change: suppress-hidden-session-auto-navigation` — note hidden sessions excluded from auto-nav + correlation consumption.

## 5. Validate

- [x] 5.1 `npx openspec validate suppress-hidden-session-auto-navigation --strict` returns clean.
