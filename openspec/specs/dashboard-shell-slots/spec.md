# dashboard-shell-slots Specification

## Purpose

This capability covers the **slot taxonomy** for the dashboard — a frozen, named list of UI regions where contributions land. First-party plugins fill slots with React components (rich, trusted); third-party extensions fill descriptor-renderable slots with serialized data (sandboxed, declarative). Both adapters target the same slot contract, so the shell is contribution-agnostic.

The requirements below are layered: the design-level (contract) requirements come from change `dashboard-plugin-architecture`, and the implementation-level (runtime) requirements come from change `add-dashboard-shell-slots-runtime`. The full slot taxonomy table and motivating design notes live in `openspec/changes/dashboard-plugin-architecture/design.md` §"Slot taxonomy".

## Requirements

### Requirement: Slot consumer per-claim error boundary

Each contribution rendered by a slot consumer SHALL be wrapped in its own error boundary. If one contribution throws during render, the boundary SHALL catch the error, log it to the console with the offending plugin id and slot id, render nothing for that specific contribution, and SHALL NOT prevent sibling contributions for the same slot from rendering.

The error boundary scope SHALL be **per-claim**, not per-slot. A slot rendering N contributions has N boundaries.

#### Scenario: One plugin throws, others continue rendering

- **WHEN** three plugins (A, B, C) each register a `session-card-badge` claim and B's component throws on first render
- **THEN** A's badge SHALL render, B's badge SHALL render nothing, C's badge SHALL render, and the console SHALL contain a single error mentioning plugin id "B" and slot id "session-card-badge".

#### Scenario: Slot with one throwing plugin still renders empty container

- **WHEN** the only plugin registered for `session-card-badge` throws on render
- **THEN** the slot consumer SHALL render no badge for that session and SHALL NOT propagate the error to its parent component (the session card SHALL still render).

#### Scenario: Subsequent renders of recovered claim succeed

- **WHEN** plugin B's component throws on the first render of session X but renders successfully on session Y
- **THEN** session X's row SHALL show no B badge, session Y's row SHALL show the B badge, and the error log SHALL identify only the failing render.

### Requirement: settings-section claims target a specific settings tab

The `settings-section` slot manifest SHALL accept an optional `tab` field on each claim. The value SHALL be one of the dashboard's existing settings tab ids (initial set: `"general"`, `"servers"`, `"packages"`, `"providers"`, `"security"`, `"advanced"`). When omitted, the loader SHALL default the claim to `"general"`.

The settings-section slot consumer SHALL be parameterized by `tab` and render only contributions whose `tab` matches. Unknown `tab` values SHALL be rejected at manifest validation time with an explicit error naming the plugin and the unknown value.

#### Scenario: Claim with no tab field defaults to general

- **WHEN** a plugin manifest claims `settings-section` with no `tab` field
- **THEN** the loader SHALL treat the claim as `tab: "general"` and the General tab SHALL render the contribution below the core sections.

#### Scenario: Claim targets the providers tab

- **WHEN** a plugin manifest claims `{ "slot": "settings-section", "tab": "providers", "component": "MyProviderRow" }`
- **THEN** the Providers tab SHALL render `MyProviderRow`, and other tabs SHALL not.

#### Scenario: Unknown tab value rejected

- **WHEN** a plugin manifest claims `{ "slot": "settings-section", "tab": "nonexistent" }`
- **THEN** manifest validation SHALL fail with an error naming the plugin id and the unknown tab value, the plugin SHALL be marked failed in `/api/health`, and other plugins SHALL load normally.

#### Scenario: Settings-section consumer renders nothing when no claims for tab

- **WHEN** the user opens the Security tab and no plugin claims `tab: "security"`
- **THEN** the existing core sections SHALL render unchanged and the slot consumer SHALL render no extra content (no divider, no placeholder).

### Requirement: Slot consumer reads registry via plugin context provider

The dashboard SHALL wrap its React tree in a single `<PluginContextProvider>` that exposes the slot registry to all descendant slot consumer components. Slot consumers SHALL NOT import the registry directly; they SHALL read it from context.

This enables tests to render slot consumers with a mocked registry without modifying any production code.

#### Scenario: Slot consumer reads from context

- **WHEN** a slot consumer renders inside `<PluginContextProvider value={mockRegistry}>`
- **THEN** the consumer SHALL render contributions from `mockRegistry`, not from the production registry.

#### Scenario: Slot consumer outside provider throws helpful error

- **WHEN** a slot consumer is rendered outside any `<PluginContextProvider>`
- **THEN** the consumer SHALL throw an error reading "Slot consumer must be rendered inside <PluginContextProvider>".

### Requirement: Per-plugin context layer scopes hooks to a plugin id

When a slot consumer renders a contribution, it SHALL wrap the contribution component in a nested context layer that records the contributing plugin's id. Hooks `usePluginConfig<T>()` and the contribution's `logger` SHALL read the nearest plugin id from this context, not from an explicit argument.

A plugin SHALL NOT be able to read another plugin's config via these hooks.

#### Scenario: Hook reads from nearest plugin context layer

- **WHEN** plugin A's contribution calls `usePluginConfig<T>()`
- **THEN** the hook SHALL return `plugins.A.*` from the dashboard config, not any other plugin's namespace.

#### Scenario: Hook called outside any plugin context throws

- **WHEN** a non-plugin component (e.g. a core dashboard component) calls `usePluginConfig<T>()`
- **THEN** the hook SHALL throw an error reading "usePluginConfig must be called from a plugin slot contribution".

#### Scenario: Logger namespace matches surrounding plugin id

- **WHEN** plugin B's contribution calls `pluginContext.logger.info("ready")`
- **THEN** the log line SHALL be prefixed with `[plugin:B]`, regardless of the calling component's file path.

### Requirement: Demo plugin exists as runtime fixture

The repository SHALL contain a private workspace package `packages/demo-plugin/` whose sole purpose is to exercise the runtime end-to-end in tests. The demo plugin SHALL claim at least `settings-section` (rendering a small React form persisting two fields) and `tool-renderer` (registering a synthetic `toolName: "DashboardDemo"`).

The demo plugin's `package.json` SHALL declare `"private": true`. The build pipeline SHALL exclude the demo plugin from production bundles whenever the manifest declares `"fixture": true` and `process.env.NODE_ENV === "production"`.

#### Scenario: Demo plugin loads in dev and test

- **WHEN** the dashboard runs in dev mode or under vitest
- **THEN** `/api/health.plugins[]` SHALL include `{ id: "demo", enabled: true, loaded: true, claims: 2 }`.

#### Scenario: Demo plugin excluded from production bundle

- **WHEN** `npm run build` produces a production client bundle and the demo plugin's manifest declares `"fixture": true`
- **THEN** the bundle SHALL NOT contain any code from `@blackbelt-technology/demo-plugin/client` (asserted by a build artifact scan in the test suite).

#### Scenario: Demo plugin tool renderer takes precedence

- **WHEN** a session emits a `tool_call` with `toolName: "DashboardDemo"`
- **THEN** the chat view SHALL render the demo plugin's component instead of `GenericToolRenderer`.

### Requirement: Slot taxonomy is a frozen, named list

The dashboard SHALL expose a fixed set of named slots, defined as a TypeScript union in `@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-types.ts`. Each slot SHALL have a stable string id and a typed payload contract. Slot ids SHALL NOT be renamed or removed within a major version.

The slot taxonomy SHALL include at minimum:

```ts
type SlotId =
  // first-party React-targeted slots
  | "sidebar-folder-section"
  | "session-card-badge"
  | "session-card-action-bar"
  | "session-card-flows"
  | "session-card-memory"
  | "workspace-action-bar"
  | "content-view"
  | "content-header-sticky"
  | "content-inline-footer"
  | "anchored-popover"
  | "command-route"
  | "settings-section"
  | "tool-renderer"
  // descriptor-renderable slots (shared with extension-ui-system)
  | "management-modal"
  | "footer-segment"
  | "agent-metric"
  | "breadcrumb"
  | "gate"
  | "toast"
  | "rjsf-form";
```

Each slot id SHALL be associated with a payload type and a `multiplicity` (`one` | `many` | `one-active`).

#### Scenario: Slot id is referenced via type import

- **WHEN** a plugin or shell component declares a claim on a slot
- **THEN** the slot id SHALL be passed as a typed `SlotId` value, not as a free string, so renames produce TypeScript errors.

#### Scenario: Adding a new slot is a minor version bump

- **WHEN** a new slot id is added to the union
- **THEN** the change SHALL be a minor (non-breaking) version of `pi-dashboard-shared`, since existing plugins that don't reference the new slot are unaffected.

#### Scenario: Removing a slot is a major version bump

- **WHEN** a slot id is removed
- **THEN** the change SHALL be a major version, and plugins claiming that slot fail to load with an explicit error.

### Requirement: Each slot accepts a payload tier

Every slot SHALL declare which payload tiers it accepts: `react-only`, `descriptor-only`, or `react-or-descriptor`. The shell's slot consumer for each slot SHALL accept the declared tiers and reject others at registration time.

#### Scenario: React-only slot rejects descriptor

- **WHEN** an `extension-ui-system` descriptor targets `content-inline-footer` (React-only)
- **THEN** the slot consumer SHALL log a warning, ignore the descriptor, and not render anything for it.

#### Scenario: Descriptor-only slot rejects React component

- **WHEN** a first-party plugin attempts to register a React component for `toast` (descriptor-only)
- **THEN** the plugin loader SHALL fail validation at startup with an error naming the offending plugin and slot.

#### Scenario: React-or-descriptor slot accepts both

- **WHEN** a first-party plugin and a third-party extension both target `session-card-badge` for the same session
- **THEN** both contributions SHALL render, ordered by `priority` then plugin id.

### Requirement: Slot multiplicity governs rendering

Each slot SHALL declare its multiplicity:

- `one` — exactly one contribution allowed; collision at registration is a fatal load-time error.
- `many` — any number of contributions; all render, ordered by `priority` then alphabetical plugin id.
- `one-active` — many contributions register; only one is "active" at a time, selected by route or interaction.

#### Scenario: Many-multiplicity slot renders all contributions

- **WHEN** three plugins register for `session-card-badge`
- **THEN** all three badges SHALL render in priority order.

#### Scenario: One-active multiplicity routes to a single contribution

- **WHEN** the user navigates to `/specs` and one plugin registers `command-route` for that path
- **THEN** that plugin's `content-view` component SHALL render, replacing `ChatView`.

#### Scenario: Collision on `command-route` is a load error

- **WHEN** two plugins both register `command-route` for `/openspec`
- **THEN** the loader SHALL report an explicit collision error naming both plugins and abort startup.

### Requirement: Slot consumer components iterate the registry

For each slot, the dashboard shell SHALL provide a single consumer component (e.g. `<SidebarFolderSectionSlot folder={f} />`, `<SessionCardBadgeSlot session={s} />`, `<ContentViewSlot session={s} route={r} />`). The consumer SHALL:

1. Read the slot registry produced by the plugin loader.
2. Filter contributions applicable to the current props (e.g. session-scoped contributions to the current session).
3. Render each contribution in priority order with a typed `SlotProps` payload.

The consumer SHALL not assume any specific plugin exists. If no contributions are registered for the slot, the consumer SHALL render nothing (no fallback content, no placeholder).

#### Scenario: Empty slot renders nothing

- **WHEN** no plugin claims `sidebar-folder-section` and the openspec plugin is disabled
- **THEN** the folder header in the session list SHALL render no extra content; the session list itself remains visible.

#### Scenario: Session-scoped contribution

- **WHEN** a plugin's `session-card-badge` claim has a `predicate(session)` returning true only for sessions in `/Users/me/repo`
- **THEN** the badge SHALL render only on those sessions; other sessions render no badge from that plugin.

### Requirement: Slot context props are typed per-slot

The shell SHALL pass typed props to every slot contribution component. Each slot id SHALL have a corresponding `SlotProps<SlotId>` type. Plugins SHALL receive only the props for the slot they claim.

#### Scenario: Session-card-badge receives session

- **WHEN** the shell renders a `session-card-badge` claim
- **THEN** the component SHALL receive `{ session: DashboardSession; pluginContext: PluginContext }`.

#### Scenario: Content-view receives session and route params

- **WHEN** the shell routes to a `command-route` claim
- **THEN** the contribution SHALL receive `{ session: DashboardSession; routeParams: Record<string, string>; onClose: () => void; pluginContext: PluginContext }`.

#### Scenario: Anchored-popover receives anchor element

- **WHEN** the shell shows an `anchored-popover` claim triggered by a button
- **THEN** the contribution SHALL receive `{ anchorEl: HTMLElement; onDismiss: () => void; pluginContext: PluginContext }`.

### Requirement: Plugin priority orders contributions deterministically

When multiple plugins claim the same `many`-multiplicity slot, render order SHALL be:

1. By `priority` ascending (lower is first).
2. Tie-break by plugin `id` alphabetical ascending.

Default priority SHALL be `1000`. First-party plugins use `100`. The dashboard SHALL log a warning at startup if any priority is `< 0` or `> 10000`.

#### Scenario: First-party plugin renders before third-party

- **WHEN** `openspec-plugin` (priority 100) and a hypothetical third-party extension (priority 1000) both contribute `session-card-badge`
- **THEN** the OpenSpec badge SHALL render first.

#### Scenario: Tie-break by id

- **WHEN** two plugins both have priority 100 and claim `sidebar-folder-section`
- **THEN** the plugin whose `id` sorts first alphabetically SHALL render first.

### Requirement: settings-section slot hosts plugin-owned settings UI

The `settings-section` slot SHALL render contributions inside the dashboard's Settings page (`SettingsPanel`). Contributions are sorted by plugin `priority` then alphabetical id. The slot accepts both React components (first-party plugins) and JSON-Schema-bearing descriptors (third-party extensions) per the slot's `react-or-descriptor` tier.

Each `settings-section` contribution SHALL receive `pluginContext` (React variant) or `formValue` + `onChange` (descriptor variant). React contributions persist via `pluginContext.updatePluginConfig({...})`; descriptor contributions persist via the dashboard's standard form-submit handler.

#### Scenario: Plugin section appears below core sections

- **WHEN** the user opens the Settings page
- **THEN** the page SHALL render core sections first (General, Auth, Providers, Network, Packages, Pi Core, Tools), then a divider, then plugin contributions in priority order.

#### Scenario: First-party plugin contributes React settings

- **WHEN** OpenSpec plugin's manifest claims `settings-section` with `component: "OpenSpecSettings"`
- **THEN** the SettingsPanel SHALL render the `OpenSpecSettings` component inside a labelled, collapsible section.

#### Scenario: Third-party extension contributes descriptor settings

- **WHEN** an extension pushes `{ kind: "settings-section", namespace: "judo", schema: {...JSON Schema...} }` via the `extension-ui-system` probe
- **THEN** the SettingsPanel SHALL render the schema using the simple `UiField` form (Phase 1 of `extension-ui-system`) or RJSF (Phase 4 once shipped), inside a labelled section titled by the descriptor's `title`.

#### Scenario: Reactive update on config change

- **WHEN** a plugin's `updatePluginConfig({...})` succeeds
- **THEN** the server SHALL broadcast `plugin_config_update { id, config }`, and any subscribed `usePluginConfig<T>()` consumers in *any* plugin or section SHALL re-render with the new value within one frame.

#### Scenario: Plugin without settings claim renders nothing

- **WHEN** a plugin has no `settings-section` claim
- **THEN** the SettingsPanel SHALL render no entry for that plugin and SHALL NOT log a warning.

### Requirement: tool-renderer slot maps a tool name to a React renderer

The `tool-renderer` slot SHALL accept React-only contributions. Each claim SHALL declare a `toolName: string` (the value of `tool_call.toolName` to render) and a `component` (an exported React component implementing the existing `ToolRenderer` signature). When the dashboard chat renders a tool call whose `toolName` matches a registered claim, the slot consumer SHALL use the registered component instead of the built-in `GenericToolRenderer`.

Multiple plugins MAY register `tool-renderer` claims for distinct tool names. Two claims for the same tool name are a load-time error (collision rule for `one`-multiplicity per tool name).

#### Scenario: Plugin's tool-renderer takes precedence over generic renderer

- **WHEN** a plugin claims `tool-renderer` with `toolName: "Agent"` and a session emits a `tool_call` with that tool name
- **THEN** the dashboard SHALL render the tool call using the plugin's component, not `GenericToolRenderer`.

#### Scenario: Two plugins claim the same tool name

- **WHEN** plugin A and plugin B both claim `tool-renderer` for `toolName: "Agent"`
- **THEN** the loader SHALL report a fatal collision error naming both plugins and the conflicting tool name, and abort startup.

#### Scenario: Tool with no claim falls through to generic renderer

- **WHEN** a tool call's `toolName` matches no registered claim
- **THEN** the dashboard SHALL render it with `GenericToolRenderer` (existing behavior preserved).

#### Scenario: Plugin component crashes during render

- **WHEN** a plugin's tool-renderer component throws on first render
- **THEN** the slot consumer's error boundary SHALL catch it, fall back to `GenericToolRenderer` for that specific tool call, and log the error.

### Requirement: Slot contributions degrade to no-op when payload is invalid

A plugin contribution that throws during render SHALL NOT crash the shell. The slot consumer SHALL catch the error, log it (including plugin id and slot id), render nothing for that contribution, and continue rendering other contributions in the same slot.

#### Scenario: Plugin component throws

- **WHEN** a plugin's `session-card-badge` component throws on render
- **THEN** the slot consumer SHALL catch the error, log to console with plugin id and slot id, render no badge for that plugin, and other plugins' badges SHALL still render.

#### Scenario: Invalid descriptor for descriptor-renderable slot

- **WHEN** a third-party extension emits a descriptor with a missing required field for `breadcrumb`
- **THEN** the slot consumer SHALL skip the descriptor with a warning and continue.

### Requirement: Slot consumers SHALL NOT mask sibling fallbacks via JSX-`??` chains

Slot consumer components MUST NOT be placed directly as the left operand of a `??` (nullish-coalescing) operator in a JSX route fallback chain. The `??` operator evaluates the JSX **element**, which is always a truthy object, regardless of whether the consumer renders `null` once mounted. Placing `<XxxSlot/>` directly before `??` therefore makes any subsequent fallback unreachable when the slot has zero claims — the slot wrapper silently masks the sibling.

When wiring a slot consumer into a fallback chain, the JSX element MUST be gated on a registry claim count (or equivalent runtime check) **before** construction:

```tsx
// CORRECT
(claimCount > 0 ? <ContentViewSlot session={s} routeParams={p} onClose={c} /> : null)
  ?? sessionDetail
  ?? <LandingPage … />

// INCORRECT — masks sessionDetail and LandingPage when no plugin claims the slot
<ContentViewSlot session={s} routeParams={p} onClose={c} />
  ?? sessionDetail
  ?? <LandingPage … />
```

The convention is enforced by a repository-level lint test (`packages/client/src/__tests__/no-jsx-slot-nullish-fallback.test.ts`) that scans the dashboard shell entry points for the anti-pattern. The lint test SHALL fail with the offending file:line when the gating expression does not contain `getClaims(` or `.length [><=]` within a tight lookback window.

This requirement applies to every slot consumer exported by `@blackbelt-technology/pi-dashboard-plugin-runtime` whose contribution can render `null` when no plugins claim it (i.e. `ContentViewSlot`, `SidebarFolderSectionSlot`, `SessionCardBadgeSlot`, `SessionCardActionBarSlot`, `ContentHeaderStickySlot`, `ContentInlineFooterSlot`, `AnchoredPopoverSlot`, `CommandRouteSlot`, `SettingsSectionSlot`, `ToolRendererSlot`, and any future slot consumer).

#### Scenario: Lint fails on a `<XxxSlot/> ?? fallback` direct sequence

- **WHEN** `packages/client/src/App.tsx` contains the line `<ContentViewSlot session={s} /> ?? sessionDetail`
- **THEN** the lint test `no-jsx-slot-nullish-fallback.test.ts` SHALL fail with an error message referencing `App.tsx:<line>` and the offending snippet

#### Scenario: Lint fails on the production bug shape (ternary-wrapped, no claim gate)

- **WHEN** `App.tsx` contains the ternary-wrapped shape `(selectedId && selectedSession ? <ContentViewSlot … /> : null) ?? sessionDetail` with no claim-count check in the ternary condition
- **THEN** the lint test SHALL fail and identify the line where the JSX is constructed

#### Scenario: Lint passes when the JSX is gated on a registry claim count

- **WHEN** `App.tsx` contains `(selectedId && selectedSession && _pluginRegistry.getClaims("content-view").length > 0 ? <ContentViewSlot … /> : null) ?? sessionDetail`
- **THEN** the lint test SHALL pass — the `getClaims(` token within the lookback window proves the JSX construction is correctly gated

#### Scenario: Lint ignores sibling-mounted slot consumers

- **WHEN** `App.tsx` contains a slot consumer mounted as a sibling, e.g. `<ContentHeaderStickySlot session={s} />` followed on later lines by unrelated JSX containing `??` operators
- **THEN** the lint test SHALL NOT flag the slot — the inter-token character class between the slot's `/>` and the next `??` rejects `<`, `{`, `;`, etc. that necessarily appear when crossing into a sibling subtree

#### Scenario: Behavior test pins the fix semantics

- **WHEN** the regression test `content-view-slot-fallback.test.tsx` renders the gated expression with `claimCount = 0` and a fallback element
- **THEN** the test SHALL render only the fallback element

- **WHEN** the same test renders the gated expression with `claimCount = 1` and an active slot
- **THEN** the test SHALL render only the slot element (the fallback SHALL NOT render)

### Requirement: Slot taxonomy SHALL classify each slot id by predicate input shape

The shared package `@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-types.js` SHALL export a public type `SlotPredicateInput<S extends SlotId>` that maps every `SlotId` to the input shape its registered predicates receive at runtime. The mapping SHALL reflect the actual filter helpers in the plugin runtime:

| Slot category | Slot ids | `SlotPredicateInput<S>` |
|---|---|---|
| Session-scoped | `session-card-badge`, `session-card-action-bar`, `session-card-flows`, `session-card-memory`, `workspace-action-bar`, `content-view`, `content-header-sticky`, `content-inline-footer`, `command-route` | `DashboardSession \| null \| undefined` |
| Folder-scoped | `sidebar-folder-section` | `FolderDescriptor` |
| Predicate-irrelevant | every other `SlotId` (`settings-section`, `tool-renderer`, `anchored-popover`, all descriptor-only slots) | `never` |

The classification SHALL be expressed as a single conditional type. The file SHALL include a compile-time exhaustiveness assertion (analogous to the existing `_AssertAllSlotsCovered` pattern for `SlotPropsMap`) that fails type-checking if any `SlotId` is left unclassified.

The `never` value for predicate-irrelevant slots is documentation-only: under the bivariant method-shorthand contract used by `ClaimEntry`, predicates can still be registered against `never`-input slots without a type error, but the registered function is never invoked at runtime because filter helpers only target session- and folder-scoped slots. Plugins SHOULD NOT rely on `never`-typed slots rejecting predicates at compile time.

#### Scenario: Session-scoped slot maps to DashboardSession input

- **WHEN** type-checking `SlotPredicateInput<"session-card-badge">`
- **THEN** the resolved type SHALL be `DashboardSession | null | undefined`.

#### Scenario: New session-card-flows slot is session-scoped

- **WHEN** type-checking `SlotPredicateInput<"session-card-flows">`
- **THEN** the resolved type SHALL be `DashboardSession | null | undefined`.

#### Scenario: Folder-scoped slot maps to FolderDescriptor input

- **WHEN** type-checking `SlotPredicateInput<"sidebar-folder-section">`
- **THEN** the resolved type SHALL be `FolderDescriptor`.

#### Scenario: Predicate-irrelevant slot maps to `never`

- **WHEN** type-checking `SlotPredicateInput<"settings-section">`
- **THEN** the resolved type SHALL be `never`.
- **AND** registering a predicate on such a slot SHALL compile (method bivariance) but the predicate SHALL NOT be invoked at runtime.

#### Scenario: Adding a new slot id without classification is a compile error

- **WHEN** a new entry is added to the `SlotId` union but is not assigned a classification in `SlotPredicateInput`
- **THEN** the compile-time exhaustiveness assertion in `slot-types.ts` SHALL fail with a TypeScript error pointing at the unclassified slot.

### Requirement: Dashboard shell SHALL contain zero flow references

The dashboard shell source code SHALL NOT contain any reference to
flows. The substring `flow` (case-insensitive) SHALL not appear in any
file under:

- `packages/shared/src/`
- `packages/server/src/`
- `packages/client/src/`

except for an explicit allow-list:

- `packages/shared/src/types.ts` MAY export `FlowState`,
  `ArchitectState`, `FlowStatus`, `FlowAgentStatus`,
  `FlowAgentState`, `ArchitectPhase`, `ArchitectAgentEntry`,
  `ArchitectDagStep`, `ArchitectParsedFlow`, `ArchitectPrompt`,
  `FlowDetailEntry`, `FlowRecentTool` (the type contract for the
  plugin's `/reducer` workspace export).
- Test files under `__tests__/` MAY reference flow types if they
  exist solely to assert these allow-list exports.

This invariant SHALL be enforced by a repo-lint test
`packages/shared/src/__tests__/no-flow-references-in-shell.test.ts`
that scans the listed source trees and fails CI on any unallowed
match.

#### Scenario: Lint catches new flow reference in shell

- **WHEN** any file under `packages/{shared,server,client}/src/`
  (excluding the allow-list) introduces the substring `flow` (case-
  insensitive)
- **THEN** the repo-lint test SHALL fail CI
- **AND** the failure message SHALL name the file, line, and the
  matching token

#### Scenario: Lint allows shared FlowState type export

- **WHEN** `packages/shared/src/types.ts` exports `FlowState`
- **THEN** the repo-lint test SHALL NOT flag this export

#### Scenario: Plugin source is exempt

- **WHEN** files under `packages/flows-plugin/src/` reference flow
  types and components
- **THEN** the repo-lint test SHALL NOT scan those files

### Requirement: Shell SHALL render all flow content via plugin slot claims

The shell SHALL NOT directly import or render any `Flow*` component.
All flow rendering SHALL go through slot consumers populated by
`flows-plugin` claims. Specifically:

- `FlowActivityBadge` rendered via `session-card-badge` slot.
- `SessionFlowActions` rendered via `session-card-flows` slot.
- `FlowDashboard` and `FlowArchitect` rendered via
  `content-header-sticky` slot.
- `FlowAgentDetail`, `FlowArchitectDetail`, `FlowYamlPreview`
  rendered via `content-view` slot, each with a distinct `route`.
- `FlowSummary` rendered via `content-inline-footer` slot.
- Slash-command wrappers (`/flows`, `/flows:new`, `/flows:edit`,
  `/flows:delete`) rendered via `command-route` slot.

The shell SHALL NOT pass flow-specific props to any slot consumer.
Slot consumers receive the standard prop contract for their slot
(`{ session, pluginContext }` or
`{ session, routeParams, onClose, pluginContext }` for content-view).

#### Scenario: Single content-header-sticky claim renders FlowArchitect

- **GIVEN** a session whose event stream has produced a non-null
  `architectState` inside `flows-plugin`'s internal context
- **WHEN** the shell renders `<ContentHeaderStickySlot session={...}>`
- **THEN** `<FlowArchitect>` SHALL render exactly once via the slot
  contribution
- **AND** the rendering SHALL not require any flow-specific props from
  the shell

#### Scenario: FlowArchitect collapses across selection states

- **GIVEN** the user is viewing a session with both `architectState`
  and `flowState` set
- **WHEN** the user transitions through architect-detail, flow-detail,
  and default content views
- **THEN** `<FlowArchitect>` SHALL be rendered exactly once at any
  point in time
- **AND** dismissal callbacks SHALL be uniform across all selection
  states (handled by the plugin's internal UI-state context)

#### Scenario: FlowDashboard collapses across selection states

- **GIVEN** the user is viewing a session with `flowState` set
- **WHEN** the user transitions through flow-detail and default views
- **THEN** `<FlowDashboard>` SHALL be rendered exactly once at any
  point in time

#### Scenario: SessionFlowActions renders inside FLOWS subcard

- **GIVEN** a session whose `flowsList` is non-empty OR whose `commandsList` includes `flows:new`
- **WHEN** the desktop session card is rendered
- **THEN** `<SessionFlowActions>` SHALL render exactly once inside the FLOWS subcard via the `session-card-flows` slot
- **AND** SHALL NOT render via the `session-card-action-bar` slot

### Requirement: New plugin slot `session-card-flows` is reserved and consumed by FLOWS subcard

A new dashboard plugin slot identifier `session-card-flows` SHALL be added to `SLOT_DEFINITIONS` in `packages/shared/src/dashboard-plugin/slot-types.ts`. Multiplicity SHALL be `many`. Payload tier SHALL be `react-only` (matching `session-card-action-bar` and `session-card-memory`). The slot SHALL render its claims inside the FLOWS subcard. When no plugin claims the slot, the subcard renders nothing.

A matching consumer component `SessionCardFlowsSlot({ session })` SHALL be exported from `packages/dashboard-plugin-runtime/src/slot-consumers.tsx`. The consumer SHALL render both legacy refs claims (filtered via `forSessionRendered`) and intent-store contributions (via `useSlotIntents("session-card-flows", session.id)`), each wrapped in a per-claim `SlotErrorBoundary` + `CurrentPluginLayer`.

The slot SHALL be classified as session-scoped: `SlotPredicateInput<"session-card-flows">` SHALL resolve to `DashboardSession | null | undefined`. The compile-time exhaustiveness assertion (`_AssertAllSlotsPredicateClassified`) SHALL cover the new slot id without modification beyond the union extension.

#### Scenario: Slot definition exists

- **WHEN** the slot registry is initialized
- **THEN** `SLOT_DEFINITIONS` SHALL contain an entry with `id: "session-card-flows"` and `multiplicity: "many"`

#### Scenario: Slot consumer is exported from the runtime

- **WHEN** a consumer imports from `@blackbelt-technology/dashboard-plugin-runtime`
- **THEN** the named export `SessionCardFlowsSlot` SHALL be present and accept a `{ session: DashboardSession }` prop

#### Scenario: Plugin contribution renders inside FLOWS subcard

- **WHEN** a plugin registers a `session-card-flows` claim that returns a non-empty React node for a session
- **AND** a desktop session card is rendered for that session
- **THEN** the rendered DOM SHALL contain a `FLOWS` titled subcard
- **AND** the plugin's contribution SHALL appear inside that subcard's body

#### Scenario: Predicate input is session-scoped

- **WHEN** type-checking `SlotPredicateInput<"session-card-flows">`
- **THEN** the resolved type SHALL be `DashboardSession | null | undefined`

### Requirement: Chat tool-call dispatch consults `tool-renderer` slot before built-in registry

The dashboard chat surface (`ToolCallStep`) SHALL consult the plugin slot registry for `tool-renderer` claims matching the current `toolName` before falling through to the built-in `getToolRenderer(toolName)` Map.

The resolution chain SHALL be, in order:

1. Plugin `tool-renderer` claim for `toolName` whose `shouldRender` evaluates truthy (or whose `shouldRender` is undefined) → render the plugin's component.
2. Built-in renderer in `packages/client/src/components/tool-renderers/registry.ts` Map.
3. `GenericToolRenderer` as final fallback.

Resolution SHALL be one-shot at lookup time. If the resolved renderer throws during render, the existing per-tool ErrorBoundary catches it; dispatch SHALL NOT attempt to fall through to a lower tier.

When a plugin claim's `shouldRender` function THROWS, dispatch SHALL treat the result as `false` (fail closed), log a console warning naming the offending plugin id and `toolName`, and continue down the chain.

When the slot registry context is unavailable (e.g. test or storybook contexts without a `SlotRegistryProvider`), `useSlotRegistryOrNull()` SHALL return null and dispatch SHALL fall through cleanly to the built-in registry.

#### Scenario: Plugin claim wins over built-in for same toolName

- **WHEN** a plugin contributes a `tool-renderer` claim with `toolName: "bash"` AND a chat surface renders a `bash` tool call
- **THEN** the plugin's component renders
- **AND** the built-in `BashToolRenderer` does NOT render

#### Scenario: No plugin claim → built-in wins

- **WHEN** no plugin claims `tool-renderer` for `toolName: "read"` AND a chat surface renders a `read` tool call
- **THEN** the built-in `ReadToolRenderer` renders

#### Scenario: Unknown tool with no plugin claim → Generic

- **WHEN** a chat surface renders a `ctx_execute` tool call AND no plugin claims it AND no built-in entry exists
- **THEN** `GenericToolRenderer` renders

#### Scenario: `shouldRender` returns false → fall through

- **WHEN** a plugin contributes a `tool-renderer` claim for `toolName: "ctx_execute"` AND its `shouldRender` returns false
- **THEN** the plugin's component does NOT render
- **AND** dispatch falls through to the built-in registry (then to `GenericToolRenderer` if no built-in match)

#### Scenario: `shouldRender` throws → fail closed

- **WHEN** a plugin contributes a `tool-renderer` claim AND its `shouldRender` function throws on invocation
- **THEN** dispatch treats the claim as if `shouldRender` returned false
- **AND** falls through to the next tier
- **AND** logs a console warning identifying the plugin id and `toolName`

#### Scenario: Plugin renderer throws → ErrorBoundary catches; no fall-through

- **WHEN** the resolved plugin renderer throws during render
- **THEN** the existing per-tool ErrorBoundary catches the error and renders an error state
- **AND** the dispatch does NOT fall through to the built-in renderer (failure is visible, not silently swapped)

#### Scenario: Slot registry not initialized → fall through to built-in

- **WHEN** `useSlotRegistryOrNull()` returns null because no `SlotRegistryProvider` is mounted (test / storybook context)
- **THEN** dispatch skips the plugin lookup entirely and uses `getToolRenderer(toolName)`

### Requirement: Tool-renderer slot prop contract expanded with optional payload fields

The `tool-renderer` slot prop contract SHALL include all of the following:

- **Required** (unchanged): `toolName: string`, `toolInput: Record<string, unknown>`, `sessionId: string`.
- **Optional** (added by this change): `status?: "running" | "complete" | "error"`, `result?: string`, `toolDetails?: Record<string, unknown>`, `images?: ChatImage[]`, `context?: ToolContext`.

Existing plugin claims that consume only the required core SHALL continue to work without changes. Plugin renderers MAY consume the optional fields to mirror the built-in renderer payload.

The slot SHALL NOT rename `toolInput` to `args` (the built-in renderers' field name); both naming forms continue to coexist (plugin slot uses `toolInput`, built-in renderers use `args`) to preserve backward compatibility of existing plugin claims (`demo-plugin`).

#### Scenario: Existing plugin claim continues to render after expansion

- **WHEN** a plugin that consumes only `toolName`, `toolInput`, and `sessionId` (the pre-expansion contract) is loaded
- **THEN** the plugin's renderer mounts and renders without TypeScript errors or runtime errors

#### Scenario: Plugin renderer consuming `result` and `status`

- **WHEN** a plugin renderer reads `result` to populate an output panel AND `status` to drive a loading spinner
- **THEN** the renderer receives both props from `ToolCallStep`'s mount call
- **AND** the values match what the built-in renderers receive for the same tool call

## Related Capabilities

- `dashboard-plugin-loader` — sibling capability defining how plugins (the React-side adapter) discover, register, and bind contributions into the slots defined here.
- `extension-ui-system` — sibling capability defining the *third-party* descriptor protocol (the data-side adapter into the same slot contract). Some slot ids in this taxonomy reuse descriptor kinds defined there (`agent-metric`, `breadcrumb`, `management-modal`, `footer-segment`, `gate`, `toast`, `rjsf-form`, `settings-section`); see `dashboard-plugin-architecture/design.md` §"Cross-reference with `extension-ui-system`".
- `agent-tool-rendering` — current implementation of tool renderers (today a hardcoded registry); the `tool-renderer` slot defined in this capability replaces that registry once `extract-subagents-as-plugin` ships.
- `app-decomposition` — historical decomposition of `App.tsx`; this capability completes the decomposition by moving feature-specific conditional rendering out of the shell entirely.
