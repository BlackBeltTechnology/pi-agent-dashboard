## Context

Flow rendering is the dashboard's reaction to `flow_*` events emitted by the external `pi-flows` extension. Today that reaction is hard-wired into the client shell across 12 components and 2 reducers (~250 LOC of conditional rendering in `App.tsx`, plus direct imports in `SessionCard.tsx`). The umbrella change `dashboard-plugin-architecture` introduces a slot taxonomy and a plugin loader; the runtime change `add-dashboard-shell-slots-runtime` lands the loader and slot consumer components. This change consumes both to relocate every flow-rendering file into a first-class plugin package and remove flow-specific knowledge from the shell.

**Scope**: client UI + reducer slice only. There is no server entry (flow events are forwarded by the existing `event-wiring.ts` server module without any flow-specific logic) and no bridge entry (pi-flows is its own pi extension, owned upstream).

**Dependencies**:
- `dashboard-plugin-architecture` (archived 2026-04-26) — slot taxonomy frozen, plugin manifest schema defined.
- `packages/dashboard-plugin-runtime/` — `<ContentViewSlot/>`, `<ContentHeaderStickySlot/>`, `<ContentInlineFooterSlot/>`, `<SessionCardBadgeSlot/>`, `<SessionCardActionBarSlot/>` components already exist and are mounted in `App.tsx` as additive co-tenants (see comment at `App.tsx:978` — `Plugin slot: content-header-sticky (additive, coexists with FlowDashboard until extract-flows-as-plugin)`).

**Important non-dependency**: this change does NOT depend on a `pluginContext.registerReducerSlice` API. An earlier draft proposed one; investigation showed the archived plugin-architecture specs never introduced it, and inventing it now would expand the scope of this change significantly. Instead, flow reducers are imported into `event-reducer.ts` at compile time from the `flows-plugin` workspace package — see Decision 2 below.

**Stakeholders**: dashboard maintainers (App.tsx + SessionCard.tsx surface area), flow plugin author (will own `packages/flows-plugin/` going forward), test suite owners (~30 test files paths shift).

## Goals / Non-Goals

**Goals:**
- Move all 12 flow-rendering files + 2 reducers from `packages/client/src/` into `packages/flows-plugin/client/` using `git mv` to preserve history.
- Replace ~250 LOC of conditional rendering in `App.tsx` with slot consumers.
- Replace direct imports in `SessionCard.tsx` with slot consumers.
- Delegate every `flow_*` event from `event-reducer.ts` to a plugin-registered reducer slice.
- Ensure the dashboard builds, runs, and passes tests with `flows-plugin` disabled (no flow dashboard, no agent cards, no architect view, no badges, no summary).
- Preserve sticky-header stacking order (architect on top, flow dashboard below) when both states are active.

**Non-Goals:**
- Touching the `pi-flows` pi extension itself (separate repo, separate ownership).
- Modifying the wire format of `flow_*` events (`packages/shared/src/browser-protocol.ts` flow types stay where they are; the plugin imports the existing types).
- Server-side changes beyond import path updates (no new REST routes, no new event types, no new persistence).
- Bundling-vs-not policy decisions for flows-plugin (covered by `add-dashboard-shell-slots-runtime` "bundled-by-default" concept).
- Changing the user-visible flow UI (this is a refactor; the rendered output must be pixel-identical pre/post).

## Decisions

### Decision 1: `flowState` and `architectState` stay on the same `SessionState` shape

Both reducer slices continue to write to the same `SessionState` object (not an isolated plugin-local store). Rationale:
- Sibling code (mobile shell, session card) already reads `session.flowState` and `session.architectState` for decision-making (e.g. "is there a flow running?" → show badge). Splitting state into a plugin-local store would force every consumer through `usePluginConfig` or similar, multiplying the refactor surface.
- The umbrella's "full state" decision (resolved open question #1 in `dashboard-plugin-architecture/design.md`) explicitly endorses plugins writing to the central state for now, with sliced state deferred until usage stabilizes.

**Alternative considered**: plugin-local Zustand store accessed via `usePluginState`. Rejected because slot consumers already receive `SessionState` as a prop (`SlotProps<"content-header-sticky">` includes `session: Session`); pulling out a parallel store doubles the wiring without benefit at this stage.

### Decision 2: Compile-time import from the workspace package, not a runtime extension API

`packages/client/src/lib/event-reducer.ts` currently does:
```ts
import { isFlowEvent, reduceFlowEvent } from "./flow-reducer.js";
import { reduceArchitectEvent, isArchitectEvent } from "./architect-reducer.js";
```

After this change, the import paths point at the plugin's workspace package:
```ts
import { isFlowEvent, reduceFlowEvent, isArchitectEvent, reduceArchitectEvent }
  from "@blackbelt-technology/pi-dashboard-flows-plugin/reducer";
```

The `flows-plugin/package.json` declares an `exports` map exposing `./reducer` (pointing at the moved `flow-reducer.ts` + `architect-reducer.ts` re-export barrel). `packages/client/package.json` adds `@blackbelt-technology/pi-dashboard-flows-plugin` as a workspace dependency. No new runtime API. No plugin-context changes. The reducer's outward contract is unchanged.

**Why not a runtime registration API?**
- The archived `dashboard-plugin-architecture` plugin-context surface (`useSessionState`, `useAllSessions`, `usePluginConfig`, `send`, `pluginRouter`, `pluginLogger`) does **not** include `registerReducerSlice`. Inventing it here would add: a registry, deterministic ordering rules, manifest validation (no two plugins claim the same event type), a load-time-vs-runtime registration question, lifecycle (when does the plugin's client entry execute relative to the first event?), and a host of edge cases. None of that pays off until a *second* plugin wants to add new event types — which today is purely speculative.
- For the dashboard's bundled-by-default plugin model, compile-time import is sufficient and significantly simpler to reason about. The reducer code physically lives in the plugin package, can be tested in isolation, and is owned by the plugin author. Disabling the plugin via config doesn't unload the reducer (events still mutate `flowState` if they arrive), but no UI consumes that state, so the user sees no flow output. Acceptable for v1.
- A future change can introduce a runtime slice API once a real second consumer surfaces (e.g. an external `node_modules/*` plugin that emits its own event types). Spec'd as `add-plugin-reducer-slice-api` if/when needed.

**Alternative considered**: keep the reducer files in `packages/client/src/lib/` and move only the UI components. Rejected because (a) the plugin should *own* its reducer for code-locality reasons (changes to flow event handling shouldn't require touching `packages/client/`), (b) future tests live with the code under test (the existing `flow-reducer.test.ts` moves alongside its subject), (c) it leaves a half-extracted plugin which is worse than either fully-in or fully-out.

### Decision 3: Sticky header stacking via slot multiplicity

The `content-header-sticky` slot supports multiple concurrent contributions (frozen multiplicity in the slot taxonomy). The plugin contributes two claims:
- `FlowArchitect` with `predicate: (s) => s.architectState != null` and `priority: 10`.
- `FlowDashboard` with `predicate: (s) => s.flowState != null` and `priority: 20`.

Lower-priority renders first (top of stack). Today's `App.tsx` renders architect above flow dashboard; the priority assignment preserves that order. The slot consumer renders both stacked vertically with no extra spacing (today's behavior is `<div>` siblings inside the sticky container).

**Alternative considered**: a single composite component that owns both. Rejected because it forces a hard-coded couple between architect and flow lifecycles inside one render tree, which is exactly what the plugin model is meant to eliminate.

### Decision 4: `FlowYamlPreview`, `FlowAgentDetail`, `FlowArchitectDetail` claim `content-view` routes

These three are full-page content views opened from a flow card / agent card / architect card. The plugin claims:
- `content-view` route `flow-yaml/:flowName` → `FlowYamlPreview`
- `content-view` route `flow-agent-detail/:agentId` → `FlowAgentDetail`
- `content-view` route `architect-detail` → `FlowArchitectDetail`

Routes encode the parameters needed by each view. Navigation goes through `pluginRouter.push(route)` (provided by `add-dashboard-shell-slots-runtime`) instead of the legacy `setActiveView` callback that App.tsx currently passes around.

**Alternative considered**: keep `setActiveView` and have plugins push string ids into it. Rejected because every plugin would need to coordinate string ids with the shell's hard-coded `ActiveView` union; route-based dispatch is the slot model's intended pattern.

### Decision 5: `FlowSummary` as `content-inline-footer`

`FlowSummary` is a post-completion banner rendered below the chat (currently inside `App.tsx`). The plugin claims `content-inline-footer` with `predicate: (s) => s.flowState?.status === "complete" || s.flowState?.status === "error"`. Multiple inline-footer contributions stack; flow summary uses default priority (50).

### Decision 6: Navigation continues via shell-owned callbacks for now

Both `FlowActivityBadge` and `SessionFlowActions` call shell-owned callbacks today (passed via props from `App.tsx`). The dashboard-plugin-runtime exposes `pluginRouter` on the plugin context, but the bundled-by-default flow plugin can keep using the existing prop-callback pattern via the slot consumer's `SlotProps` — slot consumers already thread `session`, `onOpenFlowDashboard`, etc. as props. Switching to `pluginRouter.push(...)` is a follow-up refactor (separable PR, doesn't block this extraction).

**Alternative considered**: rewrite all navigation to `pluginRouter` in this change. Rejected because the prop-callback path works today; introducing router-based navigation is orthogonal to the file move. Tracked as open question 1.

### Decision 7: Move test files alongside their subjects

All flow-related tests in `packages/client/src/__tests__/` and `packages/client/src/lib/__tests__/` move to `packages/flows-plugin/__tests__/` via `git mv`. Vitest config picks them up automatically (workspace-aware). This keeps tests co-located with the code they cover and lets future flow plugin work happen in one directory.

## Risks / Trade-offs

- **Reducer slice ordering & precedence** → Mitigated by deterministic manifest discovery order + load-time validation that no two plugins register for the same event type. A test asserts that with `flows-plugin` disabled, `flow_*` events are silently dropped (no runtime errors).
- **Sticky stacking regression** → Mitigated by a screenshot/regression test that boots a session with both `flowState` and `architectState` populated and verifies the rendered stack matches the pre-extraction baseline.
- **Hidden coupling via shared utilities** → `truncate-path.ts`, `useZoomPan.ts`, etc. are shared between flow components and core. These stay in `packages/client/src/lib/` and the plugin imports them via the plugin's allowed shared-imports list (defined by `dashboard-plugin-architecture`). A grep audit during implementation enumerates every `import` in the moved files and classifies it (intra-plugin / shared-allowed / shared-violating).
- **Mobile shell flow-specific behavior** → `MobileShell.tsx` has flow-aware swipe transitions today. Verify slot consumers receive enough props (route metadata, session state) for `MobileShell` to remain flow-agnostic. If not, escalate the missing prop into the slot's `SlotProps` definition (frozen taxonomy → minor bump).
- **App.tsx LOC reduction sets up next refactor** → Removing 250 LOC of flow logic from App.tsx still leaves OpenSpec / Subagents / Git logic in place; combined with `extract-openspec-as-plugin`, `extract-subagents-as-plugin`, `extract-git-as-plugin` the eventual App.tsx is significantly smaller. Sequence the four extracts so each one's diff is reviewable in isolation.

## Migration Plan

1. Scaffold `packages/flows-plugin/` with manifest, `package.json` (`"private": true` initially), `tsconfig.json`, `src/client/` subdir, and an `exports` map exposing `./reducer` and `./manifest`.
2. `git mv` the 12 flow components + 2 reducers + their tests from `packages/client/src/components/` and `packages/client/src/lib/` into `packages/flows-plugin/src/client/`.
3. Update import paths inside the moved files (intra-plugin → relative; shared types → `@blackbelt-technology/pi-dashboard-shared`).
4. Add `@blackbelt-technology/pi-dashboard-flows-plugin` as a workspace dep in `packages/client/package.json`.
5. Update `event-reducer.ts` to import flow/architect reducers from the plugin package (one-line import path change).
6. Wire the manifest's slot claims and have the runtime mount them. Remove the corresponding hand-written JSX from `App.tsx` and direct imports from `SessionCard.tsx` once the slot consumers cover the rendering 1:1.
7. Run the full test suite. Verify reducer state is byte-identical pre/post (snapshot test).
8. Update `AGENTS.md` Key Files table and `docs/architecture.md` Flow Dashboard Data Flow section.

**Rollback**: revert the four PRs in reverse order. `git mv` history preservation makes the revert clean.

## Open Questions

1. Should the prop-callback navigation pattern (Decision 6) be replaced with `pluginRouter.push(...)` in a follow-up? Track as a separate cleanup PR after this extraction lands.
2. Does `FlowLaunchDialog` need to be a slot contribution (e.g. `anchored-popover`) or stay a plugin-local modal opened by `SessionFlowActions`? Leaning toward plugin-local modal — no other plugin needs to mount it.
3. Should the existing `openspec/specs/flow-*` capability spec files relocate to `packages/flows-plugin/specs/`? Cosmetic / housekeeping; not blocking.
