## Why

Automation actions are hardcoded to `prompt | skill`. No installed plugin can contribute its own action, so a flow can never be run on a schedule even though the flows plugin already knows how. Triggers are extensible (a registry exists); actions are not. This change opens the action side to any plugin and surfaces the contributed actions in the create-automation dialog.

## What Changes

- Add a host-brokered cross-plugin seam on `ServerPluginContext`: `provide(name, value)` / `consume(name)`. A plugin publishes a service; any later-loaded plugin consumes it. Load order is already topological (`manifest.dependsOn`), so a provider is guaranteed to register before its consumers.
- The automation plugin publishes an **action registry** through that seam. Plugins register actions with: a namespaced id `<source>.<verb>` (e.g. `flows.run`), an `available(cwd)` gate, a `payloadSchema`, and a `dispatch` handler.
- Generalize the `automation.yaml` `action` block: `action.kind` accepts any registered id (not only `prompt`/`skill`); a new `action.payload` map carries the schema-driven values. Validation runs against the live registry. `prompt` and `skill` become the two built-in `core.*` actions — backward compatible.
- Unify the registry instance: the dialog's action-list source and the engine's dispatch path read the SAME registry (today the trigger-picker route builds a throwaway registry that knows only `schedule`).
- Redesign the create-automation dialog's action control (was a fixed `prompt|skill` segmented control) into an **inline grouped accordion picker** (Direction A): actions grouped by source plugin, searchable, `available(cwd)`-gated (un-configured sources shown disabled-with-reason), and a payload form auto-generated from the selected action's `payloadSchema`. Accessible per WAI-ARIA APG + WCAG 2.2.
- The flows plugin registers `flows.run` / `flows.resume` / `flows.cancel`, gated on flows existing in the cwd; `flows.run` declares a `flow` enum (live from `flows_list`) + a `task` string, and dispatches into the existing flow-run path.
- Terminology: reserve **event** for the inbound trigger and **action** for the registered, namespaced capability. "event" stays a code/protocol token; the UI surfaces "Trigger" and "Action".

Scope: in-process dashboard plugins only. pi bridge extensions emitting actions over the WebSocket bridge is explicitly out of scope.

## Capabilities

### New Capabilities
- `automation-action-registry`: registration model for plugin-contributed automation actions (namespaced `<source>.<verb>` ids, `available(cwd)` gating, `payloadSchema`, `dispatch`), the single shared registry feeding both dialog and engine, and the grouped/searchable inline-accordion action picker with schema-driven payload form.

### Modified Capabilities
- `dashboard-plugin-loader`: `ServerPluginContext` gains `provide(name, value)` / `consume(name)`; the loader's existing topological order becomes a guaranteed provider-before-consumer contract relied upon by registration.
- `automation-folder-format`: `action.kind` accepts any registered action id beyond `prompt|skill`; adds `action.payload` map; validation resolves against the live action registry; `prompt`/`skill` redefined as built-in `core.prompt`/`core.skill`.
- `flows-plugin`: registers `flows.run`/`flows.resume`/`flows.cancel` automation actions, gated on cwd flow availability, with payload schemas (flow enum + task) and dispatch into the flow-run path.

## Impact

- `packages/dashboard-plugin-runtime/src/server/server-context.ts` (+ `loader.ts`): new `provide`/`consume` on the context + deps.
- `packages/automation-plugin/src/server/`: new action-registry module; `automation-schema.ts` action validation generalized; `routes.ts` trigger/action-kinds route reads the shared registry; `engine.ts` dispatch routes through registered action handlers.
- `packages/automation-plugin/src/shared/automation-types.ts`: `AutomationAction` widened (id + payload); action-descriptor types for the client.
- `packages/automation-plugin/src/client/CreateAutomationDialog.tsx` (+ `api.ts`): inline-accordion action picker + schema-driven payload form.
- `packages/flows-plugin/src/server/index.ts`: action registrations + dispatch.
- On-disk `automation.yaml` files: additive, backward compatible (existing `prompt`/`skill` keep working).
