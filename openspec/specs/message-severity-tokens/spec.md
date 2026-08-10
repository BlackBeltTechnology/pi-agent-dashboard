# message-severity-tokens Specification

## Purpose
TBD - created by archiving change unify-message-severity-colors. Update Purpose after archive.
## Requirements
### Requirement: Severity tokens are a derived triple set
The client SHALL define, in `index.css` (NOT via `applyThemeVars`/`CSS_VAR_KEYS`), a `--severity-<level>-{bg,fg,border}` triple for each of `error | warning | success | info | neutral`. Each of the four accent triples (`error/warning/success/info`) SHALL derive from a single base accent (`--accent-red/orange/green/blue`) via `color-mix`, where `bg` mixes into `--bg-tertiary` (10%) and `fg` mixes toward `--text-primary` (46%), both theme-aware tokens, so one formula resolves correctly in every theme; `neutral` SHALL instead map to the literal `--bg-tertiary`/`--text-secondary`/`--border-primary` tokens (NOT a `--text-muted` mix). The tokens SHALL NOT reference a nonexistent variable such as `--bg-card`. This set SHALL be the single color source of truth for every message surface.

#### Scenario: Triple preserves the muted box look
- **WHEN** a message surface applies `--severity-error-{bg,fg,border}`
- **THEN** the result SHALL be a muted translucent box (comparable to the prior `bg-red-900/90 text-red-200 border-red-800`), NOT a saturated solid-accent fill

#### Scenario: Severity → base accent mapping
- **WHEN** the token set is defined
- **THEN** `error` SHALL derive from `--accent-red`, `warning` from `--accent-orange`, `success` from `--accent-green`, and `info` from `--accent-blue` via color-mix

#### Scenario: neutral uses literal base tokens, not a mix
- **WHEN** the `neutral` triple is defined
- **THEN** it SHALL map to the existing `--bg-tertiary` / `--text-secondary` / `--border-primary` tokens directly (the proven subdued look), NOT a `color-mix` from `--text-muted` (which fails WCAG AA)

#### Scenario: close button reuses fg
- **WHEN** a toast renders its dismiss (×) button
- **THEN** its color SHALL be the variant's `-fg` at reduced opacity, NOT a separate token or raw literal

#### Scenario: Tokens resolve in every theme
- **WHEN** any theme (including light) is active
- **THEN** all five triples SHALL resolve to defined colors, deriving from theme-aware accents so named-theme overrides flow without per-surface edits

### Requirement: info does not reuse the protocol notice token
`--severity-info` SHALL be an independent token deriving from `--accent-blue`. It SHALL NOT be aliased to `--status-notice` (a protocol signal meaning "model returned reasoning only"), so the two semantics stay separable.

#### Scenario: info and notice are distinct tokens
- **WHEN** `index.css` is inspected
- **THEN** `--severity-info` and `--status-notice` SHALL be separate declarations (they MAY share `--accent-blue` as a source)

### Requirement: Warning is visually distinct from working
The `warning` severity SHALL use orange (`--accent-orange`), NOT the yellow used by `--status-working`.

#### Scenario: Warning does not reuse working-yellow
- **WHEN** a `warning` surface and a `working` status surface are visible together
- **THEN** their colors SHALL differ (orange vs yellow)

### Requirement: No raw severity color literals in message components
Message components — `Toast.tsx`, `SpawnErrorToastHost.tsx`, `SpawnErrorBanner.tsx`, and `extension-ui/ToastSlot.tsx` — SHALL source severity color from `--severity-*` tokens, NOT from raw Tailwind literals (`bg-red-900`, `bg-amber-500`, etc.). `ToastSlot` SHALL keep its protocol `level` names while mapping them onto the shared tokens.

#### Scenario: Component inspection finds no hardcoded severity color
- **WHEN** the four message components are inspected
- **THEN** severity backgrounds/borders/text SHALL derive from `--severity-*` (directly or via a class map), not inline `red-900`/`amber-500`/`red-500` literals

### Requirement: Derived triples meet a relative contrast gate across all themes
The derived `--severity-*` triples SHALL satisfy a **relative** contrast gate across all 9 named themes (base, dracula, nord, github, catppuccin, tokyo-night, rose-pine, solarized, gruvbox) in both light and dark modes (18 combos), computed in a real browser that resolves `color-mix`, as specified below. An absolute "AA 4.5:1 body everywhere" gate is unsatisfiable: adding color to text always lowers its contrast below the pure base text, and 5 of 18 theme·mode combos already ship sub-AA base body text (`--text-secondary` on `--bg-tertiary`: catppuccin/light, tokyo-night/light, rose-pine/light, solarized/dark, solarized/light). A derived tint can never beat the tokens it derives from — hence the relative gate:
- Each accent tier's `-fg` on its `-bg` SHALL clear a **3:1 legibility floor** (a minimum legibility bar, NOT a body-text AA claim; the severity color is a redundant cue alongside the icon + message text). Full WCAG AA 4.5:1 SHALL be met on the majority of cells (≥ 55 of the 90 total cells; the implementation measures 75/90, of which 61/72 are accent cells). Accent cells in [3.0, 4.5) are intentional, documented sub-AA exceptions, not AA-compliant body text.
- `neutral` SHALL equal the theme's own `--text-secondary`-on-`--bg-tertiary` contrast (it reuses those literal tokens), so it is never worse than the theme already ships.
- Borders are decorative (the filled `-bg` identifies the component, WCAG 1.4.11) and are NOT held to a contrast floor.
- ONE documented exception is permitted: tokyo-night light `info` (a blue tier on a theme whose own body text is blue and already ~3.5:1), measured ~2.7:1; the gate asserts ≥ 2.5:1 to leave browser-rounding margin.

#### Scenario: Every tier clears its floor in every theme/mode
- **WHEN** each of the five tiers renders in each of the 18 theme×mode combos
- **THEN** its `-fg`/`-bg` contrast SHALL be ≥ 3:1 (accent tiers) or ≥ the theme's own `--text-secondary`-on-`--bg-tertiary` ratio (`neutral`), except the documented tokyo-night/light `info` cell (≥ 2.5:1), and ≥ 55 of the 90 total cells SHALL additionally meet 4.5:1

### Requirement: NotifyRenderer sources severity colour from the shared tokens

`NotifyRenderer.tsx` SHALL source its per-level colour from `--severity-*`
tokens, not from raw Tailwind literals. The existing no-raw-literals requirement
enumerates `Toast.tsx`, `SpawnErrorToastHost.tsx`, `SpawnErrorBanner.tsx` and
`extension-ui/ToastSlot.tsx`; `NotifyRenderer` was omitted from that list and
still ships a `levelColors` map of `text-blue-400` / `text-green-400` /
`text-yellow-400` / `text-red-400`. It is added to the governed set.

The four `NotifyLevel` values SHALL map onto severity tiers 1:1:
`info→info`, `success→success`, `warning→warning`, `error→error`. In particular
`warning` SHALL resolve to the `--severity-warning-*` triple (derived from
`--accent-orange`), NOT to a yellow literal.

Contrast SHALL be held to the **existing relative gate** defined by this
capability — a 3:1 legibility floor per tier across all 18 theme·mode combos
with AA on the majority of cells. This change SHALL NOT introduce an absolute
"AA 4.5:1 in every theme" assertion, which that gate documents as unsatisfiable
because a derived tint cannot beat the tokens it derives from.

#### Scenario: No hardcoded severity colour in the notify renderer
- **WHEN** `NotifyRenderer` is inspected
- **THEN** it SHALL contain no `text-blue-400`, `text-green-400`, `text-yellow-400` or `text-red-400` literal
- **AND** each level's colour SHALL resolve from a `--severity-*` token

#### Scenario: Warning resolves to the orange-derived tier
- **WHEN** a notify with `level: "warning"` renders
- **THEN** its foreground SHALL resolve from `--severity-warning-fg`
- **AND** SHALL NOT be a yellow Tailwind literal

#### Scenario: Success tier resolves from its tokens
- **WHEN** a notify with `level: "success"` renders
- **THEN** its background, border and foreground SHALL resolve from `--severity-success-{bg,border,fg}`
- **AND** the existing `Toast.tsx` / `extension-ui/ToastSlot.tsx` consumers of that triple SHALL be unaffected

