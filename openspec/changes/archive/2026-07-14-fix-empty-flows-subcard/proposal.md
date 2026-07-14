## Why

The FLOWS subcard renders an empty capsule panel (a "FLOWS" pill over a blank
bordered box, no buttons) whenever the pi-flows extension is loaded in a
session's cwd but there is nothing actionable to show: zero flows in the cwd,
edit mode off, and no flow running or previously run.

Root cause is a **divergence between the subcard's visibility gate and its
content's render condition**:

- Gate — `shouldRenderFlowsSubcard` (`flows-plugin/src/client/shouldRender.ts`)
  opens on `getFlowsAvailabilitySync() || sessionHasFlowEvents()`, and
  `getFlowsAvailabilitySync` is computed by `computeAvailability`, which returns
  `true` whenever the session's `commandsList` contains a `flows` / `flows:*`
  command — i.e. **whenever the pi-flows extension is present**, regardless of
  flow count or edit mode.
- Content — `SessionFlowActionsClaim` returns `null` when
  `flows.length === 0 && !editMode && !flowState`.

In the "extension loaded, zero flows, edit mode off, no flow ran" state the gate
opens but the content is `null`. `SessionSubcard`'s own `hasMeaningfulChildren`
auto-hide cannot rescue this: it receives a truthy React *element*
(`<SessionCardFlowsSlot/>`) that only renders `null` later, so it still paints
the panel + title.

The `session-card-subcards` capability already requires the opposite: *"A plugin
that registers a claim whose component conditionally returns `null` SHALL declare
a `shouldRender` so the wrapper does not render an empty panel."* This change
brings `shouldRenderFlowsSubcard` back into compliance.

## What Changes

- Replace the extension-presence proxy in `shouldRenderFlowsSubcard` with the
  **same predicate `SessionFlowActionsClaim` uses to decide it renders**:

  ```
  flowsList.length > 0  ||  editMode  ||  sessionHasFlowEvents(session)
  ```

  - `flowsList` read synchronously via `getSessionData<FlowInfo[]>(id, "flowsList")`.
  - `editMode` read synchronously via `getPluginConfig("flows").editFlow` (default `false`).
  - `sessionHasFlowEvents` unchanged (covers a running/completed flow; ⊇ `flowState`).

- Retire the `computeAvailability` command-presence path and its
  `commandsList`/`flowsList` availability subscriber
  (`installFlowsAvailabilitySubscriber`, the `availability` cache, and
  `getFlowsAvailabilitySync`) **if** nothing else consumes them. The gate no
  longer needs a cache — it reads live per-session-data + config directly.
  `sessionHasFlowEvents` and its memo stay.

- Preserve invariants: author-first-flow (edit mode on, zero flows) still shows
  via `editMode`; running/completed flows still show via `sessionHasFlowEvents`;
  closed-by-default anti-flicker holds (empty `flowsList` on cold boot →
  hidden → visible, the acceptable direction).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `session-card-subcards`: tighten the FLOWS visibility row. The FLOWS subcard's
  `shouldRender` predicate SHALL match the claim's render condition
  (`flowsList non-empty OR edit mode on OR a flow event exists`), so the subcard
  hides in the "extension loaded, zero flows, edit mode off, no flow ran" state
  instead of painting an empty panel.

## Impact

**Code:**

- `packages/flows-plugin/src/client/shouldRender.ts` — swap the gate body to the
  content-matching predicate; import `getSessionData` + `getPluginConfig`.
- `packages/flows-plugin/src/client/flowsAvailability.ts` — remove
  `computeAvailability`, `getFlowsAvailabilitySync`, `setFlowsAvailability`, the
  `availability` cache, and `installFlowsAvailabilitySubscriber` if unused after
  the gate change; keep `sessionHasFlowEvents` + memo. Update the client entry
  (`index.tsx`) that installs the subscriber accordingly.

**Tests:**

- `packages/flows-plugin/src/__tests__/flowsAvailability.test.ts` — replace the
  availability-cache cases with predicate cases: hidden when
  `flowsList empty + editMode off + no flow events`; visible for each of
  `flowsList>0`, `editMode`, `flow event present`.
- `packages/flows-plugin/src/__tests__/manifest-discoverability.test.ts` — the
  `shouldRenderFlowsSubcard` gate name + export assertions stay valid; adjust
  only if it asserts the retired subscriber.

**APIs / dependencies:**

- `flows-plugin` patch version bump (behaviour fix, no new slot/API).

**No effect on:** wire protocol, server-side state, the `session-card-flows`
slot id, `SessionSubcard`, or the FLOWS subcard's position in the stack.

## Discipline Skills

None (surgical predicate fix; no auth/perf/observability/migration surface).
