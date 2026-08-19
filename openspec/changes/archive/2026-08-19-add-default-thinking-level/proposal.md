## Why

The dashboard lets an operator pick a **Default Model** applied to every brand-new
session, but there is no matching control for the **thinking level**. A
dashboard-spawned session therefore lands on whatever pi resolves on its own
(pi's `settings.defaultThinkingLevel`, else the hard-coded `"medium"`), never a
value the dashboard operator chose. Pairing a default thinking level with the
default model closes that gap and matches pi-ai's own first-class
`defaultThinkingLevel` concept.

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

## Impact

- `packages/shared/src/config.ts` — add `defaultThinkingLevel` to the config
  type, defaults, sanitizer, and parser.
- `packages/extension/src/bridge.ts` — apply `config.defaultThinkingLevel` via
  `pi.setThinkingLevel` alongside `applyDefaultModel()` under the existing gate.
- `packages/client/src/components/settings/SettingsPanel.tsx` — add the
  `ThinkingLevelSelector` beside the Default Model selector, wired to
  `defaultThinkingLevel` with model-derived `supportedLevels` and a
  locked-to-`off` state when no model is selected.
- No new dependencies. No breaking changes.

## Discipline Skills

- `doubt-driven-review` — ran during planning on `proposal.md` + `design.md`
  (single-model fresh-context; cross-model series exhausted/unreachable and
  skipped with user acknowledgement). Findings on async placement, the
  pending-provider path, and the locked-off no-op were folded into `design.md`
  and the spec deltas.
- `review-code` — to run at implementation time before committing the change (a
  non-trivial change touching config, bridge, and client wiring).
- Not applicable: `security-hardening` (no auth/untrusted-input/secrets/PII —
  reuses the existing `PUT /api/config` surface), `performance-optimization` (no
  latency/throughput budget or large-data path), `observability-instrumentation`
  (no new endpoint/job/external call — the bridge reuses the existing
  default-model application site).
