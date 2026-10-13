# UI plan — add-acp-session-driver

Token authority: repo `ui-contract.md` → `packages/client/src/index.css` (dark `:root`, light `[data-theme="light"]`). Mockup copies those two blocks verbatim into `tokens.css`; every mockup rule references `var(--…)` only.

## Surfaces → tokens → states

| # | Surface (real component) | Tokens | States |
|---|---|---|---|
| S1 | Folder spawn tray — `FolderSpawnButtons` → new `AgentSpawnPicker` split button | button: `--severity-success-{bg,fg,border}` (replaces raw `green-*` debt, same hue family); menu: card recipe `--bg-secondary`/`--border-secondary` + raised elevation; focus `--focus-ring` | a) no agents → today's single button, pixel-identical; b) agents, remembered = pi; c) remembered = querymt (label shows agent); d) menu open (radio items, current checked, "durable" meta line); e) spawning (disabled + "Starting querymt…") |
| S2 | Session card — `SessionCard` | driver chip: chip recipe + `--severity-info-{bg,fg,border}` + icon + text; status via existing `StatusShapeBadge` | running ACP (in-process) · running ACP (durable) · ended ACP (no Resume/Fork/Reload/Retry in menu) |
| S3 | Chat — ended ACP session composer | severity callout `--severity-info-*`; secondary button recipe | prompt refused → inline callout "This agent session has ended" + action "New querymt session" |
| S4 | Chat — startup failure | severity callout `--severity-error-*` | "querymt failed to start" + cause + action "Edit agent config" |
| S5 | Chat — permission request (existing prompt card) | existing prompt card recipe | question = ACP `title`, options = `options[].name`, one primary |
| S6 | Automation editor — `CreateAutomationDialog` | input + label recipe; helper text `--text-secondary` | Agent select (pi default) before Model; agent chosen → Model row replaced by note "Model is chosen by the agent"; Action "Skill" disabled with reason |

## Cited rules driving the design

- **Recognition over recall** (Nielsen H6) — the picker preselects the agent last used in this folder and shows it in the button label.
- **Visibility of system status** (H1) — main button label names the agent that will start; spawning state names it too.
- **Hick's Law** — the menu lists only `pi` + configured agents; no picker at all when none are configured (progressive disclosure, NN/g).
- **Consistency** (H4 + Jakob) — split button follows the WAI-ARIA APG Menu Button pattern (https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/): `aria-haspopup="menu"`, `aria-expanded`, `role="menuitemradio"` + `aria-checked`, Arrow/Home/End/Esc keys, focus returns to the trigger.
- **Error prevention** (H5) — pi-only actions are removed for ACP sessions, not shown then refused; Skill action disabled with its reason in the automation editor.
- **Help users recover from errors** (H9, NN/g error-message guidelines) — ended-session and startup-failure callouts state what happened and offer one fix action.
- **Color not the sole channel** (WCAG 1.4.1, contract invariant 4) — driver chip = icon + text; menu check = icon + `aria-checked`.
- **Target size** (WCAG 2.5.8 + Fitts) — split halves ≥ 44 px tall at mobile, chevron hit area ≥ 44×44 px at mobile, ≥ 24×24 px desktop.
