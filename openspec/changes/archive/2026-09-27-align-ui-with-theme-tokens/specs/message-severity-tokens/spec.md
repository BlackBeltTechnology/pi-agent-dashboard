## ADDED Requirements

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

## MODIFIED Requirements

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
