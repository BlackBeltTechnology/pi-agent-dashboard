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

The derived `--severity-*` triples and the `--tint-*` identity triples SHALL satisfy a **relative** contrast gate
across all 9 named themes (base, dracula, nord, github, catppuccin, tokyo-night,
rose-pine, solarized, gruvbox) in both light and dark modes (18 combos), computed
in a real browser that resolves `color-mix`, as specified below. An absolute
"AA 4.5:1 body everywhere" gate is unsatisfiable: adding color to text always
lowers its contrast below the pure base text, and several light themes (notably
tokyo-night light, whose body text is blue) leave little headroom. A derived tint
can never beat the tokens it derives from — hence the relative gate:

- Each accent tier's `-fg` on its `-bg` SHALL clear a **3:1 legibility floor** (a
  minimum legibility bar, NOT a body-text AA claim; the severity color is a
  redundant cue alongside the icon + message text). Full WCAG AA 4.5:1 SHALL be
  met on the majority of cells. Accent cells in [3.0, 4.5) are intentional,
  documented sub-AA exceptions, not AA-compliant body text. The accent tiers are the
  four severity tiers and the five tint tiers (`green`, `orange`, `blue`, `purple`, `red`).
- `neutral` SHALL equal the theme's own `--text-secondary`-on-`--bg-tertiary`
  contrast (it reuses those literal tokens), so it is never worse than the theme
  already ships.
- Borders are decorative (the filled `-bg` identifies the component,
  WCAG 1.4.11) and are NOT held to a contrast floor.
- Documented exceptions, all on tokyo-night light (a theme whose own body text is
  blue and already ~3.5:1), each asserted at ≥ 2.5:1 to leave browser-rounding margin:
  `info` and `blue` (the same resolved colours, since `--severity-info-*` aliases
  `--tint-blue-*`; measured ~2.7:1), and `purple` (measured ~2.9:1). The
  tool-result `link` surface keeps its existing tokyo-night light exception
  (≥ 2.5:1). No other exception is permitted.

The gate SHALL additionally cover the governed **tool-result error surfaces**.
Each such surface's resolved foreground against its own resolved background SHALL
clear the same 3:1 floor in every theme and mode, except the existing tokyo-night
light `link` cell (≥ 2.5:1). No further exception is introduced for them.

#### Scenario: Every tier clears its floor in every theme/mode
- **WHEN** each severity tier and each tint tier renders in each of the 18 theme×mode combos
- **THEN** its `-fg`/`-bg` contrast SHALL be ≥ 3:1 (accent tiers) or ≥ the theme's own `--text-secondary`-on-`--bg-tertiary` ratio (`neutral`), except the documented tokyo-night/light `info`, `blue` and `purple` cells (≥ 2.5:1)
- **AND** at least 55 of the 90 severity cells and at least 55 of the 90 tint cells SHALL meet 4.5:1

#### Scenario: Tool-result error surfaces clear the floor in every theme/mode
- **WHEN** the ctx error card, the `N failed` badge, the `exit N` badge, the errored tool-step icon, the ask_user error message and the subagent error line render in each of the 18 theme×mode combos
- **THEN** each surface's resolved foreground against its own resolved background SHALL be ≥ 3:1
- **AND** no light-mode cell SHALL measure below the floor

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

### Requirement: Tool-result error surfaces source severity colour from the shared tokens

The chat transcript's tool-result error surfaces SHALL source severity colour
from `--severity-*` tokens, not from raw Tailwind literals. The existing
no-raw-literals requirement enumerates `Toast.tsx`, `SpawnErrorToastHost.tsx`,
`SpawnErrorBanner.tsx`, `extension-ui/ToastSlot.tsx` and `NotifyRenderer.tsx`;
the tool-result renderers were omitted from that list and still ship raw
`red-300` / `red-400` / `red-500` / `red-950` literals. They are added to the
governed set:

- `tool-renderers/CtxToolRenderer.tsx` — the error card's border, fill and label
- `tool-renderers/AskUserToolRenderer.tsx` — the error icon and message
- `tool-renderers/AgentToolRenderer.tsx` — the subagent error line
- `chat/ToolBurstGroup.tsx` — the `N failed` badge
- `chat/BashOutputCard.tsx` — the non-zero `exit N` badge
- `chat/ToolCallStep.tsx` — the errored tool's status icon

These literals are dark-mode-tuned, so every one of these surfaces currently
clears the floor in dark mode and fails it in light mode.

#### Scenario: Component inspection finds no hardcoded severity colour
- **WHEN** the six governed tool-result components are inspected
- **THEN** severity backgrounds, borders, text and icon colours SHALL derive from `--severity-*` (directly or via a class map)
- **AND** SHALL NOT use raw `red-300` / `red-400` / `red-500` / `red-950` literals, with or without an alpha suffix

#### Scenario: A raw literal cannot re-enter a governed surface
- **WHEN** a raw `red-<NNN>` Tailwind literal is introduced into any file in the governed set
- **THEN** a static check SHALL fail and identify the file and line

#### Scenario: Non-error surfaces are unaffected
- **WHEN** files outside the governed set use raw red literals for non-severity purposes, such as a destructive-action button
- **THEN** the check SHALL NOT fail

### Requirement: Severity styles the chrome, not multi-line body content

An error surface whose body is **multi-line content** — a log dump, a command
transcript, a stack trace, tool output — SHALL carry its severity signal on the
container chrome (border, fill, and label) and SHALL render the body in the
normal code colours, `--text-secondary` on `--bg-code`.

An error surface that is a **badge or a bare status icon** SHALL take
`--severity-error-fg` for the whole element; no chrome/content split applies.

An error surface that is an **icon (or a literal `Error:` marker) followed by a
message** SHALL put `--severity-error-fg` on the icon/marker only and render the
message in `--text-secondary`. The icon/marker is the chrome; the message is
content. These surfaces carry no container fill or border, so the accent is
deliberately kept on the one element that is not the message itself — the error
signal is the icon/marker plus the message's own wording, not a tinted body.

Colouring an entire block of program output in the severity hue removes the
structure a reader needs, independently of whether the contrast ratio passes.
For a **contained** surface the fill, border and label are three redundant
channels for the error signal, so removing colour from the body does not weaken
it. For an icon-plus-message surface the redundancy is the icon plus the
message's wording instead; no container is introduced to manufacture it.

#### Scenario: Multi-line error body renders in code colours
- **GIVEN** a tool result parsed as an error whose message spans multiple lines
- **THEN** the body SHALL use `--text-secondary` on `--bg-code`
- **AND** the container SHALL use `--severity-error-bg` and `--severity-error-border`
- **AND** the label SHALL use `--severity-error-fg`

#### Scenario: The error signal survives without a coloured body
- **GIVEN** a multi-line error body rendered in code colours
- **THEN** the surface SHALL still convey the error state via at least the container fill, the container border, and a text label

#### Scenario: Badges and bare status icons take the accent directly
- **GIVEN** a badge or a bare status icon
- **THEN** it SHALL take `--severity-error-fg`, and no separate body treatment SHALL apply

#### Scenario: An icon-plus-message surface accents only the icon
- **GIVEN** an error surface composed of an icon or an `Error:` marker followed by a message
- **THEN** the icon or marker SHALL take `--severity-error-fg`
- **AND** the message SHALL take `--text-secondary`
- **AND** no container fill or border SHALL be added to the surface

#### Scenario: Collapsed detail blocks already follow the rule
- **GIVEN** an error card with a collapsible received-arguments block
- **THEN** that block SHALL use `--text-secondary` on `--bg-code`, unchanged by this requirement

### Requirement: Identity tint triples with severity aliases
The client SHALL define in `index.css`, alongside the severity triples, `--tint-<hue>-{bg,fg,border}` for each of `green | orange | blue | purple | red`, derived from `--accent-<hue>` with the same formula as the severity triples (`bg` 10% into `--bg-tertiary`, `fg` 46% toward `--text-primary`, `border` 40% into transparent). `--severity-success-*`, `--severity-warning-*`, `--severity-info-*` and `--severity-error-*` SHALL resolve through `--tint-green-*`, `--tint-orange-*`, `--tint-blue-*` and `--tint-red-*` respectively, with resolved values unchanged. Tints SHALL express identity (pi, worktree, fork, goals, destructive) and SHALL NOT be used to express severity. A `--tint-<hue>-fg` colour SHALL only be rendered on its matching `--tint-<hue>-bg` fill, never directly on a card or page surface.

#### Scenario: Severity values unchanged
- **WHEN** the resolved values of every `--severity-{success,warning,info,error}-*` token are compared before and after this change in every theme, light and dark
- **THEN** they SHALL be identical

#### Scenario: Tints meet the severity contrast gate
- **WHEN** each `--tint-<hue>-fg` is composited over `--tint-<hue>-bg` in every theme, light and dark
- **THEN** the ratio SHALL satisfy the relative gate in "Derived triples meet a relative contrast gate across all themes", including its enumerated exceptions

### Requirement: No raw colour literals on aligned action surfaces
`FolderSpawnButtons.tsx`, `DashboardSpawnButtons.tsx`, `SessionCard.tsx`, `WorktreeSpawnDialog.tsx`, `WorktreeList.tsx`, `GoalDetailClaim.tsx`, `ConfirmRenderer.tsx`, `SelectRenderer.tsx` and `CreateAutomationDialog.tsx`, and the `OpenSpecBoardView.tsx` new-session / create controls, SHALL source accent colour from `--tint-*`, `--severity-*` or `--status-*` tokens and SHALL NOT use raw Tailwind palette classes (`text|bg|border|ring|outline|divide|shadow|from|via|to-<hue>-<shade>`) or hex/rgba colour literals in class names or inline styles. Identity accents SHALL use `--tint-*`, warning/error/success/info meaning SHALL use `--severity-*`, and session status SHALL use `--status-*`.

#### Scenario: New-session tray uses tints
- **WHEN** the folder new-session tray renders in the default light theme
- **THEN** "New Session" SHALL use `--tint-green-*`, "New Worktree" SHALL use `--tint-orange-*`, and each label SHALL measure at least 4.5:1 against its composited background

#### Scenario: Worktree collision warning uses severity
- **WHEN** the worktree dialog shows the branch-collision or orphan-path warning
- **THEN** the block SHALL use `--severity-warning-*` and its text SHALL measure at least 4.5:1 in the default dark and light themes

#### Scenario: Surface files contain no palette literals
- **WHEN** the listed files are scanned for `(text|bg|border|ring|outline|divide|shadow|from|via|to)-(green|orange|blue|yellow|indigo|red|amber|purple|emerald|sky)-<digits>` and `#[0-9a-fA-F]{3,8}` / `rgba(` inside `className` or `style`
- **THEN** no match SHALL be found
