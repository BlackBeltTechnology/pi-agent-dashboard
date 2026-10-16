## Why

The composer's open-inline-terminal control is a borderless 34×30 icon floating next to the 44×44 Send button: different height, different weight, no label. It reads as decoration, not as an action, and its purpose is only discoverable via tooltip.

## What Changes

- Move the inline-terminal control from the composer **input row** to the **settings row**, after `Steer | Queue`.
- Render it as a bordered chip matching the delivery control (30 px height, `rounded-lg`, `--border-secondary`), with the terminal icon plus a visible `Terminal` label. Accessible name stays "Open inline terminal"; `data-testid="open-inline-terminal-button"` is unchanged.
- The input row keeps only the textarea and the morphing Send/Stop button.
- Narrow composer (`< @[44rem]`): unchanged — the control still folds into the `⋯` overflow.
- No new tokens; no behaviour change to how the terminal opens (same path as `!!`).
- Mockup: mockups/inline-terminal-button (in this change) — variant **B** chosen; A (current), C, D kept for reference.

## Non-goals

- No keyboard shortcut for opening the terminal.
- No change to the inline terminal card, PTY lifecycle or `!!` trigger (`inline-terminal` spec untouched).
- No restyle of other composer controls.

## Discipline Skills

None apply: a client-only restyle and one JSX move, no security, data, perf or migration surface.

## Capabilities


### New Capabilities

_None._

### Modified Capabilities

- `chat-view`: "Composer is a unified container…" (terminal control moves from input row to settings row, becomes a labelled chip) and "Mobile composer adaptation" (wide-layout scenario now places the terminal in the settings row).

## Impact

- `packages/client/src/components/chat/CommandInput.tsx` — `terminalButton` classes + label, render position.
- i18n: reuse `command.inlineTerminal` for aria/title; add a short `command.terminal` label key.
- Tests: `packages/client/src/components/__tests__/CommandInput.test.tsx` row-membership assertions; e2e `tests/e2e/terminal.spec.ts`, `tests/e2e/inline-terminal-transcript.spec.ts` use the unchanged test id (should keep passing).
