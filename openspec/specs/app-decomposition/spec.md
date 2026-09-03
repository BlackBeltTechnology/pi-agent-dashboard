# app-decomposition Specification

## Purpose

Keeps the dashboard client's root `App` component tractable by extracting its state, message handling, session actions, OpenSpec actions, content views, session detail view, and layout into dedicated hooks and components. Defines what each extracted unit owns so behaviour stays identical while the root component stops accreting responsibilities, and pins the reconnect path's ordering so a session-registry reset cannot race the incoming snapshot.

## Requirements

### Requirement: App state hook extraction
App.tsx SHALL delegate all useState and useRef declarations to a `useAppState` hook that returns a typed state object and setter functions.

#### Scenario: State hook provides all app state
- **WHEN** App component mounts
- **THEN** useAppState returns sessions, sessionStates, terminals, openspecMap, modelsMap, and all other state slices with their setters

### Requirement: Message handler hook extraction
App.tsx SHALL delegate the ServerToBrowserMessage switch handler to a `useMessageHandler` hook that receives state setters and WebSocket send function.

#### Scenario: Message handler processes all message types
- **WHEN** a WebSocket message arrives
- **THEN** useMessageHandler dispatches to the correct state setter (session_added, event, event_replay, terminal_added, etc.) identically to the current inline handler

### Requirement: Session actions hook extraction
App.tsx SHALL delegate session action callbacks (send, abort, resume, spawn, hide, unhide, rename, shutdown, terminal create/kill/rename) to a `useSessionActions` hook.

#### Scenario: Session action callbacks work through hook
- **WHEN** user triggers a session action (e.g., send prompt, abort, resume)
- **THEN** the action callback from useSessionActions sends the correct WebSocket message and applies optimistic UI updates

### Requirement: OpenSpec actions hook extraction
App.tsx SHALL delegate OpenSpec-related callbacks (refresh, bulk archive, read artifact, attach/detach proposal) to a `useOpenSpecActions` hook.

#### Scenario: OpenSpec actions work through hook
- **WHEN** user triggers an OpenSpec action (e.g., refresh, attach proposal)
- **THEN** the action callback from useOpenSpecActions sends the correct WebSocket message

### Requirement: Content views hook extraction
App.tsx SHALL delegate content view state and fetch logic (pi resources, pi resource file preview, readme preview) to a `useContentViews` hook.

#### Scenario: Content view fetch and state through hook
- **WHEN** user opens a pi resource file or README preview
- **THEN** useContentViews manages loading state and fetches content via REST API

### Requirement: Session detail view extraction
App.tsx SHALL render the session detail area (header, token stats, content router, status bar, command input) via a `SessionDetailView` component.

#### Scenario: Session detail renders all sub-components
- **WHEN** a session is selected
- **THEN** SessionDetailView renders SessionHeader, TokenStatsBar, content area (chat/flow/preview/diff), StatusBar, and CommandInput

### Requirement: Layout component extraction
App.tsx SHALL delegate desktop and mobile layout rendering to `DesktopLayout` and `MobileLayout` components respectively.

#### Scenario: Desktop layout renders sidebar and detail
- **WHEN** viewport is desktop
- **THEN** DesktopLayout renders ResizableSidebar with SessionList alongside the content area

#### Scenario: Mobile layout renders MobileShell
- **WHEN** viewport is mobile
- **THEN** MobileLayout renders MobileShell with list panel and detail panel with correct depth and back navigation

### Requirement: Reconnect handler defers session-registry reset to snapshot

The reconnect effect in `App.tsx` (the one keyed on transitioning to `status === "connected"`) SHALL NOT pre-reset `sessionOrderMap`. The incoming `sessions_snapshot` message SHALL be the sole authority for replacing both `sessions` and `sessionOrderMap` after reconnect.

The same effect SHALL continue to clear `subscribedRef` and `terminals` because those are not covered by the snapshot.

#### Scenario: Reconnect does not flash empty sidebar
- **WHEN** the WebSocket transitions from non-connected to `connected`
- **THEN** `App.tsx` SHALL NOT call `setSessionOrderMap(new Map())`
- **AND** `App.tsx` SHALL still call `subscribedRef.current.clear()` and `setTerminals(new Map())`

#### Scenario: Snapshot drives the post-reconnect state
- **WHEN** the post-reconnect `sessions_snapshot` arrives
- **THEN** `useMessageHandler` SHALL replace both `sessions` and `sessionOrderMap` with the snapshot payload (see session-listing spec)
