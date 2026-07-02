## Context

Automations run `ON <trigger> DO <action>`. Triggers are extensible via a `TriggerRegistry`; actions are not — `action.kind` is hardcoded to `prompt | skill` in `automation-schema.ts`, the `AutomationAction` type, and the dialog's segmented control. The create-automation dialog's action source and the engine's dispatch path do not share a registry instance (the trigger-picker route in `routes.ts` builds a throwaway registry knowing only `schedule`).

Plugins load through `loadServerEntries` (`dashboard-plugin-runtime`) which already topologically sorts by `manifest.dependsOn`/`priority` — but `ServerPluginContext` exposes no way for one plugin to publish a service another consumes.

First consumer: the flows plugin already models `action: "flow.run"` with `payload: { flow }` and gets its flow list from pi's `flows_list` message. It just has no way to offer that as an automation action.

Chosen UI: Direction A (inline grouped accordion picker). Selected over command-palette (B) and two-pane (C) for lowest build cost, best discoverability, and reuse of the current dialog structure.

## Goals / Non-Goals

**Goals:**
- Any in-process dashboard plugin can register automation actions at startup.
- Registered actions appear in the create-automation dialog, grouped by source, searchable, cwd-gated.
- Action payloads are declared by a schema and rendered as a form automatically.
- Backward compatible: existing `prompt`/`skill` automations keep working.
- One registry instance feeds both the dialog and the engine dispatch.

**Non-Goals:**
- pi bridge extensions emitting actions over the WebSocket bridge (cross-process). Out of scope.
- Changing the trigger side beyond what unification requires.
- A general plugin event bus beyond the minimal `provide`/`consume` seam.

## Decisions

**D1 — Cross-plugin seam: generic `provide`/`consume`, not an automation-specific hook.**
Add `provide(name: string, value: unknown)` + `consume<T>(name): T | undefined` to `ServerPluginContext`, backed by one host-owned `Map`. Automation publishes `"automation.action-registry"`; consumers (flows) `consume` it and call `register(action)`.
- Alternatives: (a) automation-specific `ctx.registerAutomationAction(...)` — smaller but couples the host to automation and doesn't generalize; (b) event-message advertisement — async, races the dialog fetch. Rejected.
- Rationale: the user requirement is "any plugin." A generic seam is ~20 lines, reusable, and load-order-safe because the loader is already topological. Consumers declare `dependsOn: ["automation"]`.

**D2 — Namespaced action ids `<source>.<verb>`.**
Registry key = `source.verb` (e.g. `flows.run`). Prevents collisions when many plugins register and self-documents ownership in `automation.yaml`. `core.prompt`/`core.skill` are the built-ins (back-compat: bare `prompt`/`skill` in existing files normalize to `core.*`).

**D3 — Action descriptor shape.**
`{ id, source, label, description, available(cwd): boolean, payloadSchema: Field[], dispatch(payload, runCtx) }`. `payloadSchema` field types: `string`, `multiline`, `enum` (with `options(cwd)` for live values), `text`. The client renders one control per field; `enum.options` resolved server-side per cwd and sent with the descriptor.

**D4 — Unify the registry.**
The action registry lives in the engine and is also referenced by the kinds route. Replace the throwaway-registry pattern: the route returns descriptors from the live registry filtered by `available(cwd)`.

**D5 — Dialog = inline accordion (Direction A).**
Replace the `prompt|skill` segmented control with a grouped accordion: one collapsible group per source, search filter, disabled-with-reason for unavailable sources, schema-driven payload form below. ARIA: combobox over grouped listbox, focus-visible, 44px targets, reduced-motion.

**D6 — Dispatch routing.**
On run, the engine resolves `action.kind` → registered descriptor → `dispatch(payload, runCtx)`. `core.prompt`/`core.skill` dispatch via the existing seed-prompt path. `flows.run` dispatches into the flow-run path the flows plugin already owns.

## Risks / Trade-offs

- [Plugin floods the picker with actions] → per-plugin cap (≤12); registry warns + truncates.
- [`available(cwd)` is sync but flow discovery is async] → descriptor carries a cached availability snapshot; dialog shows skeleton while the kinds route resolves; never blocks open.
- [Consumer loads before provider] → mitigated by topological load + `dependsOn`; if `consume` returns undefined, plugin logs and no-ops (degrades gracefully, no crash).
- [`automation.yaml` references an action whose plugin is uninstalled] → validation marks that automation invalid with an error naming the id; siblings still load (mirrors existing unknown-trigger-kind isolation).
- [Generic `provide`/`consume` invites misuse] → documented as in-process, last-write-wins, no lifecycle teardown in v1; only automation uses it initially.

## Migration Plan

- Additive. Existing `automation.yaml` with `action.kind: prompt|skill` parse unchanged (normalized to `core.*` internally).
- No data migration. New `action.payload` map is optional and only present for schema-bearing actions.
- Rollback: revert the plugin-runtime + automation-plugin + flows-plugin changes; old `prompt|skill` files remain valid.

## Open Questions

- Final per-plugin action cap value (proposed 12).
- Whether `consume` should throw vs return undefined when the provider is absent (proposed: return undefined, log).
