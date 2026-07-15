## 1. Severity tokens (additive)

- [ ] 1.1 Add `--severity-{error,warning,success,info,neutral}` to `packages/client/src/index.css`, deriving from `--accent-red/orange/green/blue` and `--text-muted`. → verify: tokens resolve in the base theme + one named theme (DevTools computed styles).

## 2. Toast variant system

- [ ] 2.1 Extend `ToastVariant` in `Toast.tsx` to `error | warning | success | info | neutral`. → verify: `tsc --noEmit` passes.
- [ ] 2.2 Add `warning` (orange) + `neutral` entries to `VARIANT_CLASSES`; re-point `info` from gray → `--severity-info` (blue); swap all raw `red-900/green-900` literals for `--severity-*`. → verify: each variant renders its color in the mockup/dev build.
- [ ] 2.3 Flip `showToast` default variant from `error` → `neutral`. → verify: unit test that `showToast("x")` yields a `neutral` message.

## 3. Tag success call sites

- [ ] 3.1 `SessionList.tsx` spawn-result effect: pass `"success"` for the success branch (keep `"error"` for the failure branch). → verify: spawn-success toast is green in dev.
- [ ] 3.2 `App.tsx` `Committed <hash>` toast: pass `"success"`. → verify: commit toast is green.
- [ ] 3.3 Grep every `showToast(` call site; confirm no genuine-error path relied on the old red default. → verify: `rg 'showToast\(' packages/client/src` audit noted in PR.

## 4. Spawn toast host

- [ ] 4.1 `SpawnErrorToastHost.tsx`: replace hardcoded `bg-red-900/90` / `text-red-*` with `--severity-error`. → verify: spawn-error toast visually unchanged (still red), sourced from token.

## 5. Accessibility + tests

- [ ] 5.1 Contrast check: orange + blue toast text on the dark box clears WCAG AA (`accessibility-a11y`). → verify: contrast ratios recorded ≥ 4.5:1 (text) / ≥ 3:1 (large).
- [ ] 5.2 Unit tests: default variant = neutral; each variant maps to a distinct class; success call sites pass `"success"`. → verify: `npm test` green.

## Discipline Skills

- `accessibility-a11y` — contrast floor for the new orange/blue tiers (task 5.1).
- `code-simplification` — collapse two palettes into one token set.
