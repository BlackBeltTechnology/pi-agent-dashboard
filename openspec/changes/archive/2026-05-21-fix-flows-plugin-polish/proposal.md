# fix-flows-plugin-polish

## Why

Polish sweep covering issues that surfaced after `add-flow-agent-popout` and
`route-flow-asks-to-upper-slot` landed:

- `FlowArchitectDetail` still ships its own copy of `ToolCallEntry`,
  `TextEntry`, `ThinkingEntry`, and `extractInputPreview`. The expanded
  architect view therefore does not look like the rest of the agent timelines
  (which use `MinimalChatView`). `extract-minimal-chat-view` deliberately
  scoped only `SubagentDetailView` and `FlowAgentDetail`; the architect is
  the remaining duplicate.
- The expand-detail (eye) and popout (open-in-new) buttons on `FlowAgentCard`
  and `FlowArchitect` are too small (~12 px icons, no label). Users miss
  them.
- The popout button on `FlowAgentCard` opens `about:blank` in some
  configurations. Root cause: `agent.stepId` is not URL-encoded and the URL
  is path-only (browsers handle this inconsistently). A defensive fix
  resolves the URL against `window.location.origin` and encodes every
  variable segment.
- `FlowArchitect` has no popout button, but the same monitoring use case
  (keep the architect open in a tab while continuing in the parent session)
  applies. Adds parity via a new `shell-overlay-route` claim and page.
- `FlowActivityBadgeClaim` is registered against `session-card-badge`, which
  the shell mounts inside the WORKSPACE subcard. The flow status badge
  therefore shows under WORKSPACE — wrong subcard. The correct home is the
  FLOWS subcard (`session-card-flows` slot). Once moved, the running-flow
  status pill lives next to the Run / New / Edit / Delete action buttons.
- The FLOWS subcard currently shows ONLY action buttons. When a flow is
  running, there is no in-card indicator showing "▶ custom:test (running)
  with N/M agents". The user can see flow activity only via the badge
  (which currently renders in the wrong subcard) or via the upper slot
  (which has its own bug — see below).
- The shell hardcodes the literal string `"flow-question"` in
  `SessionCard.tsx` (`useHasFlowRoutedPrompt`) to suppress the purple
  ask_user pulse for flow-routed prompts. This couples the shell to one
  plugin's component-type identifier. The fix is to replace it with the
  generic `isWidgetBarPrompt(componentType)` placement check that already
  exists in `dashboard-plugin-runtime`'s prompt-component registry — any
  plugin that registers a widget-bar-placed prompt automatically gets pulse
  suppression, with no shell-side knowledge of plugin specifics.
- The chat view (`ChatView`) does not suppress widget-bar-placed prompts at
  all. Every `interactiveUi` row renders inline regardless of placement. As
  a result, flow-question prompts render BOTH in the upper slot (`FlowQuestionCard`)
  AND inline in chat — double-render, plus the chat copy is the only one
  that survives after the prompt is answered (the slot only renders pending
  heads).
- During flow EXECUTION (after the architect finishes), the upper-slot
  FlowDashboard slot is empty even though agents are running. The architect
  upper slot worked fine during the architect phase. This is a state /
  reducer bug: the flow's `flowState` does not resolve via
  `useFlowsSessionState` even though `flow_*` events should be flowing.
  Needs diagnostic logging + actual fix.

All fixes belong in the flows plugin or in shared / runtime primitives.
The shell SHALL NOT learn any new plugin-specific identifiers — every
change in `packages/client/` swaps a plugin literal for a placement-based
generic primitive.

## What Changes

### Group A — Plugin-internal fixes (all in `flows-plugin/`)

- **A1. FlowArchitect → MinimalChatView shim**: rewrite
  `FlowArchitectDetail` to map `ArchitectState` onto `MinimalChatView`
  props. Drop the inline `ToolCallEntry` / `TextEntry` / `ThinkingEntry`
  / `extractInputPreview` helpers. Status mapping table:
  - `phase: "context" | "designing"` → `running`
  - `phase: "complete" | "abort_pending"` → `complete`
  - `phase: "error"` → `error`
  - any other → `pending`
  The inline status icon (`mdiLoading` for active / `◇` glyph) is
  replaced by the shared status visuals; the "Edit" / "New" mode pill
  and the iteration counter move to `MinimalChatView`'s `meta.modelName`
  slot.
- **A2. Bigger expand/popout buttons**: in `FlowAgentCard.tsx` and the
  agent-card section of `FlowArchitect.tsx`, bump icon size from 0.45/0.5
  to 0.7. Add visible "Details" text label next to the eye icon and
  "Popout" next to the open-in-new icon (hidden on narrow viewports via
  `hidden sm:inline`). Use a contrasted background pill on hover so the
  affordance reads clearly.
- **A3. Popout URL hardening**: in `FlowAgentCard.tsx`, build the popout
  URL via `new URL(path, window.location.origin).toString()`. URL-encode
  every path segment containing variable user data (`sessionId`, `flowId`,
  `agent.stepId`). Defensive: log a console warning when the URL fails
  to construct (e.g. empty `stepId`).
- **A4. FlowArchitect popout**: add a popout button to the architect's
  upper-slot rendering AND inside the expanded popover. Click opens
  `/session/:sid/architect` in a new tab. New files:
  - `flows-plugin/src/client/FlowArchitectPopoutPage.tsx` — body component
    (chrome header + `FlowArchitectDetail` in popout mode + empty states).
  - `flows-plugin/src/client/FlowArchitectPopoutClaim.tsx` — slot claim
    wrapper (reads `useFlowsSessionState(params.sid).architectState`,
    cold-open subscribe, renders the page).
  - Manifest claim:
    `{ slot: "shell-overlay-route", component: "FlowArchitectPopoutClaim", config: { path: "/session/:sid/architect", sessionParam: "sid" } }`.
- **A5. Move flow activity badge from WORKSPACE → FLOWS subcard**: remove
  `{ slot: "session-card-badge", component: "FlowActivityBadgeClaim" }`
  from `flows-plugin/package.json`. Embed the same badge content
  (`FlowActivityBadge`) inside `SessionFlowActions` (which is what
  `SessionFlowActionsClaim` renders into the `session-card-flows` slot).
  Show it ABOVE the Run / New / Edit / Delete action button row, only
  when `flowState` exists. The standalone `FlowActivityBadgeClaim`
  component goes away (its renderer `FlowActivityBadge` remains and is
  consumed by `SessionFlowActions`).
- **A6. Abort affordance inside the FLOWS-subcard status pill**: when
  the pill shows a `running` flow, append a small "Abort" button. Click
  sends `{ type: "flow_control", sessionId, action: "abort" }` via
  `usePluginSend`.

### Group B — Shell decoupling (plugin-agnostic primitives)

- **B1. Drop `useHasFlowRoutedPrompt` from `packages/client/`**. Replace
  every call site with a generic `useHasWidgetBarPrompt(sessionId)` hook
  exported from `@blackbelt-technology/dashboard-plugin-runtime`. The
  hook reads `useSessionInteractiveRequests(sessionId)` and tests each
  pending request via `isWidgetBarPrompt(componentType)` from the
  prompt-component registry. The shell now suppresses the purple
  `card-input-pulse` and the "Waiting for input" activity label whenever
  the pending prompt is widget-bar-placed — not just when it's
  specifically `"flow-question"`. Any plugin that registers a widget-bar
  prompt gets the suppression automatically.
- **B2. Chat suppression for widget-bar prompts**: in `ChatView.tsx`,
  the inline render of `<InteractiveUiCard>` for a message of role
  `interactiveUi` SHALL skip rendering when the request's params encode
  a widget-bar component (`isWidgetBarPrompt(params._promptBusComponent?.type)`).
  Generic: shell only knows about `placement` (a frozen primitive
  contract from the registry), not about specific plugins. Side effect:
  fixes the current double-render of flow-question prompts.

### Group C — Investigation + design

- **C1. FlowDashboard upper slot empty during flow execution**: confirmed
  by the user: architect upper slot renders fine; after architect finishes
  and the flow starts, the upper slot is empty. Root cause unknown. Add
  diagnostic console logging to `FlowDashboardClaim` and to
  `useFlowsSessionState`'s memo, capture the user's browser output, then
  fix. Hypotheses:
  - `flow_started` not being emitted by pi-flows for architect-launched
    flows (only for `/flows:run` invocations).
  - `flow_started` arriving with a flow name that doesn't match what the
    architect emits, so reducer creates a separate state slot that
    `useFlowsSessionState` doesn't surface.
  - `architectState` still present after flow start, and the slot
    consumer picks the architect claim first (both are
    `content-header-sticky` claimers).
- **C3. Flow-question history**: when a flow-question is answered, it
  currently disappears from the slot AND appears in chat history. The
  user wants the slot to remain the single source of truth — answered
  questions show as collapsed cards in the slot (a transcript), and chat
  suppresses ALL widget-bar-placed prompts (pending or resolved). B2
  already handles the chat side. The slot side needs `FlowQuestionsSection`
  to render the full per-flow queue (pending + recent answered) as a
  collapsible transcript.

## Capabilities

### New Capabilities

- `flows-running-status-pill`: A status pill rendered inside the FLOWS
  subcard (NOT WORKSPACE) for any session with an active flow. Includes
  flow name, agent counts (done/total), status icon (animated spinner
  when running), and an Abort button when status === "running". The
  consumer is `SessionFlowActionsClaim`; the slot is `session-card-flows`.
- `flow-architect-popout`: Fullscreen popout page for the in-flight
  architect at `/session/:sid/architect`. Registered as a
  `shell-overlay-route` claim by the flows plugin. Renders
  `FlowArchitectDetail` in popout mode with a chrome header carrying
  back-nav and breadcrumb. Four-state empty ladder (subscription pending
  → no session → no architect active → resolved-and-rendered).

### Modified Capabilities

- `shared-timeline-view`: clarification that `FlowArchitect` is now also
  a consumer (shim) of `MinimalChatView`. No requirement-level changes;
  the existing scenarios continue to apply.
- `flow-question-routing`: ADD a requirement that chat (`ChatView`) SHALL
  suppress every `interactiveUi` row whose resolved placement is
  `widget-bar` (not just `flow-question`). The shell SHALL use the
  prompt-component registry's `isWidgetBarPrompt(componentType)` for
  this check — never a hardcoded component-type literal. The slot side
  is unchanged.
- `ask-user-card-indicator`: GENERALIZE the suppression rule from
  "specifically `flow-question`" to "any widget-bar-placed prompt".
  Plugin-agnostic.

## Impact

**Affected code (plugin-internal)**

- `packages/flows-plugin/package.json` — drop `session-card-badge` claim;
  add `shell-overlay-route` claim for the architect popout.
- `packages/flows-plugin/src/client/FlowArchitect.tsx` — rewrite
  `FlowArchitectDetail` as a `MinimalChatView` shim; delete inline
  helpers; bump button sizes; add popout button.
- `packages/flows-plugin/src/client/FlowArchitectPopoutPage.tsx` — NEW.
- `packages/flows-plugin/src/client/FlowArchitectPopoutClaim.tsx` — NEW.
- `packages/flows-plugin/src/client/FlowAgentCard.tsx` — bump button
  sizes; harden popout URL; add visible labels next to icons.
- `packages/flows-plugin/src/client/SessionFlowActions.tsx` — render the
  flow status pill at top when `flowState` exists; include abort button.
- `packages/flows-plugin/src/client/FlowActivityBadge.tsx` — keep the
  `FlowActivityBadge` renderer; remove the `FlowActivityBadgeClaim`
  export (or repoint it at the FLOWS slot if a parallel claim is still
  wanted). Decision: remove the claim; `SessionFlowActions` renders the
  badge directly.
- `packages/flows-plugin/src/client/index.tsx` — exports the new claim
  components; drops the dropped claim.

**Affected code (shell decoupling)**

- `packages/client/src/components/SessionCard.tsx` — replace
  `useHasFlowRoutedPrompt` with the new `useHasWidgetBarPrompt` imported
  from `dashboard-plugin-runtime`. No hardcoded plugin component types
  remain.
- `packages/client/src/components/ChatView.tsx` — gate
  `InteractiveUiCard` render with `!isWidgetBarPrompt(componentType)`.
- `packages/dashboard-plugin-runtime/src/prompt-component-registry.ts` —
  add `useHasWidgetBarPrompt(sessionId)` hook that consumes
  `useSessionInteractiveRequests` and tests each pending request via
  `isWidgetBarPrompt`.

**APIs / protocols**

- No on-the-wire changes.
- One new shell-overlay-route URL: `/session/:sid/architect`.

**Tests**

- Unit: `MinimalChatView` mapping for `ArchitectState`.
- Unit: `FlowArchitectPopoutClaim` empty-state branches.
- Unit: popout URL construction tolerates special characters in `stepId`.
- Unit: `useHasWidgetBarPrompt` returns true for flow-question and false
  for generic-dialog.
- Component test: `ChatView` skips `InteractiveUiCard` rendering for
  widget-bar prompts.
- Manifest validator: `flows-plugin` manifest now has the
  shell-overlay-route claim for `/session/:sid/architect`.

**Risks**

- (A5) Removing `FlowActivityBadgeClaim` from `session-card-badge` changes
  visual location of an existing UI element. Users get used to it, then
  it moves. Mitigated by: the FLOWS subcard is where users look for flow
  status; the WORKSPACE placement was the bug.
- (B2) Suppressing widget-bar prompts in chat is correct but invisible
  if the slot side fails to render (e.g. the FlowDashboard upper-slot
  bug from C1). Until C1 is fixed, a widget-bar prompt could be
  invisible to the user. Mitigation: ship C1 fix together with B2.
- (C1) Without a fix for the upper-slot empty bug, B2 risks dropping
  user-visible prompts. The PR ships C1 BEFORE B2 to avoid this.

**Backward compatibility**

- Plugins without widget-bar claims are unaffected.
- The `useHasFlowRoutedPrompt` export from `SessionCard.tsx` was a private
  shell hook; replacing it is internal.
- `FlowActivityBadgeClaim` is removed; no other plugin imports it.
