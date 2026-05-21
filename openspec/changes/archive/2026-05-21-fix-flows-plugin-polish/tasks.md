## 1. FlowArchitect → MinimalChatView migration (A1)

- [x] 1.1 In `packages/flows-plugin/src/client/FlowArchitect.tsx`, delete the inline `ToolCallEntry`, `TextEntry`, `ThinkingEntry`, and `extractInputPreview` declarations.
- [x] 1.2 Add `mapArchitectPhase(phase): MinimalChatStatus` adapter (exhaustive `switch` with `never` default) per design Decision 1.
- [x] 1.3 Add `mapArchitectEntries(detailHistory): MinimalChatEntry[]` (effectively identity; explicit for type safety).
- [x] 1.4 Rewrite `FlowArchitectDetail` to render `<MinimalChatView ... mode="popout" />` with the mapped props. Preserve its existing `{ state, onBack }` prop API.
- [x] 1.5 Run the existing architect tests; they SHALL pass without modification (call sites unchanged).
- [x] 1.6 Repo-lint: `rg -n "function (ToolCallEntry|TextEntry|ThinkingEntry|extractInputPreview)" packages/flows-plugin/src/client/FlowArchitect.tsx` SHALL return empty.

## 2. Button sizing + labels (A2)

- [x] 2.1 In `packages/flows-plugin/src/client/FlowAgentCard.tsx`, bump the popout (`mdiOpenInNew`) and detail (`mdiEyeOutline`/`mdiEyeOffOutline`) icon sizes from 0.45 → 0.7.
- [x] 2.2 Add `<span className="hidden sm:inline ml-1 text-xs">Popout</span>` next to the popout icon and `<span className="hidden sm:inline ml-1 text-xs">Details</span>` next to the detail icon. Hide on narrow viewports.
- [x] 2.3 Increase button padding from `p-0.5` → `px-1.5 py-0.5` so the affordance reads as a button, not just an icon.
- [x] 2.4 Apply the same sizing/labels to the architect's detail eye button (`FlowArchitect.tsx`).

## 3. Popout URL hardening (A3)

- [x] 3.1 In `FlowAgentCard.tsx`, replace the popout URL construction with:
  ```ts
  const path = `/session/${encodeURIComponent(sessionId)}/flow/${encodeURIComponent(flowId)}/agent/${encodeURIComponent(agent.stepId)}`;
  const url = new URL(path, window.location.origin).toString();
  window.open(url, "_blank");
  ```
- [x] 3.2 Console-warn (via `console.warn`) when `agent.stepId` is empty or undefined, before opening — so the user sees a hint in dev tools.
- [x] 3.3 Same change for the architect popout button (see Task 4).
- [x] 3.4 Unit test: `buildPopoutUrl(sessionId, flowId, stepId)` (extract as a pure helper) handles slashes / special chars / empty values correctly.

## 4. FlowArchitect popout (A4)

- [x] 4.1 Add `mdiOpenInNew` button in `FlowArchitect.tsx`'s agent-card section, next to the existing detail eye button. URL: `new URL(\`/session/${encodeURIComponent(sessionId)}/architect\`, window.location.origin).toString()`. Open in new tab.
- [x] 4.2 Disabled state + descriptive title when `sessionId` is missing.
- [x] 4.3 Create `packages/flows-plugin/src/client/FlowArchitectPopoutPage.tsx`. Mirror the shape of `FlowAgentPopoutPage`: chrome header (back, breadcrumb `session › "Flow Architect"`), body renders `<FlowArchitectDetail state={...} />`. Four empty-state branches (subscription pending → no session → no architect → resolved).
- [x] 4.4 Set `document.title = \`Flow Architect · ${parentLabel ?? sessionId} · pi\`` while mounted; restore to `"pi"` on unmount.
- [x] 4.5 Create `packages/flows-plugin/src/client/FlowArchitectPopoutClaim.tsx`. Reads slot props `{ params, session, onBack }`. Cold-open subscribes via `usePluginSend({ type: "subscribe", sessionId: params.sid, lastSeq: 0 })`. Reads `architectState` via `useFlowsSessionState(params.sid)`. Renders the page.
- [x] 4.6 Export both new components from `packages/flows-plugin/src/client/index.tsx`.
- [x] 4.7 Add manifest claim to `packages/flows-plugin/package.json`:
  ```json
  { "slot": "shell-overlay-route", "component": "FlowArchitectPopoutClaim", "config": { "path": "/session/:sid/architect", "sessionParam": "sid" } }
  ```
- [x] 4.8 Unit test for `FlowArchitectPopoutClaim` empty-state branches (mirror `SubagentPopoutClaim.test.tsx`).

## 5. Move flow activity badge from WORKSPACE → FLOWS (A5)

- [x] 5.1 Remove `{ "slot": "session-card-badge", "component": "FlowActivityBadgeClaim" }` from `packages/flows-plugin/package.json`'s `pi-dashboard-plugin.claims`.
- [x] 5.2 In `packages/flows-plugin/src/client/SessionFlowActions.tsx`, import `useFlowsSessionState` + `FlowActivityBadge`. At the top of the rendered output (above the action button row), render `<FlowActivityBadge ... />` when `flowState` exists. Pass `flowName`, `agentsDone`, `agentsTotal`, `status` from the resolved `flowState`.
- [x] 5.3 Modify `SessionFlowActionsClaim` to also read `flowState` via `useFlowsSessionState(session.id)` and pass it down to `SessionFlowActions`.
- [x] 5.4 Remove the `FlowActivityBadgeClaim` export from `packages/flows-plugin/src/client/FlowActivityBadge.tsx` (keep the `FlowActivityBadge` renderer). Drop its re-export from `index.tsx`.
- [x] 5.5 Update `shouldRenderFlowsSubcard` (if needed) so the FLOWS subcard renders when EITHER `flowState` exists OR an action button (`flows:new` etc.) is available — current logic already covers both, verify.

## 6. Abort button in the FLOWS-subcard pill (A6)

- [x] 6.1 In `SessionFlowActions.tsx`, when the embedded `<FlowActivityBadge>` is rendering for a `running` flow, append a small "Abort" button after the badge content.
- [x] 6.2 Click handler: `pluginContext.send({ type: "flow_control", sessionId, action: "abort" })` (via `usePluginSend` already in `SessionFlowActionsClaim` — thread the handler through `SessionFlowActions`'s props).
- [x] 6.3 Abort button SHALL be rendered ONLY when status is `running`. Other statuses (success/error/aborted) show the badge without a control.

## 7. Shell decoupling — generic placement-aware suppression (B1, B2)

- [x] 7.1 Create `useHasWidgetBarPrompt(sessionId: string): boolean` in `packages/dashboard-plugin-runtime/src/prompt-component-registry.ts`. Calls `useSessionInteractiveRequests(sessionId)` and tests each pending request via `isWidgetBarPrompt(componentType)`.
- [x] 7.2 Re-export `useHasWidgetBarPrompt` from `packages/dashboard-plugin-runtime/src/index.ts`.
- [x] 7.3 In `packages/client/src/components/SessionCard.tsx`:
  - Delete the local `useHasFlowRoutedPrompt` declaration (lines 60–73 region).
  - Replace all call sites with `useHasWidgetBarPrompt(session.id)` imported from `@blackbelt-technology/dashboard-plugin-runtime`.
  - Confirm no string `"flow-question"` remains in the file.
- [x] 7.4 In `packages/client/src/components/ChatView.tsx`:
  - Where the inline `<InteractiveUiCard>` is rendered for a message of role `interactiveUi` (around line 417–428), wrap in `(() => { const cmp = msg.params?._promptBusComponent as { type?: string } | undefined; if (cmp?.type && isWidgetBarPrompt(cmp.type)) return null; return <InteractiveUiCard ... />; })()` or equivalent.
  - Import `isWidgetBarPrompt` from `@blackbelt-technology/dashboard-plugin-runtime`.
- [x] 7.5 Repo-lint: `rg -n '"flow-question"' packages/client/src/` SHALL return empty (no shell-side plugin-specific literal). Plugin packages may still reference the string in their manifest and adapter code.

## 8. Flow-question history transcript in slot (Decision 8)

- [x] 8.1 In `packages/flows-plugin/src/client/FlowDashboard.tsx`'s `FlowQuestionsSection`, change the filter from "pending only" to "all flow-question requests for `flowId`, regardless of status, capped at 10".
- [x] 8.2 Render pending entries as the existing `<FlowQuestionCard>`. Render non-pending entries as a new `<FlowQuestionTranscriptPill>` (collapsed pill showing question text + answer + status icon).
- [x] 8.3 Order: insertion order, oldest first. Use the existing `interactiveRequests` array order from `useSessionInteractiveRequests` (it appends in arrival order).
- [x] 8.4 Cap at 10 most-recent. Document the cap in `FlowQuestionsSection`'s docblock.
- [x] 8.5 New small component `packages/flows-plugin/src/client/FlowQuestionTranscriptPill.tsx`. Pure React, no external state. Props: `{ question, type, answer, status }`. Visual: muted pill, single line, status icon left.

## 9. C1 — Debug + fix the empty FlowDashboard upper slot during flow execution

- [x] 9.1 Add `import.meta.env.DEV`-gated `console.debug` in `FlowDashboardClaim` logging the resolved `flowState`/`flowStates` shape on every render. Format: `[flows] FlowDashboardClaim render sid=X flowName=Y agents=N`.
- [x] 9.2 Add `import.meta.env.DEV`-gated `console.debug` in `reduceFlowsSessionState` logging which flow events flow through.
- [x] 9.3 Build + restart. User reproduces the flow-run flow (architect → "Run now? Yes" → flow executes).
- [x] 9.4 Capture user's console log; identify root cause.
- [x] 9.5 Likely fixes (decide based on output):
  - If `flow_started` never arrives → producer-side issue (pi-flows). Mark cross-repo, defer.
  - If `flow_started` arrives but with a different flow name → align reducer / dashboard naming convention. Plugin-side fix in `flow-reducer.ts`.
  - If `architectState` is still non-null and the slot consumer picks the architect claim → adjust `FlowArchitectClaim` to return null once a flow has started (track via `architectState.phase === "complete"` plus a subsequent `flow_started`). Plugin-side fix.
- [x] 9.6 Apply the fix in the appropriate file.
- [x] 9.7 Verify by running the same flow again and observing the upper slot now renders the agent grid.

## 10. Build + tests

- [x] 10.1 `npm run build` succeeds.
- [x] 10.2 `npm test 2>&1 | tee /tmp/pi-test-polish.log; grep -nE 'FAIL|Error' /tmp/pi-test-polish.log | head -20` — all suites green.
- [x] 10.3 `curl -X POST http://localhost:8000/api/restart` to pick up server + plugin changes.
- [x] 10.4 `npm run reload` to re-load bridge so the flows-plugin's bridge entry re-registers (in case any bridge code changed — none expected for this PR, but harmless).

## 11. Documentation

- [x] 11.1 Delegate to subagent (caveman style per AGENTS.md): add/update file-index rows for:
  - `packages/flows-plugin/src/client/FlowArchitectPopoutPage.tsx` (NEW)
  - `packages/flows-plugin/src/client/FlowArchitectPopoutClaim.tsx` (NEW)
  - `packages/flows-plugin/src/client/FlowQuestionTranscriptPill.tsx` (NEW)
  - `packages/flows-plugin/src/client/FlowArchitect.tsx` — note `MinimalChatView` shim
  - `packages/flows-plugin/src/client/SessionFlowActions.tsx` — note running-flow pill + abort
  - `packages/dashboard-plugin-runtime/src/prompt-component-registry.ts` — note `useHasWidgetBarPrompt`
- [x] 11.2 No AGENTS.md backbone changes.

## 12. Verification

- [x] 12.1 `openspec validate fix-flows-plugin-polish --strict` passes.
- [x] 12.2 Manual smoke: spawn an architect-and-flow session; confirm
  - FlowArchitect detail expansion uses the new look (MinimalChatView).
  - Eye + Popout buttons are clearly visible with text labels.
  - Popout click opens a working tab (no `about:blank`).
  - FLOWS subcard shows the running-flow pill with abort button.
  - WORKSPACE subcard has no flow content.
  - After "Run now?", upper slot transitions from architect view to flow view (post C1 fix).
  - Answered flow-question prompts appear as transcript pills in the slot, NOT in chat.
- [x] 12.3 Inspect `packages/client/src/components/SessionCard.tsx` — no `"flow-question"` literal remains.
