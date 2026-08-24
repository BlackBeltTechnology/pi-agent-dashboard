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
- Close the same gap at every OTHER surface that picks a model **to run with** —
  roles and the create-automation dialog — so "model picked here" always implies
  "level pickable here".
- Reuse the existing `ThinkingLevelSelector` component and `supportedThinkingLevels`
  derivation — no new primitive.
- Apply the chosen level only where the default model is applied (brand-new
  startup), keeping resume/fork/reload untouched.
- Empty value = "do not override", mirroring `defaultModel: ""`.

**Non-Goals:**

- Changing the per-session runtime thinking-level selector (composer) behavior.
- Model Proxy's preferred-models list and alias table. They are a preference
  ordering and a name→ref mapping, not run configuration, so a level is
  meaningless there. Deliberately excluded — see D6.
- Any server-side plumbing for the automation level (D8 shows none is needed).
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

**D6 — The gap closes at run-configuring surfaces only.** Audit of every
`ModelSelector` call site yields two classes. *Run-configuring* (the picked model
executes a turn): composer ✓already paired, OpenSpec run-config row ✓already
paired, Settings Default Model (D1–D5), roles (D7), create-automation (D8).
*Reference-listing* (the picked model is an entry in a list or a mapping target):
`ModelProxySection.tsx:132` preferred-models and `:201` alias→model. The latter
class is excluded: a preference ordering has no single level to apply, and an
alias target is a ref consumed by a run-configuring surface that supplies its own
level. Adding a control there would persist a value nothing reads.

**D7 — Roles encode the level as a `:<level>` ref suffix, not a new field.**
pi already defines the suffix grammar (`--model sonnet:high`, README:560), and
the bridge already parses it (`splitThinkingSuffix`, `provider-register.ts:914`,
feeding `probe.thinkingLevel`). The roles map value is exactly such a ref, so the
level has a home. Alternatives rejected: (a) a parallel `roleThinkingLevels` map
in plugin config — two sources of truth, and pi's own `/roles` command writes the
suffix form, so the two would drift on the first CLI edit; (b) a new field in
`providers.json` — same drift plus a schema change to a file pi owns.
Consequence: the section needs split/join helpers around the existing
`inferProviderForBareId` display path, and the model selector's `current` must be
fed the SUFFIX-STRIPPED base (else no row matches and the pill renders blank).

**D8 — Automation needs UI only; the ref already travels verbatim to `--model`.**
Traced end to end: `CreateAutomationDialog` writes `config.model` →
`resolveModel()` (`model-resolver.ts`) passes non-`@` values through with only
`.trim()` and returns role values unchanged → `engine.ts:581` forwards
`resolved.model` to `spawnSession` → `sessionFlagsToArgv()`
(`packages/shared/src/platform/spawn-mechanism.ts:140`) emits
`["--model", flags.model]` → pi parses the suffix itself. No component in that
chain inspects the string's shape, and `automation-types.ts:127` types it as a
bare `string`, so the suffix survives with zero server edits. This is what made
folding automation into this change affordable. The risk is *silent breakage by a
future validator*, mitigated by the explicit verbatim-passthrough scenarios added
to `automation-folder-format`.

**D9 — The `@role` branch of the automation dialog shows no level control.**
When the model field is an `@role` token, the level belongs to the role's ref and
is resolved at run time (D7 + D8's role-preservation scenario). Rendering a
second control there would let the operator set a level that either loses to the
role ref or silently overrides it — a coin-flip either way. One owner per value:
the role.

**D10 — Plugins read `supportedThinkingLevels` off the rows they already have.**
Both plugins take `models` from the roles plugin config, populated from the
`models_list` WS payload, whose rows already carry `supportedThinkingLevels`
(emitted at `provider-register.ts:403`, typed at `packages/shared/src/types.ts:609`).
Only the plugins' local `ModelInfo` interfaces (`RolesSettingsSection.tsx:39`,
`CreateAutomationDialog.tsx:181`) need the optional field added — no new payload,
no new fetch. Likewise `UI_PRIMITIVE_KEYS.thinkingLevelSelector` is already
registered by the shell (`main.tsx`, backed by `shell-primitives.tsx:48`); this
change is simply its first plugin-side consumer.

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
- **Scope growth.** Folding roles + automation in takes the change from 3 to 5
  modified capabilities. Accepted deliberately: the three surfaces share one
  question ("where a model is picked, is a level pickable?"), and splitting them
  would ship a half-answered rule. Mitigated by D8 — the automation half is UI
  plus spec text, not new plumbing.
- **Suffix round-trip in roles.** A stored ref must split for display and rejoin
  on save. A bug here shows as a blank pill or a spuriously dirty row on mere
  render. Both failure modes get an explicit scenario.
- **Level orphaned by a model switch.** Picking a model that does not support the
  currently staged level must drop the suffix rather than persist an unsupported
  ref. pi would clamp it anyway, but the persisted value would lie about what
  runs. Scenario-covered in `roles-settings-ui`.
- **A future automation validator could reject the suffix.** Nothing validates
  `model` today (D8), so the passthrough is load-bearing but unenforced. The two
  verbatim-passthrough scenarios in `automation-folder-format` are the guard.
