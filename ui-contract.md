# UI Contract

Single source of truth for cross-screen visual consistency. Every value here
references a design token — never a raw hex or pixel literal. If a screen needs
a value not listed, add the token to the theme layer first, then cite it here.

## Tokens (authority)

Token definitions live in **`packages/client/src/index.css`**. This file
references them by name and never redefines them.

Theme mechanism, two layers:

- **CSS layer (the `base` theme).** `:root` is base **dark** (the default) and
  `[data-theme="light"]` overrides a 44-token subset for base **light**. This
  is the only theme `index.css` declares, and the layer this file describes.
- **Runtime palette layer.** `packages/client/src/lib/theme/themes.ts`
  (`THEMES`) ships 8 further palettes (dracula, nord, github, catppuccin,
  tokyo-night, rose-pine, solarized, gruvbox), each in dark and light. For any
  theme other than `base`, `applyThemeVars`
  (`packages/client/src/hooks/useTheme.ts`) writes that palette's values as
  inline overrides of the **same token names** on `<html>`. 9 themes × 2 modes
  = 18 palettes; the `theme-gallery` spec sets their contrast floor.

Consequence: always paint through the tokens below and every palette follows.
A raw literal is correct in at most one of the 18.

`packages/dashboard-plugin-skill/.pi/skills/dashboard-plugin-scaffold/references/host-design.md`
is a derived subset of this file for third-party plugin authors. Update the two
together.

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

**Exception — invite QR quiet zone:** the Users invite QR keeps a literal
`bg-white` panel in every theme; a QR code needs a light quiet zone
(ISO/IEC 18004 §6.3.8). The only `bg-white` allowed in the connectivity
components (`connectivity-token-scan.test.ts`).

**Exception — mermaid fallback literals:** `FALLBACK_ACCENTS` and the
`--text-primary` hex fallback in `MermaidBlock.tsx` are used only when
`getComputedStyle` returns empty (jsdom); mermaid needs concrete colour strings
and `rgba()` parses hex only. Every palette must therefore define
`--accent-blue`, `--accent-green`, `--accent-yellow`, `--accent-red`,
`--accent-purple`, `--accent-orange` and `--text-primary` as `#hex`, guarded by
`mermaid-accent-guard.test.ts`.

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

**One bounded exception:** the capsule legends of `SlotPill`, `SessionSubcard`
and the SlotPill mirror in `FolderOpenSpecSection` render at 11 px uppercase
(`text-[11px] font-semibold uppercase tracking-wide`) — the `meta` step and
the floor, not below it. They are non-interactive labels, not buttons or links.

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
| role ref (`RoleRef`, `dashboard-plugin-runtime`) | role token `font-mono font-semibold text-[var(--text-primary)] bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] rounded px-1.5` · model id `font-mono text-[var(--text-primary)] truncate` with the provider prefix in a `sr-only` span (so `textContent` keeps `provider/id`, no `aria-label`) · level chip `text-xs font-semibold text-[var(--text-secondary)] border rounded-full px-1.5` + `sr-only` "thinking" · one-shot picks show the model then "from @role" in `--text-secondary` · no model value → warning pill "No model assigned". Every surface that shows an `@role[:level]` ref renders it through this component. See change: retro-ux-model-selector |
| binding status pill | `inline-flex rounded-full border px-1.5 py-0.5 text-xs` + `--severity-warning-{bg,border,fg}`; one vocabulary: `detached` → "Detached", `dangling` → "Role unassigned, keeps its last model", unassigned → "No model assigned", `ok` → nothing; the raw status stays in `data-status`. The reason and a "Reattach to @role" button sit in a warning callout. See change: retro-ux-model-selector |
| primary button | `focus-ring rounded-md bg-[var(--accent-solid)] px-3 min-h-[44px] sm:min-h-[36px] text-white font-semibold disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)]` — `--accent-solid` is theme-invariant (white on it is 5.17:1 everywhere); `--accent-primary` is NOT a white-text fill (3.68:1) |
| secondary button | `focus-ring rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] px-3 min-h-[44px] sm:min-h-[36px]` |
| section heading | `text-[12px] font-semibold text-[var(--text-secondary)]` — no uppercase + `--text-muted` |
| field label | `text-[12px] font-semibold text-[var(--text-primary)]` |
| settings field | the runtime field family (`dashboard-plugin-runtime/src/settings-fields.tsx`): label row (`text-xs font-semibold text-[var(--text-primary)]`, `htmlFor`, unit chip inside the label) + optional key chip + state pill → control → hint (`text-xs text-[var(--text-secondary)]`, `aria-describedby`) → error (`text-xs text-[var(--severity-error-fg)]`, `role="alert"`, `aria-invalid`). **Exception to the `input` row's "label above":** settings rows keep the label beside the control (stacked only for text inputs). The 12 px unit chip inside a settings `<label>` is an exception to the 11 px chip step (text inside a `<label>` meets the 12 px interactive floor). |
| notice | `SettingsNotice` (`dashboard-plugin-runtime`) — the one implementation for callouts and banners, core and plugin. `flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs` + `--severity-X-{bg,fg,border}`; tone icon (an `icon` override only when the icon carries meaning) → message (a short title saying what happened + an optional one-sentence why) → optional remedy rows (`remedies`: icon + sentence, links allowed, the caller's order, the caller drops unknown kinds; the list is named "What you can do") → action row: optional "Try again" (`retrying` → disabled + `aria-busy`), caller `actions`, optional "Copy details" (`SettingsCopyButton`; raw codes, HTTP status, bodies and stacks are copied, never rendered; a missing or refused clipboard says "Copy failed"). Buttons `min-h-[32px] text-[12px] font-semibold` on `--bg-tertiary`. `role="alert"` for error, `role="status"` for the other tones. See change: retro-ux-plugin-settings-wave-2, align-ui-contract-recipes |
| inline action error | `SettingsActionError` (`dashboard-plugin-runtime`): `<div role="alert" id>` `mt-1 flex items-start gap-1 text-xs text-[var(--severity-error-fg)]` + `AlertCircleOutline` + one plain sentence (what failed and what to try), directly under the control or row that failed; the failed control points `aria-describedby` at the error `id` (unique per page — derive it from the row). Server codes and raw text only through "Copy details"; never a toast for a failure the user can act on in place. A generic page-load failure stays a plain line (`operate-required-remedy`). Reference: services `ActionFailure` (Stop, Start, …). See change: align-ui-contract-recipes |
| settings group (`SettingsGroup`) | `<details>` card, summary `text-sm font-semibold text-[var(--text-primary)]`, `min-h-[44px]`, `focus-ring`, chevron; meta `text-[12px] font-semibold text-[var(--text-secondary)]` — **exception to the 11 px meta step:** the meta sits inside an interactive `<summary>`, so it meets the 12 px interactive floor. See change: retro-ux-plugin-settings-wave-2 |
| status pill | `SettingsStatusPill` (`dashboard-plugin-runtime`) — the one implementation; `ui:status-pill` renders it. `inline-flex items-center gap-1 rounded-full border px-1.5 py-px font-semibold whitespace-nowrap` at `text-[11px]`, `text-[12px]` inside an interactive element (automatic in a `SettingsItem` / `SettingsGroup` summary, or `interactive`) + `--severity-<tone>-{bg,fg,border}` (tone = success, info, warning, error, neutral); a human word always, never a raw enum (the code goes in `data-status`); a default icon per tone (static MDI import, `aria-hidden`; neutral is word-only); in progress = info + spinning `mdiLoading` (`spinning`, `motion-reduce:animate-none`). Core pills (services, vault, provider health, plugin list, board state) use it too. See change: retro-ux-plugin-settings-wave-2, align-ui-contract-recipes |
| settings item (`SettingsItem`) | repeated entity card (profile, instance, server, binding): `rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)]`, title 14 px semibold, subtitle 12 px `--text-secondary`, status pills, actions; `collapsible` → `<details>` whose summary (≥ 44 px, `focus-ring`) holds title AND status, so collapsed cards still show state. Actions never sit inside the summary (nested interactive): collapsible items render them at the top of the body. See change: retro-ux-plugin-settings-wave-2 |
| settings facts (`SettingsFacts`) | read-only `<dl>`, two-column grid, `text-[12px]`; `<dt>` `--text-secondary`, `<dd>` `--text-primary`. See change: retro-ux-plugin-settings-wave-2 |
| settings table (`SettingsTable`) | read-only table in an `overflow-x-auto` bordered wrapper (scrolls instead of widening the page), `text-[12px]`, `<th scope="col">` `--text-secondary` on `--bg-tertiary`, `sr-only` caption. See change: retro-ux-plugin-settings-wave-2 |
| capsule legend | `text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]`, overhang `-top-2`, on `SlotPill` (shared `SLOT_PILL_LEGEND`), the SlotPill mirror in `FolderOpenSpecSection` and `SessionSubcard` — the section-heading recipe at the `meta` step plus `uppercase`/`tracking-wide` as an explicit exception (see the aligned-action-surface exception above). `SessionSubcard`'s border-only panel (no fill) is an exception to the inset-panel row. See change: fix-slot-pill-legend-and-stale-overflow. |
| menu / flyout | panel `min-w-[220px] max-w-[320px] overflow-y-auto rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)]`; group heading `text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]` (optional normal-case subtitle); item `role="menuitem"` `flex items-center gap-2 min-h-[36px] max-sm:min-h-[44px] px-3 text-sm text-[var(--text-primary)]`; one emphasised NEXT item at most (`font-semibold` on `--accent-soft`); a disabled item is `aria-disabled` in `--text-secondary` with its reason on its own wrapping `text-xs` line (never tooltip-only, never a truncated trailing span), referenced by `aria-describedby`; a group with at least 2 rare items folds them under `More…` (`--text-primary`, count `text-xs` `--text-secondary`); the PLUGINS container sets `--text-primary` so plugin output inherits it. Reference: `SessionActionsPanel`. Other menus (folder actions, plugin menus): Adoption: pending (plugin wave). See change: add-session-actions-flyout, align-ui-contract-recipes |
| dialog | `client-utils/Dialog.tsx` (`ui:dialog`, `ui:confirm-dialog`): scrim `bg-[var(--bg-overlay)]`; panel at the card recipe (`rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-secondary)]` + raised elevation) `p-5 space-y-4 max-w-*` on `z-dialog`; header: optional 36 px icon tile in the info severity triple + title `text-lg font-semibold` + a close button of 44 px (36 px from `sm`); footer right-aligned: Cancel, then one action — primary `--accent-solid` or danger `--tint-red-{bg,fg,border}` (never a raw red fill); every action and Cancel `min-h-[44px] sm:min-h-[36px] font-semibold`. Destructive confirms are `role="alertdialog"` with Cancel focused, the impact read fresh on open, every affected item named, and an extra-destructive option an unchecked checkbox that names what it deletes (reference: vault `ConfirmImpact`, services dialogs). A red icon tile for destructive confirms needs a later `Dialog` prop: Adoption: pending. Hand-built plugin overlays: Adoption: pending (plugin wave). See change: add-pi-spec-driven-schema, align-ui-contract-recipes |
| settings rail | `settings-nav-rail` item `flex items-center gap-2.5 px-3 py-2 min-h-[36px] max-sm:min-h-[44px] rounded-md text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]`; current item `aria-current="page"` + `bg-[var(--bg-tertiary)] text-[var(--text-primary)] font-semibold` + a 3 px `--accent-primary` bar (bottom edge in the strip below `md`, leading edge from `md`); group labels `text-[11px] font-semibold uppercase` `--text-secondary`; the Services attention marker is an `AlertCircleOutline` in `--severity-error-fg` with an `sr-only` count; dirty and plugin-health dots take `--severity-*` colours; no `--text-muted`, no `opacity` dimming, no raw palette. Retires the debt recorded by add-services-settings-ui. See change: align-ui-contract-recipes |
| tabs | APG tablist: list `flex flex-wrap gap-1 border-b border-[var(--border-secondary)]`; tab `focus-ring -mb-px inline-flex items-center gap-1.5 min-h-[36px] max-sm:min-h-[44px] px-3 border-b-2 text-sm font-semibold`, selected `border-[var(--accent-primary)] text-[var(--text-primary)]`, else `border-transparent text-[var(--text-secondary)]`; arrow keys move, panels stay mounted (`hidden`); page-level tabs mirror `?tab=` in the URL; counts ride as an inline status pill. Adoption: pending (plugin wave) — the five existing tab styles are unchanged. See change: align-ui-contract-recipes |
| filter chip | a toggled filter is not a tab: `<button aria-pressed>` `inline-flex items-center gap-1 rounded-full border px-2.5 min-h-[32px] max-sm:min-h-[44px] text-xs font-semibold`; off `bg-[var(--bg-tertiary)] border-[var(--border-secondary)] text-[var(--text-secondary)]`, on `--severity-info-{bg,fg,border}` + a `Check` icon (a shape, not colour alone). Adoption: pending (plugin wave). See change: align-ui-contract-recipes |
| loading / empty / first-run | loading: `aria-busy` container + `sr-only` `role="status"` label + skeleton blocks shaped like the content (`rounded-md bg-[var(--bg-tertiary)] animate-pulse motion-reduce:animate-none`), never a bare "Loading…"; empty: inset panel (`rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] p-4`) with a `text-sm font-semibold` title saying what is empty and why, one sentence on how to change it, at most one secondary action; first-run: the same panel with one sentence on what the thing is and exactly one primary action; a load failure is an error notice, never an empty state. Adoption: pending (plugin wave). See change: align-ui-contract-recipes |
| row overflow | a row of one primary text plus trailing chips is `flex flex-wrap items-center gap-x-1.5 gap-y-1`; the primary text `grow basis-[6ch] min-w-0 truncate` with the full value in `title`; chips `flex-shrink-0`; the row carries `min-w-0` when its parent is a grid or flex track. The text truncates first and chips wrap only when 6 characters no longer fit — never clipped, never pushed out. Reference: `SessionCard`; plugin rows (goal chips, automation rows, MCP server list): Adoption: pending (plugin wave). See change: compact-session-card-header, align-ui-contract-recipes |
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
   **Exception — non-modal popovers** (the model selector's dropdown): `role="dialog"`
   with `aria-modal="false"` and an `aria-label`, no focus trap (the page stays
   interactive, outside click closes it), Escape closes and returns focus to the
   trigger. A popover that blocks the page is a modal and follows the rule above.
   See change: retro-ux-model-selector.
6. **The lower text ramp is not uniformly text-safe, and the failure is
   theme-asymmetric.** Verify a ramp token against BOTH themes before using it
   as text:

   | Token | dark on `--bg-primary` | light on `--bg-primary` | Safe as text? |
   |---|---|---|---|
   | `--text-secondary` | 9.07:1 | 9.74:1 | yes, both |
   | `--text-tertiary` | 4.98:1 | `#636363` — passes 4.5:1 on `--bg-surface` (`index.css`) | yes in both; the earlier `#777777` / 4.48:1 figure was stale. See change: retro-ux-identity-connectivity |
   | `--text-muted` | 2.77:1 | 2.32:1 | no — decorative/disabled only |

   Quiet body copy that must survive every palette takes `--text-secondary`;
   `--text-muted` never carries information text.
7. **Severity foregrounds stay on their own background.** `--severity-X-fg` is
   text-safe on `--severity-X-bg` (a pill or callout), not on `--bg-surface`
   (nord dark measures 4.36:1). `--accent-text` is not text-safe on
   `--bg-surface` in every palette (nord dark: 3.39:1, and 3.27:1 on
   `--severity-info-bg`); menu actions use `--text-primary` plus an icon, and a
   disclosure summary inherits its callout's fg and is underlined. See change:
   retro-ux-identity-connectivity (audit A1, A2).

**Contradiction to resolve (a11y #2 vs the primary-button recipe):** #2 says
primary actions are ≥ 44×44 px, while the primary-button recipe is
`min-h-[44px] sm:min-h-[36px]` (44 px below `sm`, 36 px from `sm`). The recipe
is what ships; reconcile the wording in a follow-up.

**Follow-up (needs user approval, not done here):** hide the selector's move
"Update" item from non-operators; this needs a MODIFIED `known-servers`
"Operator accepts a move suggestion" delta.

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
