## Context

`add-flows-subcard` (archived 2026-05-12) established the FLOWS subcard as a
wrapper (`FlowsSubcard` in `SessionCard.tsx`) gated by
`useSlotHasClaimsForSession("session-card-flows")`, which consults the manifest
`shouldRender` predicate `shouldRenderFlowsSubcard`. That predicate was designed
"closed-by-default" and driven by a module-level availability cache populated
from `flowsList` / `commandsList` publishes.

At the time, `computeAvailability` gated on **extension presence** (a `flows` /
`flows:*` command exists) as a proxy for "authoring is possible here — show the
subcard even with zero flows (the author-first / edit-mode case)". That proxy is
too broad: edit mode defaults **off**, so the gate also opens when there is
nothing to author and nothing to run.

## Goals / Non-Goals

**Goals**
- The FLOWS subcard is visible iff `SessionFlowActionsClaim` will render content.
- No empty "FLOWS" panel in any session state.
- Keep author-first-flow (edit mode, zero flows) and running/completed-flow
  states visible.

**Non-Goals**
- Changing the slot taxonomy, subcard order, or `SessionSubcard` internals.
- An empty-state hint inside the subcard (explicitly rejected — hide, don't hint).
- Making `SessionSubcard` see through a child element that renders `null`.

## Decision: gate reads live per-session-data + config, not a cache

Compute the gate directly from the same synchronous sources the claim reads:

```ts
export function shouldRenderFlowsSubcard(session): boolean {
  if (!session) return false;
  const flows = getSessionData<FlowInfo[]>(session.id, "flowsList");
  const editMode = (getPluginConfig("flows") as { editFlow?: boolean }).editFlow ?? false;
  return (Array.isArray(flows) && flows.length > 0)
      || editMode
      || sessionHasFlowEvents(session.id);
}
```

`getPluginConfig` (plugin-context.tsx:441) and `getSessionData` are both
synchronous — legal inside a manifest `shouldRender` predicate, which must be
sync and side-effect-free.

### Why not keep the availability cache and fold in editMode?

The cache existed to avoid depending on the gated component being mounted
(chicken-and-egg). But the gate never needed the component — only the
per-session-data it consumes, which `getSessionData` exposes directly. Reading
live removes a second source of truth (the cache + its subscriber) that could
drift from the claim's condition. Dropping it is the durable fix (one predicate,
not two mirrored conditions).

### Reactivity

`useSlotHasClaimsForSession` re-evaluates the predicate on session-card renders.
`flowsList` changes already trigger a re-render via the per-session-data store.
An `editFlow` toggle writes global plugin config (`plugin_config_write`); verify
it triggers a re-render so the subcard reveals without a manual refresh. If it
does not, the toggle already re-renders `SessionFlowActions` (it reads
`config.editFlow`), and the subcard shares the same render pass — acceptable.

### Anti-flicker

Cold boot: `flowsList` is briefly `undefined`/empty, edit mode off, no events →
predicate `false` → hidden. When `flowsList` populates → visible. Hidden →
visible is the acceptable transition per the original design note; the jarring
visible → hidden direction cannot occur from this path.

## Risks / Trade-offs

- **Removing the subscriber** may touch `index.tsx`'s plugin-entry install call
  and `manifest-discoverability.test.ts` if either asserts it. Mitigation: grep
  for `installFlowsAvailabilitySubscriber` / `getFlowsAvailabilitySync` /
  `computeAvailability` consumers before deleting; keep `sessionHasFlowEvents`.
- **Config read in a hot predicate**: `getPluginConfig` returns a cached config
  object; the call is O(1). No measurable cost.

## Migration

None. Behaviour-only fix; no data, protocol, or slot changes.
