## Context

See proposal.md — Why.

Three facts about the current code shape the approach:

1. **Refresh-on-open already works.** `ModelSelector` fires an open-transition effect that calls `onRefresh()`; the footer button calls the same handler. `App.tsx` wires `onRefresh` to `send({ type: "request_models" })`, and the extension's `request_models` handler awaits `registry.refresh()` before reading `getAvailable()`. So removing the button removes a duplicate trigger, not a capability.
2. **`refreshAndListModels` throws the evidence away.** It does a bare `await registry.refresh?.()` and ignores the resolved value, while `packages/extension/src/model-refresh.ts` already exists to interpret pi 0.84's `ModelsRefreshResult { aborted, errors }` via `reportRefresh()`. The helper is written and unused on this path.
3. **The shell already has the exact prop bundle plugins need.** `OpenSpecRunConfigContext` carries `{ model, models, thinkingLevel, favorites, setModel, setThinkingLevel, toggleFavorite, refreshModels, notify }` for the selected session — assembled in `App.tsx` and consumed by the OpenSpec launch dialogs.

Primitives are registered once at module load in `main.tsx`, outside React state, so any shell state a registration wants must be read from context *inside* a wrapper component — the pattern `ToolCallStepPrimitive` and `ThinkingBlockPrimitive` already establish.

## Goals / Non-Goals

**Goals:**

- Plugin surfaces inherit shell model-selector behavior (favorites, refresh-on-open) with zero plugin-side wiring.
- Thinking-level parity between shell composer and plugin surfaces guaranteed by sharing one component, not by keeping two in sync.
- A provider that fails to refresh is legible in both the logs and the dropdown.

**Non-Goals:**

- Changing how blackhole or automation persist their model configuration. Adopting the primitives in those plugins is follow-on work; this change makes the primitives worth adopting.
- Adding a favorites or refresh concept to plugin *server* entries or the `IntentRenderer` action pathway.
- Any change to the credentials-driven push path in `bridge.ts` (the second `refreshAndListModels` caller). Noted as follow-on in Risks.

## Decisions

### D1 — Bind shell state inside the registration wrapper, not the contract

`UiModelSelectorProps` stays `{ current, models, onSelect, placeholder? }`. The registration in `main.tsx` becomes a wrapper that reads shell state from context and injects `favorites`, `onToggleFavorite`, `onRefresh`.

*Why:* a plugin has no access to the selected session's favorites or WS sender, so putting those in the contract would mean every plugin drills state it cannot obtain — and every new shell capability would be a breaking contract change. Binding at registration means shell capabilities land in plugin surfaces automatically.

*Alternative rejected:* widen the public contract with all six props. Pushes shell concerns into every plugin call site and makes the contract churn on every shell feature.

*Alternative rejected:* have plugins send `request_models` themselves. Requires per-plugin WS access and duplicates the fetch-once-guard bypass logic in each one.

### D2 — Extract a neutral `ModelConfigContext`; retire `OpenSpecRunConfigContext` outright

The bundle is renamed and moved to a neutral context. Every current consumer is migrated in the same change: `App.tsx` (provider), `useOpenSpecRunConfigRow.tsx`, `NewChangeDialog.tsx`, `ProposeDialog.tsx`, `ExploreDialog.tsx`, plus `test-support/runConfigHarness.tsx` and `OpenSpecRunConfig.test.tsx`.

No compatibility alias is left behind. A deprecated re-export would leave two names for one context and invite new code onto the misleading one.

*Why not reuse the OpenSpec name:* the primitives are not OpenSpec-specific; a name that lies about scope is how the next reader concludes the primitive wrapper is OpenSpec-only and adds a third context.

*Why not a parallel third context:* two providers assembling the same `App.tsx` state drift independently — exactly the divergence this change exists to remove.

**Regression guard:** the OpenSpec dialogs' behavior must be unchanged by the rename. The existing `OpenSpecRunConfig.test.tsx` suite is the guard and moves with the rename rather than being rewritten.

### D3 — Register the shell's real `ThinkingLevelSelector`, thinly wrapped

The new primitive registers the shell component itself. Its canonical order, the `max` opt-in, and the `FALLBACK_LEVELS` behavior when `supportedLevels` is absent all come along for free.

`supportedLevels` stays a *caller-supplied* prop rather than being derived inside the wrapper: the shell composer derives it from the selected session's model, but a plugin editing a per-worker fallback chain needs the levels for *that row's* model, which the wrapper cannot know. The caller owns the model→levels lookup; the primitive owns the rendering.

### D4 — Delete the footer refresh button and its busy state

Removes the button JSX, the `refreshing` state, the `models`-identity effect that clears it, and the 10s safety-timeout effect. The open-transition effect and the `onRefreshRef` indirection stay.

*Why:* it triggers the same handler the open transition already fired microseconds earlier. Its busy indicator taught users the list might be stale when it had just been refreshed. The `models`-identity clear-effect and safety timeout exist only to service that indicator.

*Note:* the freed footer slot is where refresh failures now render (D5) — same pixels, real information.

### D5 — Errors travel on `models_list`, render in the footer, never as a toast

`refreshAndListModels` routes its refresh through `reportRefresh()` (logs abort + names each failing provider) and additionally returns the provider errors, which `command-handler.ts` attaches to the returned message as `refreshErrors?: Array<{ provider, message }>`.

Optional and **omitted** — not `[]` — on success, so the happy-path message is byte-identical to today's and the client's render condition is a plain truthiness check.

Abort is logged but does **not** populate `refreshErrors`: there is no provider to name, and an abort usually means a newer refresh superseded this one.

*Why not a toast:* the refresh fires on every dropdown open, so a persistently failing provider would alert on every open.

*Why not logs alone:* `console.warn` in the extension lands in the pi session's stderr — not the dashboard server log, and invisible in the browser. Logs answer "what broke" for a developer; the footer answers "why isn't my model here" for the user. Both are needed.

### D6 — TDD entry point

`packages/extension/src/__tests__/request-models-refresh-errors.test.ts`, a sibling of the existing `request-models-refresh-await.test.ts`, using the same plain-object registry mock extended to resolve `{ aborted, errors: Map }`. Five cases: single provider failure (degraded-not-broken + provider named + reaches client), multiple providers, aborted, clean (silent, field absent), and a pre-0.84 registry resolving `undefined`.

The mock's `getAvailable()` returns a non-empty last-known catalogue so "degraded ≠ broken" is asserted, not assumed. Note the existing sibling test spies `console.error` for the *throw* path (which returns an empty list); the errors-map path warns and returns the last-known list. Both paths coexist — do not unify them.

## Risks / Trade-offs

- **Rename churn across 7+ files with no alias** → the existing `OpenSpecRunConfig.test.tsx` suite is the regression guard and must pass unmodified in substance after the rename; run the full client suite before commit.
- **The wrapper renders in plugin surfaces with no selected session** (e.g. a folder-level settings page). Context values are then `undefined` → no favorites, no refresh, list falls back to whatever the plugin passed. Acceptable, and matches the spec's "no request without a handler" scenario, but plugin surfaces must not *depend* on refresh firing.
- **`refreshErrors` is per-message, not sticky** → a later clean push clears the footer notice, which is correct, but a provider that fails intermittently will flicker the notice between opens. Accepted; the log is the durable record.
- **`bridge.ts`'s `credentials_updated` push still discards the refresh result** → same latent defect on a second call site, deliberately out of scope to keep this change reviewable. The two mock helpers in the new test are written so they can be lifted to `test-support` when that site is fixed.
- **Registering a wrapper contradicts the prior spec text** ("no wrapper that drops props or alters event timing") → resolved explicitly by the modified requirement, which permits *additive* wrappers only: no dropped props, no re-timed events, no new required props.

## Migration Plan

Additive at every boundary — `placeholder`, the new primitive key, and `refreshErrors` are all optional. No coordinated deploy is required: an older bridge simply never sets `refreshErrors` and the footer stays silent (covered by a spec scenario). Rollback is a straight revert; no persisted data or config format changes.
