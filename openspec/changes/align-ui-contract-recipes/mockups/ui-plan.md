# UI plan — align-ui-contract-recipes

Mode: **preserve** (`anti-slop-redesign`). Profile: `product-ui`. Contract: root `ui-contract.md`.
Board: `index.html` (9 recipes + "All proposed contract rows"); serve the `mockups/` dir.

| File | Purpose |
|---|---|
| `index.html` | Board shell: theme (base dark / base light / nord dark), frame width (375 / 768 / full), view (side by side / as-built / proposed); per-recipe probe badge. |
| `recipes.js` | `RECIPES[]`: per recipe — lead, cited rules, findings with file:line, AS-BUILT variants (shipped classes verbatim as inline styles), PROPOSED states, copy-ready contract row. |
| `surfaces.js` | `SURFACES[]`: the three components this change fixes in code, shown in context — S1 settings page + rail, S2 session card + actions menu, S3 dialog over the dashboard (standard + confirm). |
| `recipes.css` | PROPOSED recipe classes, token-only. Only literal: `#fff` on `--accent-solid` (contract primary-button recipe, inherited from `mockup.css`). |
| `probe.js` | Contrast + size probe (rules of `tests/e2e/helpers/computed-contrast.ts`): `__probeAll()` → proposed failures + as-built failure count per recipe. |
| `tokens.css` | Copied from `retro-ux-plugin-settings-wave-2` (generated from `index.css`, unchanged since 2026-10-17) + nord dark. |
| `mockup.css`, `board.css` | Copied from wave 2 (shared board chrome + contract button/input recipes). |
| `icons.js` | Generated from `@mdi/js`. |

## Surfaces → tokens → states

| Recipe | Tokens | States on the board |
|---|---|---|
| R1 status pill | `--severity-{success,info,warning,error,neutral}-{bg,fg,border}` | 5 tones; `ui:status-pill` state map (running/success/info/warn/error/muted); healthy-silent list |
| R2 notice | severity triple, `--bg-code`, contract buttons | error + retry + raw detail; info + remedies; warning + action; success |
| R3 inline action error | `--severity-error-fg` | button action; field action; item-scoped row |
| R4 tabs / filter chip | `--border-secondary`, `--accent-primary` (indicator), `--text-{primary,secondary}`, info triple | page tabs + count pills; in-component tabs; filter chips |
| R5 menu / flyout | `--bg-secondary`, `--border-secondary`, `--elevation-rim`, `--shadow-card`, `--tint-red-fg` | grouped menu, NEXT, disabled with visible reason, `More…`, plugin group, destructive |
| R6 dialog | `--bg-overlay`, card recipe, `--accent-solid`, `--tint-red-*`, severity tile | standard; confirm-impact alertdialog; destructive with volume checkbox |
| R7 loading / empty / first-run | `--bg-tertiary`, `--border-subtle` | skeleton; filtered-empty; first-run; load-failed (notice) |
| R8 row overflow | — | 260 px and 340 px cards |
| R9 settings rail | `--text-secondary`, `--bg-tertiary`, `--accent-primary` bar | rail with current item |

## Gate results (measured 2026-10-18, agent-browser, `__probeAll()`)

Failures = text contrast < 4.5:1 (3:1 large) or text < 11 px (< 12 px inside an interactive element).

| Recipe | Proposed (dark / light / nord) | As-built (dark / light / nord) |
|---|---|---|
| R1 status pill | 0 / 0 / 0 | 3 / 10 / 3 |
| R2 notice | 0 / 0 / 0 | 0 / 0 / 0 |
| R3 inline error | 0 / 0 / 0 | 0 / 0 / 0 |
| R4 tabs | 0 / 0 / 0 | 3 / 4 / 4 |
| R5 menu | 0 / 0 / 0 | 4 / 4 / 4 |
| R6 dialog | 0 / 0 / 0 | 1 / 0 / 1 |
| R7 states | 0 / 0 / 0 | 1 / 1 / 1 |
| R8 overflow | 0 / 0 / 0 | 0 / 0 / 0 (clipping, not contrast — see O1) |
| R9 rail | 0 / 0 / 0 | 3 / 3 / 3 |
| S1 settings page · rail | 0 / 0 / 0 | 6 / 6 / 6 |
| S2 session card · menu | 0 / 0 / 0 | 7 / 7 / 7 |
| S3 dialog in context | 0 / 0 / 0 | 1 / 0 / 1 |
| **Total** | **0** | **29 / 35 / 33** |

Notes:
- The probe does not measure target size. As-built target defects (dialog actions ≈ 26 px and close button 28 px, menu items 30 px, Unified tabs ≈ 28 px) are recorded as findings D3, M2 and T1.
- As-built R2/R3 = 0 because the shipped notices and error lines already use severity tokens. Their findings are about anatomy (N1–N3, E1–E2), not colour.

Reflow: `documentElement.scrollWidth === clientWidth` on every recipe at 375 and 768 px, and on S1–S3 at 375 px. At 375 px the S1 rail collapses into a horizontal scroller, as the shipped rail does below `md`.

- Fixed during the loop: the proposed R8 row overflowed its `grid` card at 375 px until the row got `min-width: 0`. The detail went into the R8 contract row.
- Fixed during the loop: the as-built R2 `<pre>` needed `overflow-wrap` (the shipped class has `break-words`).

## Rubric (boolean, proposed column)

| # | Check | Rule | Pass |
|---|---|---|---|
| 1 | Text contrast ≥ 4.5:1, 3 themes | WCAG 1.4.3 | ✅ (probe 0) |
| 2 | No text < 11 px; < 12 px in interactive | contract type floor | ✅ (probe 0) |
| 3 | State never by colour alone (pill icon + word, chip check, rail bar + weight) | WCAG 1.4.1 | ✅ |
| 4 | Non-text indicators (tab underline, rail bar) use `--accent-primary` ≥ 3:1 | WCAG 1.4.11 | ✅ (`#3b82f6` on base surfaces ≥ 3:1) |
| 5 | Targets ≥ 36 px desktop / 44 px touch (chips 32 px desktop, 44 px touch) | WCAG 2.5.8, contract | ✅ |
| 6 | One primary per dialog / empty state / notice | Von Restorff; contract dialog row | ✅ |
| 7 | Raw codes / errors only behind "Copy details" or `data-state` | Nielsen #2, #9 | ✅ |
| 8 | Destructive confirm: alertdialog, Cancel focused, items named, risky option unchecked | APG alertdialog; NN/g confirmation | ✅ |
| 9 | Menu: grouped, ≤ 1 emphasised, rare items folded, disabled reason visible | Hick, APG menu | ✅ |
| 10 | Tabs vs filters split by semantics (tablist vs `aria-pressed`) | APG tabs | ✅ |
| 11 | Loading uses shaped skeleton + `aria-busy`, motion-reduce respected | NN/g skeleton; WCAG 2.3.3 | ✅ |
| 12 | No reflow overflow at 375 / 768 | WCAG 1.4.10 | ✅ |
| 13 | No raw colour literal in `recipes.css` beyond the contract's `#fff` on `--accent-solid` | contract tokens rule | ✅ |

Score: **13 / 13**. Visual judgement of the screenshots is a note, not a gate.

## Decisions (approved 2026-10-18 — board as shown)

1. **Danger action fill:** tinted `--tint-red-{bg,fg,border}` (vault precedent). No new token.
2. **NEXT emphasis in menus:** `font-semibold` plus an info "Next" pill.
3. **Rail current item:** `--bg-tertiary` fill plus a 3 px `--accent-primary` inset bar.
4. **Filter chip on-state:** info triple plus a `Check` icon.

## Pre-existing debt deliberately left alone

- `PrSegment` tone ramp (follow-up of `compact-session-card-header`).
- `--text-tertiary` sub-AA at 10–11 px in most palettes. Recipes avoid it rather than re-tune it.
