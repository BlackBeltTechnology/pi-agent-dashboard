## Why

Closing an inline terminal card after the shell has already exited produces an **empty** "Terminal closed" card. The transcript is silently lost, and the reason is a lifecycle ordering bug:

```
shell `exit`  →  pty.onExit (terminal-manager.ts:165)  →  entries.delete(id)
user clicks ✕ →  handleCloseInlineTerminal (terminal-handler.ts:56)
                 → getTranscript(id) → entry missing → ""
                 → emits inline_terminal_close { transcript: "" }
                 → card freezes to an empty read-only body
```

`getTranscript` (terminal-manager.ts:298) returns `""` when the entry is gone, and `onExit` deletes the entry — so the exit-then-close path *always* loses the scrollback. What the user sees as visual noise is a dropped transcript.

A second, latent defect makes the naive fix strictly worse than the bug. `inline_terminal_close` carries the transcript into `eventStore.insertEvent`, which runs `createTruncator(maxStringFieldSize, maxEventDataSize)`. In production config `maxStringFieldSize = 0` (per-field pass OFF, `packages/shared/src/config.ts:101`) while `maxEventDataSize = 20_000` (size pass ON, `memory-event-store.ts:125`). Any event whose `data` serializes past 20 KB is replaced wholesale by `truncatedPlaceholder` (`memory-event-store.ts:528`) — `{ __truncated, reason, thresholdBytes, eventType }`. **`terminalId` is destroyed.** The client reducer (`event-reducer.ts:1995`) matches the card row by `data.terminalId`, so a >20 KB transcript would mean the card never freezes at all and, on reload, stays "live" attached to a dead PTY. Restoring the transcript without capping it would convert an empty-card annoyance into a stuck-card bug.

Third, even with the transcript restored, a terminal that is opened and closed without the user ever typing anything still leaves a "Terminal closed" card whose body is one shell prompt. That row carries no information and should not persist in the chat stream.

## What Changes

- **Transcript survives PTY exit.** `terminal-manager.ts` keeps a bounded tombstone map for **ephemeral** terminals only. On `onExit` (:165) and on the kill fallback path (:279), the ring-buffer contents are capped and written to the tombstone *before* `entries.delete(id)`. `getTranscript` falls back to the tombstone. `entries.delete` itself is unchanged, so `list()`, `get()`, `attach()`, the `terminal_removed` broadcast and the `TerminalsView` tab lifecycle keep their exact current behavior. A close releases its tombstone via a suppression flag, so the normal live-close path (which reads the live buffer *before* the PTY dies) leaves no residue.
- **Transcript is tail-capped in serialized JSON bytes.** `handleCloseInlineTerminal` caps the transcript below `maxEventDataSize` so `terminalId` always survives persistence. The cap is measured with the store's own byte accounting, **not** `string.length`: the ceiling counts UTF-8 bytes plus JSON escapes, so a code-unit cap would still trip the placeholder on CJK (~3×), emoji (~4×) or ESC-dense colorized output (up to 6× per escape). Truncation keeps the **tail** — the end of a session is what a reader wants — with the elision marker counted inside the budget.
- **Cards the user never touched are removed.** The terminal manager tracks whether a PTY ever received user input (one call site: the `attach` message handler, the only `pty.write` for user input in the repo). On close with no input, the server emits an empty transcript, and the client reducer removes the `inlineTerminal` row when the transcript is exactly `""` — no stripping, no line counting, no heuristic. One predicate, server-side, so live and replay agree by construction. Two text-inspection rules were considered and rejected: line counting inverts if the control-character strip removes LF and misfires on both flagship scenarios (`exit` yields one line; multi-line prompts make an untouched terminal read as non-blank), and whitespace-emptiness disagrees with input tracking in the harmful direction (arrow-keys-only input strips to nothing, deleting a card the user did interact with) while requiring a greenfield ANSI regex the client does not otherwise have.
- **Close is idempotent.** Releasing the retained transcript on close means a second `close_inline_terminal` would emit an empty transcript, which the removal rule would then apply to the already-frozen card — destroying it live and permanently on replay. Today a double close is benign, so the change guards it on both sides: the server skips emitting for an already-released terminal (checked *first*, before any liveness lookup, so a concurrent close from a second browser is suppressed too), and the reducer ignores an empty close targeting a non-empty frozen row.
- **No PTY-exit auto-close.** A card whose shell has exited stays live-but-disconnected until the user clicks ✕, exactly as today. Auto-emitting `inline_terminal_close` from `onExit` was considered and rejected: the server's `onExit` callback (`server.ts:671`) only receives a `terminalId` and has no session/inline-card association, so it would require a new registry for no user-visible gain.

## Capabilities

### Modified Capabilities
- `inline-terminal`: the close-event contract gains a transcript-survives-exit guarantee, a transcript size bound, and a blank-card suppression rule; the frozen-card rendering requirement is narrowed accordingly.

## Discipline Skills

`systematic-debugging` (root cause was an ordering bug masked by a second truncation defect — evidence before fix), `doubt-driven-review` (the 20 KB `__truncated` interaction is the kind of silent failure that ships green), `review-code` (before commit).

## Impact

- `packages/server/src/terminal/terminal-manager.ts` — bounded ephemeral-only tombstone map + release-suppression set, writes in `onExit` + kill fallback, `getTranscript` fallback, byte-measured `capTranscript`, `sawInput` tracking in `attach`.
- `packages/server/src/persistence/memory-event-store.ts` — add `inline_terminal_open` / `inline_terminal_close` to `ESSENTIAL_CHAT_EVENT_TYPES` so per-session trim cannot drop one half of a position-bearing pair. No other change: `measureBytes` / `exceedsSerializedSize` are already exported, and `measureBytes` returns a `cap + 1` sentinel usable as the binary-search comparator.
- `packages/server/src/server.ts` — derive the transcript budget from the event-store ceiling in force (`config.maxEventDataSize ?? DEFAULT_MAX_EVENT_DATA_SIZE`) at wiring time, pass it to the terminal manager, and validate the truncation configuration at startup.
- `packages/server/src/browser-handlers/terminal-handler.ts` — cap the transcript in `handleCloseInlineTerminal` before `insertEvent`, emit empty when no input was ever seen, release the tombstone.
- `packages/client/src/lib/chat/event-reducer.ts` — empty-transcript row removal in `inline_terminal_close` (both branches: matched row and the defensive close-without-open path).
- Tests: `packages/server/src/__tests__/terminal-manager.test.ts`, `packages/server/src/__tests__/inline-terminal-handler.test.ts`, `packages/client/src/lib/__tests__/event-reducer.inline-terminal.test.ts`.
- Docs: `packages/server/src/terminal/terminal-manager.ts.AGENTS.md`, `packages/client/src/lib/chat/event-reducer.ts.AGENTS.md` purpose rows.
- No protocol change (`inline_terminal_close` keeps its `{ terminalId, transcript }` shape), no persisted-format change, no migration. Memory ceiling added is `tombstone cap × transcript cap` (bounded, sub-megabyte). Rollback = revert; old and new clients both tolerate either server, since the change only affects the *content* of an existing field and the client-side rendering of a blank one.
