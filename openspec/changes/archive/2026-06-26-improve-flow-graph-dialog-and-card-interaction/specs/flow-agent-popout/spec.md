# flow-agent-popout delta

The flow agent popout is removed entirely. Card drill-in moves to the in-shell
agent-detail dialog (see `flow-agent-detail` delta), which wraps
`FlowAgentDetail` directly. The popout's only unique capability — a detached
browser tab / deep link — is intentionally dropped in favor of single-surface
consistency. `FlowAgentPopoutPage` is deleted: its route lookup + empty-state
ladder served only the standalone URL, which no longer exists.

## REMOVED Requirements

### Requirement: Popout button on every flow agent card

**Reason:** Replaced by the single Details→Dialog drill-in. The `Popout`
button, `handlePopout`, and `popoutUrl`/`popoutEnabled` are removed from
`FlowAgentCard`.

### Requirement: Flows plugin claims the popout route via `shell-overlay-route`

**Reason:** The popout URL no longer exists; the `shell-overlay-route` claim is
removed from `packages/flows-plugin/package.json`, returning the borrowed slot.
`buildFlowAgentPopoutUrl` (and `buildPopoutUrl` if unreferenced) is deleted from
`popout-url.ts`.

### Requirement: FlowAgentPopoutClaim is self-contained

**Reason:** No route claims the popout, so the claim wrapper is deleted along
with its `index.tsx` export. Cold-open subscription is unnecessary — the card
dialog renders inside an already-subscribed session.

### Requirement: Popout coexists with the eye-button popover

**Reason:** Both surfaces are gone — the popout is removed and the eye-button
popover is replaced by the agent-detail dialog. Coexistence no longer applies.

### Requirement: Popout page renders flow agent timeline in fullscreen

**Reason:** `FlowAgentPopoutPage` is deleted. The agent timeline now renders
via `FlowAgentDetail` inside the card's `ui:dialog`, not a fullscreen route page.

### Requirement: Popout page handles four empty-state branches

**Reason:** The loading / no-session / no-flow / no-agent ladder existed only to
handle a cold-loaded route URL. With the route removed and the card holding the
`agent` directly, the ladder is dead code and is deleted with the page.
