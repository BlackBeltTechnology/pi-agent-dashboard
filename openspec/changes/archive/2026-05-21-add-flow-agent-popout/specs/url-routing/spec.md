## ADDED Requirements

### Requirement: Plugin-owned overlay routes are dispatched exclusively via `shell-overlay-route`

URL routes that belong to a plugin (full-screen pages mounted at the top of the shell, e.g. subagent popout, flow agent popout, future plugin overlays) SHALL be dispatched via the `shell-overlay-route` slot. The shell (`packages/client/src/App.tsx`) SHALL:

- NOT contain any `useRoute(<plugin-owned-path>)` call for plugin pages.
- NOT import any plugin popout component (`SubagentPopoutPage`, `FlowAgentPopoutPage`, `*PopoutClaim`, or equivalent).
- Mount exactly one `<ShellOverlayRouteSlot>` at the top of the desktop overlay switch.
- Mount exactly one `<ShellOverlayRouteSlot>` inside `MobileShell.detailPanel`.
- Treat the slot's match state as the single source of truth for "is a plugin overlay active?" via `useShellOverlayRouteMatched()`.

When a plugin overlay claim matches, the slot's element SHALL render as the top-level content for that layout. The shell SHALL NOT fall through to `LandingPage`, `sessionDetail`, or any plugin-content-view slot for that URL.

Pre-existing direct-dispatch code in App.tsx for `SubagentPopoutPage` (the `useRoute("/session/:sessionId/subagent/:agentId")` call, its decoded params, its cold-open subscribe effect, and both desktop+mobile dispatch arms) SHALL be removed.

#### Scenario: Desktop deep-link to a plugin overlay route renders the claim

- **GIVEN** the viewport is at desktop width
- **AND** the subagents-plugin has registered a `shell-overlay-route` claim with `config.path: "/session/:sessionId/subagent/:agentId"`
- **WHEN** the URL is `/session/sess_1/subagent/agent_x`
- **THEN** `<ShellOverlayRouteSlot>` SHALL render the subagents-plugin's claim component as the top-level content
- **AND** `LandingPage` SHALL NOT be rendered
- **AND** no session-detail JSX gated by `selectedId` SHALL be rendered

#### Scenario: Mobile deep-link to a plugin overlay route renders the claim

- **GIVEN** the viewport is at mobile width
- **WHEN** the URL is `/session/sess_1/flow/my-pipe/agent/agent_3`
- **THEN** `MobileShell.detailPanel` SHALL render the flows-plugin's claim component via the slot consumer
- **AND** `LandingPage` SHALL NOT be rendered inside `detailPanel`

#### Scenario: No matching overlay claim falls through cleanly

- **WHEN** the URL has no matching `shell-overlay-route` claim
- **THEN** `<ShellOverlayRouteSlot>` SHALL render `null`
- **AND** the shell SHALL render the next branch in its dispatch chain (folder view, session detail, landing) as before

#### Scenario: Shell static-analysis ban

- **WHEN** static analysis (or a repo-lint test) inspects `packages/client/src/App.tsx`
- **THEN** the file SHALL NOT contain `from "@blackbelt-technology/pi-dashboard-subagents-plugin"` imports for `SubagentPopoutPage` or `SubagentPopoutClaim`
- **AND** the file SHALL NOT contain `from "@blackbelt-technology/pi-dashboard-flows-plugin"` imports for `FlowAgentPopoutPage` or `FlowAgentPopoutClaim`
- **AND** the file SHALL NOT contain a `useRoute` call whose path begins with a plugin-owned namespace (`/session/:*/subagent/...`, `/session/:*/flow/...`)

#### Scenario: Single slot mount per layout

- **WHEN** static analysis scans `packages/client/src/App.tsx`
- **THEN** the file SHALL contain at most two `<ShellOverlayRouteSlot` JSX mounts (one for the desktop overlay switch, one for `MobileShell.detailPanel`)
