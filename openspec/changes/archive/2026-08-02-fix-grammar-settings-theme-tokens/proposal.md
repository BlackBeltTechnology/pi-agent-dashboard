# Tokenize GrammarSettings styling and make its controls theme- and a11y-correct

## Why

An **anti-slop-frontend** review (Part A universal tells; Part B skipped — this is product UI)
found the grammar plugin's client surface clean **except one file**. Every corrections panel
(`GrammarPanel`, `GrammarRedlinePanel`, `grammar-panel-chrome`) styles with theme CSS tokens
(17 / 23 / 8 `var(--…)` references, **0** hardcoded colors). `GrammarSettings.tsx` is the lone
outlier: **0 theme tokens, 6 hardcoded hex + 1 `rgba()` literal, 25 inline `style={{}}` blocks.**

The dashboard ships **4 themes** (studio · earth · athlete · gradient) switched via the
`data-theme` attribute (see the `theme-system` skill). Because `GrammarSettings` bakes in raw
Zinc greys and fixed emerald / amber, its colors **do not adapt** — they drift in 3 of the 4
themes, and the muted `#a1a1aa` text plus 9.5–10px status labels risk failing **WCAG-AA
(4.5:1)** on the lighter themes. Its native `<input>` / `<select>` controls also lack the
shared `focus-ring` class the panel buttons carry, so keyboard focus is invisible and control
foreground/background fall back to un-themed UA defaults.

This is the anti-slop **A1** (accent lock / one neutral temperature per project), **A6** (form
contrast + focus a11y), with minor **A2** (one radius / font-size scale) and **A5** (one icon
family) findings. It is a **presentation + a11y** fix: no config shape, endpoint, or behaviour
changes.

### Assumptions (please correct)

- **Token mapping is 1:1 with existing theme variables** — the literals map to tokens already
  defined by the theme system, so no new token is introduced:
  `#71717a` → `--text-muted`, `#a1a1aa` → `--text-secondary`, `#34d399` → `--severity-success-fg`,
  `#fbbf24` → `--severity-warning-fg`, `rgba(82,82,91,.5)` → `--border-primary`.
- **The settings section keeps its inline-`style` structure** — this change swaps the *values*
  (literals → `var(--…)`) and adds focus affordances; it does **not** rewrite the section into
  Tailwind utility classes (that would be a larger, riskier diff for no behaviour gain).
- **The kind pill in `GrammarPanel` (`text-[9.5px] uppercase tracking-wide`) is NOT flagged** —
  it reads like an anti-slop "eyebrow" (B2) but B2 is marketing-only; here it is a legitimate
  product categorization pill and stays.

## What Changes

- **MODIFIED** `packages/grammar-plugin/src/GrammarSettings.tsx`
  - Replace the 6 hardcoded hex + 1 `rgba()` literal with the theme tokens above so the section
    renders correctly under all 4 `data-theme` values.
  - Add the shared `focus-ring` affordance to the interactive controls (checkboxes, `<select>`s,
    `<input>`s, Save / Reload / Test buttons) so keyboard focus is visible and control fg/bg
    derive from theme tokens, not UA defaults.
  - Ensure the reachable / unreachable status and the "unsaved" marker read from
    `--severity-success-fg` / `--severity-warning-fg` (semantic, theme-aware).
- **MODIFIED (A5/A2 consistency)** the health-status dot (`●`, `GrammarSettings.tsx`) and
  the compact-mode Apply / Ignore glyphs (`✓` / `✕`, `GrammarRedlinePanel.tsx`) standardize on
  the `@mdi` icon family already used everywhere else (`mdiCheck` / `mdiClose` / `mdiCircle`);
  the sub-11px font sizes (`text-[9.5px]`, `text-[11.5px]`) collapse to `text-[11px]` and every
  `rounded` unifies to `rounded-md` (one radius scale) in the two corrections panels.
- **MODIFIED (A6 contrast — measured AA failure)** the solid-accent buttons in the corrections
  panels (`GrammarPanel` Apply-all, `GrammarRedlinePanel` Apply-all + active mode tab) carried
  `bg-[var(--accent-primary)] text-white`. Measured: the default-theme accent `#3b82f6` is only
  **3.68:1** against white — enough for the 3:1 UI-component target but a **fail** for the 4.5:1
  normal-text target these 11-12px labels need (`[data-theme="light"]`'s `#2563eb` passes at
  5.17:1). A new shared `ACCENT_BUTTON_BG` in `grammar-panel-chrome.tsx` darkens the accent
  (`color-mix(in srgb, var(--accent-primary) 85%, black)`) to **~4.9:1** default / **~6.6:1**
  light, preserving the accent hue. Applied as an inline `style`, deliberately not a Tailwind
  arbitrary class (a malformed arbitrary value emits no CSS, which would leave white-on-panel).
  **Scoped to this plugin by decision** — `bg-[var(--accent-primary)] text-white` is the
  dashboard-wide convention (6+ core client files, no `--accent-fg` token exists); fixing it
  app-wide would mean introducing that token and touching core, which this change does not do.
- **TESTS** extend `packages/grammar-plugin/src/__tests__/GrammarSettings.test.tsx` — assert no
  raw hex / `rgba()` literal survives in the rendered section and that the interactive controls
  carry the focus affordance.
- **DOCUMENTATION** amend the `GrammarSettings.tsx` row in `packages/grammar-plugin/AGENTS.md`
  (`See change: fix-grammar-settings-theme-tokens`).

## Capabilities

### Modified Capabilities

- `grammar-settings-plugin` — the settings section SHALL render exclusively from theme CSS
  tokens (no hardcoded color literals) and expose accessible, theme-aware interactive controls
  (visible focus, token-derived fg/bg, semantic status colors), so it adapts across all four
  themes and meets WCAG-AA contrast.
- `composer-grammar-check` — the corrections panels' solid-accent controls SHALL carry a label
  that meets WCAG-AA 4.5:1 against their own background, and SHALL use one icon family and one
  radius/size scale.

### New Capabilities

- _None._ No new endpoint, wire type, or config key; `GrammarConfig` and the save/load path are
  unchanged.

## Out of Scope

- **Config / behaviour** — no new setting, no endpoint change, no change to load/save or
  clamping; only styling + a11y affordances move.
- **An app-wide `--accent-fg` token** — the accent-button contrast fix is deliberately
  plugin-local (`ACCENT_BUTTON_BG`). Introducing a real on-accent token and swapping it across
  the 6+ core client files that use `bg-[var(--accent-primary)] text-white` is a separate,
  cross-cutting change; the dashboard core is NOT modified here. The accepted trade-off is that
  the plugin's accent buttons render slightly darker than core's.
- **The corrections panels' token usage** — `GrammarPanel` / `GrammarRedlinePanel` /
  `grammar-panel-chrome` already reference theme tokens correctly for text/border colours; only
  the accent-button background, the glyph family, and the size/radius scale change.
- **Rewriting the inline-`style` section into Tailwind** — deliberately not done; the diff swaps
  values and adds focus rings, it does not restructure the markup.
- **The composer trigger / hook / backends** — no runtime grammar-check code changes.

## Discipline Skills

review-code (a multi-locus presentation + a11y change — inline review of the full diff before
commit once tests pass); the WCAG-AA contrast claim across all four themes is verified per the
`frontend-mockup-loop` a11y floor during manual QA (dark + light of each theme).
