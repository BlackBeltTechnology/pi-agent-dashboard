## Why

The dashboard lets an operator pick a **Default Model** applied to every brand-new
session, but there is no matching control for the **thinking level**. A
dashboard-spawned session therefore lands on whatever pi resolves on its own
(pi's `settings.defaultThinkingLevel`, else the hard-coded `"medium"`), never a
value the dashboard operator chose. Pairing a default thinking level with the
default model closes that gap and matches pi-ai's own first-class
`defaultThinkingLevel` concept.

The same gap exists at **every other surface that picks a model to run with**.
An audit of all model-selection surfaces found three that pair a level and three
that do not:

| Surface | Pairs a level today? |
|---|---|
| Chat composer (`CommandInput.tsx`) | yes |
| OpenSpec run config row (`useOpenSpecRunConfigRow.tsx`) | yes |
| Settings → Sessions Default Model | **no** — added by this change |
| Roles → assign model to `@role` (`RolesSettingsSection.tsx`) | **no** — added by this change |
| Automation → create automation model (`CreateAutomationDialog.tsx`) | **no** — added by this change |
| Settings → Model Proxy preferred-models / aliases | no — **out of scope by design** |

Model Proxy stays out: its two selectors build an ordered preference list and a
name→ref alias table. Neither configures a run, so a thinking level has no
meaning there.

Roles and automation are cheap to close because the level already has a home in
the ref string: pi parses `provider/model[:thinking]` (`--model sonnet:high`,
and `splitThinkingSuffix` in `packages/extension/src/provider-register.ts:914`).
Both surfaces already persist a ref, so the level rides in the existing field —
no second source of truth.

## What Changes

- Add a new dashboard config field `defaultThinkingLevel` (string). Empty string
  means **"don't override"** — the bridge leaves pi's own resolution intact
  (mirrors how `defaultModel: ""` already means "don't override").
- Settings → Sessions: render a thinking-level control **inside the existing
  Default Model callout**, immediately beside the Default Model selector.
  - When a Default Model is selected, the control filters its levels to that
    model's supported thinking levels (same `supportedThinkingLevels` source the
    composer already uses).
  - When **no** Default Model is selected, the control is **locked to `off`**
    (visible, but only `off` is selectable), because a level cannot be validated
    against a model that is not chosen.
- Bridge: on a brand-new startup session where the default-model gate applies the
  configured model, and `config.defaultThinkingLevel` is non-empty, the bridge
  also applies that thinking level via pi's `setThinkingLevel` (pi clamps it to
  the model's capabilities). Empty `defaultThinkingLevel` → the bridge does not
  call `setThinkingLevel` and pi's own resolution stands.
- Resume / fork / reload sessions are unaffected — they keep their existing
  thinking level, gated by the same brand-new-startup predicate as the default
  model.
- Roles settings: the role model-picker gains a thinking-level control beside the
  model selector, filtered to the picked model's supported levels. The chosen
  level is encoded as a `:<level>` suffix on the role's existing ref string
  (`anthropic/claude-sonnet-4-5:high`) — no new field, no new persistence path.
  Selecting `off`-equivalent "no override" strips the suffix. Deferred
  persistence via the host Save/Reload contract is unchanged.
- Create-automation dialog: the direct-model branch gains the same paired
  control, encoded as the same `:<level>` suffix on the existing
  `automation.yaml` `model` field. The `@role` branch shows **no** control — the
  level comes from the role's own ref. Runner/spawn need no change: the ref
  travels verbatim through `resolveModel()` → `sessionFlagsToArgv()` →
  `--model`, which pi already parses with the suffix.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `shared-config`: config schema gains `defaultThinkingLevel` (string, default
  `""`) with load / partial-merge / empty-default semantics.
- `bridge-default-model-gate`: when the gate applies the default model to a
  brand-new startup session and a non-empty `defaultThinkingLevel` is configured,
  the bridge also applies the thinking level; empty leaves pi's resolution intact.
- `settings-panel`: the Sessions Default Model callout gains a paired
  thinking-level control that filters to the selected model's supported levels
  and locks to `off` when no model is selected; the value is persisted via
  `PUT /api/config`.
- `roles-settings-ui`: the role model-picker gains a paired thinking-level
  control; the level is encoded as a `:<level>` suffix on the role ref and
  staged through the existing pending/Save seam.
- `automation-content-view`: the create editor's direct-model branch gains a
  paired thinking-level control; the `@role` branch does not.
- `automation-folder-format`: the `automation.yaml` `model` field is documented
  as accepting an OPTIONAL `:<thinking>` suffix on the bare provider/model form.

## Impact

- `packages/shared/src/config.ts` — add `defaultThinkingLevel` to the config
  type, defaults, sanitizer, and parser.
- `packages/extension/src/bridge.ts` — apply `config.defaultThinkingLevel` via
  `pi.setThinkingLevel` alongside `applyDefaultModel()` under the existing gate.
- `packages/client/src/components/settings/SettingsPanel.tsx` — add the
  `ThinkingLevelSelector` beside the Default Model selector, wired to
  `defaultThinkingLevel` with model-derived `supportedLevels` and a
  locked-to-`off` state when no model is selected.
- `packages/roles-plugin/src/RolesSettingsSection.tsx` — add the
  `ui:thinking-level-selector` primitive beside the model picker, plus
  suffix split/join helpers on the role ref.
- `packages/automation-plugin/src/client/CreateAutomationDialog.tsx` — same
  primitive on the direct-model branch, suffixing the written `model` value.
- No server change: `model-resolver.ts`, `engine.ts`, `process-manager.ts`, and
  `sessionFlagsToArgv()` already pass the ref through verbatim to `--model`.

Both plugins consume the `models_list` rows that already carry
`supportedThinkingLevels`; only their local `ModelInfo` types need widening. Both
also already have `UI_PRIMITIVE_KEYS.thinkingLevelSelector` available (registered
in `packages/client/src/main.tsx`) — today no plugin consumes it.
- No new dependencies. No breaking changes.

## Discipline Skills

- `doubt-driven-review` — ran during planning on `proposal.md` + `design.md`
  (single-model fresh-context; cross-model series exhausted/unreachable and
  skipped with user acknowledgement). Findings on async placement, the
  pending-provider path, and the locked-off no-op were folded into `design.md`
  and the spec deltas.
- `review-code` — to run at implementation time before committing the change (a
  non-trivial change touching config, bridge, and client wiring).
- `react-expert` (subagent checkpoint) — the scope now touches three React
  surfaces (`SettingsPanel`, `RolesSettingsSection`, `CreateAutomationDialog`),
  crossing the ≥3-components spawn checkpoint.
- Not applicable: `security-hardening` (no auth/untrusted-input/secrets/PII —
  reuses the existing `PUT /api/config` surface), `performance-optimization` (no
  latency/throughput budget or large-data path), `observability-instrumentation`
  (no new endpoint/job/external call — the bridge reuses the existing
  default-model application site).
