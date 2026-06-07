## 1. Shared types & protocol

- [x] 1.1 Add `ephemeral?: boolean` to `TerminalSession` in `packages/shared/src/terminal-types.ts`
- [x] 1.2 Add `inline_terminal_open { terminalId }` + `inline_terminal_close { terminalId, transcript }` to the shared event/protocol types

## 2. Trigger (client-driven — Option A)

- [x] 2.1 Add `open_inline_terminal { sessionId, cwd }` + `close_inline_terminal { sessionId, terminalId }` browser→server messages in `browser-protocol.ts`
- [x] 2.2 Composer intercepts bare `!!` (empty command, before send) → dispatch open-inline-terminal; `!! <cmd>` / `! <cmd>` still go to bridge unchanged
- [x] 2.3 Verify no regression: `!! <cmd>` → bash excludeFromContext; `! <cmd>` → bash to-LLM (extension `parseSendPrompt` untouched)

## 3. Server — PTY + transcript

- [x] 3.1 `terminal-manager.ts`: `spawn(cwd, { ephemeral })` honors flag; add `getTranscript(id)`
- [x] 3.2 `terminal-handler.ts` `handleOpenInlineTerminal`: spawn ephemeral PTY, broadcast `terminal_added`, insert+broadcast `inline_terminal_open` into session stream
- [x] 3.3 `terminal-handler.ts` `handleCloseInlineTerminal`: capture ring-buffer transcript, kill PTY, insert+broadcast `inline_terminal_close { terminalId, transcript }`
- [x] 3.4 Ephemeral terminals reaped on session teardown (existing `terminalManager.list()` kill loop covers it)

## 4. Client — rendering & lifecycle

- [x] 4.1 `TerminalView.tsx`: bounded fixed-height variant (no hard `flex-1`); verify FitAddon rows; guard against half-height regression
- [x] 4.2 `TerminalsView.tsx`: filter out `ephemeral` terminals from the tab bar
- [x] 4.3 `event-reducer.ts`: add `inlineTerminal` chat role + `inline_terminal_open` / `inline_terminal_close` reducer arms (live vs frozen, update-in-place by `terminalId`)
- [x] 4.4 Chat message renderer: render live `inlineTerminal` row (bounded `TerminalView`, reattach via `terminalId`) and frozen row (read-only scrollable transcript)
- [x] 4.5 Composer: add open-inline-terminal button → same open path as bare `!!`

## 5. Reload / replay

- [x] 5.1 Live + PTY alive → reattach `/ws/terminal/:id` (ring buffer replay) — replay emits `inline_terminal_open` (no close) → live `InlineTerminalCard` → `TerminalView` reattaches
- [x] 5.2 Live + PTY dead → `TerminalView` ws close writes `[Terminal disconnected]` notice
- [x] 5.3 Closed → replay emits open+close → reducer freezes row → `FrozenTranscript`

## 6. Verification

- [x] 6.1 `npm test` — all touched-area suites green (added: inline-terminal-handler, terminal-manager ephemeral/getTranscript, event-reducer.inline-terminal). Pre-existing unrelated failures remain: `@blackbelt-technology/pi-image-fit` Jimp API mismatch (17) + `session-file-dedup` flaky timeout (1); none touch terminal/inline/protocol/reducer code.
- [x] 6.2 Manual: bare `!!` opens card; run interactive program (REPL / tab-complete); scroll within fixed-height card; close → frozen transcript; reload → card reconstructed (requires running dashboard + browser)
- [x] 6.3 Ephemeral excluded from tabs — `TerminalsView` filters `t.ephemeral` (unit-covered)
- [x] 6.4 No terminal output reaches LLM — inline path never calls `pi.sendUserMessage`; events flow only to event store + browser, never to the extension/agent (architectural guarantee, Option A)
