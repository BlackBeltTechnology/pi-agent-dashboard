## Why

The dashboard has two terminal modes with a gap between them.

- **Content-area terminals** (`TerminalsView` / `TerminalView`) are full PTY-backed xterm.js emulators: real interactivity, tab-completion, scrollback, resize. But they live in a tabbed view that takes over the whole content pane — heavyweight for a quick interactive task.
- **Bang commands** (`!` / `!!`) render as inline chat cards via `bash_output`, but run through `pi.exec("sh","-c",cmd)` one-shot — **no PTY, no tty, no completions, no interactivity**.

There is no way to open a small, interactive terminal *in the chat stream* for a quick task (a REPL, `ssh`, `vim`, a tab-completing CLI) and close it when finished. The user wants exactly that: an inline, fixed-height, scrollable, interactive terminal card, independent from the LLM, that freezes to a transcript on close.

The infrastructure to do this already exists. `TerminalView` is self-contained — it takes a `terminalId`, opens its own binary WebSocket (`/ws/terminal/:id`), and runs its own xterm + PTY via `terminal-manager`. The backend is reusable as-is. The new work is placement (render bounded, in a chat row), lifecycle (ephemeral, not in the tab list), a trigger (bare `!!` + a composer button), and two events so the card survives reload through the existing event-replay pipeline.

## What Changes

- **NEW**: bare `!!` (no command) opens an inline interactive terminal card in the chat stream. `!! <command>` and `! <command>` keep their current one-shot `bash_output` behavior unchanged — only the empty-`!!` branch is new.
- **NEW**: a composer button that opens the same inline interactive terminal card.
- **NEW**: inline terminal card — reuses the existing PTY (`terminal-manager`, `/ws/terminal/:id`) and `TerminalView` xterm component, rendered at a **fixed height (~16 rows)** with xterm's internal scrollback for scrolling inside the card. Full interactivity (keyboard, tab-completion, ANSI, resize-to-card-width). **Independent from the LLM** — output never enters context.
- **NEW**: `TerminalSession.ephemeral?: boolean`. Ephemeral terminals are **excluded** from the content-area `TerminalsView` tab bar so inline terminals don't clutter the folder's terminal tabs.
- **NEW**: two events so the card is event-sourced and survives reload:
  - `inline_terminal_open { terminalId }` — fixes the card's durable position in the chat stream.
  - `inline_terminal_close { terminalId, transcript }` — freezes the card to a read-only scrollable transcript.
- **NEW**: chat role `inlineTerminal`. Live → renders bounded `TerminalView` (reattach to PTY via `terminalId` if alive on reload). Closed → renders the stored transcript read-only.

## Capabilities

### Added Capabilities

- `inline-terminal`: inline interactive terminal card lifecycle — trigger (bare `!!` + composer button), ephemeral PTY reuse, fixed-height scrollable rendering, LLM independence, and the open/close event contract for replay-safe transcript persistence.

### Modified Capabilities

- `terminals-view`: the content-area tab bar SHALL exclude `ephemeral` terminals.

## Impact

- `packages/shared/src/terminal-types.ts` — add `ephemeral?: boolean` to `TerminalSession`.
- `packages/shared/` event/protocol types — add `inline_terminal_open` / `inline_terminal_close` events.
- `packages/extension/src/command-handler.ts` — bare-`!!` branch in `parseCommand`; emit `inline_terminal_open`.
- `packages/server/src/terminal-manager.ts` — honor `ephemeral` flag on spawn; capture final transcript on kill for the close event.
- `packages/client/src/components/TerminalView.tsx` — bounded-height variant (drop hard `flex-1` assumption for inline use).
- `packages/client/src/components/TerminalsView.tsx` — filter out `ephemeral` terminals from tabs.
- `packages/client/src/lib/event-reducer.ts` — `inlineTerminal` chat role + `inline_terminal_open/close` reducer arms (live vs frozen).
- chat message renderer — render `inlineTerminal` rows (live `TerminalView` / frozen transcript).
- composer — "open inline terminal" button.
