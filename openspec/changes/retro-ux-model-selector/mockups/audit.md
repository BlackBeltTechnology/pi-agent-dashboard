# Audit — retro-ux-model-selector

Method: `retro-ux-identity-connectivity` design D4. Board: `model-selector.html` (17 states: picker 8, host role refs 6, roles settings 3). Findings R1–R16: `ui-plan.md`.

## Measured — repo probes on the board

`tests/e2e/helpers/computed-contrast.ts` probes, Playwright at 1440 px, every state's frame.

| Column | base dark | base light | nord dark | Total |
|---|---|---|---|---|
| As-built replica | 126 | 140 | 127 | **393** |
| Proposed | 0 | 0 | 0 | **0** |

## Found while building the proposed version

| # | Finding | Resolution |
|---|---|---|
| B1 | level chips, warning pills and the Unsaved pill sit inside buttons (trigger, role row, role pill) → 12 px interactive floor | those chips and pills at 12 px |
| B2 | `--link` on `--bg-surface` is 3.92:1 in base light (footer "Providers") | in-app navigation → ghost button "Open providers", not a link |
| B3 | `--accent-warning` is undefined in `index.css` and every `THEMES` palette | finding R14 |
| B4 | proposed and replica shared class names; scoped the proposed recipes to `.col.proposed` | board-only |

## Not measured

- Real portal positioning / flip (the board renders the panel in flow).
- 375 px media queries: the frame toggle narrows the frame, not the viewport, so `sm` breakpoints are measured only in the L3 captures.

## Approval record

2026-10-12, via `ask_user` (confirmed "approve all 8"):
1. Shared `RoleRef` display everywhere: role token, short model id, level chip; full `provider/id` in the accessible name (R1, R2, R13).
2. One-shot picks read the model followed by "from @fast" in 12 px secondary text (R3).
3. One vocabulary: "No model assigned", "Detached", "Role unassigned, keeps its last model" as warning pills; reason + "Reattach to @coding" in a callout (R4, R5).
4. Role-pick and level-drop notices as warning callouts with one sentence, no emoji (R6).
5. Picker list as APG combobox + grid with 32 px ★ cells; current model by check mark (R7, R8).
6. Picker states: status spinner, empty-state button, warning-pill footer, "Favorites only", "Models"/"Roles" tabs with tabpanels, 32/44 px targets, dialog semantics (R9–R12).
7. Automation hint says the model and the level follow the role (R15).
8. Baseline: palette classes, undefined `--accent-warning` hex, Blackhole hex fallbacks, 10 px / `--text-muted` information text → tokens (R14, R16).

Fold note: the provider-filter default stays "All Providers" (as built) to avoid copy churn; the board was aligned.
