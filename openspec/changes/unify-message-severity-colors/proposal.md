> Visual audit + proposed scale: [`mockups/index.html`](mockups/index.html) — current inconsistency (section 1), unified 5-tier scale (section 2), migration shape (section 3).

## Why

Message surfaces in the dashboard use three parallel, inconsistent color systems, so severity no longer maps to color. Most visibly, `showToast` defaults to the `error` (red) variant, so a **successful** session spawn and a **successful** commit both render in the red error box — users read a success as a failure. There is no `warning` toast tier (the spawn banner already uses amber), and toast `info` is gray while the semantic `--status-notice` token is blue, so "info" means two different colors.

## What Changes

- Introduce a single severity vocabulary — `error | warning | success | info | neutral` — shared by toasts, the spawn banner, and status surfaces, sourced from one `--severity-*` token set (derived from existing accents).
- Add a `warning` tier to `ToastVariant` / `VARIANT_CLASSES`, colored **orange `#f97316`** (`--accent-orange`), distinct from working-yellow (`--status-working`).
- **BREAKING (behavioral):** flip the `showToast` default variant from `error` → `neutral` (styleless/quiet), so an unmarked toast can never masquerade as an error.
- Tag success call sites explicitly: spawn-success (`SessionList.tsx`) and `Committed <hash>` (`App.tsx`) ⇒ `"success"`.
- Re-point toast `info` from gray → `--status-notice` (blue) so "info" is one color across surfaces.
- Replace raw Tailwind literals (`bg-red-900/90`, `bg-green-900/90`) in `Toast.tsx` and `SpawnErrorToastHost.tsx` with the shared severity tokens.

## Capabilities

### New Capabilities
- `message-severity-tokens`: A single `--severity-{error,warning,success,info,neutral}` token set (derived from `--accent-*`), the source of truth for every message/status surface's color-by-severity.

### Modified Capabilities
- `toast-notifications`: `showToast` gains a severity variant with a **neutral** default (was implicit red); adds a `warning` tier; `info` becomes blue; colors source from `--severity-*` tokens instead of raw Tailwind classes.

## Impact

- `packages/client/src/components/Toast.tsx` — `ToastVariant` enum, `VARIANT_CLASSES`, default variant.
- `packages/client/src/components/SessionList.tsx` — tag spawn-success toast `"success"`.
- `packages/client/src/App.tsx` — tag `Committed <hash>` toast `"success"`.
- `packages/client/src/components/SpawnErrorToastHost.tsx` — swap raw red literals for severity tokens.
- `packages/client/src/index.css` — add `--severity-*` token set.
- Client-only; no protocol or server changes.

## Discipline Skills

- `code-simplification` — collapsing two color palettes into one token set is a behavior-preserving readability pass.
