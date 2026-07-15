## Context

Three color systems coexist today:

| Surface | Vocabulary | Color source |
|---|---|---|
| Session-status tokens (cards/rails/dots) | needs-you / working / idle / error / notice | semantic `--status-*` (clean, 5 states) |
| Toast variants | error / success / info | raw Tailwind (`red-900`, `green-900`, gray) |
| `SpawnErrorToastHost` | (always red) | hardcoded `bg-red-900/90` |
| `SpawnErrorBanner` | error / warning | raw Tailwind red / amber |

Root defect: `showToast(text, variant = "error")` — the default is red, so any unmarked toast reads as an error. Confirmed live at `SessionList.tsx:304` (spawn success) and `App.tsx:1963` (commit success).

## Goals

- One severity vocabulary and one token set for every message/status surface.
- An unmarked toast is never mistaken for an error.
- Add the missing `warning` tier so toasts match the banner.

## Decisions

### D1 — Severity scale: five tiers
`error · warning · success · info · neutral`. Maps 1:1 onto a new `--severity-*` token set derived from existing accents. No new hues except orange (D2).

```
error    #ef4444  --accent-red      failed, needs action
warning  #f97316  --accent-orange   degraded / retrying
success  #22c55e  --accent-green    completed
info     #3b82f6  --accent-blue     neutral fact (== --status-notice)
neutral  #6b6b6b  --text-muted      passive / styleless
```

### D2 — Warning = orange, not yellow  *(user decision)*
Yellow (`#eab308`) is already `--status-working`. Reusing it for warning overloads "busy" vs "caution". Orange (`--accent-orange #f97316`, already in the palette) keeps the two distinct. No new token added — the accent already exists.

### D3 — Default `showToast` variant = neutral  *(user decision)*
Flip the default from `error` → `neutral` (styleless gray). An unmarked call is quiet, never alarming. All genuinely-error call sites already pass `"error"` explicitly or route through `notifyError`, so no error toast is silently downgraded — verified by grepping `showToast(` call sites.

### D4 — Token indirection, not literal swaps
Introduce `--severity-*` in `index.css` deriving from `--accent-*`. `VARIANT_CLASSES` references the tokens (via arbitrary-value classes or a small style map) rather than hardcoding `red-900`. Theme overrides then flow for free, matching how `--status-*` already works.

## Risks / Trade-offs

- **Silent error downgrade** — mitigated by D3's call-site audit; every error path passes `"error"` explicitly.
- **Sixth accent creep** — orange already exists in `index.css`; no palette growth.
- **Contrast** — orange/blue toast text pairs must clear WCAG AA on the dark box; verify in the mockup + a11y check (see `accessibility-a11y`).

## Migration order

1. Add `--severity-*` tokens (additive, no behavior change).
2. Extend `ToastVariant` + `VARIANT_CLASSES` with `warning`; point `info` at blue.
3. Flip default → `neutral`.
4. Tag the two success call sites `"success"`.
5. Swap `SpawnErrorToastHost` raw red for `--severity-error`.
