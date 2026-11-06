# ui-plan: automation board (navigate, edit, stop, polish)

Explore-mode plan for three live mocks (one per decision axis). Pending change:
automation board navigation, editing, stop and polish. Every value cites a
`ui-contract.md` token or recipe; no raw hex/px. Mode: anti-slop-redesign
**preserve**.

## Mocks

| Mock dir | Decision | Frames |
|---|---|---|
| `2026-11-06-automation-board/` | Navigate: A (list + session links) vs B (master-detail) + polish | A desktop · B desktop · B phone |
| `2026-11-06-automation-edit/` | Edit: E1 (Edit button + modal) · E2 (inline Form/YAML) · E3 (quick card toggles) | E1 · E2 form · E2 YAML invalid · E3 |
| `2026-11-06-automation-stop/` | Stop: S1 (orphaned-run stop flow) · S2 (restart-survival timeline) | S1 steps · S2 |

Current panes import the REAL `automation-card-visuals` helpers via the
`@automation` alias, so "today" is the shipped visual, not a redraw.

## Preserve list (protected; audited from AutomationBoard.tsx)

- Route `/folder/:encodedCwd/automations`, run monitor `/folder/:encodedCwd/automations/run/:sid`.
- Labels: "Automations", "+ Create Automation", "Show archived", "Definitions",
  "Recent runs", "Run now", "Stop", "Enable"/"Disable", "Edit", "Delete".
- Every `data-testid` (`automation-board`, `automation-def-<name>`, `stop-<name>`,
  `run-now-<name>`, `overflow-<name>`, `automation-run-<runId>`, ...).
- Renames are proposals, flagged as such in the mock, never silent.

## Surfaces -> tokens -> states

| Surface | Recipe (ui-contract) | States |
|---|---|---|
| Definition card | card root `rounded-xl border-[var(--border-secondary)] bg-[var(--bg-secondary)]` + raised elevation | enabled · running · disabled · invalid · orphaned (new) |
| Status | `SettingsStatusPill` tone success/info/warning/error/neutral, human word, icon | running = info + `mdiLoading` spinning; orphaned = warning |
| Status dot / rail | `--status-working/idle/error` shape only, never text | replaces `bg-yellow-500/40` etc. (raw palette, contract violation) |
| Buttons | primary / secondary button recipes, `min-h-[44px] sm:min-h-[36px]` | replaces 10 px `CardBtn` (below the 12 px action floor) |
| Destructive | `tint-action-red` / dialog danger triple | Stop, Delete |
| Run row | row-overflow recipe; time `--text-secondary` | link to session `/session/:id`, monitor route |
| Notices | `SettingsNotice` (warning / success) | orphaned run, stop result |
| Facts | `SettingsFacts` | detail-pane metadata |
| Tabs | tabs recipe (APG tablist, `?tab=` in URL) | Overview / Runs / Settings |
| Editor | input + field-label recipes; segmented Form/YAML = filter-chip recipe (`aria-pressed`) | dirty · invalid · saved |
| Empty | loading/empty/first-run recipe | no automations |

## Rules applied (cited)

- **Nielsen #1 visibility of system status**: orphaned / reattached states are named, not hidden (S1, S2).
- **Nielsen #3 user control**: Stop always does something; undo toast for quick toggles (E3) - NN/g "prefer undo over confirm".
- **Nielsen #6 recognition over recall**: "Daily at 09:20" instead of `20 9 * * *` (cron kept on hover/edit).
- **Nielsen #8 minimalist**: findings chip only when > 0.
- **Fitts's Law** (lawsofux.com/fittss-law): action targets to the contract button floor.
- **Von Restorff** / one primary action per view (ui-contract anti-slop guardrails).
- **NN/g modal guidance**: modal only when the user must decide first -> inline editing (E2), confirm only for destructive Stop on an orphan (S1).
- **WCAG 1.4.1**: state = pill word + icon + dot shape, never colour alone.
- **Gestalt common region**: runs nested under their automation (A) instead of a detached global table.

## Gates

`validate_mockup` L1/L2 (dark + light), `score_mockup` 375/768/1440, plus one
non-base palette screenshot (themes.ts). `node scripts/theme-token-guard.mjs`
on promotion.
