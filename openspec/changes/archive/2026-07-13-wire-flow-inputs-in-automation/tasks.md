## 1. Per-fire value threading (engine seam)

- [x] 1.1 Widen `FireContext` in `trigger-registry.ts` to carry a per-fire value (single value + `firedAt`); update the `TriggerType.arm` fire signature docs.
- [x] 1.2 Stop dropping context in `engine.ts`: `onFire: (a, ctx) => runner.fire(a, ctx)`.
- [x] 1.3 Update `runner.ts` `fire(a, ctx)`; change the per-key queue element to `{ automation, ctx }` and drain preserving each entry's ctx.
- [x] 1.4 Thread ctx through `startRunFor(a, ctx)` → `buildRunDispatch(a, reg, ctx)` in `engine.ts`.
- [x] 1.5 Add a pure `interpolate(payload, triggerValue)` that resolves `${{trigger}}` (whole-value pass-through; string templates stringify; absent → empty string). Call it in `buildRunDispatch` before the action runs.
- [x] 1.6 Tests: `${{trigger}}` resolves in payload; queued fires retain distinct values; absent value → empty string (covers `automation-trigger-registry` scenarios).

## 2. File trigger

- [x] 2.1 Add `file-trigger.ts`: `TriggerType` kind `file`; `parse` requires non-empty `path`, reads `events`; `arm` watches the folder and fires once per new file with the file path as the per-fire value.
- [x] 2.2 Implement `settle: rename-only` (default): fire only on atomic rename into the folder.
- [x] 2.3 Register `fileTrigger` in `engine.ts` alongside `scheduleTrigger`; add `file` to the trigger taxonomy status as enabled.
- [x] 2.4 Tests: single fire per new file with correct path; two files → two independent fires; missing `path` isolates the automation; rename-only ignores in-progress writes (covers `automation-file-trigger` scenarios).

## 3. Read flow inputs from files (read-only discovery)

- [x] 3.1 Extend flow discovery in `flows-plugin/src/server/automation-actions.ts` to parse each flow's declared `inputs:` (read-only via local `yaml` parse; pi-flows not a dep) and return it alongside the flow id. Impl: `flow-inputs.ts` `readFlowInputs`.
- [x] 3.2 Expose the per-flow input schema to the client via `GET /api/plugins/flows/flow-inputs?cwd=&flow=` so the dialog can render wiring rows.
- [x] 3.3 Tests: a flow declaring typed inputs surfaces its schema; a flow with no inputs surfaces an empty schema; invalid rows skipped; no `flow.yaml` is written during discovery.

## 4. Emit wired inputs from flows.run

- [x] 4.1 Update `flows.run.buildEvent` to emit `data.inputs` from the (engine-)resolved `payload.inputs`; whole-value trigger bindings pass through with type preserved. Literal type coercion happens at wiring time (G6) + is preserved by yaml + central interpolate.
- [x] 4.2 Keep emitting `task` (optional) for back-compat; allow `task` and `inputs` to coexist.
- [x] 4.3 Tests: trigger-bound input carries the per-fire value; number/boolean literal preserves its type; empty/non-object inputs omitted; task-only still emits `task`.

## 5. Automation-plugin: host the action-editor slot (no flow knowledge)

- [x] 5.1 Add slot `automation-action-editor` to `packages/shared/src/dashboard-plugin/slot-types.ts` (`multiplicity: "many"`, `payloadTier: "react-only"`, keyed by `config.actionId`); non-breaking minor. `config` already flows through the manifest-validator + vite generator verbatim, so no validator change needed. Runtime: `forActionId` filter + `AutomationActionEditorSlot` consumer.
- [x] 5.2 In `CreateAutomationDialog`, render the contributed editor for the selected action id (props: `payload`, `onChange(payload)`, `cwd`) **additively below `ActionPayloadForm`** (DEVIATION from original "in place of": user chose the additive model — generic Flow+Task form stays, editor adds the inputs wiring). Renders nothing when none is contributed. automation-plugin stays ignorant of flow inputs.
- [x] 5.3 Add the file-trigger config field (folder path + created/changed/deleted + settle: rename-only), rendered in the trigger section; `on: { kind: file, path, events, settle: "rename-only" }`.
- [x] 5.4 Tests: dialog renders a contributed editor for a matching action id; falls back to `ActionPayloadForm` otherwise; payload.inputs coexists with flow/task; file-trigger config round-trips to `on:`; empty folder path blocks submit.

## 6. Flows-plugin: claim the slot with the wiring UI (owns read + UI)

- [x] 6.1 Claim `automation-action-editor` in the flows-plugin manifest (`config.actionId: "flows.run"`, component `FlowInputWiringClaim`), exported from `packages/flows-plugin/src/client/FlowInputWiring.tsx` via the client barrel.
- [x] 6.2 `FlowInputWiring` reads the selected flow's declared inputs via `GET /api/plugins/flows/flow-inputs?cwd=&flow=` (group-3 discovery, read-only) and renders one row per declared input.
- [x] 6.3 Each row binds a literal (typed control per declared type; number/boolean/object coercion at wiring time) or the trigger's fired value (`${{trigger}}`); writes only `payload.inputs` via `onChange`; never writes `flow.yaml`. UX: collapsible, collapsed by default, auto-expands when a required input is unbound.
- [x] 6.4 Re-renders + re-fetches when the selected flow changes; drops `payload.inputs` keys not declared by the new flow (console.warn).
- [x] 6.5 Tests: rows render from a flow's declared inputs; binding to trigger writes `${{trigger}}`; typed number literal persists as a number; re-selecting a flow drops orphan keys; no-inputs flow renders nothing.

## 7. Verify + gates

- [x] 7.1 Tests green: automation-plugin + flows-plugin + shared + dashboard-plugin-runtime (1834 passed, 1 pre-existing skip); client (2909 passed, generated registry updated). New: `CreateAutomationDialog.wiring.test.tsx` (6), `FlowInputWiring.test.tsx` (5). NOTE: worktree had no `node_modules` (cross-package `@blackbelt-technology/*` leaked to the main repo) — ran `npm install` to make it self-contained, then regenerated `plugin-registry.tsx`.
- [x] 7.2 `biome check --changed`: 0 Tier A errors; `tsc --noEmit` clean. 3 warn-tier advisories remain (non-CI-blocking per Tier A/B/C policy): `startRunFor`/`arm` cognitive-complexity (inherent to spawn/watch orchestration) + `model-tracker.ts noExplicitAny` (unrelated prior branch commit `08230e25`). Added the `automation-action-editor` entry to `slot-props.ts` `SlotPropsMap` (tsc coverage assertion).
- [x] 7.3 Verified via unit tests (live pi flow run not exercised here): file trigger fires once per file with its path (`file-trigger.test.ts`); central `interpolate` resolves `${{trigger}}` (`interpolate.test.ts`); `flows.run.buildEvent` emits `data.inputs` with type preserved (`automation-actions.test.ts`); discovery/wiring never writes `flow.yaml` (`flow-inputs.test.ts`, `FlowInputWiring.test.ts`); automation-plugin imports nothing flow-specific (slot hosted generically; flows-plugin owns the wiring component + reads).
