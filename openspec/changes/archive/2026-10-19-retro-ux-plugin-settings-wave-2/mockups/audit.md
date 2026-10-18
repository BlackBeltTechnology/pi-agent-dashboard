# Audit — retro-ux-plugin-settings-wave-2

Method: wave 1 (`retro-ux-plugin-settings-forms`) D4. Board: `plugin-settings-wave-2.html` (16 surfaces, 44 states). Findings: `ui-plan.md`. Probe: `probe.js` (same rules as `tests/e2e/helpers/computed-contrast.ts`: text contrast < 4.5:1, or < 3:1 for large text; text < 11 px, < 12 px inside an interactive element; pills ≥ 11 px).

## Measured

As-built = live `:8000`, plugin body (`[data-testid=plugin-page-body-<id>]`, all `<details>` opened), current live state of each page only. Proposed = every state frame on the board.

| Column | base light | base dark | nord dark | Total |
|---|---|---|---|---|
| As-built (live) | 265 | 251 | 258 | **774** |
| Proposed (board) | 0 | 0 | 0 | **0** |

As-built by surface, summed over the three themes:

| Surface | Failures | Main cause |
|---|---|---|
| browser | 324 | 10 px status words + audit caption, repeated per profile (8 profiles) |
| blackhole | 246 | 10 px DEFAULT / PRIMARY / key chips, 11–11.5 px help, `--text-muted` loading |
| quota | 70 | 10 px reasons, ToS warning, id chip, retry preview |
| flows-anthropic-bridge | 33 | zinc rgba status bar (unreadable in light), 10 px id, 11 px table |
| grammar | 30 | 9.5–10.5 px recommended list + id |
| apple-tools | 19 | `#71717a` 10 px id, 11 px hex-coloured notices |
| flows | 18 | `--text-muted` hint, 11 px |
| mcp-client | 13 | 11 px docs link / empty text |
| goal | 12 | `--text-muted` install line + hint |
| chat-gateway, system-one, subagents | 3 each | single 10–11 px caption |
| automation, cost-estimator, obs-studio | 0 | defects are structural (see below), not contrast/size |

Probe does not see structural defects. Those are judged by heuristic (below): borderless controls (cost-estimator), missing hints/labels (automation, chat-gateway), raw state words (obs-studio, apple-tools), literal backticks (obs-studio), contradictory toggles (flows-anthropic-bridge).

## Found while building the proposed version

| # | Finding | Resolution |
|---|---|---|
| B1 | Kit `SettingsGroup` summary meta (`text-[11px]`) inside an interactive `<summary>` fails the 12 px interactive floor — on every group of every wave-1 page too | meta → 12 px in `settings-fields.tsx` (kit fix, this change) |
| B2 | `--accent-text` link on `--bg-tertiary` (inside an item card) = 3.96:1 in nord dark — same gap as wave 1 B1 | secondary button inside cards; `p-link` only on `--bg-primary`/`--bg-secondary` |
| B3 | Host chrome “Running” pill next to a body status pill (“Not set up”) reads as a contradiction | chrome pill only when the plugin is unhealthy (compact-header precedent) |
| B4 | Browser relay page is 5 008 px tall because every profile is fully expanded | profiles with the extension open; the rest grouped in a collapsed “Other Chrome profiles” group |
| B5 | flows-anthropic-bridge force + disable checkboxes can both be on | one 3-way “Bridge gate” (Automatic · Always on · Off); both env vars stay the storage |

## Heuristic notes (Nielsen)

| Heuristic | As-built | Proposed |
|---|---|---|
| #1 Visibility of system status | status as 10 px words or raw enums; no loading state (bridge, grammar, cost) | status pills with words; “Checking…”/“Loading…” states; unhealthy-only chrome pill |
| #2 Match the real world | `OS_TOO_OLD`, `waiting_peers`, `allowedRoots`, L1/L2/L4 | human words; config term moves into the hint |
| #3 User control | own mid-page Save, keystroke writes, blur writes | one host Save bar for config; immediate only for actions |
| #4 Consistency | 12 field anatomies across 15 sibling pages | one kit anatomy |
| #8 Minimalist design | title/id repeated in 6 bodies; `claims:` developer chip on every page | identity once (host); claims only with Developer ▸ Show plugin internals |
| #9 Error recovery | raw codes, unhandled rejections, page blanked on one failure | sentence + Try again + Copy details; errors scoped to the item that failed |

## Verdicts

| Surface | Verdict | Decisions needing approval |
|---|---|---|
| Host chrome | redesign | **A1** claims chip gate (new Developer toggle vs collapsed disclosure); **A2** back link to the top as breadcrumb; **A3** healthy = no status pill |
| apple-tools | redesign | path field joins the host Save bar (**A4**) |
| browser | redesign | **A5** collapse profiles without the extension |
| chat-gateway | redesign | **A4** own Save → host Save bar; 4 groups; field validation |
| flows-anthropic-bridge | redesign | **A6** 3-way gate replaces two checkboxes; **A4** host Save bar |
| automation, blackhole, grammar, quota | redesign | kit migration only; save model unchanged |
| cost-estimator | redesign | **A4** keystroke writes → host Save bar |
| obs-studio, mcp-client, system-one, goal, flows, subagents | polish | none beyond the shared rules |
| Kit | — | **A7** add `SettingsStatusPill`, `SettingsItem`, `SettingsFacts`, `SettingsTable`; B1 meta 12 px |
| Lint | — | **A8** kit-adoption ratchet + `theme-token-guard` over every plugin tree |

## Approval record

Approved by the user in session on 2026-10-18 via `ask_user`, all eight with no copy changes: A1 new Developer display preference `showPluginInternals` (default off) gates the slot-claims disclosure; A2 breadcrumb back link at the top; A3 status pill only when unhealthy; A4 configuration on the host Save bar (chat-gateway, flows-anthropic-bridge, cost-estimator, apple-tools path); A5 Browser Relay collapses profiles without the extension; A6 three-way bridge gate; A7 `SettingsStatusPill`, `SettingsItem`, `SettingsFacts`, `SettingsTable` + `SettingsGroup` meta 12 px; A8 settings-kit ratchet lint + `theme-token-guard` over every plugin tree.

## After capture

`mockups/after/<surface>/` — 44 states (15 plugin bodies + host chrome) × 3 themes (base dark, base light, nord dark) × 3 widths (375 / 768 / 1440) = 396 captures from the docker harness with `RETRO_UX_CAPTURE=1` (`tests/e2e/retro-ux-plugin-settings-wave-2.spec.ts`, 21 passed). Every contrast, size, focus and overflow list is empty (`E36`); `E37`–`E39`, `F7`, `F8` pass in the same run.

Replica-vs-capture differences:
- States are reached by `page.route` stubs of each plugin's REST/config routes (`tests/e2e/fixtures/retro-ux/plugin-*.ts`); real provisioning flows stay manual (`F10`).
- Pills, items, facts and tables come from the runtime kit, not the board's HTML; sizes are the same 11 / 12 / 14 px steps (pills inside an interactive summary step up to 12 px automatically).
- Collapsible item actions sit at the top of the item body, not in the summary (a control inside a `role=button` summary is a nested interactive element — design D9).
- Probe-driven one-line fixes outside the board: `plugin-row-parts.tsx` copy/install buttons 11 → 12 px; browser "Recommended" pill inside the group summary marked interactive.
- Host chrome "disabled" state needs both the row and the persisted `config.plugins.<id>.enabled` patched (the client seeds `enabled` from config).
