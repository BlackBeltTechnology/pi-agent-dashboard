# Ship-decision note — Cmd-F find-in-page regression (task 10.3)

## The regression

Windowing unmounts off-screen transcript rows. The browser's native find (Cmd-F
/ Ctrl-F) only searches mounted DOM, so it can no longer match text in rows
outside the viewport working set. This is **inherent to windowing** and is NOT
present in Step A (`content-visibility: auto` keeps every row mounted).

Scope of impact:
- Cmd-F finds only matches in currently-mounted rows (viewport + overscan +
  streaming tail).
- Print / "save page" likewise capture only mounted rows.

## Why we accept it for this change

Step B is the only lever for the GC / listener / DOM-node layer (Step A leaves
~47k nodes + ~26k listeners mounted). The find-over-history capability is a
strictly smaller loss than the CPU/memory win on long sessions, and the umbrella
ordered Step A first precisely so this trade-off is a deliberate, reversible
step (revert the diff → back to Step A's fully-mounted `content-visibility`
list, Cmd-F restored).

## Out-of-scope follow-up (filed here, not implemented)

A future change should restore find-over-history via one of:
- **In-app transcript search** — a search box that queries `state.messages`
  (the full model, always in memory) and `scrollToIndex` to the hit; independent
  of what is mounted.
- **"Expand all for print/search" escape hatch** — a toggle that disables
  windowing (renders the full list, i.e. Step A behaviour) for a print/find
  session, then re-enables it.

Neither is in scope for `virtualize-chat-transcript-tanstack`. Surface this note
at ship time so the reviewer signs off on the trade-off knowingly.
