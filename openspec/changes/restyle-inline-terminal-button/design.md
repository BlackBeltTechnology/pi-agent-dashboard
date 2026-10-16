## Context

See `proposal.md` (Why). The control is `terminalButton` in
`packages/client/src/components/chat/CommandInput.tsx`. It is rendered twice:
inline in `composer-input-row` (wrapped in `hidden @[44rem]:inline-flex`) and
inside the `⋯` overflow menu (narrow composer). The delivery control
(`delivery-control`) is the visual reference: `h-[30px] rounded-lg border
border-[var(--border-secondary)] text-[11px]`.

Constraint: e2e `#F11` (`tests/e2e/composer-session-strip.spec.ts`) asserts the
settings row does not overflow at `44rem + 1px` with the longest model id.
Adding a labelled chip to that row consumes ~80 px of it.

## Goals / Non-Goals

**Goals:**
- One element definition (`terminalButton`) restyled once; both render sites
  (settings row, `⋯` menu) pick it up.
- Keep `#F11` green without moving the `@[44rem]` fold threshold.

**Non-Goals:**
- No new CSS tokens, no `themes.ts` change.
- No new component file.

## Decisions

1. **Restyle in place, move one JSX line.** Change `terminalButton`'s classes to
   the delivery-control chip language and move its inline wrapper from the
   input row to the settings row, after `{deliveryControl}`.
   *Alternative:* extract a `ComposerChip` component — rejected, one consumer.

2. **Label collapses via container query, not the fold.** The label is
   `<span className="hidden @[52rem]:inline">Terminal</span>`; between
   `44rem` and `52rem` the chip is a bordered icon-only square (30 px). Same
   pattern as the stop-after-turn split (`@[30rem]`).
   *Alternative:* raise the fold to `@[50rem]` — rejected, it folds thinking
   and `Steer | Queue` into `⋯` earlier for every user. The exact `52rem`
   value is tuned against `#F11`'s longest-model fixture during implementation.

3. **Overflow-menu copy shows the label always.** Inside `⋯` the chip is not
   under the `@[52rem]` container rule's width pressure; render the label
   unconditionally there for scannability. Implemented by passing the label
   visibility class via a tiny variant (`terminalButton(compact: boolean)` →
   inline function) rather than duplicating the button.

4. **i18n.** Visible label uses new key `command.terminal` (en fallback
   "Terminal"; hu "Terminál"; zh-CN "终端"). `title`/`aria-label` keep
   `command.inlineTerminal`, so the accessible name is unchanged.

5. **Disabled state.** Keep the existing `disabled={disabled}` +
   `disabled:opacity-50 disabled:cursor-not-allowed`.

## Risks / Trade-offs

- [`#F11` overflow at 44rem+1px with label hidden still too wide] → icon-only
  chip is 30 px vs today's 34 px input-row button that did not count toward
  the settings row; if it still overflows, drop the chip's `px` to `px-1.5`
  before touching the fold.
- [Users trained on the input-row position] → low; same icon, now labelled,
  one row below.
- [Theme drift] → only existing tokens used; `node scripts/theme-token-guard.mjs`
  run in tasks.

## Migration Plan

Client-only, no data or protocol change. Rollback = revert the commit.
