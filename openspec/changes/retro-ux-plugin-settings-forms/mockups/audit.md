# Audit — retro-ux-plugin-settings-forms

Method: `retro-ux-identity-connectivity` design D4. Board: `plugin-settings-forms.html` (26 states: field anatomy, context-mode 5, hermes 5, Gmail 7, KB pill 8). Findings G1–G15 and K1–K6: `ui-plan.md`.

## Measured — repo probes on the board

Probes: `tests/e2e/helpers/computed-contrast.ts` (`measureText` fed into `contrastFailures` and `sizeFailures`, plus `buttonsWithoutFocusIndicator`), Playwright at 1440 px, every state's frame.

| Column | base dark | base light | nord dark | Total |
|---|---|---|---|---|
| As-built replica | 81 | 108 | 85 | **274** |
| Proposed | 0 | 0 | 0 | **0** |

Before approval the proposed column had 24 failures, all SlotPill's 9 px "Knowledge base" legend (K6). The approved fix brought it to 0 at 11 px; re-probed at the final 12 px legend: still 0 in all three themes.

As-built by surface, summed over themes: Gmail 111 contrast (`--text-muted` labels and help, G7); hermes 14 contrast + 51 size (11.5 px help, 11 px units and errors); KB pill 5 contrast + 36 size (10 px units and stale count, 9 px legend); field anatomy 12 + 21; context-mode 6 + 18.

## Found while building the proposed version

| # | Finding | Resolution |
|---|---|---|
| B1 | `--accent-text` link ("Open Providers") on `--severity-info-bg` is 3.27:1 in nord dark — the same gap as change 1's A2 | secondary button inside the callout |
| B2 | An 11 px pill inside a control would fail the probe's 12 px interactive floor | state pills sit in the field head, outside the control; KB stale pill is 12 px |

## Heuristic notes (Nielsen)

| Heuristic | As-built | Proposed |
|---|---|---|
| #1 Visibility of system status | Gmail wizard shows the current step only by border colour, done steps unmarked; "Add account" disabled with no reason | numbered step chips (current / done); reason text |
| #4 Consistency | four field anatomies and three type scales across sibling settings sections | one anatomy and the 11 / 12 / 14 px scale |
| #9 Error recovery | flow error = bare code; model selector unavailable = dead end; hermes errors not announced | callout naming the fix step; "Open Providers"; `aria-invalid` + linked error |

## Verdicts

| Surface | Verdict | Decisions needing approval |
|---|---|---|
| Field anatomy (A, B, C) | redesign | one shared anatomy; **carrier: runtime components vs class recipe (D2)** |
| Context-mode | polish | status line as a severity pill pointing at the host Save bar |
| Hermes memory | redesign | `htmlFor` labels, linked errors, `role="switch"`, dialog recipe |
| Gmail | polish | wizard step chips; "Add account" primary; "Connected" wording; per-account control names |
| KB folder pill | polish | state words → secondary + icon / severity pills; 32 px reindex button; **SlotPill legend: carve-out vs fix (K6)** |

## Approval record

Approved by the user in session on 2026-10-12 via `ask_user`: all 6 decisions — one field anatomy; status pill + severity notices for context-mode and hermes; hermes labels/errors/switch/dialog/Open Providers; Gmail step chips, primary Add account with reason, Connected pill, per-account names, fix-step error callout; KB pill state words and severity pills, 11 px units, 32 px control; baseline tokens. D2 carrier: shared components in `dashboard-plugin-runtime` + recipe in `ui-contract.md`. K6: fix the SlotPill legend in this change. Follow-ups decided in doubt-review the same day: the core field family moves to the runtime and serves core + plugins with the core layout (hint below control); `SessionSubcard` legend changes with SlotPill; both legends at 12 px (section-heading recipe). Scope: KB pill kept here as a separate surface.

## Replica ↔ capture reconciliation (phase 2)

_Empty until `RETRO_UX_CAPTURE=1` runs on the real components._
