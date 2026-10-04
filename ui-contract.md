# UI Contract

Single source of truth for cross-screen visual consistency. Every value here
references a design token — never a raw hex or pixel literal. If a screen needs
a value not listed, add the token to the theme layer first, then cite it here.

## Tokens (authority)

Token definitions live in **`packages/client/src/index.css`**. This file
references them by name and never redefines them.

Theme mechanism: `:root` is the **dark** theme (the default), and
`[data-theme="light"]` overrides a 44-token subset. **Two themes ship today** —
`dark` and `light`. Any doc claiming four themes (studio / earth / athlete /
gradient) is stale; no such selectors exist in `index.css`.

Light overrides the surface, text, and border ramps plus `--accent-primary`
and the six `--accent-<hue>-text` tokens, but deliberately does **not** override
`--accent-red|green|yellow|purple|orange|blue`.
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
| accent fill (dot, border, glyph — no contrast guarantee; check each use against its backdrop) | `--accent-{purple,blue,green,orange,red,yellow}` |
| accent text (coloured label, AA 4.5:1 on surface / tertiary / primary / card fill) | `--accent-{purple,blue,green,orange,red,yellow}-text` |
| focus ring | `--focus-ring` |

### Semantic families — prefer these over raw accents

| Family | Tokens | Use for |
|---|---|---|
| severity | `--severity-{error,warning,success,info,neutral}-{bg,fg,border}` | any state message, badge, or callout |
| identity tint | `--tint-{green,orange,blue,purple,red}-{bg,fg,border}` | identity accents on action chips, trays, pills |
| status | `--status-{needs-you,working,idle,error,notice}` | session lifecycle state only — shapes and dots, never text |
| warn alias | `--warn-{bg,border,fg,body}` | pre-existing alias of the warning family |

**Rule:** a new surface uses a *severity* or *tint* token, not `--accent-red`
directly and never a Tailwind palette class (`text-green-400`,
`bg-blue-500/10`, …) or a hex/`rgba(` literal. Raw accents are reserved for the
status family and for chart/graph series. When text must be coloured by hue,
use `--accent-<hue>-text`, never `--accent-<hue>` (a fill with no contrast
guarantee — 80 of 108 sit below the 4.5:1 text floor on `--bg-surface`), and back the hue with a word, icon or shape — hue is a
secondary cue (solarized dark accent-text hues are near-indistinguishable).
`scripts/theme-token-guard.mjs` (arm `accentText`) fails any NEW fill-accent
text paint; existing ones are baselined debt.

### Colour roles

Pick the family by **meaning**, not by hue. `--severity-{success,warning,info,error}-*`
are aliases of `--tint-{green,orange,blue,red}-*` (same values), but the names
keep the meanings apart. See change: align-ui-with-theme-tokens.

| Meaning | Token | Examples |
|---|---|---|
| identity: pi / new session | `--tint-green-*` | tray New Session, card `+ Session`, automation "armed" badge |
| identity: worktree | `--tint-orange-*` | tray New Worktree, card Worktree chip, worktree badge |
| identity: fork, links, selected toggle | `--tint-blue-*` | card Fork, pressed source toggle, selected session card |
| identity: goals | `--tint-purple-*` | goal `+ New session`, subgoal add |
| destructive | `--tint-red-*` | goal delete, unlink |
| severity (warning / error / success / info) | `--severity-*` | collision / orphan warnings, error text |
| session status (working / idle / needs-you / ended) | `--status-*` | status **shapes and dots only** |

- **Tint pairing:** a `--tint-X-fg` is only ever painted on its own
  `--tint-X-bg` fill (a filled chip / button / pill) — never directly on a card
  or page surface (as low as 3.4:1 on tokyo-night light).
- **Status colour on shape, not text:** `--status-working` is 1.84:1 as text in
  light. Status words ("Resuming…", "Thinking…", "Idle") render
  `--text-secondary` beside an `aria-hidden` `--status-*` dot or glyph.
- **`--text-muted` is decoration only:** allowed in `disabled:` variants (WCAG
  1.4.3 exempts them) and on `aria-hidden="true"` elements (separators,
  glyphs). Headings, labels and help text use `--text-primary` /
  `--text-secondary`; timestamps and counts are information →
  `--text-secondary`.

**Tinted action recipe:** `border tint-action-X` (X = green | orange | blue | purple | red).
`@utility tint-action-X` in `packages/client/src/index.css` = `--tint-X-fg` text,
`--tint-X-border` border, `--tint-X-bg` bg; hover (on `(hover: hover)`) mixes the bg
70% toward the border. Use the utility, not the four arbitrary-value classes — the
recipe then lives in the CSS chunk, not the JS index chunk (`mdi-chunk-size` cap).
A disabled control keeps the static triple without the hover (no `tint-action-X`).
**Target floor:** `tap-target` = min-height 44px, 32px from `sm:` up.

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

**Aligned action surfaces** (tray, session card, worktree dialog/list, goal
detail, prompt renderers, automation dialog, OpenSpec board create controls):
nothing below 11 px; buttons, labels, links and help text ≥ 12 px
(`text-[12px]`); dense metadata (model, path, cost) may stay 11 px. The micro
and chip steps above are legacy and not used on these surfaces.

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
| chip / pill | `rounded-full px-1.5 py-0.5 text-[11px] bg-[var(--bg-tertiary)]` (identity pill: tint triple) |
| action chip | `focus-ring inline-flex items-center gap-0.5 rounded-md border px-2.5 tap-target text-[12px] font-semibold` + `tint-action-X` |
| severity callout | `rounded-md border bg-[var(--severity-X-bg)] border-[var(--severity-X-border)] text-[var(--severity-X-fg)]` |
| primary button | `focus-ring rounded-md bg-[var(--accent-solid)] px-3 min-h-[44px] sm:min-h-[36px] text-white font-semibold disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)]` — `--accent-solid` is theme-invariant (white on it is 5.17:1 everywhere); `--accent-primary` is NOT a white-text fill (3.68:1) |
| secondary button | `focus-ring rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] px-3 min-h-[44px] sm:min-h-[36px]` |
| section heading | `text-[12px] font-semibold text-[var(--text-secondary)]` — no uppercase + `--text-muted` |
| field label | `text-[12px] font-semibold text-[var(--text-primary)]` |
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
   On the aligned action surfaces: every button ≥ 44×44 below `sm`, and ≥ 32 px
   tall from `sm:` (chips/toggles `sm:min-h-[32px]`, form buttons
   `sm:min-h-[36px]`, icon-only `min-w-[44px] sm:min-w-[32px]`).
3. Visible focus indicator via `--focus-ring` on every focusable element.
4. **State is never carried by color alone** (WCAG 1.4.1). The house pattern is
   `StatusShapeBadge` — `data-status-shape` renders a distinct *shape* per
   status alongside the color. Any new state badge follows it: shape or icon
   **plus** text, not a bare coloured dot.
5. Dialogs carry `role="dialog"`, `aria-modal`, a labelled title, focus trap,
   and Escape-to-close.
6. **The lower text ramp is not uniformly text-safe, and the failure is
   theme-asymmetric.** Verify a ramp token against BOTH themes before using it
   as text:

   | Token | dark on `--bg-primary` | light on `--bg-primary` | Safe as text? |
   |---|---|---|---|
   | `--text-secondary` | 9.07:1 | 9.74:1 | yes, both |
   | `--text-tertiary` | 4.98:1 | **4.48:1** | **dark only** — light is under the 4.5:1 floor |
   | `--text-muted` | 2.77:1 | 2.32:1 | no — decorative/disabled only |

   `--text-tertiary` is #777777 in light, documented in `index.css` as an
   *overlay boundary* under SC 1.4.11 — a **3:1 non-text** threshold. It is a
   border token that happens to be legible, not a text token. Quiet body copy
   that must survive both themes takes `--text-secondary`.

**Known debt (do not copy):** `BranchSwitchDialog.tsx` ships with no `role`,
`aria-modal`, or labelled title. New dialogs must not inherit that.

## Terminology

| Say | Never say (user-facing) | Notes |
|---|---|---|
| new session (noun) · start (verb) · restart (for respawn) | spawn, respawn | Internal identifiers keep their names: protocol messages (`spawn_session`), functions, config keys (`spawnStrategy`), testids, i18n KEYS. Gate: `packages/client/src/lib/__tests__/ui-copy-no-spawn.test.ts` (log-only literals in `ui-copy-allowlist.json`). |

## Anti-slop guardrails

- No default-average look (generic Inter + purple gradient + centered hero).
- One focal point per view (Von Restorff); exactly one visually-primary action.
- Rhythm from the spacing scale, not eyeballed gaps.
- Contrast verified in dark **and** light before a surface is considered done.
- Real product nouns in mockup data — real session ids, real model names, real
  paths. No "Acme" / "Jane Doe" placeholder data.
