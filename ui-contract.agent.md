# ui-contract.md — UI contract index

Pull-only condensed map. Source: ui-contract.md. Cross-screen visual consistency; every value = design token, never raw hex/px.

## Tokens (authority)
- Definitions: `packages/client/src/index.css`. Contract references names only.
- CSS layer: `:root` = base dark (default); `[data-theme="light"]` overrides 44-token subset.
- Runtime layer: `packages/client/src/lib/theme/themes.ts` (`THEMES`): 8 palettes (dracula, nord, github, catppuccin, tokyo-night, rose-pine, solarized, gruvbox) × dark/light. 9 themes × 2 = 18. `theme-gallery` spec = contrast floor.
- Non-base: `applyThemeVars` (`packages/client/src/hooks/useTheme.ts`) writes inline overrides on `<html>`, same names.
- Mirror: `packages/dashboard-plugin-skill/.pi/skills/dashboard-plugin-scaffold/references/host-design.md` — update together.
- Light overrides surface/text/border ramps, `--accent-primary`, six `--accent-<hue>-text`; not `--accent-{red,green,yellow,purple,orange,blue}`.

## Role → token
- page `--bg-primary` · card `--bg-secondary` · inset/chip `--bg-tertiary` · control `--bg-surface` · hover `--bg-hover` · code `--bg-code` · scrim `--bg-overlay`
- text: `--text-primary` → `--text-secondary` → `--text-tertiary` → `--text-muted` → `--text-faint`
- divider `--border-{primary,secondary,subtle,strong}` · brand `--accent-primary` · link `--link`, `--link-hover` · focus `--focus-ring`
- accent fill `--accent-{purple,blue,green,orange,red,yellow}` (no contrast guarantee)
- accent text `--accent-<hue>-text` (AA 4.5:1)

## Semantic families (prefer)
- severity `--severity-{error,warning,success,info,neutral}-{bg,fg,border}`
- identity tint `--tint-{green,orange,blue,purple,red}-{bg,fg,border}`
- status `--status-{needs-you,working,idle,error,notice}` — shapes/dots only, never text
- Exception: invite QR `bg-white` (ISO/IEC 18004 §6.3.8); guard `connectivity-token-scan.test.ts`.
- Exception: mermaid `FALLBACK_ACCENTS` in `MermaidBlock.tsx`; palettes define accents + `--text-primary` as `#hex` (`mermaid-accent-guard.test.ts`).
- Rule: new surface → severity/tint token. Never `--accent-red` direct, never Tailwind palette class (`text-green-400`), never hex/`rgba(`.
- Hue text → `--accent-<hue>-text`; back hue with word/icon/shape.
- `scripts/theme-token-guard.mjs` (arm `accentText`) fails NEW fill-accent text.

## Colour roles
- pi/new session → `--tint-green-*` · worktree → `--tint-orange-*` · fork/links/selected → `--tint-blue-*` · goals → `--tint-purple-*` · destructive → `--tint-red-*` · warning/error/success/info → `--severity-*` · session status → `--status-*` (dots/shapes).
- `--tint-X-fg` only on own `--tint-X-bg`.
- `--status-working` 1.84:1 as text (light) → status words `--text-secondary` + `aria-hidden` dot.
- `--text-muted` decoration only (disabled, `aria-hidden`). Timestamps/counts → `--text-secondary`.
- `tint-action-X` utility (X = green|orange|blue|purple|red) in `index.css`. Disabled = static triple, no hover.

## Spacing / type / radius / elevation
- Spacing: Tailwind `0.5 · 1 · 1.5 · 2 · 2.5 · 3 · 4` only. Within-group `gap-1`/`gap-1.5`; between-group `gap-3`/`gap-4`.
- Type: micro `text-[9px]` dense numeric · chip `text-[10px]` · meta `text-[11px]` · body-dense `text-[12px]`/`text-xs` · body `text-sm` · title `text-lg`.
- Floor: below 11px non-essential only. Aligned action surfaces (tray, session card, worktree, goal detail, prompt renderers, automation dialog, OpenSpec board): nothing <11px; buttons/labels/links/help ≥12px.
- Radius: `rounded` chips/inputs · `rounded-md` buttons · `rounded-lg` panels · `rounded-xl` card root · `rounded-full` dots/pills.
- Elevation: flat = no shadow · raised (card) = `shadow-[inset_0_1px_0_var(--elevation-rim),0_4px_8px_var(--shadow-card)]` · subtle `shadow-sm` · overlay = scrim + raised. Keep `--elevation-rim` on raised.

## Component invariants (tokens only)
- card root: `rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-secondary)]` + raised
- inset panel: `rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]`
- action chip: `focus-ring inline-flex items-center gap-0.5 rounded-md border px-2.5 tap-target text-[12px] font-semibold` + `tint-action-X`
- severity callout: `rounded-md border bg-[var(--severity-X-bg)] border-[var(--severity-X-border)] text-[var(--severity-X-fg)]`
- `RoleRef` (`dashboard-plugin-runtime`): every `@role[:level]` ref. Model id `font-mono truncate`, provider in `sr-only`; no model → "No model assigned" pill. change: retro-ux-model-selector
- binding status pill: severity-warning triple. `detached`→"Detached", `dangling`→"Role unassigned, keeps its last model", unassigned→"No model assigned", `ok`→nothing. raw status in `data-status`. change: retro-ux-model-selector
- primary button: `focus-ring rounded-md bg-[var(--accent-solid)] px-3 min-h-[44px] sm:min-h-[36px] text-white font-semibold disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)]`. `--accent-solid` theme-invariant (white 5.17:1); `--accent-primary` NOT white-text fill (3.68:1).
- section heading `text-[12px] font-semibold text-[var(--text-secondary)]`; field label `text-[12px] font-semibold text-[var(--text-primary)]`.
- dialog: scrim `bg-[var(--bg-overlay)]` + card recipe, `max-w-*`, one primary action.
- input: `rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-3 py-1.5 text-sm` + label above.

## Motion
- Honour `prefers-reduced-motion`; suppress non-essential transition/pulse.

## Accessibility (WCAG 2.2 AA hard gate)
1. Text ≥4.5:1 (≥3:1 large); UI ≥3:1; both themes.
2. Targets ≥24×24; primary ≥44×44. Buttons ≥44 below `sm`, ≥32 from `sm:` (chips `sm:min-h-[32px]`, form `sm:min-h-[36px]`, icon-only `min-w-[44px] sm:min-w-[32px]`).
3. `--focus-ring` on every focusable.
4. No colour-only state (1.4.1). `StatusShapeBadge` (`data-status-shape`): shape/icon + text.
5. Dialogs: `role="dialog"`, `aria-modal`, labelled title, focus trap, Escape. Non-modal popover: `aria-modal="false"`, `aria-label`, no trap, Escape returns focus to trigger.
6. Ramp: `--text-secondary` safe both (9.07 / 9.74). `--text-tertiary` safe both (4.98 / `#636363`). `--text-muted` NOT safe (2.77 / 2.32).
7. `--severity-X-fg` text-safe on own `--severity-X-bg` only (nord dark 4.36:1 on surface). `--accent-text` not text-safe on `--bg-surface` in all palettes (nord dark 3.39:1).

Open: a11y #2 (≥44) vs recipe (44 below `sm`, 36 from `sm:`) — recipe ships. Known debt, do not copy: `BranchSwitchDialog.tsx` lacks role/aria-modal/title.

## Terminology
- Say: new session (noun), start (verb), restart (respawn). Never user-facing: spawn, respawn.
- Internal ids keep names (`spawn_session`, testids, i18n keys). Gate: `ui-copy-no-spawn.test.ts`.

## Anti-slop
- One focal point; one primary action. Contrast verified dark AND light. Real nouns in mock data (no "Acme"/"Jane Doe").
