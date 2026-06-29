# Improve flow graph dialog + card interaction

## Why

The post-flow `FlowSummary` (the `content-inline-footer` slot the flows plugin borrows) renders a **horizontal** DAG (`FlowGraph`, `rankdir: "LR"`), but its ⤢ Expand affordance opens the shell's `ui:dialog` primitive at `size="lg"` — a 512px-wide, `max-h-[80vh]` **vertical column** with an inner `height: "70vh"` scroll box. A wide graph squeezed into a tall column is unreadable: it renders narrow and over-tall, forcing vertical scroll across a horizontal layout. The `lg` ceiling (`max-w-lg`) is the limiting factor; the shell exposes no wider variant.

Separately, each `FlowAgentCard` carries two drill-ins — a `Popout` button (`window.open` → `/session/:sid/flow/:flowId/agent/:agentId` via the `shell-overlay-route` claim) and an eye `Details` button (anchored `Popover`). The popout opens a detached browser tab, fragments state, and needs URL plumbing (`popout-url.ts`, `FlowAgentPopoutClaim`, the route claim). The graph and the cards also have no shared selection — clicking a node tells you nothing about which card it maps to, and vice-versa.

Plugins only **borrow** shell slots + the UI-primitive registry; they cannot define chrome. So the dialog fix is a small additive shell change (new `Dialog` size variant) that the plugin then consumes; the rest is plugin-local.

## What Changes

- **Shell (`dialog-system`):** the `Dialog` primitive SHALL gain a `size="full"` variant mapping to `max-w-[95vw]` + `max-h-[92vh]` (near-fullscreen wide stage). Existing `sm`/`md`/`lg` and the `max-h-[80vh]` default are unchanged.
- **Graph expand (`flow-summary-view`):** the ⤢ Expand Dialog SHALL open at `size="full"` and let the non-`fit` (pan/zoom) `FlowGraph` fill it, dropping the inner `70vh` cap, so the horizontal DAG gets a wide horizontal stage.
- **Bidirectional highlight (`flow-summary-view`):** `FlowSummary` SHALL hold a `selectedStepId`. Clicking a graph node selects its step (node ring + accent glow) and scrolls the matching card into view; clicking a card selects its step (card ring/glow) and scrolls the matching node into view. Esc or re-clicking the selected element clears selection. Visual highlight only — no detail open from the big graph.
- **Card drill-in becomes a Dialog (`flow-agent-detail`):** the eye `Details` button SHALL open the agent detail in the shell's `ui:dialog` (vertical default size, which suits a detail column) instead of the anchored `Popover`. The Dialog body wraps `FlowAgentDetail` directly with the in-hand `agent` (the Dialog title supplies the header).
- **Remove popout + URL routing (`flow-agent-popout` REMOVED):** the `Popout` button, `popout-url.ts` (`buildFlowAgentPopoutUrl`, and `buildPopoutUrl` if unreferenced), the `shell-overlay-route` claim in `package.json`, `FlowAgentPopoutClaim`, and `FlowAgentPopoutPage` are all removed. Wrapping `FlowAgentDetail` directly makes the page (route lookup + empty-state ladder) dead code.
- **Decision update:** reading the code showed reusing `FlowAgentPopoutPage` as the Dialog body double-stacks headers (Dialog title + page back-bar) and needs a fabricated `{ flowStates }` session shape; wrapping `FlowAgentDetail` directly is cleaner and deletes the page.

## Capabilities

### Modified Capabilities
- `dialog-system`: adds a `full` size variant (`max-w-[95vw]` / `max-h-[92vh]`) alongside `sm`/`md`/`lg`.
- `flow-summary-view`: graph Expand opens the `full`-size Dialog with a pan/zoom graph; adds bidirectional graph⇄card selection highlight + scroll-into-view.
- `flow-agent-detail`: the card eye/Details affordance opens agent detail in a `ui:dialog` (replacing the anchored Popover), reusing the popout page body.

### Removed Capabilities
- `flow-agent-popout`: the popout button, popout URL builder, `shell-overlay-route` claim, and `FlowAgentPopoutClaim` are removed. The page body survives as the card Dialog body.

## Impact

- **Shell** `packages/client-utils/src/Dialog.tsx` — extend `DialogSize` + `SIZE_MAX_W` with `full`; apply `max-h-[92vh]` for `full`. Shared, additive; every plugin benefits.
- **Plugin** `packages/flows-plugin/src/client/FlowSummary.tsx` — graph Dialog `size="full"`, drop inner `70vh`; add `selectedStepId` state + highlight/scroll wiring; pass selection down to `FlowGraph` + `FlowAgentCard`.
- **Plugin** `packages/flows-plugin/src/client/FlowGraph.tsx` — accept `selectedStepId` + `onSelectStep`; render a `selected` node treatment (ring/glow) next to `flow-node-running`; node `data-node` already present.
- **Plugin** `packages/flows-plugin/src/client/FlowAgentCard.tsx` — remove Popout button + `handlePopout`/`popoutUrl`; accept `selected` + `onSelect` (card click toggles selection); open `Details` in `ui:dialog` (body = `FlowAgentDetail` directly); add `data-step`.
- **Plugin** `packages/flows-plugin/src/client/popout-url.ts` — delete `buildFlowAgentPopoutUrl` (and `buildPopoutUrl` if no other caller).
- **Plugin** `packages/flows-plugin/src/client/FlowAgentPopoutClaim.tsx` + `FlowAgentPopoutPage.tsx` — delete.
- **Plugin** `packages/flows-plugin/package.json` — remove the `shell-overlay-route` claim.
- **Tests:** `Dialog` full-variant size; `FlowSummary` selection sync (node→card, card→node, clear); `FlowAgentCard` has no Popout button + opens Dialog; `no-flow-references-in-shell` + popout tests updated/removed.
