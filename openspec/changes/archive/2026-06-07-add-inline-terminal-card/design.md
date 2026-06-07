## Context

Two existing terminal modes bracket the gap this change fills:

| | Content-area terminals | Bang commands (`!`/`!!`) |
|---|---|---|
| Backing | PTY (`terminal-manager`), `/ws/terminal/:id` | `pi.exec("sh","-c",cmd)` one-shot |
| Render | `TerminalsView` tabs → `TerminalView` (xterm) | `bash_output` chat card (frozen text) |
| Interactive | yes (completions, vim, ssh) | no |
| Placement | takes whole content pane | inline chat row |
| Persistence | live PTY + ring buffer; reattach on reload | `bash_output` event replay |

The inline interactive terminal is the missing quadrant: **inline placement + full interactivity + ephemeral lifecycle**.

## Goals / Non-Goals

Goals:
- Open an interactive PTY card in the chat stream via bare `!!` or a composer button.
- Fixed-height, scrollable (xterm internal scrollback), independent from the LLM.
- Freeze to a stored transcript on close; survive page reload via event replay.
- Reuse existing PTY + xterm + replay machinery; minimal new code.

Non-Goals:
- Changing `!! <command>` or `! <command>` one-shot semantics.
- Feeding interactive terminal output to the LLM (explicitly out — independent from LLM).
- Multiplexing inline terminals into the content-area tab list (ephemeral terminals are filtered out).
- Image/attachment capture from terminal output.

## Decisions

### D1 — Trigger: bare `!!` + composer button; argumented bangs untouched

Parser splits on whether `!!` carries a command:

```
!!            (empty)        → open inline interactive terminal  [NEW]
!! <command>  (has command)  → one-shot bash, excludeFromContext  [unchanged]
! <command>                  → one-shot bash, → LLM               [unchanged]
```

Only the empty-`!!` branch is added in `parseCommand`. `!! <command>` keeps its current `{ type: "bash", excludeFromContext: true }` path verbatim, so there is no behavior regression for existing usage. The composer button dispatches the same open path as bare `!!`.

Rationale: `!!` already means "independent from the LLM," which matches the inline terminal's LLM-independence. Reusing the prefix keeps the mental model consistent.

### D2 — Reuse PTY infra; add an `ephemeral` flag

Inline terminals spawn through the **existing** `terminal-manager` and connect via the **existing** binary WebSocket `/ws/terminal/:id`. The only backend addition is `TerminalSession.ephemeral?: boolean`. Ephemeral terminals are excluded from the content-area `TerminalsView` tab bar so they don't pollute folder terminal tabs.

Rationale: zero new transport, zero new PTY lifecycle. `TerminalView` is already a self-contained component that takes a `terminalId` and manages its own socket — it can render anywhere.

### D3 — Fixed-height bounded card; xterm scrollback for scrolling

The card renders `TerminalView` at a fixed height (~16 rows) rather than `flex-1` fill. FitAddon fits the PTY to the card's bounded dimensions. Scrolling **inside** the card uses xterm's existing 10000-line scrollback (mouse wheel / Shift+PageUp). The chat page scrolls past the card normally.

`TerminalView` currently hard-assumes `flex-1` (the half-height bug fix relied on a flex-column parent). The inline variant must take an explicit height instead of claiming residual flex height. This is the main client adaptation.

### D4 — Event-sourced lifecycle: open + close events

The dashboard is event-sourced: the server stores an ordered per-session event stream and replays it to rebuild chat on every reload/reconnect. To make the inline card replay-safe, two events thread through that pipe (mirroring how `bash_output` already persists bang cards):

```
open  → inline_terminal_open  { terminalId }
        • fixes the card's durable POSITION in the chat stream
        • on replay, reconstructs a live card that reattaches to the
          PTY via terminalId if still alive (ring buffer replays output)

close → inline_terminal_close { terminalId, transcript }
        • captured final scrollback transcript stored in payload
        • freezes the card to a read-only scrollable transcript row
```

Reload matrix:

| State at reload | Replay sees | Render |
|---|---|---|
| Live, PTY alive | open, no close | reattach `TerminalView` (ring buffer) |
| Live, PTY dead | open, no close | best-effort captured transcript / disconnected notice |
| Closed | open + close | frozen read-only transcript |

`terminal-manager` captures the final transcript (from its ring buffer) at kill time to populate `inline_terminal_close.transcript`.

### D5 — LLM independence

The inline terminal never calls `pi.sendUserMessage`. No path feeds its output into context. This is stricter than `!` (which does feed) and matches `!!`. No "send transcript to agent" affordance in this change (could be a later addition).

### D6 — Chat role `inlineTerminal`

`event-reducer.ts` gains an `inlineTerminal` chat role plus reducer arms for the two events. A live row carries the `terminalId`; a closed row carries the frozen `transcript`. The close arm updates the existing row in place (keyed by `terminalId`) so the card transitions live → frozen without duplicating.

## Risks / Trade-offs

- **`flex-1` assumption in `TerminalView`** — bounded-height variant must not reintroduce the half-height rendering bug (`fix-terminal-half-height-dual-mount`). Mitigation: explicit pixel/row height on the inline container, verified by the FitAddon producing the expected rows.
- **Orphaned PTYs** — if a user opens an inline terminal and never closes it, the PTY lives until session end. Mitigation: ephemeral terminals are still tracked by `terminal-manager` and reaped on session teardown like any terminal.
- **Transcript size** — large interactive sessions could produce a big `inline_terminal_close.transcript`. Mitigation: cap captured transcript to the ring buffer size already used for terminals.

## Open Questions

- Should an unclosed live inline terminal auto-close (and freeze) on session end, or just disappear? (Lean: freeze with whatever transcript was captured.)
- Composer button placement and icon (defer to implementation).
