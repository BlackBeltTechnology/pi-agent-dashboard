## MODIFIED Requirements

### Requirement: Tool renderer registry
The client SHALL maintain a registry mapping tool names to renderer components. A `getToolRenderer(toolName)` function SHALL return the specialized renderer for known tools, route any unmapped tool whose name begins with `ctx_` to `CtxToolRenderer`, and otherwise fall back to `GenericToolRenderer`.

Built-in renderers:
- `read` → `ReadToolRenderer`
- `edit` → `EditToolRenderer`
- `write` → `WriteToolRenderer`
- `bash` → `BashToolRenderer`
- `canvas` → `CanvasToolRenderer`
- `ctx_execute`, `ctx_execute_file`, `ctx_batch_execute`, `ctx_search`, `ctx_index`, `ctx_fetch_and_index`, `ctx_insight` → `CtxToolRenderer`
- Other tools named `ctx_*` → `CtxToolRenderer`
- All others → `GenericToolRenderer`

#### Scenario: Known tool renders with specialized view
- **WHEN** a tool call for "read" is displayed
- **THEN** the `ReadToolRenderer` SHALL be used

#### Scenario: Canvas tool renders with canvas view
- **WHEN** a tool call for "canvas" is displayed
- **THEN** the `CanvasToolRenderer` SHALL be used

#### Scenario: Known ctx tool renders with ctx view
- **WHEN** a tool call for "ctx_search" is displayed
- **THEN** the `CtxToolRenderer` SHALL be used

#### Scenario: Unmapped ctx-prefixed tool routes to ctx renderer
- **WHEN** a tool call for "ctx_stats" (not in the explicit map) is displayed
- **THEN** the `CtxToolRenderer` SHALL be used

#### Scenario: Unknown non-ctx tool uses generic renderer
- **WHEN** a tool call for "custom_tool" is displayed
- **THEN** the `GenericToolRenderer` SHALL be used

## ADDED Requirements

### Requirement: CanvasToolRenderer shows the declared target

`CanvasToolRenderer` SHALL show the declared title when present, an icon for the target kind, and the target itself: the file path, the URL, or `:port` for a server target. It SHALL NOT show the raw JSON acknowledgement. An error acknowledgement SHALL render its error message as an error line. Its code-styled text SHALL follow the uniform code payload font size.

#### Scenario: File declare
- **WHEN** a `canvas` call with `target {kind:"file", path:"mockups/a/index.html"}` and title "Mockup" completes
- **THEN** the card shows "Mockup", a file icon and `mockups/a/index.html`, and no `{"ok":true}` text

#### Scenario: Rejected declare
- **WHEN** a `canvas` call completes with `{ok:false, error:"canvas: url target must be a valid URL"}`
- **THEN** the card shows that error as an error line

### Requirement: Only the active canvas card opens its target

Only the card for the `canvas` call that produced the session's current canvas target or current server chip SHALL render its target as a link; an earlier call declaring the same target is superseded. Activating the link SHALL open the target in the canvas as the active tab: a file target as an operator open, and a server or loopback URL target exactly like tapping its confirm chip. Every other `canvas` card SHALL render its target as plain text without a link.

#### Scenario: Latest declare is clickable
- **GIVEN** two `canvas` calls in a session, the second for `http://localhost:5173/`, and that URL is the current canvas target
- **WHEN** the user clicks the second card's target
- **THEN** the live-server tab for that URL opens and becomes active

#### Scenario: Superseded declare is plain
- **GIVEN** the same session
- **WHEN** the first card renders
- **THEN** its target is plain text and is not a link

#### Scenario: Re-declaring the same target supersedes the earlier card
- **GIVEN** two `canvas` calls declaring the same `http://localhost:5173/`
- **WHEN** both cards render
- **THEN** only the second card's target is a link

#### Scenario: Active URL card click behaves like the confirm chip
- **GIVEN** the active card declares `http://localhost:5173/app` and its confirm chip is pending
- **WHEN** the user clicks the card's target
- **THEN** the dashboard probes `127.0.0.1:5173` and, if live, opens `/app` under the restricted policy

#### Scenario: Card click is an operator open
- **GIVEN** the active card targets a local `.html` file
- **WHEN** the user clicks it
- **THEN** the file opens with scripts and open egress
