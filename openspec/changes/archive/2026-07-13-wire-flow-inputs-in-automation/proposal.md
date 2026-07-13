## Why

An automation can start a flow, but the flow's task is a frozen string in `automation.yaml`; there is no way to feed a per-fire value (the file that arrived) into the flow. pi-flows already declares typed `inputs:` in each flow file and already consumes `data.inputs` from the `flow:run` event — but automations never read those declared inputs and never emit `data.inputs`. This closes that gap: automations read a flow's declared inputs (read-only), the user wires a value to each in the UI, and a trigger's per-fire output can be bound to any of them.

## What Changes

- Add a **file trigger**: watches a folder, fires once per new file, and produces a single per-fire value (the file path). Renders in the create-automation dialog like the cron field (folder path + created/changed/deleted + `settle: rename-only`).
- Thread the per-fire trigger value through the engine. Today `FireContext` is dropped at `engine.onFire`; the fire's value must survive scheduler → runner (queue holds per-fire context) → dispatch so it can fill bound inputs.
- **Read a flow's declared inputs from its file** (`flow.yaml` `inputs:`), read-only. `discoverFlows` returns each flow's input schema, not just names. The automation UI **never edits flow files.**
- Add an **input-wiring form** to the create-automation dialog: one row per declared flow input; the user binds each to a literal (typed per the declared type) or to the trigger's fired value (`${{trigger}}`). Writes only to `automation.yaml` `action.payload.inputs`.
- `flows.run` emits `data.inputs` on the `flow:run` event, with the per-fire value substituted and declared types preserved. pi-flows already consumes `data.inputs` → `${{flow.input.<name>}}` — **no flow-side change.**

## Capabilities

### New Capabilities
- `automation-flow-input-wiring`: read a flow's declared `inputs:` schema (read-only), render a UI wiring form binding each input to a literal or the trigger's fired value, persist to `automation.yaml` `payload.inputs`, and emit `data.inputs` on `flow:run` with per-fire substitution + type preservation.
- `automation-file-trigger`: folder-watch trigger that fires once per new file and produces a single per-fire value (the file path), with `settle: rename-only` to avoid firing on partially written files.

### Modified Capabilities
- `automation-trigger-registry`: `FireContext` carries a per-fire value; it is threaded through scheduler → runner (the run queue holds per-fire context, not just the automation) → engine dispatch, where `${{trigger}}` in the action payload is resolved per-fire.

## Impact

- **Dashboard (build here):**
  - `packages/automation-plugin/src/server/` — `trigger-registry.ts` (`FireContext` per-fire value), new `file-trigger.ts`, `engine.ts` + `runner.ts` + `scheduler.ts` (thread context; queue holds per-fire ctx), central per-fire substitution in dispatch.
  - `packages/shared/src/dashboard-plugin/slot-types.ts` — new `automation-action-editor` slot (keyed by `config.actionId`; non-breaking minor).
  - `packages/automation-plugin/src/client/CreateAutomationDialog.tsx` — file-trigger config field + **host** the action-editor slot (renders a contributed editor for the selected action id; generic fallback). automation-plugin stays ignorant of flow inputs.
  - `packages/flows-plugin/src/client/` — the **input-wiring UI**, claimed into `automation-action-editor` for `flows.run`. flows-plugin owns reading inputs + rendering the wiring form.
  - `packages/flows-plugin/src/server/automation-actions.ts` — `discoverFlows` returns each flow's `inputs:` schema (read-only parse via pi-flows `parseFlowYamlFile`); `flows.run.buildEvent` emits `data.inputs`.
- **Unchanged (explicit non-goals):** flow definitions (`flow.yaml` is read-only from the automation UI), pi-flows' `flow:run` → `flowInput` → `${{flow.input.*}}` consumption path, `concurrency` policy (`queue`/`skip`/`parallel` already built).
- **Consumers (out of scope):** the invoicebot repo scaffolds its own `automation.yaml` + spool; not part of this change.
