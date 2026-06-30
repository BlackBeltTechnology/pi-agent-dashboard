## Why

The pi compatibility floor is already at 0.78.0 (`packages/server/package.json::piCompatibility`), so pi 0.71/0.72/0.73 are firmly below the floor — every API, event, and UX affordance those releases shipped is guaranteed present at runtime, no version guard required. The dashboard still has not adopted them. This change closes that gap. Six related but independent improvements consolidate here because they all answer the same question: "what does pi 0.73 give us?" Bundling them under one narrative matches how a release-notes reader will think about them.

The six pieces, ordered by pi version they target:

**pi 0.71**:
1. **Remove dead OAuth handlers** — Pi 0.71 removed Google Gemini CLI and Google Antigravity from built-in providers. The dashboard still ships hand-written `geminiCliHandler` and `antigravityHandler` and registers them in the `handlers` Map. After `replace-hardcoded-provider-lists` shipped, the bridge's catalogue does not list these ids on pi 0.71+, so no rows render via the catalogue path — but the dead handlers remain reachable via `getAllHandlers()` / `getProviderHandler(id)`, surfacing as latent ammo for regressions and as 400 errors when an extension registers a NEW OAuth provider via `pi.registerProvider({oauth})` without a matching server handler.
2. **Honor message_end content replacement** — Pi 0.71 added `message_end` extension result support so extensions can replace the finalized assistant message (cost overrides, footers, redactions). The dashboard's `event-reducer.ts::message_end` arm has THREE branches that handle this differently — branches 1 and 2 ignore `data.message.content` and render the pre-replacement delta-derived text, while branch 3 (replay) reads it. Live render and `/reload` show different things.
3. **Use thinking_level_select event** — Pi 0.71 added a dedicated `thinking_level_select` extension event. Today the bridge tracks thinking-level changes by piggybacking on `model_select` and reading `pi.getThinkingLevel?.()` at that moment — works for combined model+level changes, fails for level-only changes.

**pi 0.72**:
4. **Per-model thinking levels** — Pi 0.72 made the BREAKING change of replacing per-model `compat.reasoningEffortMap` with `thinkingLevelMap`. Each model now declares which of `off / minimal / low / medium / high / xhigh` it supports — providers' SDKs differ. The dashboard's `ThinkingLevelSelector` HARDCODES all six and renders them for every model. Users pick `xhigh` on Anthropic Claude → pi silently downgrades or rejects → no UI feedback.
5. **Graceful stop-after-turn** — Pi 0.72 added a `shouldStopAfterTurn` callback in the agent loop. The dashboard today offers two abrupt controls (Abort mid-stream, Force Kill). Missing: a soft "let it finish what it's doing, then stop" — useful when satisfied with the answer and wanting to free the model/budget without losing trailing tokens or producing aborted-tool noise.

**pi 0.73**:
6. **Bash-output streaming UX** — Pi 0.73 made bash tool output stream incrementally via `tool_execution_update` (issue #4145). The dashboard already forwards `tool_execution_update` and the reducer updates `result` in place — but pipes everything through `truncateLines(text, 30)`, which (a) caps any tool output to 30 lines and (b) keeps the FIRST 30 lines, dropping the rest. `npm install` shows the lockfile dance, hides "added 247 packages, 0 vulnerabilities". `pytest` shows test discovery, hides the failure summary.

Each of the six is a small focused change (~5-70 LOC each, ~220 LOC total). Bundling reduces orchestration overhead, makes a coherent release-note section, and keeps capabilities that share a pi-version theme together.

## What Changes

### Phase A — Pi 0.71 catch-up

#### A.1 Remove dead OAuth handlers

- **REMOVE**: `geminiCliHandler`, `antigravityHandler`, and their constants (`GEMINI_*`, `AG_*`, `getGoogleTokenUrl()` helper if unused) from `packages/server/src/provider-auth-handlers.ts`. Remove the two corresponding entries from the `handlers` Map.
- **NEW**: `GET /api/provider-auth/handlers` returning `{ ids: string[] }` — the list of provider ids the dashboard's hand-written registry can drive. Distinct from the catalogue (catalogue id without matching handler id = OAuth provider UI knows about but dashboard cannot complete a login flow for).
- **MODIFY**: `packages/client/src/components/ProviderAuthSection.tsx` fetches `/api/provider-auth/handlers` once on mount, caches as `Set<string>`. For each row in the catalogue with `flowType !== "api_key"` (OAuth), if the id is NOT in the handler-id set, render the login button `disabled` with tooltip "OAuth flow not yet supported in dashboard for `<displayName>`."
- **NEW**: shared response type `ProviderAuthHandlerIdsResponse { ids: string[] }` in `packages/shared/src/rest-api.ts`.
- **MODIFY**: `packages/server/src/__tests__/provider-auth-handlers.test.ts` drops gemini/antigravity assertions.

#### A.2 Honor message_end content replacement

- **NEW**: pure helper `deriveEffectiveAssistantText(msg, fallback)` in `packages/client/src/lib/event-reducer.ts`. Array content concatenates `type: "text"` parts; string content is used directly; missing content falls through to `fallback` (`streamingText`).
- **MODIFY**: `event-reducer.ts::message_end` arm — at the top of the assistant branch compute `effectiveContent` once. Apply uniformly to branches 1 (already-flushed: update `content` IN ADDITION to stamping `entryId`/`nonce`), 2 (streaming-row push: use `effectiveContent` as content), 3 (replay/fork: unchanged).

#### A.3 Use thinking_level_select event

- **MODIFY**: `packages/extension/src/bridge.ts` adds `"thinking_level_select"` to its listened-event list. On receipt, calls `sendModelUpdateIfChanged(...)` from `model-tracker.ts`.
- **VERIFY**: `model-tracker.ts::sendModelUpdateIfChanged` already considers BOTH `model` and `thinkingLevel` for its dedup gate. If it only checks `model`, extend with OR-on `thinkingLevel`.

### Phase B — Pi 0.72 catch-up

#### B.1 Per-model thinking levels

- **MODIFY**: `packages/shared/src/types.ts` extends `ModelInfo` with optional `supportedThinkingLevels?: string[]`.
- **MODIFY**: `packages/extension/src/provider-register.ts` (or wherever `models_list` is built) reads each model's `thinkingLevelMap` defensively (`(model as any).thinkingLevelMap`). When non-null, projects `Object.entries` keys whose value is `string | true` (NOT `null`, which means "this pi level not supported by this model") into `supportedThinkingLevels`. Pre-0.72 models without the map → undefined.
- **MODIFY**: `packages/client/src/components/ThinkingLevelSelector.tsx` accepts optional `supportedLevels?: string[]`. Filters rendered levels to that array preserving canonical order; falls back to all six when undefined.
- **MODIFY**: `packages/client/src/components/StatusBar.tsx` looks up the active model in `models[]` and passes `supportedThinkingLevels` to `<ThinkingLevelSelector>`.

#### B.2 Graceful stop-after-turn

- **NEW protocol message**: `StopAfterTurnBrowserMessage { type: "stop_after_turn"; sessionId: string }` in browser→server union (`packages/shared/src/browser-protocol.ts`); server→bridge equivalent in `packages/shared/src/protocol.ts`.
- **NEW server handler**: `handleStopAfterTurn(msg, ctx)` in `packages/server/src/browser-handlers/session-action-handler.ts`. Forwards to bridge via `piGateway.sendToSession`.
- **MODIFY**: `packages/extension/src/bridge.ts` — on `stop_after_turn`, set per-session flag `shouldStopAfterTurn = true`. Register (once at activation) `pi.events.on("turn_end", ...)` handler that, when the flag is set, calls `cachedCtx.shutdown()` (graceful) — falling back to `cachedCtx.abort()` if `shutdown` is unavailable. Clear flag after the call. Idempotent: repeated `stop_after_turn` while flag set is a no-op.
- **NEW UI**: "Stop after turn" button alongside the existing Abort button in `StatusBar.tsx` (or wherever Abort lives). Visible only when streaming. Click sends `stop_after_turn` over WS; optimistically disables and shows a "stopping after this turn…" pill until next `agent_end` / `session_removed`.

### Phase C — Pi 0.73 catch-up

#### C.1 Bash-output streaming UX

- **NEW helper**: `truncateOutputForDisplay(text, opts)` in `packages/client/src/lib/event-reducer.ts`. Defaults `maxLines: 200`. Keeps the LAST N lines (not first). Prepends a `«N earlier lines hidden»` marker when truncating. Returns text unchanged when `lines.length <= maxLines`.
- **MODIFY**: replace all three `truncateLines(text, 30)` call sites in `event-reducer.ts` (`tool_execution_update.partialResult` structured, `tool_execution_update.partialResult` plain string, `tool_execution_end.result`) with the new helper.
- **NEW server route**: `GET /api/sessions/:sessionId/tool-result/:toolCallId` in `packages/server/src/routes/session-routes.ts`. Looks up the full final result in `MemoryEventStore` (server already retains the full `tool_execution_end` event). Returns 404 if still in flight or evicted. Network-guarded.
- **MODIFY**: `ToolCallStep.tsx` + `BashOutputCard.tsx` — when `result` starts with the truncation marker (`«` prefix), render a "Show full output" button. Click hits the new endpoint and replaces rendered `result`.

## Capabilities

### New Capabilities

(none — all work modifies existing capabilities)

### Modified Capabilities

- `provider-auth-server`: handler registry no longer includes gemini-cli or antigravity. New endpoint `/api/provider-auth/handlers` exposes handler ids.
- `provider-auth-ui`: rows whose `hasOAuth: true` but lack a server handler render disabled-with-tooltip rather than producing 400 errors.
- `event-reducer`:
  - `message_end` honors `data.message.content` replacement uniformly across all three branches.
  - Tool result truncation keeps LAST N lines (default 200) with a `«N earlier lines hidden»` marker, NOT first 30 lines.
- `bridge-extension`:
  - Bridge listens to `thinking_level_select` (pi 0.71+) and emits `model_update` whenever thinking level changes alone.
  - Bridge handles `stop_after_turn` by setting a per-session flag and invoking graceful shutdown at the next `turn_end`.
- `model-selector` (or whichever capability owns the models channel): `ModelInfo` carries `supportedThinkingLevels?: string[]` derived from pi 0.72+'s `thinkingLevelMap`. Bridge populates when present.
- `flow-controls`: includes a graceful "stop after turn" affordance distinct from Abort and Force Kill.
- `dashboard-server`: adds `GET /api/sessions/:sessionId/tool-result/:toolCallId` returning the full final result.
- `bash-execution` / `agent-tool-rendering`: when rendered `result` was truncated, the UI offers a "Show full output" affordance.

## Impact

**LOC**:
- A.1 (dead OAuth): ~50 deleted, ~25 added
- A.2 (msg-end replacement): ~25
- A.3 (thinking_level event): ~5
- B.1 (per-model levels): ~25
- B.2 (graceful stop): ~50
- C.1 (bash streaming UX): ~70
- **Total: ~220 LOC**

**Files**: ~14 source files modified, ~8 new test files.

**Tests**: ~15 new across reducer, server routes, bridge, client components.

**Risk**:
- A.2 changes a hot, recently-tweaked `event-reducer` code path. Existing fix-streaming-text-vs-interactive-ui-order and fix-replay-duplicates-tool-and-flushed-rows tests MUST pass.
- B.2 introduces a new browser-WS message type — additive; old browser tabs ignore.
- C.1 increases tool-result memory cap from 30 to 200 lines per tool call. Spot-check cumulative state size for a heavy session: 200 lines × ~80 chars × 100 tool calls ≈ 1.6 MB — well within reasonable React state.
- A.3 + B.1 are tiny defensive additions: missing pi 0.71/0.72 fields fall through to today's behavior.

**Cross-references**:
- No version-floor precondition: floor is already 0.78.0 (> 0.73), so all targeted APIs are unconditionally present.
- Builds on archived `replace-hardcoded-provider-lists` (catalogue path makes A.1 + B.1 safe — no hardcoded provider/model lists to drift).

## Out of Scope

- Stamping `usage.cost` from `message_end` replacement messages onto `ChatMessage`. Adding `usage` to `ChatMessage` is a larger separate change. A.2 deliberately scopes to **content** + IDs only.
- Maximum-version pin in `piCompatibility`. Unchanged here.
- Subagents / extension-UI improvements that pi 0.71/0.72/0.73 may have shipped — those are not in the bundle of "small UX-affecting catch-ups" this change targets.
