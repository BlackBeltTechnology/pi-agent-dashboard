# UI Contract

Single source of truth for cross-screen visual consistency. Every value here
references a design token — never a raw hex or pixel literal. If a screen needs
a value not listed, add the token to the theme layer first, then cite it here.

## Tokens (authority)

Token definitions live in **`packages/client/src/index.css`**. This file
references them by name and never redefines them.

Theme mechanism: `:root` is the **dark** theme (the default), and
`[data-theme="light"]` overrides a 32-token subset. **Two themes ship today** —
`dark` and `light`. Any doc claiming four themes (studio / earth / athlete /
gradient) is stale; no such selectors exist in `index.css`.

Light overrides the surface, text, and border ramps plus `--accent-primary`,
but deliberately does **not** override `--accent-red|green|yellow|purple|orange`.
The severity families are derived from those accents with `color-mix` against
`--bg-tertiary` / `--text-primary`, so they retheme automatically. Never
hand-write a per-theme severity color.

| Role | Token |
|---|---|
| page surface | `--bg-primary` |
| raised surface / card | `--bg-secondary` |
| inset surface / chip | `--bg-tertiary` |
| control surface | `--bg-surface` |
| hover wash | `--bg-hover` |
| code surface | `--bg-code` |
| modal scrim | `--bg-overlay` |
| text ramp | `--text-primary` → `--text-secondary` → `--text-tertiary` → `--text-muted` → `--text-faint` |
| hairline / divider | `--border-primary`, `--border-secondary`, `--border-subtle`, `--border-strong` |
| brand / primary action | `--accent-primary` |
| link | `--link`, `--link-hover` |
| focus ring | `--focus-ring` |

### Semantic families — prefer these over raw accents

| Family | Tokens | Use for |
|---|---|---|
| severity | `--severity-{error,warning,success,info,neutral}-{bg,fg,border}` | any state message, badge, or callout |
| status | `--status-{needs-you,working,idle,error,notice}` | session lifecycle state only |
| warn alias | `--warn-{bg,border,fg,body}` | pre-existing alias of the warning family |

**Rule:** a new surface uses a *severity* token, not `--accent-red` directly.
Raw accents are reserved for the status family and for chart/graph series.

**Known debt (do not copy):** `SessionCard.tsx` contains off-token literals
`border-blue-500/30`, `border-green-500/30`, `border-orange-500/30`. New work
uses `--severity-*-border`.

## Spacing scale

Tailwind steps only, as already used: `0.5 · 1 · 1.5 · 2 · 2.5 · 3 · 4`
(→ 2/4/6/8/10/12/16 px). No arbitrary px.

Gestalt proximity rule: **within-group gap `gap-1`/`gap-1.5`, between-group gap
`gap-3`/`gap-4`.** A group whose internal gap is not tighter than its external
gap is a defect.

## Type scale

Dense telemetry sizes coexist with prose sizes; both are in use and both are
legitimate — pick by role, not by taste.

| Step | Class | Role |
|---|---|---|
| micro | `text-[9px]` | dense numeric telemetry only, never prose |
| chip | `text-[10px]` | badge / pill labels |
| meta | `text-[11px]` | secondary metadata, card sublines |
| body-dense | `text-[12px]` / `text-xs` | card body |
| body | `text-sm` | forms, dialogs, prose |
| title | `text-lg` | page + dialog titles |

**Floor:** anything below `text-[11px]` must be non-essential — never the only
carrier of a state, an error, or an action label.

## Radius

`rounded` (chips, inputs) · `rounded-md` (buttons, small panels) ·
`rounded-lg` (panels) · `rounded-xl` (**card root**) · `rounded-full` (status
dots, pills) · `rounded-t-lg` (card headers).

## Elevation

| Tier | Recipe |
|---|---|
| flat | no shadow — inset surfaces (`--bg-tertiary`) |
| raised (card) | `shadow-[inset_0_1px_0_var(--elevation-rim),0_4px_8px_var(--shadow-card)]` |
| subtle | `shadow-sm` |
| overlay (dialog) | scrim `--bg-overlay` + raised recipe |

The inset top rim (`--elevation-rim`) is the house signature — it is what makes
a card read as lit from above in dark theme and as a crisp edge in light. Do not
drop it on a raised surface.

## Component invariants

| Component | Recipe (tokens only) |
|---|---|
| card root | `rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-secondary)]` + raised elevation |
| inset panel | `rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]` |
| chip / pill | `rounded-full px-1.5 py-0.5 text-[10px] bg-[var(--bg-tertiary)]` |
| severity callout | `rounded-md border bg-[var(--severity-X-bg)] border-[var(--severity-X-border)] text-[var(--severity-X-fg)]` |
| primary button | `rounded-md bg-[var(--accent-primary)] px-3 py-1.5 text-sm` |
| secondary button | `rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-3 py-1.5 text-sm` |
| dialog | scrim `bg-[var(--bg-overlay)]` + panel at card recipe, `max-w-*`, one primary action |
| input | `rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-3 py-1.5 text-sm` + persistent label above |

## Motion

Honour `prefers-reduced-motion` — suppress non-essential transition and any
pulse/attention animation. Attention states must remain legible with motion off,
which is why they also carry a shape (below).

## Accessibility invariants (hard gate — WCAG 2.2 AA)

1. Text contrast ≥ 4.5:1 (≥ 3:1 large); UI/non-text ≥ 3:1 — verified in **both**
   themes.
2. Interactive targets ≥ 24×24 px; primary actions ≥ 44×44 px (Fitts's Law).
3. Visible focus indicator via `--focus-ring` on every focusable element.
4. **State is never carried by color alone** (WCAG 1.4.1). The house pattern is
   `StatusShapeBadge` — `data-status-shape` renders a distinct *shape* per
   status alongside the color. Any new state badge follows it: shape or icon
   **plus** text, not a bare coloured dot.
5. Dialogs carry `role="dialog"`, `aria-modal`, a labelled title, focus trap,
   and Escape-to-close.

**Known debt (do not copy):** `BranchSwitchDialog.tsx` ships with no `role`,
`aria-modal`, or labelled title. New dialogs must not inherit that.

## Anti-slop guardrails

- No default-average look (generic Inter + purple gradient + centered hero).
- One focal point per view (Von Restorff); exactly one visually-primary action.
- Rhythm from the spacing scale, not eyeballed gaps.
- Contrast verified in dark **and** light before a surface is considered done.
- Real product nouns in mockup data — real session ids, real model names, real
  paths. No "Acme" / "Jane Doe" placeholder data.
