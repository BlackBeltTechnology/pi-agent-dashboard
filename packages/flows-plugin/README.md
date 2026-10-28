# @blackbelt-technology/pi-dashboard-flows-plugin

Flow rendering plugin for pi-dashboard. Owns the React components and reducer slices that react to `flow_*` events emitted by the external `pi-flows` pi extension.

## Status

This package was extracted from `packages/client/` by the OpenSpec change `extract-flows-as-plugin`. The current shape is:

- **Reducer code** lives here (`src/flow-reducer.ts`, `src/architect-reducer.ts`, re-exported via `./reducer`).
- **React components** live here (`src/client/*.tsx`, re-exported via `./client`).
- **Shell wiring** still imports components directly from this package and mounts them in `App.tsx` / `SessionCard.tsx` JSX. Slot-consumer-based mounting is tracked as the follow-up change `migrate-flows-jsx-to-slots`.

The manifest (`pi-dashboard-plugin` field in `package.json`) declares the eventual slot claims. `session-card-badge` and `session-card-action-bar` are already wired through the slot consumers; richer slots (`content-header-sticky`, `content-view`, `content-inline-footer`) wait on either an extended slot prop contract or a self-deriving component refactor.

## Claude subscription compat (bridge)

The bridge (`src/bridge/`) also owns the Claude subscription compat rewrite. When the dashboard's compat switch is on and a run uses the `anthropic` provider, it replaces "pi itself" and "pi packages" in pi's built-in `docs` prompt section with "the cli itself" and "cli packages". It does this for the main session (`before_agent_start`) and for pi-flows agents (via `flow:register-agent-extension`). It never renames tools and never replaces the whole prompt. It works with pi-flows 0.8.0 and later.

## Imports

- Reducer: `import { isFlowEvent, reduceFlowEvent, isArchitectEvent, reduceArchitectEvent } from "@blackbelt-technology/pi-dashboard-flows-plugin/reducer"`
- Components: `import { FlowDashboard, FlowAgentDetail, FlowArchitect, FlowSummary, FlowActivityBadge, SessionFlowActions, FlowLaunchDialog } from "@blackbelt-technology/pi-dashboard-flows-plugin/client"`
