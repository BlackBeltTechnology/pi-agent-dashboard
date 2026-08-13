# message-severity-tokens delta

## ADDED Requirements

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

An error surface whose body is a **single line or a badge** SHALL take
`--severity-error-fg` for the whole element; no chrome/content split applies.

Colouring an entire block of program output in the severity hue removes the
structure a reader needs, independently of whether the contrast ratio passes.
The container's fill, border and label are three redundant channels for the error
signal, so removing colour from the body does not weaken it.

#### Scenario: Multi-line error body renders in code colours
- **GIVEN** a tool result parsed as an error whose message spans multiple lines
- **THEN** the body SHALL use `--text-secondary` on `--bg-code`
- **AND** the container SHALL use `--severity-error-bg` and `--severity-error-border`
- **AND** the label SHALL use `--severity-error-fg`

#### Scenario: The error signal survives without a coloured body
- **GIVEN** a multi-line error body rendered in code colours
- **THEN** the surface SHALL still convey the error state via at least the container fill, the container border, and a text label

#### Scenario: Single-line error surfaces take the accent directly
- **GIVEN** a badge, status icon, or one-line error message
- **THEN** it SHALL take `--severity-error-fg`, and no separate body treatment SHALL apply

#### Scenario: Collapsed detail blocks already follow the rule
- **GIVEN** an error card with a collapsible received-arguments block
- **THEN** that block SHALL use `--text-secondary` on `--bg-code`, unchanged by this requirement

## MODIFIED Requirements

### Requirement: Derived triples meet a relative contrast gate across all themes

The derived `--severity-*` triples SHALL satisfy a **relative** contrast gate
across all 9 named themes (base, dracula, nord, github, catppuccin, tokyo-night,
rose-pine, solarized, gruvbox) in both light and dark modes (18 combos), computed
in a real browser that resolves `color-mix`, as specified below. An absolute
"AA 4.5:1 body everywhere" gate is unsatisfiable: adding color to text always
lowers its contrast below the pure base text, and 5 of 18 theme·mode combos
already ship sub-AA base body text (`--text-secondary` on `--bg-tertiary`:
catppuccin/light, tokyo-night/light, rose-pine/light, solarized/dark,
solarized/light). A derived tint can never beat the tokens it derives from —
hence the relative gate:

- Each accent tier's `-fg` on its `-bg` SHALL clear a **3:1 legibility floor** (a
  minimum legibility bar, NOT a body-text AA claim; the severity color is a
  redundant cue alongside the icon + message text). Full WCAG AA 4.5:1 SHALL be
  met on the majority of cells. Accent cells in [3.0, 4.5) are intentional,
  documented sub-AA exceptions, not AA-compliant body text.
- `neutral` SHALL equal the theme's own `--text-secondary`-on-`--bg-tertiary`
  contrast (it reuses those literal tokens), so it is never worse than the theme
  already ships.
- Borders are decorative (the filled `-bg` identifies the component,
  WCAG 1.4.11) and are NOT held to a contrast floor.
- ONE documented exception is permitted: tokyo-night light `info` (a blue tier on
  a theme whose own body text is blue and already ~3.5:1), measured ~2.7:1; the
  gate asserts ≥ 2.5:1 to leave browser-rounding margin.

The gate SHALL additionally cover the governed **tool-result error surfaces**.
Each such surface's resolved foreground against its own resolved background SHALL
clear the same 3:1 floor in every theme and mode. No additional exception is
introduced for them.

#### Scenario: Every tier clears its floor in every theme/mode
- **WHEN** each of the five tiers renders in each of the 18 theme×mode combos
- **THEN** its `-fg`/`-bg` contrast SHALL be ≥ 3:1 (accent tiers) or ≥ the theme's own `--text-secondary`-on-`--bg-tertiary` ratio (`neutral`), except the documented tokyo-night/light `info` cell (≥ 2.5:1)

#### Scenario: Tool-result error surfaces clear the floor in every theme/mode
- **WHEN** the ctx error card, the `N failed` badge, the `exit N` badge, the errored tool-step icon, the ask_user error message and the subagent error line render in each of the 18 theme×mode combos
- **THEN** each surface's resolved foreground against its own resolved background SHALL be ≥ 3:1
- **AND** no light-mode cell SHALL measure below the floor
