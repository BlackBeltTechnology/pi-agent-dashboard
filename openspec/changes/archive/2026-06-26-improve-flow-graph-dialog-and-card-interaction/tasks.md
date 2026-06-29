# Tasks

## 1. Shell — Dialog `full` size variant

- [x] 1.1 Extend `DialogSize` with `"full"` and `SIZE_MAX_W.full = "max-w-[95vw]"` in `packages/client-utils/src/Dialog.tsx`; apply `max-h-[92vh]` when `size === "full"` (keep `max-h-[80vh]` for sm/md/lg)
- [x] 1.2 Update the `ui:dialog` primitive prop type (`UiDialogProps` / `DialogSize`) so plugins can pass `size="full"` through the registry
- [x] 1.3 Test: `Dialog` with `size="full"` applies `max-w-[95vw]` + `max-h-[92vh]`; existing sm/md/lg scenarios stay green

## 2. Plugin — graph Expand uses the full stage

- [x] 2.1 In `FlowSummary.tsx`, change the graph Dialog to `size="full"` and remove the inner `<div style={{ height: "70vh" }}>` cap; render the non-`fit` (pan/zoom) `FlowGraph` so it fills the dialog
- [x] 2.2 Test: graph Dialog opens at full size; the expanded `FlowGraph` is pan/zoom-enabled (not `fit`)

## 3. Plugin — bidirectional graph⇄card highlight

- [x] 3.1 Add `selectedStepId` state + `setSelectedStepId` to `FlowSummary`; clear on Esc and when `flowState.agents` identity changes
- [x] 3.2 `FlowGraph`: accept `selectedStepId` + `onSelectStep`; add a `selected` node visual (ring + accent glow) parallel to `flow-node-running`; node click calls `onSelectStep` (toggle)
- [x] 3.3 `FlowAgentCard`: accept `selected` + `onSelect`; apply `card-ring-fx`/`card-glow-fx` when selected; card click calls `onSelect` (toggle); add `data-step={stepId}`
- [x] 3.4 `FlowSummary`: on select, `scrollIntoView({ block: "nearest" })` the matching `[data-node]` / `[data-step]` element on the *other* surface within the summary's bounded region
- [x] 3.5 Test: click node → card gets `selected` + scrolled; click card → node gets `selected` + scrolled; Esc / re-click clears

## 4. Plugin — card detail opens in a Dialog (replace Popover)

- [x] 4.1 In `FlowAgentCard.tsx`, replace the eye-button anchored `Popover` with `useUiPrimitive(ui:dialog)`; open `<Dialog title={displayName}>` (default size) wrapping `FlowAgentDetail` directly (in-hand `agent`); map `onBack` → `onClose`
- [x] 4.2 (REVISED) Card click toggles selection via `onSelect`; Details button stops propagation so it opens the dialog without also toggling selection
- [x] 4.3 Test: clicking Details opens a Dialog containing the agent timeline; closing via Esc/overlay works

## 5. Plugin — remove popout + URL routing

- [x] 5.1 Remove the `Popout` button, `handlePopout`, `popoutUrl`, `popoutEnabled` from `FlowAgentCard.tsx`; drop the `buildFlowAgentPopoutUrl` import
- [x] 5.2 Delete `popout-url.ts` `buildFlowAgentPopoutUrl`; grep for `buildPopoutUrl` callers — delete it too if unreferenced, else keep
- [x] 5.3 Remove the `shell-overlay-route` claim from `packages/flows-plugin/package.json`
- [x] 5.4 Delete `FlowAgentPopoutClaim.tsx` AND `FlowAgentPopoutPage.tsx` (now dead — route gone, dialog wraps `FlowAgentDetail`); remove their exports from `index.tsx`
- [x] 5.5 Remove/repoint popout tests (none existed; shell-overlay-route-match test uses self-contained fixtures, untouched) (`FlowAgentPopoutPage.test`, popout-url tests); update `no-flow-references-in-shell` if it referenced the route

## 7. Follow-up polish (single-window detail + dialog drill-ins)

- [x] 7.1 Shell `Dialog`: add `flush?: boolean` (drop `p-5 space-y-4`, use `overflow-hidden`) + extend `UiDialogProps`; tests for flush vs non-flush
- [x] 7.2 Agent-detail dialog: open `flush` + no `title` so `MinimalChatView`'s own header is the single window header (kills window-in-window)
- [x] 7.3 `FlowAgentCard` source viewer: `ui:popover` → `ui:dialog` (title = filename, padded); drop now-unused `Popover`/`useRef`
- [x] 7.4 `FlowYamlPopoverButton`: `ui:popover` → `ui:dialog` (title = `<flowName> · YAML`, padded); drop `useRef`

## 6. Verify

- [x] 6.1 `npm test` green for touched suites (Dialog, FlowSummary, FlowAgentCard, FlowGraph — 122 pass). 9 repo-wide failures are pre-existing + unrelated (`pi-ai-shape` version-skew, docker-gated port test); none import changed files. `tsc` clean for flows-plugin + client-utils; `npm run build` succeeds end-to-end.
- [x] 6.2 `npm run build` succeeds (client + plugins + regenerated plugin-registry). Live deploy (`/api/restart` + `npm run reload`) + visual confirm left as the user's deploy step per AGENTS.md full-rebuild flow.
- [x] 6.3 `openspec validate improve-flow-graph-dialog-and-card-interaction --strict` → valid
