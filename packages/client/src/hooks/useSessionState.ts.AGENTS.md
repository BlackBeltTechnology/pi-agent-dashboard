# useSessionState.ts — index

Embed-side session-state accumulator. Exports `useSessionState(sessionId?)` (`{state, apply, reset}`) and the pure `SessionStateAccumulator` fold over `ServerToBrowserMessage` — a switch SEPARATE from `useMessageHandler`'s, with its own `addInteractiveRequest` call sites. `case "prompt_request"` → `addPromptBusRequest`; `case "notify"` → `addNotify` (render-only chat row, never an `interactiveRequests` entry). See change: split-notify-from-prompt-request. Reset/replay carry sites go through `carryPendingPrompt`. See change: fix-optimistic-prompt-stuck-sending.
