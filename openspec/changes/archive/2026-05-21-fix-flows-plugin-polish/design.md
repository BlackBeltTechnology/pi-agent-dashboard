# Design — fix-flows-plugin-polish

## Context

This change is a polish sweep after `add-flow-agent-popout` and
`route-flow-asks-to-upper-slot` shipped. Six issues motivate it:

1. **Code duplication.** `FlowArchitect.tsx` still has its own inline
   `ToolCallEntry` / `TextEntry` / `ThinkingEntry` /
   `extractInputPreview`. `extract-minimal-chat-view` deliberately scoped
   only `SubagentDetailView` and `FlowAgentDetail`. Now is the time to
   finish the job.
2. **Tiny buttons.** The expand-detail and popout buttons on agent /
   architect cards are 0.45 size icons with no labels — easy to miss.
3. **Popout opens `about:blank`.** Path-only URLs combined with
   unencoded `agent.stepId` can produce malformed URLs that browsers
   refuse to navigate to.
4. **No popout for the architect.** Same monitoring use-case as flow
   agents; trivial to add now that the slot infrastructure exists.
5. **Flow activity badge in the wrong subcard.** Registered against
   `session-card-badge`, which the shell mounts inside `WorkspaceSubcard`
   (history reason: the badge predates the FLOWS subcard).
6. **Shell hardcodes plugin component-type literals.** `useHasFlowRoutedPrompt`
   in `SessionCard.tsx` checks the string `"flow-question"`. That's
   plugin-specific knowledge in shell code. The fix is to use the
   existing placement primitive (`isWidgetBarPrompt`) — the shell only
   needs to know "this prompt is widget-bar-placed", not which plugin
   placed it.

Plus one investigation: the FlowDashboard upper slot renders empty
during flow EXECUTION, even though it renders correctly during the
architect phase that precedes the flow.

## Goals / Non-Goals

**Goals:**

- Visual consistency: `FlowArchitect` expanded view uses the same
  `MinimalChatView` rendering as flow agents and subagents.
- Discoverable affordances: expand and popout buttons are sized and
  labelled so they read clearly.
- Working popout: clicking the popout button always opens a tab that
  resolves the route, never `about:blank`.
- FLOWS-subcard is the single home for running-flow status; WORKSPACE
  is for git/jj workspace info only.
- Shell has zero hardcoded plugin component-type identifiers. Only
  frozen primitives (`placement`, `slot id`, manifest types) cross the
  shell boundary.

**Non-Goals:**

- Not redesigning the FLOWS subcard layout from scratch — just
  consolidating the status pill that was already implemented (badly
  placed) and the existing action buttons.
- Not adding new prompt placements beyond the existing
  `inline`/`widget-bar`/`overlay` enum.
- Not migrating subagent-state into the plugin (separate change
  already tracked as a follow-up).
- Not editing pi-flows source (cross-repo, tracked separately).

## Decisions

### Decision 1 — `MinimalChatView` for `FlowArchitectDetail`

The architect's detail view ports cleanly onto `MinimalChatView` because
the entries are already shaped like `MinimalChatEntry` (the architect
reducer captures the same tool/text/thinking entries as the flow agent
reducer). The shim:

```ts
const status = mapArchitectPhase(state.phase);
const entries = mapArchitectEntries(state.detailHistory);
const meta = {
  modelName: state.architectMode === "edit" ? "Edit" : "New",
  // No tokens/duration on architect today.
};
const footer = state.error
  ? <ErrorBlock text={state.error} />
  : undefined;
return <MinimalChatView title="Flow Architect" subtitle={state.flowName}
                        status={status} entries={entries} meta={meta}
                        mode="popout" onBack={onBack} footer={footer} />;
```

Phase → status mapping table:

| `state.phase` | `MinimalChatStatus` |
|---|---|
| `"context"`        | `running` |
| `"designing"`      | `running` |
| `"abort_pending"`  | `running` |
| `"complete"`       | `complete` |
| `"error"`          | `error` |
| any other          | `pending` |

The mode pill ("Edit" vs "New") plus iteration counter become the
`meta.modelName` slot — `MinimalChatView`'s header has space for one
right-aligned label, and the mode is the closest semantic fit.

### Decision 2 — Button sizing convention

Bump every expand/popout icon to `size={0.7}`. Add a `hidden sm:inline`
text label next to the icon. Use a contrasted background pill on hover
so the affordance reads clearly. This is purely cosmetic — the
underlying state machine doesn't change.

Sizing chosen by comparison with other prominent buttons in the
codebase: source-doc button is 0.45 (subtle), eye/popout deserve more
prominence because they unlock substantive views (full timeline +
popout tab). `0.7` lines up with the OpenSpec "Attach change" action
size that users already find clearly clickable.

### Decision 3 — Popout URL construction

Use `new URL(path, window.location.origin).toString()` to build an
absolute URL. URL-encode every variable segment:

```ts
const path = `/session/${encodeURIComponent(sessionId)}/flow/${encodeURIComponent(flowId)}/agent/${encodeURIComponent(agent.stepId)}`;
const url = new URL(path, window.location.origin).toString();
window.open(url, "_blank");
```

The encoding on `sessionId` is defensive — session ids today are
URL-safe slugs but we don't want a future change to break popouts.

Console-warn when the resulting URL is malformed (e.g. empty
`stepId` → trailing slash). Defensive logging only; no user-facing
error.

### Decision 4 — Architect popout URL pattern

Use `/session/:sid/architect`. No additional path segments — the
architect is per-session (only one architect can be running per
session). Same `sessionParam: "sid"` convention as the flow popout.

### Decision 5 — Move running-flow badge from WORKSPACE → FLOWS

Drop `{ slot: "session-card-badge", component: "FlowActivityBadgeClaim" }`
from the flows-plugin manifest. The `FlowActivityBadge` renderer stays;
its consumer changes:

- Before: `FlowActivityBadgeClaim` in `session-card-badge` slot (shell
  mounts the slot inside `WorkspaceSubcard`).
- After: `SessionFlowActions` renders `<FlowActivityBadge ... />` at
  the top of its output when `flowState` exists. `SessionFlowActionsClaim`
  already lives in the `session-card-flows` slot (FLOWS subcard).

Adds an `Abort` button when `flowState.status === "running"`. Click
sends `{ type: "flow_control", sessionId, action: "abort" }` via
`usePluginSend`.

### Decision 6 — Generic placement-aware suppression in shell

The shell's `SessionCard` currently has:

```ts
export function useHasFlowRoutedPrompt(sessionId: string): boolean {
  const requests = useSessionInteractiveRequests(sessionId);
  for (const req of requests) {
    if (req.status !== "pending") continue;
    const cmp = req.params._promptBusComponent as { type?: string } | undefined;
    if (cmp?.type === "flow-question") return true;  // HARDCODED
  }
  return false;
}
```

The literal `"flow-question"` couples the shell to one plugin's
component-type identifier. Fix: replace with the existing primitive
`isWidgetBarPrompt(componentType)` from
`@blackbelt-technology/dashboard-plugin-runtime`. The hook becomes:

```ts
// In dashboard-plugin-runtime/src/prompt-component-registry.ts
export function useHasWidgetBarPrompt(sessionId: string): boolean {
  const requests = useSessionInteractiveRequests(sessionId);
  for (const req of requests) {
    if (req.status !== "pending") continue;
    const cmp = req.params._promptBusComponent as { type?: string } | undefined;
    if (cmp?.type && isWidgetBarPrompt(cmp.type)) return true;
  }
  return false;
}
```

Now the shell only needs to know about `placement`, which is a frozen
primitive (`inline` | `widget-bar` | `overlay`). Any plugin that
registers a widget-bar-placed prompt automatically gets pulse
suppression — no shell-side change needed for future plugins.

### Decision 7 — ChatView widget-bar suppression

Add the same generic check to `ChatView`:

```tsx
{msg.role === "interactiveUi" && (() => {
  const cmp = msg.params?._promptBusComponent as { type?: string } | undefined;
  if (cmp?.type && isWidgetBarPrompt(cmp.type)) return null;
  return <InteractiveUiCard request={msg} onRespondToUi={...} />;
})()}
```

Side effects:

1. Fixes the double-render of flow-question prompts (slot + chat).
2. Hides any future widget-bar prompt from chat automatically.
3. Hides ANSWERED flow-question prompts from chat (they were the
   leakage path that prompted issue C3 — see Decision 8).

### Decision 8 — Flow-question history persistence in the slot

User reported: after a flow question is answered, the slot loses it
and chat is the only place that has it. With Decision 7, chat no
longer renders flow-question prompts at all. To keep the user's
ability to see what was answered, the slot transcribes:

`FlowQuestionsSection` rendering changes from "head of pending queue"
to "transcript of all flow-question prompts for the flow, with status
indicator":

- Pending head → full interactive card (input affordance shown).
- Non-pending (answered / cancelled / dismissed) → collapsed pill
  showing question + answer + status icon.

Per-flow scope: only prompts whose `_promptBusComponent.props.flowId`
matches the active flow tab. Order: insertion order (FIFO over the
session lifetime).

Keep the cap-of-N (most recent 10) so old transcripts don't accumulate
without bound. Configurable later if needed.

### Decision 9 — Debugging the empty upper slot during flow execution

User confirmed: "It does not render when flow runs! Only when architect!"
So `architectState` resolves correctly, but `flowState` (which gates
`FlowDashboardClaim`) does not after the architect transitions to flow
execution.

Approach:

1. Add console.debug instrumentation to `FlowDashboardClaim` (logging
   the `flowState`/`flowStates` shape every render).
2. Add console.debug to `reduceFlowsSessionState` (logging the events
   it processes per session).
3. Ask the user to reproduce and capture the console.
4. Based on console output, root-cause one of:
   - pi-flows isn't emitting `flow_started` for architect-spawned flows.
   - `flow_started` arrives but with a flowName that doesn't match the
     reducer's expectations.
   - `architectState` lingers and the slot consumer picks the
     architect claim over the dashboard claim.
   - The reducer logic for transitioning architect → flow has a bug.
5. Fix the root cause. Most likely fix is dashboard-side (reducer or
   claim gating), with cross-repo coordination only if the producer
   really isn't emitting.

This is the only task in the change that needs live debugging —
everything else is mechanical.

## Risks

| Risk | Mitigation |
|---|---|
| Moving the flow activity badge breaks muscle memory of users who learned the WORKSPACE location. | The FLOWS subcard is where users look for flow status. The WORKSPACE location was a bug. Briefly document in CHANGELOG. |
| Widget-bar suppression in chat hides prompts users might want to scroll back to. | Decision 8 — transcribe answered flow-questions in the slot. |
| `useHasFlowRoutedPrompt` rename breaks anyone importing it externally. | The export was never public; no external dep imports it (grep -rn confirmed it's only used in `SessionCard.tsx`). |
| C1 debug logging in production code. | Use `console.debug` (filterable) and wrap in a `import.meta.env.DEV` gate so production bundles ship without it. |

## Migration

One PR. All changes ship together. The architect popout claim adds
a new route — no migration needed since it's additive.

Rollback: revert the PR. All visual changes revert; popout URL
regresses to potentially-broken state. No data, no protocol surface
affected.
