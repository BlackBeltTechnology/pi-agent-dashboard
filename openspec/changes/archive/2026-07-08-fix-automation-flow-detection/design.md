## Context

The Create Automation dialog asks the automation plugin for the actions available in a folder `cwd`. The automation registry flattens each published contribution, evaluating its `available(cwd)` predicate and resolving each `enum` field's `options(cwd)` to a `string[]` (`packages/automation-plugin/src/server/action-registry.ts`, `descriptorsForCwd`). This runs synchronously in the dashboard server process, keyed on a folder path.

The flows contribution (`packages/flows-plugin/src/server/automation-actions.ts`) supplies `available` and the `flow` enum `options` from `discoverFlows(cwd)` — a static scan of `<cwd>/.pi/flows/flows/<ns>/<name>/flow.yaml`. pi-flows itself discovers flows from three tiers at runtime (`discoverAll` in pi-flows `flow-engine/discovery.ts`): event-registered `extraFlowsDirs` (emitted via `flow:register-flows-dir`, e.g. the invoicebot extension registering `<pkg>/flows`), package-bundled `<pkg>/flows/`, and project-local `.pi/flows/flows/`. The static scan sees only the last tier, so package/event-registered flows are invisible to the dialog — `flows.run` greys out as "not available here" even though pi-flows runs those flows and the session-card FLOWS section lists them.

The dashboard server already holds the authoritative list: the bridge forwards a `flows_list` (from the in-session `flow:list-flows` probe, i.e. pi-flows' full runtime discovery) into the flows-plugin `stateStore` per session (`packages/flows-plugin/src/server/state-store.ts`, `setFlows`). Each `FlowInfo.name` is the fully-qualified `<ns>:<name>` command id — the exact shape the `flow` enum and `FLOW_ID_RE` already expect.

## Goals / Non-Goals

**Goals:**
- `flows.run` availability and its `flow` enum options reflect the same flows pi-flows actually runs, regardless of on-disk tier.
- Single source of truth: reuse the live `stateStore` flows list already populated by the forwarded `flows_list`.
- No new protocol messages, dependencies, or persisted artifacts.

**Non-Goals:**
- Cold-folder support (a folder with no running session). Decided out of scope: with no live session the flows list is empty and `flows.run` stays disabled. No on-disk manifest.
- Changing the generic automation registry mechanism (publish/collect, `available(cwd)` predicate contract) — unchanged.
- Changing the bridge, `flows_list` protocol, or pi-flows discovery.

## Decisions

**Decision: resolve cwd → flows via `sessionManager` + `stateStore`, injected into the contribution factory.**

`flowsActionContributions()` currently closes over the module-level `discoverFlows`. Change it to accept a resolver `flowsForCwd: (cwd: string) => string[]` and use it for both `available` (`flowsForCwd(cwd).length > 0`) and the `flow` enum `options` (`flowsForCwd(cwd)`). The server entry (`index.ts`) builds `flowsForCwd` from context it already has:

```
flowsForCwd(cwd):
  sessions = ctx.sessionManager.listActive()          // DashboardSession[]
             .filter(s => s.cwd === cwd)               // exact cwd match
  ids = union over sessions of
             stateStore.getState(s.id)?.flows?.map(f => f.name)   // <ns>:<name>
  return sorted-unique(ids)
```

and passes it into `flowsActionContributions(flowsForCwd)` before `provideFlowsActions`.

- Why exact `cwd` match (not descendant): automation availability is per exact folder scope; the dialog's cwd is the automation folder. Keep it strict and simple; broaden later only if a real case needs it.
- Why `listActive()`: only running sessions report a live flows list; a dead session's stale `stateStore` entry is cleared on disconnect (`clearSession`).

**Decision: keep the id shape `<ns>:<name>`.** `FlowInfo.name` is already the qualified command id, so no mapping is needed and `FLOW_ID_RE` / `buildEvent` are untouched.

**Alternative considered — persisted manifest (write discovered flows to `<cwd>/.pi/flows/registered.json`, read it statically).** Rejected for this change: adds a new artifact + staleness management, and the user explicitly chose the simplest live-session-only path. The live resolver is a strict subset of that design and can be extended later if cold-folder support is wanted.

**Alternative considered — replicate pi-flows' `discoverAll` (scan all three tiers statically in the dashboard).** Rejected: the dashboard cannot know which dirs an extension will register via `flow:register-flows-dir` without the running session; replicating tier logic duplicates pi-flows internals and drifts.

## Risks / Trade-offs

- [Behavior change: `flows.run` now depends on a running session] → This is the intended, user-approved scope. Document it in the spec (already captured) and the flows-plugin AGENTS row. The old static scan effectively never worked for package/event flows anyway.
- [`stateStore` empty at the instant the dialog opens right after session start, before the first `flows_list` arrives] → `flows_list` is sent on connect and on `flow:rediscover`/`flow:complete`; the window is small and self-heals on the next dialog open. Acceptable; no mitigation needed.
- [Multiple sessions in the same cwd report differing lists] → Union handles it; sorted-unique keeps the enum stable.
- [`sessionManager.listActive()` returns `unknown[]`] → narrow to the `{ id: string; cwd: string }` shape needed; guard missing fields.

## Migration Plan

Pure server-side swap inside flows-plugin. No data migration. Deploy = rebuild client not required (server-only change); restart the dashboard server (jiti loads TS directly). Rollback = revert the two files. The static `discoverFlows` helper is removed (no other caller in the plugin); if any test imports it, update the test to the resolver.

## Open Questions

- None blocking. (Future: if cold-folder availability is later desired, add the persisted-manifest tier — additive, no rework of this resolver.)
