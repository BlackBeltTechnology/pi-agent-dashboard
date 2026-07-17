# Test Plan — unify-message-severity-colors

Stage: design   Generated: 2026-07-15

Both design-stage clarifications resolved (still-working info → neutral). Contrast scope revised in implementation to a RELATIVE gate (resolution A): 3:1 floor across all 9 themes × light+dark + AA-on-majority, one documented exception (tokyo-night/light `info`) — an absolute AA-everywhere gate is unsatisfiable because 5/18 combos already ship sub-AA base text. See design D6 + E12.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | useToast default variant | EP (present/absent) | L1 | automated | `showToast("x")` no variant | message created | `messages[0].variant === "neutral"`; box class references `--severity-neutral-*`, NOT `red-900` |
| E2 | VARIANT_CLASSES covers every variant | decision-table (5) | L1 | automated | each of `error,warning,success,info,neutral` | resolve `VARIANT_CLASSES[v]` | each yields box+close style whose color derives from `--severity-<v>-*` (no raw Tailwind color literal) |
| E3 | single canonical ToastVariant | static-type | L1 | automated | `Toast.tsx`, `useAsyncAction.ts`, `useMessageHandler.ts` consumers | `tsc --noEmit` | 0 type errors; the union has exactly the 5 members; `useAsyncAction` re-exports (no 2nd declaration) |
| E4 | protocol warn maps to warning token | decision-table (4 levels) | L1 | automated | `level ∈ {success,warn,error,info-default}` | `ToastSlot.levelClass(level)` | `warn` → class referencing `--severity-warning-*`; others → matching `--severity-*`; string `--severity-warn-` never emitted |
| E5 | spawn ternary split, not trailing-tag | state (2 branches) | L1 | automated | spawnResult `{success:true}` then `{success:false}` | spawn-result effect runs | showToast spy called `(msg,"success")` then `(failMsg,"error")` — never both branches "error" |
| E6 | error/success call-site tagging | decision-table | L1 | automated | notifyError(msg); onCommitted(hash); open-editor failure | each invoked | showToast spy sees `"error"`, `"success"`, `"error"` respectively |
| E7 | still-working info reclassed | EP | L1 | automated | ws timeout fires stillWorking hint (`useAsyncAction`) | hint shown | showToast spy variant === `"neutral"` (not `"info"`) |
| E8 | no raw severity literals | static-inspection | L1 | automated | source of `Toast.tsx`,`SpawnErrorToastHost.tsx`,`SpawnErrorBanner.tsx`,`ToastSlot.tsx` | regex scan | 0 matches for `bg-red-900\|bg-green-900\|bg-red-500\|bg-amber-500\|text-red-300` severity literals |
| E9 | no bare error-intent showToast | static-inspection | L1 | automated | the 3 known error sites | scan `showToast(` calls | each error-intent call passes explicit `"error"`; no error-intent bare call remains |
| E10 | neutral uses literal base tokens | static-inspection | L1 | automated | `--severity-neutral-*` defs + neutral box class | inspect index.css + VARIANT_CLASSES | maps to `--bg-tertiary`/`--text-secondary`/`--border-primary`, NOT a `color-mix` from `--text-muted` |
| E11 | info independent of notice token | static-inspection | L1 | automated | index.css declarations | inspect | `--severity-info` and `--status-notice` are separate declarations (may share `--accent-blue`) |
| E12 | derived triples meet the relative contrast gate (all themes) | BVA (contrast threshold) | L3 | automated | 5 tiers × 9 themes × {light,dark} = 90 cells | set `dashboard:theme-name`+mode in localStorage, reload, probe each tier's resolved `--severity-*` | each accent tier `contrast(fg,bg) ≥ 3:1` floor + `neutral` ≥ its base ratio, ONE documented exception tokyo-night/light `info` (≥ 2.5); ≥ 55/90 cells also ≥ 4.5:1 AA (computed via `getComputedStyle`, real browser resolves `color-mix`). Absolute AA-everywhere is unsatisfiable — 5/18 combos ship sub-AA base text; see design D6 |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | every variant renders its token color | state-convergence | L3 | automated | one toast per variant, base theme | rendered in browser | computed `background-color` distinct per variant and equals resolved `--severity-<v>-bg`; error≠success≠warning≠info≠neutral |
| F2 | warning distinct from working-yellow | computed-compare | L3 | automated | a `warning` toast + a `working` status surface | both rendered, base theme | computed hue of `--severity-warning-bg` (orange) ≠ `--status-working` (yellow) |
| F3 | close button reuses fg | computed | L3 | automated | a rendered `error` toast | inspect × button | close color === variant `-fg` at reduced opacity (e.g. alpha < 1), not a raw literal |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| — | none | — | — | — | — | — | Pure client color change; no dependency/fault path. Deliberately empty (not invented). |

### Performance

| id | ... |
|----|-----|
| — | none — no latency/throughput/soak requirement in this change. |

### Manual-only

| id | requirement | technique | level | disposition | surface | human check | expected observable |
|----|-------------|-----------|-------|-------------|---------|-------------|---------------------|
| M1 | palette reads correctly to a human | visual/subjective | — | manual-only | rendered toasts + banners across a few themes vs `mockups/index.html` | reviewer eyeballs | severity is legible + consistent; orange/blue don't clash; "feels right" — no automatable observable beyond E12's math |

---

## Coverage summary

- Requirements covered: 11/11 testable requirements across both delta specs.
- Scenarios by class: edge 12 · perf 0 · frontend 3 · error 0 · manual 1
- Scenarios by level: L1 11 · L3 4 · L2 0
- Scenarios by disposition: automated 15 · manual-only 1

## New infra needed

- none. L1 extends `packages/client/src/components/__tests__/Toast.test.tsx`; L3 extends the Playwright/docker harness (`tests/e2e/`). E12's per-theme contrast sweep is new *test logic* but reuses the existing L3 harness (no new level).
