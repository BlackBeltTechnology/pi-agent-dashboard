## Context

pi-ai already treats thinking level as a first-class default:

- `DEFAULT_THINKING_LEVEL = "medium"` (pi `core/defaults.js`) is the baseline.
- pi's `findInitialModel` (core/model-resolver.ts) resolves the level alongside
  the model; when the saved default model is used it applies pi's own
  `settings.defaultThinkingLevel`.
- `agent-session.setModel(model)` does **not** reset the level — it captures the
  current level, switches model, then re-applies via `setThinkingLevel`, which
  clamps to the model's supported levels (`getSupportedThinkingLevels`).
  `_getThinkingLevelForModelSwitch()` keeps the current level for reasoning
  models, else falls back to `settings.defaultThinkingLevel ?? "medium"`.
- `setThinkingLevel(level)` clamps: unsupported → `clampThinkingLevel(model, level)`;
  no model → `"off"`.

The dashboard today applies only the **model**: the bridge's `applyDefaultModel()`
calls `pi.setModel(found)` under `bridge-default-model-gate` (brand-new startup
only). It never touches thinking level, so a dashboard-spawned session inherits
pi's own resolution, never an operator-chosen level. The client already renders
`ThinkingLevelSelector` in the composer, passing `supportedLevels` derived from
the model row's `supportedThinkingLevels` (`CommandInput.tsx`). The component
treats **empty/undefined `supportedLevels` as "show all six"** (its
`FALLBACK_LEVELS`).

## Goals / Non-Goals

**Goals:**

- Let the operator choose a default thinking level paired with the Default Model.
- Reuse the existing `ThinkingLevelSelector` component and `supportedThinkingLevels`
  derivation — no new primitive.
- Apply the chosen level only where the default model is applied (brand-new
  startup), keeping resume/fork/reload untouched.
- Empty value = "do not override", mirroring `defaultModel: ""`.

**Non-Goals:**

- Changing the per-session runtime thinking-level selector (composer) behavior.
- Overriding pi's own `settings.defaultThinkingLevel`; the dashboard value layers
  on top only when non-empty.
- Per-model default-level maps or multiple defaults. One dashboard default.

## Decisions

**D1 — New config field `defaultThinkingLevel: string`, default `""`.**
Empty means "do not override". Rationale: symmetric with `defaultModel: ""`; the
bridge can cheaply branch on non-empty. Alternative (a required enum defaulting
to `"medium"`) rejected — it would silently override pi's own default for every
session and force a value even when the operator wants pi's behavior.

**D2 — Bridge applies the level via `pi.setThinkingLevel` inside
`applyDefaultModel()`'s success branch, after `setModel` resolves.** `setModel`
won't apply our value on its own (it preserves the current level), so an explicit
call is required. `pi.setThinkingLevel` is **synchronous** (pi
`agent-session.js:1275`), so there is no await-ordering race with the existing
`.then(() => setTimeout(sendModelUpdateIfChanged, 50))`. The exact site: inside
the `setModel(found).then(...)` callback, call `pi.setThinkingLevel(level)`
**before** `sendModelUpdateIfChanged()` so the pushed model-update reflects the
clamped level in one frame. Set model first so pi clamps the level to the
resolved model. Rationale: pi already clamps, so the bridge stays dumb — it
forwards the string and trusts pi; no client-side validation needed for
correctness. Placing the call at this single site (not at the gate call site) is
what makes the pending path work for free — see D5.

**D3 — Settings control filters to the selected model; locks to `off` when no
model.** Because `ThinkingLevelSelector` shows all six on empty `supportedLevels`,
"no model → no levels" is NOT free. We pass an explicit single-level `["off"]`
(or an equivalent locked prop) so only `off` renders. Alternative (disable/grey
the control) was considered and rejected by product decision in favor of a
visible locked-`off` control.

**D4 — Locked-`off` selection is a no-op that persists `""`, not `"off"`.** This
resolves the apparent contradiction between "only `off` selectable" and "persist
`""`": in the locked state the control's `onSelect` is a **no-op for persistence**
— it does not write `"off"` and does not add `defaultThinkingLevel` to the
`PUT /api/config` partial. The field stays `""` ("do not override") until a model
is picked. Writing `"off"` would be a real override (turn thinking off for the
eventually-resolved model), which is wrong when the operator has merely not
chosen a model yet. The control is visibly clickable but persistence-inert while
locked.

**D5 — No separate pending-default-model handling.** Because the level is applied
inside `applyDefaultModel()` (D2), the custom-provider-late retry path
(bridge.ts:2915) reuses the same code and applies the level once the model
resolves — no distinct code path, no signal to thread through the return value.

## Risks / Trade-offs

- **Level unsupported by the chosen model.** Mitigated: the Settings control only
  offers supported levels, and the bridge relies on pi's clamp, so a stale config
  value can never produce an error — worst case pi clamps it.
- **Config edited by hand to an unsupported/invalid level.** The loader does not
  reject it; the bridge forwards and pi clamps. Acceptable — no crash, defined
  behavior.
- **Divergence from pi's own `settings.defaultThinkingLevel`.** Two defaults now
  exist (pi's and the dashboard's). The dashboard value wins only when non-empty
  on brand-new startup; empty defers to pi. Documented in the callout hint.
- **Locked-`off` vs empty subtlety.** Two states look identical (`off` shown) but
  persist differently (`""` when no model, real level when chosen). Covered by an
  explicit scenario to prevent regression.
