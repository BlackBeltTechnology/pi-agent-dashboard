# Test Plan — use-selector-style-for-automation-selection

Stage: design   Generated: 2026-11-09

Selectors: card root `automation-def-<name>`, name `automation-name-<name>`, rail stripe `automation-rail-stripe-<name>`, pill stripe `automation-pill-stripe-<name>`. FX class names come from `HOST_FX_CLASSES` (`card-glow-fx`, `card-glow-fx-outer`, `card-ring-fx`); tests import the constant instead of hard-coding the strings.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | content-view: selected card uses the selector style, not neon | EP | L1 | automated | board with 2 valid automations `a`, `b`, none selected | click `automation-def-a` | `a` root has `aria-current="true"` and class `border-[var(--accent)]`; its first header row has class `bg-[var(--accent-soft)]`; `automation-name-a` has `font-bold`; `a` contains 0 elements matching `.card-glow-fx`, `.card-glow-fx-outer` or `.card-ring-fx` |
| E2 | content-view: selection moves between cards | state-transition | L1 | automated | same board, `a` selected | click `automation-def-b` | exactly 1 element with `aria-current` on the board, and it is `b`; `a` root has `border-[var(--border-secondary)]`, no `aria-current`, no descendant with `bg-[var(--accent-soft)]`, and its name has `font-semibold` without `font-bold` |
| E3 | content-view: unselected board carries no selection marker | EP (initial state) | L1 | automated | board with 3 automations, freshly mounted | render only | 0 elements with `aria-current`; 0 elements with `bg-[var(--accent-soft)]`; 0 FX layer elements |
| E4 | content-view: selected card body keeps contrast | EP | L1 | automated | automation `a` with a done run (Result link) selected | click `automation-def-a` | the root keeps `bg-[var(--bg-secondary)]`; exactly one descendant carries `bg-[var(--accent-soft)]`; the run-result link is not inside that descendant |
| E5 | content-view: the visuals module no longer ships the neon constants | EP | L1 | automated | `import * as visuals from automation-card-visuals` | read the module keys | `GLOW_FX_CLASS`, `GLOW_FX_OUTER_CLASS` and `RING_FX_CLASS` are all `undefined`; `stripeFxClass("running")` still returns the stripes classes |
| E6 | content-view: header-row pairs stay AA in every palette | decision-table (palette × token) | L1 | automated | every palette block in `themes.ts` (18 blocks); `--accent-soft` from `index.css` for its scope | compute contrast of `--text-primary` and `--text-secondary` on `--accent-soft` | every ratio ≥ 4.5 (current minimums: primary 4.80 tokyoNightLight, secondary 5.27 baseDark) |
| E7 | content-view: colours follow the theme contract | static check | ci | automated | plugin client sources after change | `node scripts/theme-token-guard.mjs` | no new violation for `packages/automation-plugin/src/client` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | content-view: selected running card keeps its stripe | state-transition | L1 | automated | automation `a` with a `running` run | click `automation-def-a` | `automation-rail-stripe-a` and `automation-pill-stripe-a` present; `a` has `aria-current="true"` and 0 FX layer elements |
| F2 | content-view: card actions do not change selection | state-transition (illegal edge) | L1 | automated | `a` selected, `b` unselected | click `automation-name-b` (opens the editor; it calls `stopPropagation`) | `a` still has `aria-current="true"`; `b` has none |
| F3 | content-view: board matches the adopted mockup | visual/subjective | — | manual-only | board in Base dark, Base light and one non-base palette at 375 and 1440 px | a person compares against `mockups/2026-11-09-automation-selection-style` (Proposed frames) | [judgment: header band reads as one with the accent border, the rail stays visible, and the selection looks calm next to the running stripe; no automatable observable] |

### Error-handling

None. The change is presentational and adds no I/O, async path or dependency.

---

## Coverage summary

- Requirements covered: 1/1 MODIFIED (`automation-content-view`: Board adopts the session-card status visual language). Scenarios covered: selected style (E1, E3), selection moves (E2, F2), running keeps stripe (F1), body contrast (E4, E6), reduced motion (existing `automation-card-visuals.test.ts` F6 plus E1/F1 showing no new animated layer), running/invalid palette scenarios unchanged (existing tests)
- Scenarios by class: edge 7 · perf 0 · frontend 3 · error 0
- Scenarios by level: L1 8 · ci 1 · manual 1
- Scenarios by disposition: automated 9 · manual-only 1

## New infra needed

- none. E1–E4, F1 and F2 extend `packages/automation-plugin/src/__tests__/AutomationBoard.test.tsx`; E5 extends `automation-card-visuals.test.ts`; E6 follows the accent-ramp suite in `packages/client/src/lib/__tests__/themes.test.ts`.
