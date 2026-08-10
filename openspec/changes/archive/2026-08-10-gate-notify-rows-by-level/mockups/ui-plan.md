# UI plan — gate-notify-rows-by-level

Surfaces → tokens → states. Every value references a theme token from
`packages/client/src/index.css`; no raw hex or px literal is introduced.

## Surfaces

| # | Surface | Component | Change |
|---|---|---|---|
| A | The notify row itself | `NotifyRenderer.tsx` | re-tone onto `--severity-*` + add icon + level name |
| B | Settings ▸ General ▸ Chat display | `SettingsPanel.tsx` `SelectField` | one new field, existing component |
| C | Chat toolbar ⚙ View popover | `ChatViewMenu.tsx` | first non-boolean row |

## GROUND findings that drive the design

1. **`NotifyRenderer` is off-token.** It hardcodes Tailwind literals
   `text-blue-400 / green-400 / yellow-400 / red-400`. The repo's severity
   colour authority is the `--severity-{info,success,warning,error}-{bg,fg,border}`
   triples added by `unify-message-severity-colors`, whose own doc comment claims
   them as *"single color source of truth for every toast / banner surface"*.
   A notify row is exactly that surface and does not comply.

2. **The hardcoded literals fail WCAG AA in light themes.** Measured against
   `--bg-tertiary` (`#f0f0f0` light):

   | level | dark `#1e1e1e` | light `#f0f0f0` | severity token, dark | severity token, light |
   |---|---|---|---|---|
   | info | 6.56 ✓ | **2.23 ✗** | 7.27 ✓ | 6.97 ✓ |
   | success | 9.57 ✓ | **1.53 ✗** | 8.25 ✓ | 5.45 ✓ |
   | warning | 10.89 ✓ | **1.34 ✗** | 7.75 ✓ | 6.13 ✓ |
   | error | 6.03 ✓ | **2.43 ✗** | 6.94 ✓ | 7.19 ✓ |

   Four AA failures, worst 1.34:1 against a 4.5:1 floor. WCAG 2.2 §1.4.3.

3. **Level is conveyed by colour alone.** No icon, no text. WCAG 2.2 §1.4.1
   (Use of Colour) and rubric item 4. This is pre-existing, but
   `notifyMinLevel` makes level *load-bearing* — it now decides visibility, so
   a user who cannot perceive the level cannot reason about the filter.

4. **`InlineMessage` already solves A.** `components/primitives/InlineMessage.tsx`
   is the shared severity surface: `--severity-*` tokens, a leading accent bar,
   a mandatory icon, compact variant. Its `Severity` union is
   `"error" | "warning" | "info"` — missing `success`, though
   `--severity-success-*` exists. Extending the union by one member is the whole
   styling job.

5. **`SelectField` already exists** (`SettingsPanel.tsx:2445`) — native `<select>`
   inside `FieldShell` with `useId`, `aria-describedby`, hint slot. Surface B
   needs no new component.

6. **`ThinkingLevelSelector` is the in-repo precedent for an ordinal enum in the
   chat toolbar**: `role="listbox"` / `role="option"` / `aria-selected`, and
   `min-h-[44px] md:min-h-0` — the repo already enforces a 44px mobile tap
   target in chat popovers. `ChatViewMenu`'s own rows are `py-1` (≈26px) and do
   **not**, which is a pre-existing AAA/§2.5.5 miss the new row must not copy.

## Tokens used (no new tokens required)

| Purpose | Token |
|---|---|
| notify bg / fg / border per level | `--severity-{info,success,warning,error}-{bg,fg,border}` |
| popover surface | `--bg-secondary`, `--border-secondary` |
| row hover | `--bg-hover` |
| label / secondary text | `--text-secondary`, `--text-tertiary` |
| control surface | `--bg-secondary` + `--border-secondary` |
| override marker | `--accent-yellow` (replaces the existing raw `text-amber-400`) |
| focus ring | `--focus-ring` via the `.focus-ring` utility |
| selected option | `--accent-primary` |

`--severity-success-*` already exists in `index.css` and is currently unused by
any component; this change is its first consumer.

## States per surface

- **A** — 4 levels × {dark, light}; long-message wrap; markdown body preserved.
- **B** — 4 values; hint text; dirty/unsaved; disabled.
- **C** — 4 values; override-marked vs inherited; popover flipped up; narrow pane.

## Open question carried into the mockup

Surface C's control shape is the one real fork — `ChatViewMenu` is 100% boolean
rows today. Three candidates are rendered side by side for comparison:
native `<select>`, a 4-chip segmented control, and a `ThinkingLevelSelector`-style
listbox. Decided by the rubric, not taste.
