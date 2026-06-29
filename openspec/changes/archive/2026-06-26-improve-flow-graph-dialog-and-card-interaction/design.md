# Design

## Context

The flows plugin borrows shell slots; it does not own UI chrome. The `FlowSummary` widget (borrowed `content-inline-footer` slot) hosts a horizontal `FlowGraph` (`rankdir: "LR"`) plus a frozen `FlowAgentCard` grid (added by `show-flow-cards-in-summary`). Both drill-ins (graph Expand, card Details) consume shell primitives via the UI-primitive registry: `ui:dialog` for the graph, `ui:popover` for the card detail. The popout path additionally borrows the `shell-overlay-route` slot.

## Goals / Non-Goals

**Goals**
- Graph Expand opens a wide, near-fullscreen stage that fits a horizontal DAG.
- One drill-in per card (Dialog), not two (popout + popover).
- Shared selection: graph node ⇄ card stay visually in sync.

**Non-Goals**
- No flow engine, reducer, protocol, or event changes — `flowState.agents` already persists post-completion.
- No new modal/portal machinery in the plugin — reuse `ui:dialog`.
- No cross-tab / deep-link behavior (that was the popout's only unique capability; intentionally dropped).
- Big-graph node click does NOT open detail (highlight only).

## Decisions

### D1 — Dialog `full` variant lives in the shell, not the plugin
Plugins consume `ui:dialog` through the registry and cannot widen it. So `size="full"` is added to `packages/client-utils/src/Dialog.tsx` (`SIZE_MAX_W.full = "max-w-[95vw]"`, and `full` applies `max-h-[92vh]` instead of `max-h-[80vh]`). `sm`/`md`/`lg` + the `80vh` default are untouched. The plugin then passes `size="full"` only for the graph. Reusable by any plugin; minimal blast radius.
- *Alternative rejected:* a plugin-private full-bleed overlay — reinvents portal/Esc/focus-trap, violates the borrow rule.

### D2 — Selection state owned by FlowSummary
`selectedStepId: string | null` lives in `FlowSummary`, the common parent of graph + grid. Both children get the current selection + a setter:
- `FlowGraph` gains `selectedStepId` + `onSelectStep(id)`. Node `<g>` already carries `data-node={id}` for scroll targeting; add a `selected` visual branch (ring + accent glow) parallel to `flow-node-running`.
- `FlowAgentCard` gains `selected` (already a prop) + `onSelect(stepId)`. Reuse the session-card `card-ring-fx`/`card-glow-fx` treatment for consistency.
- Click toggles (re-click clears); Esc clears. Selecting scrolls the *other* surface's element into view (`scrollIntoView({ block: "nearest" })`) keyed by `data-node` / a card `data-step` attribute.
- Selection is ephemeral UI state — not persisted, resets when steps change.

### D3 — Card detail Dialog wraps FlowAgentDetail directly (REVISED during apply)
Reading the code reversed the original choice. `FlowAgentPopoutPage` is a *route* wrapper: it adds its own header (title + back button) and a 4-branch empty-state ladder that exists only to look a flow/agent up from `session.flowStates` on a cold-loaded URL. Inside a `ui:dialog` (which already renders a title header) that produces a double header, and the card would have to fabricate a `{ flowStates }` shape to feed a lookup it does not need — it already holds the `agent`. So the card's eye button opens `<Dialog size={default} title={agentName}>` wrapping `FlowAgentDetail` directly (`onBack` → `onClose`). Vertical default size is correct — a detail view is a tall column, unlike the graph.
- *Consequence:* `FlowAgentPopoutPage` becomes dead code once the route is gone, so it is deleted (not repurposed).
- *Alternative rejected:* reuse the page as the body — double header + fabricated session shape, no upside.

### D4 — Popout removal is plugin-local
Removing popout returns the borrowed `shell-overlay-route` slot (drop the `package.json` claim) and deletes plugin-owned helpers (`popout-url.ts`, `FlowAgentPopoutClaim`). The shell's route *system* is untouched. Verify `buildPopoutUrl` has no other caller before deleting it; if shared, keep it and only remove `buildFlowAgentPopoutUrl`.

## Risks / Trade-offs

- **Lost cross-tab drill-in.** Popout could live in its own browser tab; the Dialog cannot. Accepted — single-surface consistency was the ask.
- **`max-w-[95vw]` on very large monitors.** A 95vw graph stage is huge but that is the explicit "VERY BIG" intent; pan/zoom keeps it navigable.
- **Selection + scroll on a two-row wrapped grid.** `scrollIntoView` must target the scroll container, not the page; verify within the summary's bounded region.
- **Shared-primitive change.** Adding a `Dialog` size is additive and covered by `dialog-system` scenarios; low risk but must keep existing variant scenarios green.

## Open Questions

- None blocking. (`buildPopoutUrl` caller check is a task, not a design fork.)
