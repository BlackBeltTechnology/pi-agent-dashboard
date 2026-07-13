## Context

Automations run flows via the `flows.run` action, which emits a `flow:run` event into a spawned pi session where pi-flows listens. Today `flows.run.buildEvent` emits only `{ flowName, task }`, with `task` read from a static `payload.task`. There is no channel for a per-fire value to reach the flow.

Two facts make this cheap to fix:
- **pi-flows already consumes typed inputs.** `flow.yaml` declares `inputs: { <name>: { type, required } }` (`FlowInputDecl`). The `flow:run` handler maps `data.inputs → flowInput → ${{flow.input.<name>}}`, validated at run start. The receiving half is done.
- **The value channel exists but is severed.** A trigger's `arm()` calls `fire(ctx)`; the scheduler forwards `onFire(automation, ctx)`; but `engine.onFire` drops `ctx` (`(a) => runner.fire(a)`), and `runner.fire`/`startRunFor`/`buildRunDispatch`/`buildEvent` all take only the automation. The per-fire value never reaches the action.

Three cross-plugin boundaries are relevant (all already in place):
1. **Contribution bus** — flows-plugin publishes `flows.run` under `automation.action.flows`; automation-plugin collects via `ctx.consumeAll("automation.action.")`. Neither imports the other.
2. **Event bus into a spawned session** — automation emits `flow:run` via `ctx.emitEventToSession`; it never calls pi-flows directly.
3. **pi-flows in the run session** — an independent copy listens on `pi.events.on("flow:run")`.

## Goals / Non-Goals

**Goals:**
- A file trigger that fires once per new file and produces one per-fire value (the file path).
- Thread the per-fire value through the engine so `${{trigger}}` in the action payload resolves per-fire.
- Read a flow's declared `inputs:` from its file (read-only) and render a wiring form in the create-automation dialog.
- Let the user bind each declared input to a literal (typed) or to the trigger's fired value; persist to `automation.yaml` `payload.inputs`.
- `flows.run` emits `data.inputs` (per-fire substituted, types preserved). pi-flows consumes it unchanged.

**Non-Goals:**
- Editing flow definitions from the automation UI. `flow.yaml` is **read-only** here; flows are authored only via the flows editor / edit-flow skill.
- Changing pi-flows' `flow:run → flowInput → ${{flow.input.*}}` consumption path.
- A trigger "variable vocabulary" (`file`, `filename`, `dir`, `ext`, …). A trigger emits **one** value; the user wires it. (Rejected — see Decisions.)
- Ad-hoc user-invented inputs not declared by the flow. Inputs come from the flow's schema; the user wires values, not names/types.
- `concurrency` policy work (`queue`/`skip`/`parallel` already built). Consumer repos (invoicebot) scaffolding their own `automation.yaml`.

## Decisions

### D1 — Inputs are read from the flow file; the UI wires values, never edits the flow
The flow declares `inputs:` (any name, any type) in `flow.yaml`. The automation UI **reads** that schema (read-only parse) to render one wiring row per declared input, and **writes only** `automation.yaml` `payload.inputs`. The automation UI never mutates `flow.yaml`.
- *Why:* clean ownership — flows editor owns flow definitions; automation UI owns automations. The automation is a consumer of the flow's input contract.
- *Alternative rejected:* a generic ad-hoc key/type/value editor in the automation UI. Rejected — lets the user invent inputs the flow does not declare (no validation, drifts from the flow contract).

### D2 — A trigger emits one per-fire value, bound via `${{trigger}}`
The file trigger produces a single value (the path). The user binds it to whichever declared input they choose. No per-trigger variable taxonomy.
- *Why:* the automation carries one thing (the file that fired). A vocabulary (`${{trigger.file}}`, `.filename`, …) is complexity the use case does not need, and couples the dialog to trigger internals.
- *Alternative rejected:* trigger declares a `vars[]` descriptor set rendered as a palette. Rejected as over-engineered for a single value.

### D3 — Per-fire value threaded through the engine, resolved centrally
Widen `FireContext` to carry the per-fire value. Un-cut the seam: `engine.onFire(a, ctx) => runner.fire(a, ctx)`; the runner's per-key queue holds `{ automation, ctx }` (so each queued fire keeps its own value); `startRunFor(a, ctx)` → `buildRunDispatch(a, reg, ctx)`. A single interpolation pass resolves `${{trigger}}` in `payload.inputs` before the action runs.
- *Why central:* one substitution point serves every action; `flows.run.buildEvent` reads an already-resolved payload. No per-action interpolation logic.
- *Why queue-holds-ctx:* the existing queue stores `DiscoveredAutomation[]`; with per-fire values, a bare automation would collapse all queued fires to the last value. Each queue entry must carry its own `ctx`.

### D4 — Type preservation for wired inputs
Literal values coerce to the declared `FlowInputDecl.type` (number/boolean/object/array/string). A whole-value trigger binding (an input whose value is exactly `${{trigger}}`) passes the value through; string templates stringify.
- *Why:* pi-flows validates `flowInput` against the declared schema at run start; sending a string where a number is declared fails the run.

### D5 — `flows.run` emits `data.inputs`; discovery parses flow files
`flows.run.buildEvent` sets `data.inputs` from the (resolved) `payload.inputs`. `discoverFlows` returns each flow's declared `inputs:` (parsed read-only via pi-flows `parseFlowYamlFile`) so the dialog can render the wiring form.
- *Why:* pi-flows already reads `data.inputs`; this is the one missing emit. Discovery reuses the existing flow-file walk.

### D6 — File trigger settles on rename-only (default)
The trigger fires on atomic rename into the folder, avoiding partially written files. Producers write to a temp path then rename into place.
- *Alternative:* size-stable debounce (fire after N ms of no size change). Kept as a possible option but rename-only is the default and puts correctness on the producer.

### D7 — flows-plugin owns reading inputs AND the wiring UI; automation-plugin only hosts a slot
Reading a flow's declared inputs and rendering the wiring form both live in **flows-plugin**. automation-plugin exposes a new keyed slot; it never imports flows nor knows what a flow input is.
- **New slot** `automation-action-editor` (added to the frozen taxonomy in `packages/shared/src/dashboard-plugin/slot-types.ts`; adding a slot is a non-breaking minor). `multiplicity: "many"`, `payloadTier: "react-only"`, keyed by action id via the claim's `config.actionId`.
- **Host (automation-plugin):** in `CreateAutomationDialog`, when the selected action has a contributed editor for its id, render that slot component in place of the generic schema-driven `ActionPayloadForm`. The editor receives the current `payload`, an `onChange(payload)`, and the run `cwd`; it returns the edited payload. Falls back to `ActionPayloadForm` when no editor is contributed.
- **Claimant (flows-plugin):** claims `automation-action-editor` with `config.actionId: "flows.run"` and a component that (a) reads the selected flow's declared inputs read-only, (b) renders the wiring rows, (c) writes only `payload.inputs` back via `onChange`.
- *Why:* keeps automation-plugin ignorant of flow internals (mirrors the existing action-contribution decoupling — flows already owns the server-side `flows.run` action). The dialog stays a generic host; flows owns everything flow-specific, read + UI.
- *Alternative rejected:* extend the generic `ActionPayloadForm`/`payloadSchema` with a dependent-schema + typed fields so the automation dialog renders flow inputs itself. Rejected — puts flow-input knowledge inside automation-plugin, violating the ownership boundary.
- *Alternative rejected:* reuse the descriptor-only `rjsf-form` slot. Rejected — the wiring form needs live read-only flow discovery + literal/trigger binding, which is React behavior, not a static JSON-schema form.

## Risks / Trade-offs

- **Partial-write races** → rename-only settle (D6); document the temp-then-rename convention for producers.
- **Queue value collapse** → queue entries hold per-fire `ctx` (D3), covered by a test that enqueues multiple fires with distinct values and asserts each run gets its own.
- **Type mismatch fails the run** → coerce literals to declared type + preview/validate in the dialog (D4); surface pi-flows' `flow_input_invalid` clearly.
- **Dialog coupled to flow internals** → discovery is a read-only parse of `inputs:` only; no other flow structure is read, and nothing is written (D1).
- **Dependent schema (inputs depend on selected flow)** is a new dialog capability → the wiring form re-renders when the selected flow changes; `payload.inputs` keys not in the new flow's schema are dropped with a warning.

## Migration Plan

- Additive. Existing automations with `payload.task` keep working (`flows.run` still emits `task`).
- No `automation.yaml` migration: `payload.inputs` is new and optional.
- Rollback: revert the plugin changes; `flow:run` falls back to `task`-only. Flows are untouched throughout.

## Open Questions

- Token spelling for the single per-fire binding: `${{trigger}}` vs a short marker in the UI that serializes to a canonical form. Leaning `${{trigger}}` for consistency with pi-flows' `${{…}}` syntax.
- Should `payload.task` and `payload.inputs` coexist on one `flows.run` action, or is `inputs` mutually exclusive with `task`? Default: allow both; `task` optional.
