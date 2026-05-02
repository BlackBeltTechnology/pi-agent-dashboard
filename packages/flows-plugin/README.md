# @blackbelt-technology/pi-dashboard-flows-plugin

Flow rendering plugin for pi-dashboard. Owns the React components and reducer slices that react to `flow_*` events emitted by the external `pi-flows` pi extension.

## Status

This package was extracted from `packages/client/` by the OpenSpec change `extract-flows-as-plugin`. The current shape is:

- **Reducer code** lives here (`src/flow-reducer.ts`, `src/architect-reducer.ts`, re-exported via `./reducer`).
- **React components** live here (`src/client/*.tsx`, re-exported via `./client`).
- **Shell wiring** still imports components directly from this package and mounts them in `App.tsx` / `SessionCard.tsx` JSX. Slot-consumer-based mounting is tracked as the follow-up change `migrate-flows-jsx-to-slots`.

The manifest (`pi-dashboard-plugin` field in `package.json`) declares the eventual slot claims. `session-card-badge` and `session-card-action-bar` are already wired through the slot consumers; richer slots (`content-header-sticky`, `content-view`, `content-inline-footer`) wait on either an extended slot prop contract or a self-deriving component refactor.

## Imports

- Reducer: `import { isFlowEvent, reduceFlowEvent, isArchitectEvent, reduceArchitectEvent } from "@blackbelt-technology/pi-dashboard-flows-plugin/reducer"`
- Components: `import { FlowDashboard, FlowAgentDetail, FlowArchitect, FlowSummary, FlowActivityBadge, SessionFlowActions, FlowLaunchDialog } from "@blackbelt-technology/pi-dashboard-flows-plugin/client"`
