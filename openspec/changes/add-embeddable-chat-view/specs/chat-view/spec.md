# chat-view — delta

## ADDED Requirements

### Requirement: Chat view importable by sibling workspace packages
The live chat UI SHALL be importable by other packages in the monorepo through a curated subpath export `"./chat-embed"` on `@blackbelt-technology/pi-dashboard-web`, without requiring the consumer to reach into deep source paths. The export surface SHALL expose the full-fidelity chat surface (larger than `ChatView` alone): the `ChatView` component + props type, the per-session display-preferences menu component, the steer/abort/fork input+action surface, the `SessionState` and `ToolContext` types, and the context providers a host must mount. Because `packages/client` publishes only `dist/`, the `"./chat-embed"` subpath SHALL be treated as **workspace-only** (usable by monorepo siblings via the workspace symlink, NOT by an npm-registry install). The export SHALL be additive: it SHALL NOT alter the dashboard app's own runtime behaviour or Vite build output.

#### Scenario: Sibling imports the chat surface via subpath
- **WHEN** a sibling workspace package imports from `@blackbelt-technology/pi-dashboard-web/chat-embed`
- **THEN** the import SHALL resolve `ChatView`, the display-preferences menu, and `useSessionState`, and type-check against their exported types
- **AND** no deep relative source path SHALL be required

#### Scenario: package.json resolution preserved (build-safety)
- **WHEN** the `exports` map is added to `packages/client/package.json`
- **THEN** `"./package.json"` SHALL remain resolvable so that `packages/server/src/server.ts` and `packages/electron/scripts/bundle-server.mjs` continue to resolve `@blackbelt-technology/pi-dashboard-web/package.json`

#### Scenario: App behaviour and build unchanged by the export surface
- **WHEN** the dashboard app is built and run after the subpath export is added
- **THEN** its runtime behaviour and Vite build output SHALL be identical to before the export existed

### Requirement: Headless session-state hook driven by the dashboard protocol
The event→state reduction that produces `SessionState` SHALL be available as a headless hook `useSessionState` that consumes the same pi dashboard event stream and returns the current `SessionState`, with no JSX or UI-primitive dependencies. The reduction primitives (`createInitialState`, `reduceEvent`) already exist as pure functions in `event-reducer.ts`; the hook SHALL wrap them and SHALL replicate the `event_replay` sequence-reset semantics (the `maxSeqMapRef`/`shouldReset` decision made before folding) so that replay correctness is preserved.

#### Scenario: Hook reduces the event stream to SessionState
- **WHEN** `useSessionState` is driven by a sequence of dashboard events equivalent to a real session
- **THEN** it SHALL return a `SessionState` identical to what the app's existing driver produces for the same sequence

#### Scenario: Replay resets state correctly
- **WHEN** an `event_replay` arrives whose sequence indicates a reset relative to the tracked max sequence
- **THEN** `useSessionState` SHALL reset before folding the replayed events, matching the app's existing behaviour
