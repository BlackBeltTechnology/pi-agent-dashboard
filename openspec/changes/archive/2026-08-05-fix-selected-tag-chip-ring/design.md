## Context

`TagChip.tsx` builds the selected-state ring for `filter` chips as a single Tailwind class
string:

```ts
const selRing = variant === "filter" && selected
  ? "outline outline-2 outline-offset-1 outline-current" : "";
```

Colorized (user-tone) chips get their color via an **inline style** from
`tagColor(label)` → `{ text, border, bg }`, applied to the toggle `<button>`.

There are two user-tone `filter` layouts, and the ring lands in a different place in each:

| Layout | Ring host | `outline-current` resolves to | Result |
|---|---|---|---|
| toggle only (no `onRemove`) | the toggle `<button>` (carries the color style) | `c.text` — the tag color | correct today |
| toggle + destructive ✕ (`onRemove`, sidebar "Your tags") | the wrapper `<span>` (**no** color style) | inherited sidebar text color | near-black ring — the bug |

So the defect is confined to the `onRemove` wrapper branch, which is exactly the sidebar
"Your tags" configuration. The wrapper must host the ring (it keeps the toggle and the ✕
enclosed on one line), so the fix is to give that wrapper an explicit ring color rather
than relocating the ring.

Secondary complaint: `outline-2` + `outline-offset-1` around an 11px pill reads as a boxed
outline rather than a selection affordance.

## Goals / Non-Goals

**Goals:**
- Selection indicator color derives from the chip's own `tagColor(label)` in *both*
  user-tone layouts.
- Lighter indicator weight appropriate to an 11px pill.
- Preserve the single-line toggle + ✕ unit and the existing overflow behavior.

**Non-Goals:**
- No change to selection behavior, `aria-pressed`, keyboard operability, or the
  global-delete ✕ semantics.
- No change to tag persistence (verified working, covered by
  `session-tags-persistence.test.ts`).
- No `TAG_PALETTE` reorder — the palette order is the hash oracle; reordering re-hues every
  existing tag.
- No redesign of the read-only `exec`/phase chip, the card `TagStrip`, or `TagEditor`.

## Decisions

**D1 — Color the ring via inline style, not a Tailwind color class.**
The tag color is a runtime hash result (`tagColor(label)`), not a compile-time-known class,
so Tailwind cannot emit a class for it. The colorized chip already uses inline `style` for
`color`/`borderColor`/`backgroundColor`; hosting the ring color the same way keeps one
coloring mechanism. *Alternative rejected:* a CSS custom property set inline plus
`outline-[var(--x)]` — same inline-style dependency with an extra layer of indirection.

**D2 — Keep the ring on the wrapper for the `onRemove` layout; add the color there.**
The wrapper exists specifically so the ✕ never wraps to its own line and so the ring
encloses both controls. Moving the ring onto the toggle would fix the color but visually
exclude the ✕ from the selected unit. *Alternative rejected:* relocating the ring to the
toggle button.

**D3 — Derive the ring color from the palette's `text` value.**
`c.text` is the chip's most saturated, highest-contrast palette channel and is already the
value `outline-current` correctly resolves to in the working toggle-only layout — so using
it makes the two layouts render *identically*, which is the real invariant.
*Alternative considered:* `c.border`, which is deliberately translucent
(`rgba(...,.45)`) and would read as a weaker selected state.

**D4 — Reduce ring weight from 2px to 1px, keep the offset.**
Retains a visible gap between pill and ring (so the ring is legible against the chip fill)
while dropping the boxed heaviness. *Alternative considered:* removing the offset — the
ring then abuts the chip border and muddies the two edges.

**D5 — Leave the `exec`-tone selected ring on `outline-current`.**
Phase chips are intentionally muted, are never rendered with `onRemove` (the phase group
passes no remove handler), and their ring host *does* carry `text-[var(--text-tertiary)]`
— so `outline-current` already resolves to an intended color there. Touching it would be
out-of-scope churn.

## Risks / Trade-offs

- **A 1px ring is a weaker selection signal than 2px.** → Selection is not
  indicator-only: `aria-pressed` carries it programmatically, and the sidebar additionally
  surfaces an `N active` count badge plus a "Clear tags" affordance. The offset preserves
  legibility.
- **Ring color equals the chip's text color, so ring-vs-fill contrast depends on the
  palette.** → All 9 `TAG_PALETTE` entries pair a saturated `text` against a `.12`-alpha
  `bg`, so the ring reads against the fill for every entry; the offset gap also puts the
  ring partly over the surrounding surface.
- **Inline styles are harder to assert than class names in tests.** → Assert the resolved
  inline `outlineColor` against `tagColor(label).text` directly, which pins the invariant
  more precisely than a class-string match would.
- **Regression risk to the ✕ single-line layout.** → Existing
  `sidebar-tag-collapse-and-delete` coverage in `tags-components.test.tsx` exercises the
  remove-enabled filter chip; keep it green.
