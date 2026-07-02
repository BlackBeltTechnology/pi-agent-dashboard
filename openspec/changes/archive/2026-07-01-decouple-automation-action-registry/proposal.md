## Why

Today the automation action registry is a **shared mutable object owned by the automation plugin**: automation `provide`s a registry instance at its `registerPlugin`, and every contributing plugin (flows) `consume`s that object and pushes itself in. Two problems:

- **Load-order fragility.** Contribution happens at the consumer's `registerPlugin`. With no `dependsOn`, the loader's topological order does not guarantee automation's `provide` runs before flows' `consume`; if flows loads first it consumes `undefined` and silently no-ops, so `flows.run` never registers. "No dependency" is true only by luck.
- **Ownership blur.** A single mutable registry written by many plugins muddies who owns what and forces the shared object to exist before contributors run.

The right model is **publish/collect (inversion of control)**: automation owns the *slots* (contract, collection, descriptor-building, dispatch, dialog); any plugin *publishes* its own immutable contribution under a namespaced key; automation *collects* lazily when it renders the dialog or dispatches a run — after every plugin has loaded, so order is irrelevant. A plugin's action appears only if that plugin is active (it only publishes when loaded), and neither plugin references the other.

## What Changes

- Add a generic host primitive `consumeAll<T>(prefix)` to `ServerPluginContext` that returns every `provide`d entry whose key starts with `prefix` (order-independent, in-process only). Enables publish/collect for any feature, not just automation.
- Contributors publish an **immutable action contribution** under `automation.action.<source>` via `provide` (e.g. `provide("automation.action.flows", { id, label, available, payloadSchema, buildEvent })`). Publishing only happens in an active plugin's `registerPlugin`.
- The automation plugin stops owning a pushed-into registry. It **collects** contributions via `consumeAll("automation.action.")` lazily at `/actions` request time and at run dispatch, building its in-memory action index on the fly (per-cwd cached). Automation registers its own `core.prompt`/`core.skill` the same way (self-published), so built-ins are peers, not privileged.
- The client contract is pure serializable JSON: automation flattens each contribution into an `ActionDescriptor` (functions resolved/dropped, `available(cwd)` evaluated, enum `options(cwd)` resolved). `ActionPayloadField.type` is a **closed, versioned primitive set**; the client renders one control per primitive and falls back to a text input for an unrecognized `type` (forward-compat). Validation stays server-authoritative at `/create`.
- The flows plugin becomes a **pure publisher**: it publishes its `flows.run` contribution and no longer consumes automation's registry, references automation, or relies on load order.

Scope: in-process dashboard plugins only. No behavior change to what an action *does* (dispatch/emit unchanged from `automation-emit-configured-event`); this change is the wiring/ownership model + the client primitive contract.

## Capabilities

### Modified Capabilities
- `dashboard-plugin-loader`: `ServerPluginContext` gains `consumeAll(prefix)` (prefix enumeration over the host service board; in-process only).
- `automation-action-registry`: registry becomes collect-on-read over published contributions instead of a shared pushed-into object; automation self-publishes `core.*`; client `ActionPayloadField` is a closed versioned primitive set with an unknown-type client fallback.
- `flows-plugin`: flows publishes its `flows.run` contribution under `automation.action.flows`; no consume of automation, no dependsOn, no reference.

## Impact

- `packages/dashboard-plugin-runtime/src/server/server-context.ts` (+ `server.ts` deps): `ConsumeAllFn` + `consumeAll` wiring over `pluginServiceRegistry`.
- `packages/automation-plugin/src/server/action-registry.ts`: collect contributions from `consumeAll`; build descriptor/dispatch index; self-publish `core.*`.
- `packages/automation-plugin/src/server/index.ts` + `routes.ts` + `engine.ts`: read via collect instead of a held provided registry.
- `packages/flows-plugin/src/server/automation-actions.ts` + `index.ts`: publish contribution; drop `consume`/service-key duplication.
- `packages/automation-plugin/src/client/CreateAutomationDialog.tsx`: unknown-`type` field fallback in `ActionPayloadForm`.
- Shared: `ActionPayloadField` documented as a closed versioned union.
