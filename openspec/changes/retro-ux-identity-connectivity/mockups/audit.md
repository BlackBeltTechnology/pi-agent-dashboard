# Audit — retro-ux-identity-connectivity

Method: design D4. Board: `identity-connectivity.html` (29 states, as-built replica built from develop source, proposed version beside it). Findings F1–F26 and their cited rules: `ui-plan.md`.

## Measured — repo probes on the board

Probes: `tests/e2e/helpers/computed-contrast.ts` (`measureText` fed into `contrastFailures` and `sizeFailures`, plus `buttonsWithoutFocusIndicator`), run with Playwright at 1440 px on every state's frame, in `{base,dark}`, `{base,light}` and `{nord,dark}`.

| Column | base dark | base light | nord dark | Total |
|---|---|---|---|---|
| As-built replica | 133 | 164 | 154 | **451** |
| Proposed | 0 | 0 | 0 | **0** |

As-built failures by surface and type, summed over the three themes:

| Surface | Contrast | Size (< 11 px, or < 12 px interactive) |
|---|---|---|
| Users | 169 | 45 |
| Known servers | 88 | 6 |
| Network discovery | 65 | 0 |
| Server selector | 30 | 48 |

Main contributors: `--text-muted` used for information text (F1), 10 px state text and badges (F5, F21), palette-class link text on light backgrounds (F9).

The replica is evidence, not the product. Phase 2 re-runs the same probes on the real render (`tests/e2e/retro-ux-identity-connectivity.spec.ts`), and differences between replica and capture are logged below.

## Found while building the proposed version

| # | Finding | Resolution |
|---|---|---|
| A1 | `--severity-*-fg` painted on `--bg-surface` (dropdown panel) is 4.36:1 in nord dark | state words in the dropdown are severity **pills** (fg on its own bg). The tint-pairing rule (`ui-contract.md` § Colour roles) is treated as applying to the severity family too |
| A2 | `--accent-text` on `--bg-surface` is 3.39:1 and on `--severity-info-bg` 3.27:1 in nord dark | menu action uses `--text-primary` plus an icon; the disclosure summary inherits the callout fg and is underlined |
| A3 | an Update button nested inside a listbox option is invalid ARIA (interactive content inside `option`) | the selector follows the APG **menu button** pattern; a move is its own `menuitem` |

Contract follow-up (not part of this change): A1 and A2 are palette-specific failures that the contract's ramp table (`ui-contract.md` a11y #6) does not list. Proposed addition: "severity fg only on its own severity bg; `--accent-text` is not text-safe on `--bg-surface` in every palette".

## Heuristic notes (Nielsen)

| Heuristic | As-built | Proposed |
|---|---|---|
| #1 Visibility of system status | probe in flight shows nothing (F7); read-only shows nothing (F15); verified identity invisible (F16) | "Checking…" pill; read-only note; "Verified" pill |
| #4 Consistency | Users revoke = two-click, server remove = one-click (F12); Local/Remote colours differ between selector and discovery (F4) | two-click on both; one Local/Remote pill everywhere |
| #5 Error prevention | one-click server remove | confirm step |
| #9 Error recovery | load failure shown as "No remote servers saved" (F13); remove and add failures swallowed (F14) | error callout + Retry; inline row error |

## Approval record

Approved by the user in session on 2026-10-12 via `ask_user`: all 8 decisions — selector APG menu button with inline reasons and 380 px panel; "Verified" pill; two-click remove; surfaced load/remove failures; Users severity status pills and orphaned pill; Add user primary button and 32 px row actions; collapsed mDNS diagnostic; baseline contract fixes (labels, `--text-muted` info text, palette → tokens). The baseline item was confirmed in a follow-up question after it was left unticked.

## Verdicts

| Surface | Verdict | Decisions needing approval |
|---|---|---|
| Users | polish | status pill wording ("Invite pending" for `invited`); orphan explanation subline |
| Passkey impact note | ok | none |
| Server selector | redesign | APG menu button; reasons shown inline (not tooltip); panel width 380 px; "Moved" + separate update item |
| Known servers | redesign | **F16 "Verified" pill (new information)**; two-click remove |
| Network discovery | polish | "Why does discovery fail?" disclosure (diagnostic collapsed by default) |

## Replica ↔ capture reconciliation (phase 2)

_Empty until `RETRO_UX_CAPTURE=1` runs on the real components._
