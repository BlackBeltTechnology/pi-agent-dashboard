# DOX — packages/client/src/lib/chat

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `attachment-original-url.ts` | Builds the full-resolution originals URL for a transcript attachment. Exports `attachmentOriginalUrl(sessionId, attachmentId)` -> `/api/sessions/<sid>/attachments/<id>` or `null`. MIRRORS the server's id contract (`^[0-9a-f]{64}$`) and returns `null` for a malformed id, so the zoom path never issues a request the server would only 400. `sessionId` is percent-encoded so it cannot escape its path segment. Consumed by `ChatView`'s ImageAttachments -> ImageLightbox `src`, with the inline fitted derivative passed as `fallbackSrc` (F6: a failing original degrades ONLY the zoom). See change: fit-attachments-for-display. |
| `chat-selection-copy.ts` | Pure `buildSelectionClipboardText(range, container)`: rebuilds clipboard text for a transcript `copy`. → see `chat-selection-copy.ts.AGENTS.md` |
| `chat-virtual-rows.ts` | Pure helpers for the windowed (TanStack Virtual) transcript. → see `chat-virtual-rows.ts.AGENTS.md` |
| `coalesce-live-events.ts` | `foldLiveEvents(queued)` — pure fold that coalesces queued live WS events (`QueuedLiveEvent`) before dispatch. |
| `collapse-retried-errors.ts` | ChatView duplicate-collapse helpers. `findRetriedErrorIds` flags failed `toolResult` superseded by successful… → see `collapse-retried-errors.ts.AGENTS.md` |
| `command-filter.ts` | Exports `filterCommands(commands, filter)` — case-insensitive substring match on `CommandInfo.name` or `description`. Returns input unchanged when filter empty. |
| `event-reducer.ts` | `ChatMessage` gains `view?: ViewTarget` field. View rows produced by server-side `ViewMessageStore` are… → see `event-reducer.ts.AGENTS.md` |
| `group-tool-bursts.ts` | Temporal burst grouping — OUTER pass over `groupConsecutiveToolCalls`. → see `group-tool-bursts.ts.AGENTS.md` |
| `group-tool-calls.ts` | Collapses repetitive retry loops in chat view. Exports `ToolCallGroup`, `ChatItem`,… → see `group-tool-calls.ts.AGENTS.md` |
| `linkify-tool-output.ts` | Pure tokeniser. Exports `tokenize(text): Token[]`, `MAX_LINKS=5000`. → see `linkify-tool-output.ts.AGENTS.md` |
| `message-queue.ts` | Offline outgoing message queue. Exports `MessageQueue` class — `setSendFunction`, `enqueue` (caps at 10,… → see `message-queue.ts.AGENTS.md` |
| `prompt-answer-encoder.ts` | Pure helper encoding interactive renderer `result` → `answer` string for PromptBus `prompt_response`. → see `prompt-answer-encoder.ts.AGENTS.md` |
| `prompt-component-registry.ts` | Compatibility shim re-exporting prompt component registry from… → see `prompt-component-registry.ts.AGENTS.md` |
| `tool-summary.ts` | One-line tool-call summaries (`$ <cmd>`, `Read <path>`, `Grep …`, `git …`, `kb_search …`, `ctx_* …`). → see `tool-summary.ts.AGENTS.md` |
