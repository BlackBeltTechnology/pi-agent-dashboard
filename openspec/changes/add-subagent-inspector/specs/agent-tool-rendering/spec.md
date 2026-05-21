## ADDED Requirements

### Requirement: Subagent card SHALL be inline-expandable

The `Agent` tool card rendered by `AgentToolRenderer` SHALL display a collapse/expand toggle in its header. When expanded, the card body SHALL render the `<SubagentDetailView>` component for that subagent's `agentId`.

#### Scenario: Default state is collapsed

- **WHEN** the dashboard receives a new `Agent` tool call
- **THEN** the rendered card body SHALL show only the collapsed header, description, activity line, and stats — no inline detail view

#### Scenario: Expanding shows the detail view

- **GIVEN** a collapsed `Agent` card with `details.agentId` resolvable
- **WHEN** the user clicks the expand toggle
- **THEN** the card body SHALL render `<SubagentDetailView mode="inline" agentId={…} />` with `max-h-[60vh]` internal scroll
- **AND** the toggle icon SHALL flip to indicate the expanded state

#### Scenario: Toggle persists across re-renders within the same page

- **GIVEN** an expanded card
- **WHEN** the parent session receives a streaming update that re-renders the card
- **THEN** the card SHALL remain expanded

### Requirement: Subagent card SHALL provide a popout button

The card SHALL display a popout button (`mdiOpenInNew`) in its header. Clicking it SHALL open `/session/<sessionId>/subagent/<agentId>` in a new browser tab via `window.open(url, "_blank")`.

#### Scenario: Popout opens the dedicated route

- **GIVEN** an `Agent` card with `details.agentId === "abc123"` in session `sess_42`, and `context.sessionId === "sess_42"`
- **WHEN** the user clicks the popout button
- **THEN** the browser SHALL call `window.open("/session/sess_42/subagent/abc123", "_blank")` exactly once

#### Scenario: Popout button is disabled when context.sessionId is missing

- **GIVEN** an `Agent` card whose `context.sessionId` is `undefined`
- **WHEN** the popout button is rendered
- **THEN** it SHALL be disabled and clicking it SHALL NOT call `window.open`

#### Scenario: Popout button is disabled when agentId is missing

- **GIVEN** an `Agent` card whose `details.agentId` is `undefined` (e.g. early streaming frame before the agent is registered)
- **WHEN** the popout button is rendered
- **THEN** it SHALL be disabled and clicking it SHALL NOT call `window.open`

### Requirement: The dashboard SHALL serve a popout route

The dashboard client SHALL register a route at `/session/:sessionId/subagent/:agentId` that renders `<SubagentPopoutPage>`. The page SHALL subscribe to the parent session and render `<SubagentDetailView mode="popout" />` once data is available.

#### Scenario: Route renders detail view when subagent is found

- **GIVEN** the parent session `sess_42` is subscribed and contains a `subagents` entry for `abc123`
- **WHEN** the user navigates to `/session/sess_42/subagent/abc123`
- **THEN** the page SHALL render `<SubagentDetailView>` for that subagent with a chrome header showing the parent session label

#### Scenario: Route renders 'not found' for unknown agentId

- **GIVEN** subscription is resolved and the parent session has no `abc123` entry
- **WHEN** the user navigates to `/session/sess_42/subagent/abc123`
- **THEN** the page SHALL render: "Subagent not found — it may have been cleared from the parent session's history."

#### Scenario: Route shows loading while parent subscription is in flight

- **GIVEN** the popout opens in a fresh tab and the parent session is not yet subscribed
- **WHEN** subscription has not resolved
- **THEN** the page SHALL show a "Loading parent session…" indicator until subscription resolves

#### Scenario: Route renders 'parent session not found' when subscription resolves empty

- **GIVEN** subscription resolves but the parent session is unknown to the dashboard (e.g. archived/deleted)
- **WHEN** the page renders post-resolution
- **THEN** the page SHALL render: "Parent session not found — it may have been archived or deleted. Close this tab."

### Requirement: The inspector code SHALL live in a dedicated workspace plugin package

The inspector components, types, and tests SHALL live in `packages/subagents-plugin/`. The shell SHALL import them via `@blackbelt-technology/pi-dashboard-subagents-plugin/client`. The plugin SHALL have a valid `pi-dashboard-plugin` manifest with `id: "subagents"` so the vite plugin loader discovers it.

#### Scenario: Plugin is auto-discovered at build time

- **WHEN** the dashboard runs its build (`npm run build`)
- **THEN** the vite plugin loader SHALL include `subagents` in its discovered-plugins list
- **AND** the generated `plugin-registry.tsx` SHALL include the subagents plugin's entry

#### Scenario: SubagentDetailView is importable from the plugin's public entry

- **WHEN** any consumer imports from `@blackbelt-technology/pi-dashboard-subagents-plugin/client`
- **THEN** `SubagentDetailView`, `SubagentPopoutPage`, `SubagentTimelineEntry`, `SubagentState` SHALL be exported

#### Scenario: Plugin uses UI primitives registry instead of shell components

- **WHEN** `SubagentDetailView` renders markdown content
- **THEN** it SHALL resolve the renderer via `useUiPrimitive(UI_PRIMITIVE_KEYS.markdownContent)`
- **AND** it SHALL NOT import the shell's `MarkdownContent` component directly
- **AND** tests SHALL provide a mock primitive via `withUiPrimitiveProvider`

### Requirement: `SubagentDetailView` SHALL render the timeline when `entries[]` is present

When `SessionState.subagents[agentId].entries` is a non-empty array of `SubagentTimelineEntry` objects, `<SubagentDetailView>` SHALL render each entry using kind-specific renderers (`tool`, `text`, `thinking`, `error`).

#### Scenario: Full timeline with entries

- **GIVEN** a subagent state with `entries: [{ kind: "tool", toolName: "Read", input: { path: "/x" }, output: "...", ts: 1 }, { kind: "text", text: "Done.", ts: 2 }]`
- **WHEN** `<SubagentDetailView agentId={…} />` renders
- **THEN** it SHALL render the tool entry as a click-to-expand row showing `Read` and `/x`
- **AND** it SHALL render the text entry as a markdown block containing `Done.`
- **AND** thinking entries SHALL render as collapsible rows distinct from text rows
- **AND** error entries SHALL render in error colour

### Requirement: `SubagentDetailView` SHALL render fallback content when `entries[]` is absent

When `entries[]` is absent (e.g. during the brief loading window before the producer streams its first `tool_execution_end`, or for legacy / hand-edited session data with no entries), the detail view SHALL render either the completion result/error block or a generic "No detail available yet." placeholder. The dashboard no longer ships a "running, no entries" intermediate state with an upgrade-this-extension footnote — `pi-dashboard-subagents` is the only recommended producer and reliably streams entries from its first tool call.

#### Scenario: Completed, no entries

- **GIVEN** a subagent with `status === "completed"` and a `result` string, no `entries`
- **WHEN** the detail view renders
- **THEN** it SHALL render the `result` via the markdown renderer

#### Scenario: Failed, no entries

- **GIVEN** a subagent with `status === "failed"` and an `error` string, no `entries`
- **WHEN** the detail view renders
- **THEN** it SHALL render the `error` in error colour

#### Scenario: No data at all

- **GIVEN** a subagent state that has neither `entries`, `result`, nor `error`
- **WHEN** the detail view renders
- **THEN** it SHALL render: "No detail available yet."

### Requirement: `GetSubagentResultRenderer` SHALL include a "Show details" affordance

The `get_subagent_result` tool renderer SHALL expose a "Show details" link/button when the result card has a resolvable `agent_id`. Clicking it SHALL open the popout route in a new tab.

#### Scenario: Button opens the popout route

- **GIVEN** a `get_subagent_result` tool call whose args contain `agent_id: "abc123"` in session `sess_42`
- **WHEN** the renderer mounts with `context.sessionId === "sess_42"`
- **THEN** a "Show details" affordance SHALL be visible
- **AND** clicking it SHALL call `window.open("/session/sess_42/subagent/abc123", "_blank")` exactly once

#### Scenario: Affordance is hidden when agent_id is unresolvable

- **GIVEN** a `get_subagent_result` tool call whose args do not include a resolvable `agent_id`
- **WHEN** the renderer mounts
- **THEN** the "Show details" affordance SHALL NOT render

### Requirement: `SessionState` SHALL carry the subagent timeline

The reducer's `SubagentState` interface SHALL include an optional `entries?: SubagentTimelineEntry[]` field plus optional metadata fields (`activity`, `displayName`, `modelName`, `subagentType`, `startedAt`). The `subagent_*` event handlers SHALL read these from `data.details` when present.

#### Scenario: Reducer ignores absent entries

- **GIVEN** a `subagent_started` event whose `data.details` does not contain `entries`
- **WHEN** the reducer processes the event
- **THEN** the resulting `SubagentState.entries` SHALL be `undefined`

#### Scenario: Reducer stores entries when present

- **GIVEN** a `subagent_started` event whose `data.details.entries = [{ kind: "tool", … }]`
- **WHEN** the reducer processes the event
- **THEN** the resulting `SubagentState.entries` SHALL equal that array

#### Scenario: Cumulative replace semantics

- **GIVEN** a `SubagentState` with `entries.length === 3`
- **WHEN** a new `subagent_started` event arrives with `details.entries.length === 5`
- **THEN** the new `SubagentState.entries.length === 5`
- **AND** entries are REPLACED, not appended (the producer is expected to send the full cumulative array)

### Requirement: `ToolContext` SHALL carry sessionId for session-scoped URLs

The `ToolContext` interface SHALL include optional `sessionId?: string` and `session?: SessionState` fields. Renderers needing session-scoped URLs (e.g. popout) SHALL read these.

#### Scenario: ToolContext shape

- **WHEN** `ChatView` constructs the `toolContext` passed to renderers
- **THEN** the object SHALL include `sessionId` set to the current session id (or undefined when no session is selected)
- **AND** it SHALL include `session` set to the current `SessionState` (or undefined)

### Requirement: Inspector SHALL display the agent definition file path when present

The producer (`pi-dashboard-subagents`) emits `details.agentMdPath` (absolute filesystem path to the agent's `.md` definition file, e.g. `~/.pi/agent/agents/Explore.md`) on every `subagents:*` event when the agent was sourced from a file. The dashboard SHALL surface this path on the inspector card and popout, read-only.

#### Scenario: `SubagentState` carries `agentMdPath`

- **GIVEN** a `subagents:started` event whose `data.details.agentMdPath === "/home/u/.pi/agent/agents/Explore.md"`
- **WHEN** the reducer processes the event
- **THEN** the resulting `SubagentState.agentMdPath` SHALL equal that string

#### Scenario: Inspector renders the path under the displayName

- **GIVEN** a `SubagentState` with `displayName === "explorer"` and `agentMdPath === "/home/u/.pi/agent/agents/Explore.md"`
- **WHEN** `<SubagentDetailView mode="inline" />` renders
- **THEN** the header SHALL show the displayName on one line
- **AND** SHALL show the path in a smaller monospace style directly underneath
- **AND** clicking the path SHALL be a no-op (no editor-open behavior, no copy-to-clipboard affordance)

#### Scenario: Inspector omits the path line when absent

- **GIVEN** a `SubagentState` with `agentMdPath === undefined`
- **WHEN** the detail view renders
- **THEN** no path line SHALL be rendered in the header

#### Scenario: Path survives backfill from `tool_execution_end`

- **GIVEN** a parent session JSONL containing an `Agent` tool result whose `details.agentMdPath === "/home/u/.pi/agent/agents/CodeReviewer.md"`
- **WHEN** `state-replay.ts` synthesizes a `tool_execution_end` event and the reducer's backfill runs
- **THEN** `state.subagents.get(agentId).agentMdPath` SHALL equal that string

### Requirement: Dashboard SHALL recommend `pi-dashboard-subagents` as the subagent producer

The `RECOMMENDED_EXTENSIONS` manifest SHALL list `pi-dashboard-subagents` (source `https://github.com/BlackBeltTechnology/pi-dashboard-subagents.git` — the producer is not yet published to npm) as the sole dashboard-supported subagent extension. The previously listed `@tintinweb/pi-subagents` entry SHALL be removed. The new entry SHALL declare `dashboardPlugin: "subagents"` so the recommended-extensions enricher cross-references the `subagents-plugin` and surfaces a `+plugin: subagents` badge.

#### Scenario: Recommended-extensions manifest content

- **WHEN** the `RECOMMENDED_EXTENSIONS` constant is inspected
- **THEN** it SHALL NOT contain any entry whose `id === "tintinweb-pi-subagents"` or whose `source` starts with `"npm:@tintinweb/pi-subagents"`
- **AND** it SHALL contain exactly one entry whose `id === "pi-dashboard-subagents"`
- **AND** that entry's `source` SHALL equal `"https://github.com/BlackBeltTechnology/pi-dashboard-subagents.git"` (or `"npm:pi-dashboard-subagents"` once the producer is published; switching is a one-line edit)
- **AND** that entry's `dashboardPlugin` SHALL equal `"subagents"`
- **AND** that entry's `status` SHALL equal `"optional"`
- **AND** that entry's `toolsRegistered` SHALL be `["Agent"]` (foreground-only producer; no `get_subagent_result` / `steer_subagent`)

#### Scenario: Enricher reports plugin paired

- **GIVEN** the subagents-plugin is loaded and present in the plugin status store
- **WHEN** `GET /api/packages/recommended` is called
- **THEN** the response entry for `pi-dashboard-subagents` SHALL include `dashboardPluginInstalled: true`

#### Scenario: Producer is bundled in the Electron installer

- **WHEN** the `BUNDLED_EXTENSION_IDS` constant in `packages/shared/src/recommended-extensions.ts` is inspected
- **THEN** it SHALL contain `"pi-dashboard-subagents"`
- **AND** every id in `BUNDLED_EXTENSION_IDS` SHALL correspond to an entry in `RECOMMENDED_EXTENSIONS` with a git-based source (existing repo-lint test enforces this)

#### Scenario: First-run Electron install activates the producer

- **GIVEN** a fresh Electron install with no prior `~/.pi/` state
- **WHEN** the first-run wizard completes successfully
- **THEN** `pi-dashboard-subagents` SHALL be present in pi's `packages[]` (in `~/.pi/agent/settings.json`)
- **AND** the dashboard's `Agent` tool cards SHALL render via the inspector without requiring an internet round-trip

### Requirement: `@tintinweb/pi-subagents` specialized renderers SHALL be removed

The dashboard SHALL NOT ship specialized tool renderers for `get_subagent_result` or `steer_subagent`. The Tier-2 "upgrade" footnote in `SubagentDetailView` SHALL be removed. Any leftover header comments referencing `@tintinweb/pi-subagents` in `AgentToolRenderer.tsx` and related files SHALL be refreshed to reference `pi-dashboard-subagents`.

#### Scenario: Tool-renderer registry omits removed renderers

- **WHEN** the tool-renderer registry is inspected
- **THEN** there SHALL be no entry for `get_subagent_result`
- **AND** there SHALL be no entry for `steer_subagent`
- **AND** the source files `GetSubagentResultRenderer.tsx` and `SteerSubagentRenderer.tsx` SHALL NOT exist in `packages/client/src/components/tool-renderers/`

#### Scenario: `get_subagent_result` falls through to GenericToolRenderer

- **GIVEN** a user has `@tintinweb/pi-subagents` installed in pi and a session emits a `get_subagent_result` tool call
- **WHEN** the dashboard chat renders that tool message
- **THEN** it SHALL render via the dashboard's `GenericToolRenderer` (or the equivalent fallback) — not via any specialized component

#### Scenario: No source references to `@tintinweb/pi-subagents` remain

- **WHEN** the repository is searched for `"@tintinweb/pi-subagents"` or `"tintinweb"` outside `openspec/changes/archive/`
- **THEN** zero matches SHALL be found in `packages/`, `docs/`, `README.md`, or `CHANGELOG.md` Unreleased section (historic CHANGELOG entries are exempt)
- **AND** `docs/plans/tintinweb-subagents.md` SHALL NOT exist

### Requirement: subagents-plugin SHALL register a settings section using the canonical plugin-settings flow

The `subagents-plugin` workspace package SHALL declare a `settings-section` claim that renders a single toggle controlling whether subagents inherit ("fork") parent context. The plugin SHALL use the dashboard's canonical plugin-settings mechanism: a `configSchema.json` validated by the runtime's Ajv validator, read by the client via `usePluginConfig<T>()`, written via the shared `POST /api/config/plugins/:id` route. The plugin SHALL NOT register custom REST routes for this purpose.

#### Scenario: Manifest declares the canonical pieces

- **WHEN** `packages/subagents-plugin/package.json` `pi-dashboard-plugin` block is inspected
- **THEN** it SHALL contain `configSchema: "./src/configSchema.json"`
- **AND** it SHALL contain `server: "./src/server/index.ts"`
- **AND** it SHALL contain a `claims` entry of `{ slot: "settings-section", component: "SubagentsSettings", tab: "general" }`
- **AND** it SHALL contain `requires: { piExtensions: ["pi-dashboard-subagents"] }`

#### Scenario: configSchema exposes exactly one property

- **WHEN** `packages/subagents-plugin/src/configSchema.json` is parsed
- **THEN** `properties` SHALL contain exactly one key: `inheritContext`
- **AND** that property's `type` SHALL be `"boolean"`
- **AND** that property's `default` SHALL be `true`
- **AND** the schema's `additionalProperties` SHALL be `false`

#### Scenario: Schema rejects invalid writes

- **GIVEN** the subagents-plugin is loaded
- **WHEN** a client POSTs `{ inheritContext: "not-a-bool" }` to `/api/config/plugins/subagents`
- **THEN** the route SHALL return HTTP 400 with an Ajv validation error message
- **AND** the producer file SHALL NOT be modified

#### Scenario: Settings UI uses `usePluginConfig`

- **WHEN** the `SubagentsSettings.tsx` component renders
- **THEN** it SHALL call `usePluginConfig<{ inheritContext?: boolean }>()` to read the current value
- **AND** it SHALL show a checkbox/toggle labeled "Fork parent context into every subagent"
- **AND** the checkbox's checked state SHALL reflect `config.inheritContext ?? true`

#### Scenario: Toggle click POSTs to the shared route

- **GIVEN** the settings panel is open and the toggle is currently on (`inheritContext: true`)
- **WHEN** the user clicks the toggle
- **THEN** the component SHALL POST `{ inheritContext: false }` to `/api/config/plugins/subagents`
- **AND** SHALL NOT POST to any custom plugin-specific route

#### Scenario: Plugin server reconciles producer file at startup

- **GIVEN** the producer file at `~/.pi/agent/extensions/pi-dashboard-subagents/config.json` exists and contains `{ "inheritContext": false, "exposeInheritanceInTool": true, "inheritance": { ... } }`
- **WHEN** the dashboard server starts and `registerPlugin(ctx)` runs for the subagents plugin
- **THEN** the plugin server SHALL call `ctx.updatePluginConfig({ inheritContext: false })`
- **AND** the dashboard plugin config (read via `usePluginConfig`) SHALL reflect `inheritContext: false`
- **AND** the toggle in the settings UI SHALL render as off on first load

#### Scenario: Plugin server mirrors writes to the producer file (preserving unexposed keys)

- **GIVEN** the producer file currently contains `{ "inheritContext": true, "exposeInheritanceInTool": true, "inheritance": { "recentTurns": 10, "toolOutputWindow": 3, "maxChars": 30000 }, "customUserKey": "keep-me" }`
- **WHEN** a successful `POST /api/config/plugins/subagents` with body `{ "inheritContext": false }` returns 200
- **THEN** the plugin server's `onResponse` hook SHALL fire
- **AND** the producer file SHALL be rewritten with `inheritContext` changed to `false`
- **AND** `exposeInheritanceInTool` SHALL remain `true`
- **AND** all `inheritance.*` values SHALL remain unchanged
- **AND** the `customUserKey` SHALL still equal `"keep-me"`
- **AND** the file write SHALL be atomic (tmp file + rename, not partial-write visible)

#### Scenario: Hook is a no-op for unrelated routes

- **GIVEN** the plugin server is registered
- **WHEN** any of `GET /api/config/plugins/subagents`, `POST /api/config/plugins/other-plugin`, or `POST /api/config/plugins/subagents` returning 400 fires
- **THEN** the plugin's `onResponse` hook SHALL NOT write the producer file

### Requirement: Reducer SHALL backfill `subagents` map from `tool_execution_end`

The reducer's `tool_execution_end` handler SHALL also populate `next.subagents` whenever the event refers to a subagent run — i.e. `data.toolName === "Agent"` AND `data.details?.agentId` is a non-empty string.

Without this, `session.subagents.get(agentId)` is empty after parent-session `/resume` and after any dashboard refresh that occurs once the subagent has completed (the only writer today is the live `subagent_*` event stream, which is NOT synthesized by `state-replay.ts`). Producers persist the full `AgentDetails` (including `entries[]`) inside the parent's `ToolResultMessage.details` per the producer contract — `state-replay.ts` already threads `msg.details` into the synthesized `tool_execution_end` event payload, so the data is available at this seam. This requirement closes the loop on the consumer side.

The handler SHALL derive `SubagentState` fields from `data.details` via the existing `readSubagentDetails(details)` helper, plus:

- `status` ← `"failed"` if `data.isError === true`, else `"completed"`.
- `result` ← `data.result` when a string and `!isError`.
- `error` ← `data.result` when `isError === true`, or `data.details.error` if present.
- `durationMs` ← `data.details.durationMs` when present.
- `tokens` ← `data.details.tokensUsage` when present (the raw `{input, output, total}` shape).
- `toolUses` ← `data.details.toolUses` when present.

When the subagent has ALREADY been recorded in `next.subagents` (e.g. a live `subagent_completed` event arrived earlier in the same session lifetime), the backfill SHALL merge rather than replace: existing fields are preserved unless the new `data.details` provides a non-undefined value. This makes the live path and the replay path commutative — the final state does not depend on event ordering.

Backfill SHALL be a no-op when `toolName !== "Agent"` or `data.details?.agentId` is absent — `tool_execution_end` events for unrelated tools MUST NOT touch the subagents map.

#### Scenario: Replayed completed subagent populates the map

- **GIVEN** a parent session JSONL containing a `ToolResultMessage` with `toolName: "Agent"`, `isError: false`, and `details: { agentId: "sub_abc", entries: [...], durationMs: 4200, tokensUsage: {input: 500, output: 200, total: 700}, displayName: "explorer" }`
- **WHEN** the dashboard subscribes to the session and `state-replay.ts` synthesizes a `tool_execution_end` event from that entry
- **THEN** after the reducer processes the event, `state.subagents.get("sub_abc")` SHALL exist
- **AND** its `status` SHALL be `"completed"`
- **AND** its `entries` SHALL equal the persisted array
- **AND** its `durationMs` SHALL be `4200`
- **AND** its `tokens` SHALL equal `{input: 500, output: 200, total: 700}`
- **AND** its `displayName` SHALL be `"explorer"`

#### Scenario: Replayed failed subagent populates the map with failed status

- **GIVEN** a `tool_execution_end` event with `toolName: "Agent"`, `isError: true`, `result: "aborted by user"`, `details: { agentId: "sub_xyz" }`
- **WHEN** the reducer processes the event
- **THEN** `state.subagents.get("sub_xyz").status` SHALL be `"failed"`
- **AND** the resulting state's `error` SHALL be `"aborted by user"`

#### Scenario: Backfill merges with prior live state without overwriting

- **GIVEN** the subagents map already contains `sub_abc` with `displayName: "liveName"` from a prior `subagent_started` event
- **WHEN** a `tool_execution_end` arrives with `details: { agentId: "sub_abc", displayName: undefined, durationMs: 1234 }`
- **THEN** the resulting `state.subagents.get("sub_abc").displayName` SHALL remain `"liveName"` (not overwritten with undefined)
- **AND** `durationMs` SHALL be updated to `1234`

#### Scenario: Backfill is a no-op for non-Agent tools

- **GIVEN** a `tool_execution_end` event with `toolName: "bash"` and `details: { foo: "bar" }` (no `agentId`)
- **WHEN** the reducer processes the event
- **THEN** `state.subagents` SHALL be unchanged

#### Scenario: Backfill is a no-op when agentId is absent

- **GIVEN** a `tool_execution_end` event with `toolName: "Agent"` but `details` lacks an `agentId` (e.g. legacy `@tintinweb/pi-subagents` payload)
- **WHEN** the reducer processes the event
- **THEN** `state.subagents` SHALL be unchanged
- **AND** `next.messages[i].toolDetails` SHALL still be populated as today (the existing `toolDetails` path is unaffected)
