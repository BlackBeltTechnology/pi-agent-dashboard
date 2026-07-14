# Design — redesign-prompt-input

## Context

The composer is the single most-used surface in the dashboard. It currently spreads across `QueuePanel` + `CommandInput` (four-button action row) + `StatusBar` (model row with inline `ComposerSessionActions`). This design unifies it into one container, adopting the converged pattern of Codex CLI, ChatGPT, and Gemini, while preserving every existing behaviour.

Grounded reference research and interactive mocks: `mockups/prompt-input-v2/` — `index.html` (6-state matrix), `compare.html` (self-measuring footprint + desktop chat window + 4-state mobile grid).

## Reference synthesis (what each borrows)

| Move | Borrowed from | Adaptation |
|---|---|---|
| One rounded container + inner toolbar | all three | textarea + toolbar in a single card |
| Model/thinking inside the composer | ChatGPT, Gemini | toolbar chips; StatusBar model row retired |
| Send morphs to stop | ChatGPT, Gemini | one MDI button: `mdiSendVariant → mdiStop → mdiAlertOctagon` |
| `＋` attach/tools menu | ChatGPT, Gemini | image · file · screenshot · `/view` |
| Delivery/approval chip | Codex approvals | `Steer \| Queue` maps `Enter` / `Alt+Enter` |
| Footer hint line + context-left | Codex CLI, Gemini CLI | `⏎ · ⇧⏎ · / · @ · !`, focus-revealed |
| Slash menu with arg hints | Codex `/model` | grouped, `<name>` hints, source badges |

## Decisions

### D1. Unified container, model/thinking pulled in (reverses `statusbar-inline`)
The archived `2026-05-30-redesign-session-card-and-composer` mounted session actions inline in the StatusBar model row. v2 moves model/thinking **into** the composer toolbar and relocates OpenSpec/Git actions to a slim strip **above** the card.

**Why the reversal is warranted:** the original goal was "don't lose session context when you focus the textarea" — a context strip *directly above* the card serves that goal better than a model row *below* it, because it sits in the same visual unit as the input. Model/thinking belong with composing, not with session actions. Gating and slot wiring for the session actions are preserved byte-for-byte, so only the *host location* changes.

**Guard:** `doubt-driven-review` before implementation, and the session-action strip keeps its existing tests green unchanged.

### D2. One morphing action button
`send → stop → force-stop` is a single button swapping its MDI path by state; `stop-after-turn` is a slim secondary affordance beside it, not a fourth icon. Escalation semantics (`idle → aborting → killing`) are unchanged; only the rendering collapses.

### D3. `Steer | Queue` segmented control
Direct, discoverable mapping of the hidden `Enter` (steer) / `Alt+Enter` (follow-up) contract. Keyboard behaviour is unchanged; the control just makes the current mode visible and clickable. On mobile it folds into the `⋯` overflow.

### D4. Footprint budget — lean default
Measured (see `compare.html`): today ≈ **99px**, fully-loaded v2 ≈ **169px** (+71%). That ceiling is unacceptable as a default. Levers:

- Footer **hidden until focus / first keystroke** (−~24px) — default on.
- Model chip **inline** in the toolbar row (no extra row) — default on.
- Context strip **only when a session/OpenSpec context exists**, collapsible otherwise.

**Constraint:** the resting (unfocused, no OpenSpec attach) composer SHALL stay within ~15% of today's height. The full footer + strip is the focused / attached state, not the resting one.

### D5. Icons — single MDI family
Every composer control uses `@mdi/js` at one size, inheriting `currentColor`, with `aria-label` on icon-only buttons. No emoji, no unicode-glyph-as-icon. Artifact letters (P/D/S/T) stay letters (semantic identifiers, not glyphs). Terminal = `mdiConsole`, send = `mdiSendVariant`, stop = `mdiStop` (already applied in the mock).

### D6. Mobile adaptation
Persistent row: `＋ · model (flex-fills) · ⋯ · send`. Fold thinking / `Steer|Queue` / terminal into a `⋯` overflow popover; attach + tools into the `＋` bottom-sheet. Send/stop ≥ 44px (WCAG 2.5.5). Context strip → chips-only; footer → one line.

## Alternatives considered

- **Keep the StatusBar model row, only restyle CommandInput.** Rejected: leaves model a context-switch away and doesn't unify the surface — the core complaint.
- **Long-press send to choose delivery** instead of a visible `Steer|Queue`. Rejected on desktop (undiscoverable); reconsidered as the mobile fold via `⋯`.
- **Always-on footer.** Rejected on footprint grounds (D4).

## Open questions (resolve during implementation)

1. **Context-left %** — is a token-budget datum already available client-side per session? If yes, show it in the footer; if it needs new bridge plumbing, **defer** it out of this change (the footer ships without it).
2. **Context strip vs toolbar for OpenSpec chips** — strip above the card (chosen) keeps the toolbar focused on composing; confirm with a quick preview before finalizing.
3. **`Steer|Queue` default** — default `Steer` (matches today's `Enter`); confirm no persistence needed across sessions.

## Risks / mitigations

- **Reverses an archived decision** → `doubt-driven-review`, preserved gating/slots, unchanged strip tests.
- **Footprint regression** → D4 budget enforced by a resting-height test.
- **A11y regressions** (contrast, targets, motion) → `accessibility-a11y` pass + explicit test assertions.
