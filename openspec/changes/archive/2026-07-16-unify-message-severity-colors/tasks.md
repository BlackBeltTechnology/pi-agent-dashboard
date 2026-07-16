## 1. Severity tokens (index.css, additive)

- [x] 1.1 Add `--severity-{error,warning,success,info}-{bg,fg,border}` via `color-mix`: `bg` = accent **10%** into `--bg-tertiary`, `fg` = accent **46%** toward `--text-primary`, `border` = accent 40% into `transparent`. (Percentages solved offline for the relative gate, D6.) → verify: tokens resolve in base light + dark.
- [x] 1.2 Add `--severity-neutral-{bg,fg,border}` mapped to literal `--bg-tertiary` / `--text-secondary` / `--border-primary` (NOT a `color-mix` from `--text-muted`). → verify: (test-plan #E10).
- [x] 1.3 Declare `--severity-info` separately from `--status-notice` (may share `--accent-blue`). → verify: (test-plan #E11).

## 2. Toast variant system (Toast.tsx + type consumers)

- [x] 2.1 De-dup `ToastVariant`: keep canonical in `Toast.tsx`; `useAsyncAction.ts` re-exports it; replace inline union at `useMessageHandler.ts` with `ToastVariant`. → verify: (test-plan #E3).
- [x] 2.2 Extend `VARIANT_CLASSES` to 5 token-sourced entries (warning=orange, info=blue, neutral=literal); close button = variant `-fg` at reduced opacity. → verify: (test-plan #E2).
- [x] 2.3 Flip `showToast` default `error` → `neutral` — **same commit as 3.1** (co-requisite). → verify: (test-plan #E1).

## 3. Tag call sites (error sites BEFORE/with the default flip)

- [x] 3.1 `App.tsx` `notifyError` → `"error"`; `SessionList.tsx` open-editor failure → `"error"`; **split the spawn-result ternary** so success→`"success"`, failure→`"error"`. → verify: (test-plan #E5, #E6, #E9).
- [x] 3.2 `App.tsx` commit `Committed <hash>` toast → `"success"`. → verify: (test-plan #E6).
- [x] 3.3 `useAsyncAction.ts` still-working hint → `"neutral"`. → verify: (test-plan #E7).

## 4. Other severity surfaces → tokens

- [x] 4.1 `SpawnErrorToastHost.tsx` raw red → `--severity-error-*`. → verify: (test-plan #E8).
- [x] 4.2 `SpawnErrorBanner.tsx` error → `--severity-error-*`; `TimeoutBanner` amber → `--severity-warning-*`. → verify: (test-plan #E8).
- [x] 4.3 `ToastSlot.tsx` `levelClass` all 4 branches → `--severity-*`, with `"warn" → --severity-warning-*` name bridge. → verify: (test-plan #E4, #E8).

## 5. Tests — automated (folded from test-plan.md)

### L1 unit — extend `packages/client/src/components/__tests__/Toast.test.tsx`

- [x] 5.1 Default variant is neutral: `showToast("x")` no variant → `messages[0].variant === "neutral"`, box references `--severity-neutral-*` not `red-900`. Updates the existing back-compat `/red/` assertions. (test-plan #E1)
- [x] 5.2 `VARIANT_CLASSES` has all 5 variants, each color from `--severity-<v>-*`, no raw Tailwind color literal. (test-plan #E2)
- [x] 5.3 `tsc --noEmit` clean; `ToastVariant` union has exactly the 5 members; `useAsyncAction` re-exports (no 2nd declaration). (test-plan #E3)
- [x] 5.4 `ToastSlot.levelClass`: `level ∈ {success,warn,error,default}` → matching `--severity-*`; `warn`→`--severity-warning-*`; string `--severity-warn-` never emitted. (test-plan #E4)
- [x] 5.5 Spawn-result effect: `{success:true}`→spy `(msg,"success")`, `{success:false}`→spy `(failMsg,"error")` — never both "error" (ternary split). (test-plan #E5)
- [x] 5.6 Call-site tagging: notifyError→`"error"`, onCommitted→`"success"`, open-editor failure→`"error"` (spy). (test-plan #E6)
- [x] 5.7 `useAsyncAction` still-working hint → spy variant `"neutral"`. (test-plan #E7)
- [x] 5.8 Static scan: `Toast.tsx`, `SpawnErrorToastHost.tsx`, `SpawnErrorBanner.tsx`, `ToastSlot.tsx` have 0 raw severity literals (`bg-red-900|bg-green-900|bg-red-500|bg-amber-500|text-red-300`). (test-plan #E8)
- [x] 5.9 Static scan: no error-intent `showToast(` call omits `"error"`. (test-plan #E9)
- [x] 5.10 `--severity-neutral-*` maps to literal base tokens, not a `--text-muted` mix. (test-plan #E10)
- [x] 5.11 `--severity-info` and `--status-notice` are separate index.css declarations. (test-plan #E11)

### L3 e2e — extend `tests/e2e/` (harness-exemplar: `tests/e2e/chat-render-fx.spec.ts`; read the derived `dashboardPort` from `.pi-test-harness.json`, never hardcode `:18000`)

- [x] 5.12 **Contrast sweep** (relative gate, D6/resolution A): for 5 tiers × 9 themes × {light,dark} (90 cells) read `getComputedStyle` of probe elements (real browser resolves `color-mix`), assert each accent tier `contrast(fg,bg) ≥ 3:1` floor and `neutral` ≥ its base ratio, with ONE documented exception tokyo-night/light `info` (≥ 2.5); additionally assert ≥ 55/90 cells meet full AA 4.5:1. Border is decorative (no floor). Drives via localStorage theme-name/mode + reload. (test-plan #E12)
- [x] 5.13 Each variant's computed `background-color` is distinct and equals resolved `--severity-<v>-bg` (error≠success≠warning≠info≠neutral). (test-plan #F1)
- [x] 5.14 `--severity-warning-bg` (orange) computed-hue ≠ `--status-working` (yellow). (test-plan #F2)
- [x] 5.15 Rendered `error` toast close (×) color === variant `-fg` at reduced opacity (alpha < 1), not a raw literal. (test-plan #F3)

## 6. Manual (deferred post-merge by ship-change)

- [x] 6.1 Visual review: rendered toasts + banners across a few themes vs `mockups/index.html` — severity legible + consistent, orange/blue don't clash. (test-plan: manual-only)

## Discipline Skills

- `accessibility-a11y` — the AA contrast sweep (task 5.12).
- `code-simplification` — de-duplicating `ToastVariant` and collapsing raw literals into one token set.
