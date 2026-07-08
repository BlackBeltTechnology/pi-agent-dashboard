## Why

The Create Automation dialog greys out the `flows.run` ("Run a flow") action as "not available here" for folders that clearly have flows (e.g. `invoice-bot`, `invoice-bot-test`). The flows plugin's action-availability check (`discoverFlows(cwd)`) does a naive static filesystem scan of `<cwd>/.pi/flows/flows/<ns>/<name>/flow.yaml` only. But real flows are discovered by pi-flows at runtime from three tiers — event-registered `extraFlowsDirs` (how the invoicebot extension ships its flows), package-bundled `<pkg>/flows/`, and project-local `.pi/flows/flows/`. The static scan sees only the last tier, so package/event-registered flows are invisible to the dialog even though pi-flows runs them fine and the session card's FLOWS section lists them correctly.

## What Changes

- Replace the static `discoverFlows(cwd)` disk scan used by the `flows.run` contribution's `available(cwd)` and its `flow` enum `options(cwd)` with a lookup against the **live flows list the server already holds** — the `flows_list` the bridge forwards per session into the flows-plugin `stateStore`.
- The flows-plugin server resolves a folder `cwd` to its live session(s) via the plugin `sessionManager`, unions their reported flows, and exposes that as the availability/options source. This is the same authoritative list the session-card FLOWS section already uses.
- Scope (decided): availability reflects flows only when a pi session for that folder is running. No on-disk manifest, no persistence, no cold-folder support in this change.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `flows-plugin`: the `flows.run` automation action requirement changes its source of "flows discovered in the cwd" — from a static `.pi/flows/flows/` filesystem scan to the live per-session flows list (`stateStore`, populated by the forwarded `flows_list`), resolved by mapping cwd → running session(s). Availability and the `flow` enum options both derive from this single source.

## Impact

- `packages/flows-plugin/src/server/automation-actions.ts` — `discoverFlows(cwd)`, `hasFlows`, and `flowsActionContributions()` (availability + enum options). The static-scan helper is replaced by a resolver injected from the server entry.
- `packages/flows-plugin/src/server/index.ts` — wires the cwd→flows resolver (using `ctx.sessionManager` + `stateStore`) into the contribution factory before `provideFlowsActions`.
- Consumes existing infra only: `stateStore` (per-session flows), forwarded `flows_list` (bridge → server), `PluginSessionManager.listActive()` (session cwd). No protocol changes, no new dependencies.
- Behavioral note: with no live session for a folder, `flows.run` stays disabled (unchanged from today for that case); the fix is that a folder WITH a running session now shows its real flows regardless of where on disk they live.
