> Visual audit + proposed scale: [`mockups/index.html`](mockups/index.html) — current inconsistency (section 1), unified 5-tier scale (section 2), migration shape (section 3).

## Why

Message surfaces use multiple parallel color systems, so severity no longer maps reliably to color. Most visibly, `showToast` defaults to the `error` (red) variant, so a **successful** session spawn and a **successful** commit both render in the red error box — users read a success as a failure. There is no `warning` toast tier (the spawn `TimeoutBanner` already uses amber), and toast `info` is subdued gray while the semantic `--status-notice` token is blue.

## What Changes

- Introduce a single **color source of truth** — a `--severity-{error,warning,success,info,neutral}` token set — that every message surface derives its box/fg/border from. This unifies **color**, not the per-surface variant *strings* (the plugin toast protocol keeps its own vocabulary; see Non-Goals).
- Each severity token is a **triple** (`--severity-<level>-{bg,fg,border}`) derived from one base accent via `color-mix` — `bg` mixes into `--bg-tertiary` (10%), `fg` toward `--text-primary` (46%), both theme-aware — so the muted translucent box look is preserved. A single flat accent, or mixing toward a hardcoded `white`, would regress (light-mode text ~1.6:1). Contrast is verified by a **relative** gate (a 3:1 legibility floor across all 9 themes × light+dark, full AA 4.5:1 on the majority) rather than an absolute AA-everywhere gate — 5/18 theme·mode combos already ship sub-AA base text, so no derived tint can beat them; see design D6.
- Add a `warning` tier to the client `ToastVariant` / `VARIANT_CLASSES`, colored **orange** (`--accent-orange #f97316`), distinct from working-yellow (`--status-working`).
- **BREAKING (behavioral):** flip the `showToast` default variant from `error` → `neutral`. This is a **co-requisite** with tagging every currently-untagged **error** call site `"error"` (see Impact) — otherwise real errors silently downgrade to gray. The prior draft's claim that no error path relied on the default was **wrong**; three do.
- Tag call sites explicitly: **success** → spawn-success (`SessionList.tsx`), `Committed <hash>` (`App.tsx`); **error** → `notifyError` (`App.tsx:635`), open-editor failure (`SessionList.tsx:292`), spawn-failure branch (`SessionList.tsx:304`).
- Introduce `--severity-info` from `--accent-blue` (do **not** reuse `--status-notice`, which is a protocol signal meaning "model returned reasoning only").
- Replace raw Tailwind literals in `Toast.tsx`, `SpawnErrorToastHost.tsx`, and `SpawnErrorBanner.tsx` with the severity tokens; the plugin `ToastSlot.tsx` sources its colors from the same tokens while keeping its protocol `level` names.

## Capabilities

### New Capabilities
- `message-severity-tokens`: The `--severity-*` triple token set (derived from `--accent-*` via `color-mix`) — the single color source of truth for every message/status surface.

### Modified Capabilities
- `toast-notifications`: `showToast` gains a five-value variant with a **neutral** default (was implicit red); adds `warning`; `info` becomes blue; colors source from `--severity-*` triples. The single `ToastVariant` type is de-duplicated so all consumers share one definition.

## Impact

- `packages/client/src/index.css` — add `--severity-*` triple tokens.
- `packages/client/src/components/Toast.tsx` — extend `ToastVariant` (canonical), `VARIANT_CLASSES` (token-sourced), default → `neutral`.
- `packages/client/src/hooks/useAsyncAction.ts` — **duplicate** `ToastVariant` (line 5): re-export the canonical one or widen to match.
- `packages/client/src/hooks/useMessageHandler.ts:153` — inline `variant?: "error"|"success"|"info"` union → reference `ToastVariant`.
- `packages/client/src/components/SessionList.tsx` — tag open-editor failure `"error"`; **split the spawn-result ternary** into `if (success) showToast(msg,"success") else showToast(failMsg,"error")` (a trailing arg would tag both branches). (Line numbers approximate — match by symbol.)
- `packages/client/src/hooks/useAsyncAction.ts` — reclass the **single** existing `"info"` call site (still-working background hint) to `"neutral"` (decided: passive hint).
- `packages/client/src/App.tsx` — tag `notifyError` (`"error"`) + `Committed <hash>` (`"success"`).
- `packages/client/src/components/SpawnErrorToastHost.tsx` — raw red → `--severity-error`.
- `packages/client/src/components/SpawnErrorBanner.tsx` — error red + `TimeoutBanner` amber → `--severity-error` / `--severity-warning`.
- `packages/client/src/components/extension-ui/ToastSlot.tsx` — `levelClass` colors → `--severity-*`, with an explicit `"warn" → --severity-warning-*` map (protocol keeps `warn`; token is `warning`).
- `packages/client/src/components/__tests__/Toast.test.tsx` — update `/red/`, `red-900`, and default-variant assertions for the new token classes + neutral default.

## Non-Goals

- **No protocol change.** `ToastPayload.level` (`packages/shared/src/types.ts:439`, values `info|success|warn|error`) is NOT renamed; the plugin toast keeps `warn`. Only its rendered *color* is unified via the tokens.
- Session-status `--status-*` card tokens are NOT renamed — only aligned/referenced.
- The three separate toast host *containers* (all at `top-4 right-4`) are NOT consolidated here — pre-existing overlap, tracked as a follow-up. (Adopting `--severity-*` *colors* in the banner surfaces IS in scope; only host consolidation is deferred.)
- `neutral` reuses literal base tokens (`--bg-tertiary`/`--text-secondary`/`--border-primary`), NOT a color-mix from `--text-muted` (that fails AA) — see design D4 exception.

## Discipline Skills

- `accessibility-a11y` — the relative contrast gate (3:1 floor / AA-on-majority) for the derived triples across all 9 themes × light+dark; see design D6 for why absolute AA-everywhere is unsatisfiable.
- `code-simplification` — de-duplicating `ToastVariant` and collapsing raw literals into one token set.
