## Phase A — pi 0.71 catch-up

### A.1 Remove dead OAuth handlers + expose handler ids

- [x] A.1.1 In `packages/server/src/provider-auth-handlers.ts`, delete `geminiCliHandler`, `antigravityHandler`, the `GEMINI_*` and `AG_*` constant blocks, and `getGoogleTokenUrl()` if it has no other consumers (search `GOOGLE_TOKEN_URL`/`GEMINI_` in the package). Keep shared `googleAuthCommon` helpers if used elsewhere.
- [x] A.1.2 Remove the `["google-gemini-cli", geminiCliHandler]` and `["google-antigravity", antigravityHandler]` entries from the `handlers` Map.
- [x] A.1.3 In `packages/server/src/__tests__/provider-auth-handlers.test.ts`, drop assertions that fetch `geminiCliHandler` / `antigravityHandler`. Keep tests for anthropic, openai-codex, github-copilot.
- [x] A.1.4 In `packages/server/src/routes/provider-auth-routes.ts`, add `GET /api/provider-auth/handlers` (network-guarded). Returns `{ ids: getAllHandlers().map(h => h.providerId) }`.
- [x] A.1.5 In `packages/shared/src/rest-api.ts`, add `interface ProviderAuthHandlerIdsResponse { ids: string[] }`.
- [x] A.1.6 Test in `packages/server/src/__tests__/provider-auth-routes.test.ts` asserting the route returns `["anthropic","openai-codex","github-copilot"]`.
- [x] A.1.7 In `packages/client/src/components/ProviderAuthSection.tsx`, fetch `/api/provider-auth/handlers` on mount alongside the existing `/api/provider-auth/status` fetch. Cache as `Set<string>`.
- [x] A.1.8 For each row in `oauthProviders` (the `flowType !== "api_key"` partition), compute `supported = handlerIds.has(p.id)`. Pass to the row component.
- [x] A.1.9 In the row component, when `supported === false`, render the login button with `disabled` and `title="OAuth flow not yet supported in dashboard for <displayName>"`. Suppress click handler.
- [x] A.1.10 Test in `packages/client/src/__tests__/ProviderAuthSection.test.tsx` (create if missing): simulates `handlerIds={["anthropic"]}` plus a fixture catalogue containing one extension-registered OAuth row (`id: "custom-llm"`, `hasOAuth: true`); asserts custom-llm row renders disabled.

### A.2 Honor message_end content replacement

- [x] A.2.1 In `packages/client/src/lib/event-reducer.ts`, add pure helper `deriveEffectiveAssistantText(msg, fallback)` near `findFlushedAssistantRowIndex` — array content concatenates `type: "text"` parts; string content used directly; missing falls through to `fallback`.
- [x] A.2.2 Export the helper so test files can import it.
- [x] A.2.3 At the top of the `case "message_end":` block (inside the `msg?.role === "assistant"` guard), compute `const effectiveContent = deriveEffectiveAssistantText(msg, next.streamingText)`.
- [x] A.2.4 Branch 1 (`next.streamingTextFlushed`): when `flushedIdx >= 0`, in the `stamped` object set `content: effectiveContent` ALONGSIDE the existing `entryId`/`nonce` stamps. Only mutate `content` if `effectiveContent !== next.messages[flushedIdx].content` (avoid object-identity churn).
- [x] A.2.5 Branch 2 (`next.streamingText`): use `effectiveContent` (not `next.streamingText`) when pushing the new assistant row.
- [x] A.2.6 Branch 3 (replay/fork) is already correct; verify the "tool-only assistant turn (no prose)" sub-branch still triggers when `effectiveContent === ""`.
- [x] A.2.7 Preserve the existing `reorderToolCardsForAssistantMessage` call at end of arm.
- [x] A.2.8 Tests in new file `packages/client/src/lib/__tests__/event-reducer-message-end-replacement.test.ts`:
  - Already-flushed row content swap → new content + entryId/nonce stamped.
  - Streaming-row push respects msg.content.
  - Fallback when msg.content missing → today's behavior unchanged.
- [x] A.2.9 Run existing event-reducer tests; confirm no regressions in fix-streaming-text-vs-interactive-ui-order, fix-replay-duplicates-tool-and-flushed-rows.

### A.3 Use thinking_level_select event

- [x] A.3.1 In `packages/extension/src/bridge.ts`, add `"thinking_level_select"` to the listened-event list near `model_select`.
- [x] A.3.2 In the bridge's event dispatcher, after the existing `model_select` enrichment block, add a sibling block: when `eventType === "thinking_level_select"`, call `sendModelUpdateIfChanged(...)`.
- [x] A.3.3 Verify `model-tracker.ts::sendModelUpdateIfChanged` reads BOTH `model` and `thinkingLevel`; if not, extend the equality check.
- [x] A.3.4 Test in `packages/extension/src/__tests__/bridge-thinking-level-select.test.ts`:
  - Activate bridge with fake pi capturing `pi.on("thinking_level_select")` handler. Set initial state. Trigger handler with new thinkingLevel (same model). Assert ONE `model_update` sent. Trigger again with same value → no second push.

## Phase B — pi 0.72 catch-up

### B.1 Per-model thinking levels

- [x] B.1.1 In `packages/shared/src/types.ts`, extend `ModelInfo` with `supportedThinkingLevels?: string[]`.
- [x] B.1.2 Update `packages/shared/src/__tests__/protocol.test.ts` (or relevant types test) to assert the new optional field survives serialization round-trip.
- [x] B.1.3 In `packages/extension/src/provider-register.ts` (or wherever `models_list` is built), in the per-model projection block, defensively read `(model as any).thinkingLevelMap`. When non-null object, project keys whose value is `string | true` (NOT `null`) into `supportedThinkingLevels`. Pre-0.72 → undefined.
- [x] B.1.4 Test in `packages/extension/src/__tests__/provider-register-thinking-levels.test.ts`: inject fake `modelRegistry.getAll()` with two models — one having `thinkingLevelMap: { medium: "medium", high: "high", xhigh: null }`, one without. Build the catalogue. Assert first model's `supportedThinkingLevels` is `["medium", "high"]`, second's is undefined.
- [x] B.1.5 In `packages/client/src/components/ThinkingLevelSelector.tsx`, add optional prop `supportedLevels?: string[]`. Compute `levelsToRender = supportedLevels?.length ? THINKING_LEVELS.filter(l => supportedLevels.includes(l)) : THINKING_LEVELS`. Render `levelsToRender.map(...)`.
- [x] B.1.6 In `packages/client/src/components/StatusBar.tsx`, find the lookup of the current model among `models[]`. Pass `currentModel?.supportedThinkingLevels` to `<ThinkingLevelSelector>`.
- [x] B.1.7 Test in `packages/client/src/__tests__/ThinkingLevelSelector.test.tsx`:
  - With `supportedLevels=["medium","high"]`, assert dropdown renders exactly those two.
  - With `supportedLevels` undefined or empty, assert dropdown renders all six.

### B.2 Graceful stop-after-turn

- [x] B.2.1 In `packages/shared/src/browser-protocol.ts`, add `interface StopAfterTurnBrowserMessage { type: "stop_after_turn"; sessionId: string }`. Add to browser→server union.
- [x] B.2.2 In `packages/shared/src/protocol.ts`, add the corresponding server→bridge message of the same shape; add to server→extension union.
- [x] B.2.3 Round-trip JSON test in `packages/shared/src/__tests__/protocol.test.ts` (and browser-protocol equivalent).
- [x] B.2.4 In `packages/server/src/browser-handlers/session-action-handler.ts`, add `handleStopAfterTurn(msg, ctx)` that calls `ctx.piGateway.sendToSession(msg.sessionId, { type: "stop_after_turn", sessionId: msg.sessionId })`.
- [x] B.2.5 Wire `handleStopAfterTurn` into the dispatch table in `packages/server/src/browser-gateway.ts`.
- [x] B.2.6 Test in `packages/server/src/browser-handlers/__tests__/session-action-handler.test.ts`: inject fake `piGateway`; send `stop_after_turn`; assert `sendToSession` called with matching shape.
- [x] B.2.7 In `packages/extension/src/bridge-context.ts` (or wherever per-session bridge state is held), add `shouldStopAfterTurn?: boolean`.
- [x] B.2.8 In `packages/extension/src/bridge.ts`, in the server→bridge dispatcher, add a case for `stop_after_turn`: set `getBridgeState().shouldStopAfterTurn = true` (idempotent).
- [x] B.2.9 During bridge activation (once), register `pi.events.on("turn_end", () => { if (getBridgeState().shouldStopAfterTurn) { (cachedCtx?.shutdown?.() ?? cachedCtx?.abort?.()); getBridgeState().shouldStopAfterTurn = false; } })`. Wrap in try/catch.
- [x] B.2.10 Test in `packages/extension/src/__tests__/bridge-stop-after-turn.test.ts`: receive `stop_after_turn` → flag set; trigger `turn_end` → `shutdown` called once + flag cleared; trigger another `turn_end` → no further shutdown.
- [x] B.2.11 In `StatusBar.tsx` (or wherever Abort lives), add a sibling "Stop after turn" button (`mdiStopCircleOutline`). Visible only during streaming.
- [x] B.2.12 On click, dispatch `stop_after_turn` via the existing browser-protocol send helper.
- [x] B.2.13 After click, optimistically disable the button and show a "stopping after this turn…" pill. Pill clears on next `agent_end` / `session_removed`.
- [x] B.2.14 Test in `packages/client/src/__tests__/StopAfterTurnButton.test.tsx`: render with streaming → button visible; click → message sent; render with idle → button absent.

## Phase C — pi 0.73 catch-up

### C.1 Bash output streaming UX

- [x] C.1.1 In `packages/client/src/lib/event-reducer.ts`, add helper `truncateOutputForDisplay(text, opts?: { maxLines?: number }): string`. Default maxLines=200. Keeps last N lines. Prepends `«N earlier lines hidden»` marker when truncating. Returns text unchanged when `lines.length <= maxLines`.
- [x] C.1.2 Replace all three call sites of `truncateLines(text, 30)` in `event-reducer.ts` with `truncateOutputForDisplay(text)`: structured `tool_execution_update.partialResult`, plain-string `tool_execution_update.partialResult`, `tool_execution_end.result`.
- [x] C.1.3 Tests in new file `packages/client/src/lib/__tests__/event-reducer-truncation.test.ts`:
  - 500-line input on `tool_execution_update.partialResult` → marker `«300 earlier lines hidden»` + last 200 lines.
  - 10-line input → unchanged (no marker).
  - 1000-line input on `tool_execution_end.result` → marker + last 200 lines.
- [x] C.1.4 In `packages/server/src/routes/session-routes.ts`, add `GET /api/sessions/:sessionId/tool-result/:toolCallId` (network-guarded). Looks up the `tool_execution_end` event in `MemoryEventStore` keyed on `toolCallId`. Returns `{ result, isError }` (200) on hit, `{ error: "tool call still in flight or unknown" }` (404) on miss.
- [x] C.1.5 In `packages/server/src/memory-event-store.ts` (or wherever the event buffer lives), add a small lookup helper `findToolEndEvent(sessionId, toolCallId)` if not already exposed. Pure read; no new persistence.
- [x] C.1.6 Test in new file `packages/server/src/__tests__/session-routes-tool-result.test.ts`:
  - Completed tool call → 200 with full result.
  - In-flight tool call → 404.
  - Evicted tool call → 404.
- [x] C.1.7 In `packages/client/src/hooks/useToolFullResult.ts` (new file), add a fetch hook that takes `sessionId` + `toolCallId`, calls the new endpoint, returns `{ result?: string; error?: string; loading: boolean }`.
- [x] C.1.8 In `packages/client/src/components/ToolCallStep.tsx`, when `result` starts with the `«` prefix (truncation marker present), render a "Show full output" button below the rendered result. Click invokes `useToolFullResult` and replaces rendered text with the full result. Subsequent collapse re-shows the truncated form.
- [x] C.1.9 Mirror the same affordance in `packages/client/src/components/BashOutputCard.tsx`.
- [x] C.1.10 Render a small "result evicted" message in the inline area when the endpoint returns 404 (server has dropped the event under memory pressure).

## Verification

- [x] V.1 `npm test` passes.
- [x] V.2 `npm run build` succeeds.
- [x] V.3 Manual: spawn a session with pi 0.73. Open Settings → Provider Authentication. Confirm gemini-cli/antigravity absent. With an extension that registers an OAuth provider without server handler, that row renders disabled with tooltip.
- [x] V.4 Manual: ask the agent a question whose tool call produces > 200 lines of output (e.g. `npm install`). Confirm: live render shows the LAST 200 lines + `«N earlier lines hidden»` marker. Click "Show full output" → full result fetched.
- [x] V.5 Manual: change thinking level via pi's UI without changing model. Status bar updates immediately (no waiting for model change).
- [x] V.6 Manual: open ThinkingLevelSelector against an Anthropic model. Confirm only the levels that model supports appear (not all six).
- [x] V.7 Manual: in a streaming session, click "Stop after turn". Confirm agent finishes the current turn cleanly + session ends gracefully (no aborted-tool noise, no truncated final message). Force Kill still works as a separate path.
- [x] V.8 Manual: extension that uses `message_end` content replacement runs. Confirm live render and `/reload` show identical text.

## Documentation

- [x] D.1 CHANGELOG `[Unreleased] / ### Removed`: "Removed dashboard OAuth handlers for `google-gemini-cli` and `google-antigravity` — pi 0.71 removed both as built-in providers."
- [x] D.2 CHANGELOG `[Unreleased] / ### Added`: combined bullet covering A.1-UI gap detection, B.1-per-model thinking levels, B.2-stop-after-turn, C.1-streaming bash output with last-N + Show full output.
- [x] D.3 CHANGELOG `[Unreleased] / ### Fixed`: "Assistant message text now honors pi 0.71+ extension `message_end` content replacement (e.g. footers, redactions). Previously the live render kept delta-derived text while `/reload` showed the replacement, producing a visible drift."
- [x] D.4 CHANGELOG `[Unreleased] / ### Changed`: "Bridge subscribes to pi 0.71+ `thinking_level_select` event so dashboard reflects thinking-level changes immediately rather than waiting for the next model change."
- [x] D.5 Update `docs/file-index-server.md` for `provider-auth-handlers.ts`, `routes/provider-auth-routes.ts`, `routes/session-routes.ts`, `browser-handlers/session-action-handler.ts`, `memory-event-store.ts` (caveman style).
- [x] D.6 Update `docs/file-index-client.md` for `event-reducer.ts` (deriveEffectiveAssistantText + truncateOutputForDisplay), `ProviderAuthSection.tsx`, `StatusBar.tsx`, `ThinkingLevelSelector.tsx`, `ToolCallStep.tsx`, `BashOutputCard.tsx`, `hooks/useToolFullResult.ts` (new).
- [x] D.7 Update `docs/file-index-extension.md` for `bridge.ts` (thinking_level_select listener, stop_after_turn handler), `provider-register.ts` (thinkingLevelMap projection), `model-tracker.ts` if its dedup gate changed.
- [x] D.8 Update `docs/file-index-shared.md` for `types.ts` (supportedThinkingLevels), `protocol.ts` (stop_after_turn), `browser-protocol.ts` (stop_after_turn), `rest-api.ts` (ProviderAuthHandlerIdsResponse).

## Archive readiness

- [x] R.1 `openspec validate adopt-pi-071-072-073-features` passes.
- [x] R.2 No version-floor precondition: floor already 0.78.0 (> 0.73). Confirm `packages/server/package.json::piCompatibility.minimum` is still >= 0.73.0 at archive time.
- [x] R.3 Hand off for archival via `openspec-archive-change` once V.1-V.8 + D.1-D.8 green.
