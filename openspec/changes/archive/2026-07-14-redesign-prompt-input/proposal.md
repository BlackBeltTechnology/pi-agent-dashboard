# redesign-prompt-input

## Why

Today the chat composer scatters its controls across three stacked components:

- `QueuePanel` (follow-up queue, display-only),
- `CommandInput` with a four-button action row *beside* the textarea (`send`, `stop-after-turn`, `stop`, `force-stop`),
- `StatusBar` model row carrying `ModelSelector` + `ThinkingLevelSelector` + an inline `ComposerSessionActions` strip.

Consequences the user hits every turn:

- Model and thinking level live in a **separate row** from where the user types, so choosing them is a context switch away from composing.
- The delivery mode is invisible: `Enter` steers, `Alt+Enter` queues a follow-up, but nothing on screen says so.
- Stop is **four adjacent buttons** that swap in and out (`send` / `stop-after-turn` / `stop` / `force-stop`), which is dense and easy to mis-click.
- New users get **no affordance** for the composer's real power surface (`/` commands, `@` files/URLs, `!` shell).
- A few controls still render **unicode-glyph-as-icon** rather than the project's `@mdi/js` family.

The three reference composers the team benchmarked (Codex CLI, ChatGPT, Gemini) have all converged on one shape: a **single rounded container with an inner toolbar**, a **send button that morphs into stop**, model/thinking **inside** the composer, and (the CLI variants) a **footer hint line with a context-left indicator**. Adopting that vocabulary makes pi's composer legible and teaches its command surface without a manual. Reference capture and interactive state mocks live in `mockups/prompt-input-v2/` (`index.html` = state matrix; `compare.html` = footprint + desktop + mobile).

**This reconsiders a prior decision.** The archived change `2026-05-30-redesign-session-card-and-composer` deliberately mounted the session-action strip *inline in the StatusBar model row* ("statusbar-inline", per user feedback at the time). v2 pulls model/thinking **into** the composer container and relocates the OpenSpec/Git session actions to a slim context strip **above** the card. The proposal does not silently reverse that; the reversal is scoped, justified in `design.md`, and gated by a `doubt-driven-review` checkpoint before it stands.

## What Changes

- **Unify the composer into one rounded container.** The textarea and an inner toolbar share a single bordered card (`--bg-tertiary` / `--border-secondary`), replacing the side-by-side textarea + button row.
- **Pull model + thinking into the toolbar.** `ModelSelector` and `ThinkingLevelSelector` render as chips in the inner toolbar; the standalone StatusBar model row is retired.
- **Collapse the four-button stop cluster into one morphing action button.** `send → stop → force-stop` is a single button that swaps its MDI path by state; `stop-after-turn` becomes a slim secondary affordance, not a fourth icon.
- **Surface delivery mode as a visible `Steer | Queue` segmented control** — a direct, discoverable mapping of today's hidden `Enter` (steer) vs `Alt+Enter` (follow-up) contract.
- **Add a `＋` attach menu** (image · file · screenshot · `/view` preview), replacing the paste-only entry flow.
- **Add a footer hint line** (`⏎ send · ⇧⏎ newline · / commands · @ files · ! shell`). The line is **hidden until the composer is focused / first keystroke** so the resting footprint stays close to today's.
- **Optionally show a context-left indicator** in the footer *only if the datum is already available client-side*; otherwise it is deferred (see design open questions).
- **Relocate OpenSpec P/D/S/T + Git session actions** from the StatusBar into a slim context strip above the card (behaviour and gating unchanged from the archived strip).
- **Enrich the `/` menu** with grouped source sections, argument hints (`<name>`, `<@file | url>`), and the existing source badges.
- **Define an explicit mobile adaptation:** persistent row = `＋ · model · ⋯ · send`; fold thinking / `Steer|Queue` / terminal into a `⋯` overflow and attach/tools into the `＋` bottom-sheet; send/stop ≥ 44px.
- **Finish the MDI icon migration** for every composer control (single family, `currentColor`, one size, `aria-label` on icon-only buttons). Artifact letters (P/D/S/T) stay letters.

**Not changed (behaviour preserved):**

- `/` command + `@` file/URL autocomplete, `usePopoverFlip` viewport flip, history recall (↑/↓ when empty), `/view` local interception, image paste + preview, mid-turn queue (input stays enabled while streaming), stop → force-stop escalation semantics.
- The `Enter` = steer / `Alt+Enter` = follow-up keyboard contract (the segmented control mirrors it; keys still work).
- OpenSpec `ChangeState`, artifact chips, action gating, and slot wiring.

## Discipline Skills

- `doubt-driven-review` — this reverses the deliberate `statusbar-inline` layout decision and reshapes a high-traffic, user-facing surface; validate the layout reversal and the footprint budget before the change stands.
- `code-simplification` — the change collapses a four-button cluster and a three-component stack into one container; run a deliberate simplify pass so the unified composer is genuinely simpler, not just relocated.
- `accessibility-a11y` (project skill) — WCAG-AA contrast on footer/placeholder text, ≥44px touch targets, `prefers-reduced-motion` on the caret/force-stop motion, `aria-label` on every icon-only button.

## Capabilities

### New Capabilities
- *(none)* — every change modifies an existing spec.

### Modified Capabilities
- `chat-view`: the composer becomes a single unified container; model/thinking move inside its inner toolbar; the session-action strip relocates from the StatusBar to a context strip above the card; a morphing send/stop action button, a `Steer | Queue` delivery control, a `＋` attach menu, a focus-revealed footer hint line, and an explicit mobile adaptation are added.

## Impact

**Code touched**
- `packages/client/src/components/CommandInput.tsx` — unified container, inner toolbar, morphing action button, `＋` menu, footer hint line, MDI migration.
- `packages/client/src/components/StatusBar.tsx` — retire the standalone model row; host model/thinking inside the composer instead.
- `packages/client/src/components/ComposerSessionActions.tsx` — re-home as the context strip above the card (gating/slots unchanged).
- `packages/client/src/components/ModelSelector.tsx`, `ThinkingLevelSelector.tsx` — render as toolbar chips (trailing chevron, no decorative leading glyph).
- `packages/client/src/App.tsx` — rewire the composer region assembly.
- `packages/client/src/index.css` — composer-card, toolbar, footer, sheet/overflow tokens; `prefers-reduced-motion` guards.

**Tests touched / added**
- `packages/client/src/components/__tests__/CommandInput.test.tsx` — morphing button states, `Steer|Queue`, footer reveal, `＋` menu.
- `packages/client/src/components/__tests__/ComposerSessionActions.test.tsx` — relocation, unchanged gating.
- `packages/client/src/components/__tests__/StatusBar.test.tsx` — model-row retirement.
- New: mobile-adaptation render tests (persistent row, overflow, 44px targets).

**Risk**
- Reverses an archived layout decision; mitigated by `doubt-driven-review` + keeping session-action gating/slots byte-identical.
- Footprint growth; mitigated by the focus-revealed footer + inline model (lean default within ~15% of today's height).
