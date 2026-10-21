## MODIFIED Requirements

### Requirement: canvas() declare-tool normalizes into a real ViewTarget

The dashboard SHALL expose a `canvas({ target, mode?, title?, section? })` tool **registered in
the bridge extension (`packages/extension`, the `pi.registerTool` surface)** — not server-side —
so pi can call it and its call forwards on the tool-event stream the server observes. It SHALL
return a trivial `{ ok: true }` ack; the result SHALL NOT be relied upon to be stripped from pi's
history. The `target` input is a convenience shape normalized server-side into a real
`ViewTarget`: `file.path` + server-supplied session `cwd` → `{ kind:"file", cwd, path }`;
a non-loopback `url` passes through as a `ViewTarget`. A `server.port` target, and a `url` whose host
is loopback, SHALL NOT be converted to a `ViewTarget`; each SHALL route directly to the server
chip path (a URL keeps its path for the open after the tap), bypassing `selectCanvasTarget`. A model-supplied `cwd` or traversal path, or a rejected declare,
SHALL return an error result — NOT `{ ok: true }`; the ack SHALL claim success only when the
dashboard accepted the declare.

#### Scenario: Tool registers in the bridge extension
- **WHEN** the dashboard bridge extension loads
- **THEN** it registers a `canvas` tool via `pi.registerTool` so the agent can call it
- **AND** the server drives the canvas by observing the forwarded `canvas` tool call, not by registering the tool itself

#### Scenario: File target gets server cwd
- **WHEN** the agent calls `canvas({ target: { kind:"file", path:"report.md" } })` in a session with `cwd=/home/u/proj`
- **THEN** the normalized target is `{ kind:"file", cwd:"/home/u/proj", path:"report.md" }`

#### Scenario: Traversal path rejected with an error ack
- **WHEN** the agent calls `canvas({ target: { kind:"file", path:"../../etc/passwd" } })`
- **THEN** the server rejects it, no canvas opens outside the session cwd
- **AND** the tool returns an error result, not `{ ok: true }`

#### Scenario: Server target is dashboard-probed for loopback
- **WHEN** the agent calls `canvas({ target: { kind:"server", port: 5173 } })`
- **THEN** the dashboard itself probes `127.0.0.1:5173` (never trusting an announced host) and routes through the confirm-chip path, not an auto-open

#### Scenario: Last declare wins within a turn
- **WHEN** the agent calls `canvas()` twice in one turn with different targets
- **THEN** both the eager-open and the turn-end settle resolve to the last declared target

#### Scenario: Loopback URL declare routes to the chip
- **WHEN** the agent calls `canvas({ target: { kind:"url", url:"http://127.0.0.1:5173/app" } })`
- **THEN** no auto-open occurs and a confirm chip carrying port 5173 and path `/app` surfaces


### Requirement: Auto-opened file documents carry a restrictive CSP

The dashboard SHALL apply a restrictive Content-Security-Policy (blocking external subresources)
to any auto-opened agent-authored file-kind document (svg, md, pdf opened via the
DOC-detect path without a user click), so auto-open egress does not exceed the existing manual
click-to-open flow, and it SHALL ship with auto-open rather than later. An auto-opened `.html`
document SHALL instead be served as a live-server static target under the restricted
preview-egress policy: external origins are blocked unless granted for that preview or its
project, and scripts run only while the dashboard is reachable from this machine alone. The CSP SHALL NOT apply to `canvas()` URL or youtube declares, which render a live
URL and are egress-equal to a manual URL open.

#### Scenario: Auto-opened HTML cannot beacon out
- **GIVEN** an agent-written `.html` containing `<img src="http://attacker/beacon">`
- **WHEN** the canvas auto-opens it
- **THEN** the external subresource is blocked by the preview's content security policy

#### Scenario: Auto-opened HTML loads a granted CDN
- **GIVEN** `https://cdn.tailwindcss.com` is granted for the session's project
- **WHEN** the canvas auto-opens an agent-written `.html` that loads it
- **THEN** the CDN loads and the page renders styled

#### Scenario: URL declare renders normally
- **WHEN** the agent calls `canvas({ target: { kind:"url", url:"https://youtu.be/abc" } })`
- **THEN** the URL renders without the document CSP (egress-equal to a manual URL open)

### Requirement: Auto-open drives the split-workspace surface without disrupting the reader

On desktop/tablet the auto-canvas driver SHALL open the winning target through the
existing split-workspace openers (`openInSplit` for non-HTML file targets, a static live-server
target for `.html` file targets, `openUrlTarget` for generic non-loopback urls). Loopback urls never
auto-open; they surface the confirm chip. The auto-open SHALL be
**non-disruptive**: it SHALL reveal `split` only when the current mode is `closed`;
when the editor is already shown (`split` or `full`) it SHALL leave the mode
unchanged, add the target's tab **without** changing the active tab, mark it
**unread**, and play a one-time highlight — for all target kinds. When the target's tab is
already open and only the canvas version changed, the driver SHALL NOT open another tab: a
background tab SHALL reload, and the active tab SHALL keep its content and offer a reload. On mobile the
driver SHALL NEVER yank chat; it SHALL surface a tap-to-open chip. A target withheld by
the mobile gate SHALL NOT count as delivered: when the viewport later grows to
desktop/tablet, the driver SHALL auto-open that same pending target (same version)
without requiring a new canvas write. The chip tap is a
**user** action and SHALL be **foreground** (activates the tab), even though the
auto-open path that shares its handler is background.

#### Scenario: Auto-open from closed reveals the split
- **GIVEN** `closed` mode (chat only) on desktop
- **WHEN** the session's canvas target changes to a renderable file
- **THEN** the mode becomes `split` and the file opens as the active tab

#### Scenario: Auto-open while reading is silent
- **GIVEN** `split` or `full` mode on desktop with a tab being read
- **WHEN** the session's canvas target changes to a different file
- **THEN** the mode is unchanged
- **AND** the active tab is unchanged
- **AND** the canvas target's tab is added, marked unread, with a one-time highlight

#### Scenario: HTML file target opens as a served page
- **GIVEN** desktop and an agent-written `mockups/a/index.html` linking `./style.css`
- **WHEN** the canvas target changes to that file
- **THEN** it opens in a live-server tab with the stylesheet applied

#### Scenario: Second file under the same root gets its own tab
- **GIVEN** `split` mode with `mockups/a/index.html` open and active
- **WHEN** the canvas target changes to `mockups/a/settings.html`
- **THEN** a new tab is added for `settings.html` and the active tab still shows `index.html`

#### Scenario: Version bump reloads a background tab
- **GIVEN** a canvas target open in a tab that is not active
- **WHEN** the same target is declared again with a higher version
- **THEN** that tab's content reloads and no second tab is opened

#### Scenario: Version bump does not disturb the reader
- **GIVEN** the user is viewing the canvas target's tab
- **WHEN** the same target is declared again with a higher version
- **THEN** the content is unchanged and a reload is offered

#### Scenario: Mobile still surfaces a chip
- **GIVEN** a mobile viewport (`<768w` OR `<600h`)
- **WHEN** the canvas target changes
- **THEN** no pane is yanked and a tap-to-open chip is shown

#### Scenario: Target withheld on mobile opens when the viewport grows
- **GIVEN** a canvas target delivered while the viewport is mobile (chip shown, nothing opened)
- **WHEN** the viewport grows to desktop or tablet with the same target and version
- **THEN** the driver auto-opens that target (background semantics) without a new canvas write
- **AND** an already-opened target is not re-opened by unrelated re-renders

#### Scenario: Tapping the chip activates (foreground), not silent
- **GIVEN** the mobile tap-to-open chip is shown
- **WHEN** the user taps it
- **THEN** the target opens and becomes the active tab (foreground)
- **AND** it is not left unread — the shared `useOpenTarget` handler passes
  foreground intent for the chip tap while the auto-open effect passes background

## ADDED Requirements

### Requirement: canvas() guidance steers local servers to loopback URLs

The `canvas` tool's model-facing guidance SHALL instruct the agent to declare a local server by its localhost URL (`http://localhost:<port>/…`) and never by a LAN or IP address, and to declare a local HTML file as a file target. The dashboard's loopback-only routing SHALL be unchanged.

#### Scenario: Guidance present in the tool definition
- **WHEN** the bridge registers the `canvas` tool
- **THEN** its guidelines state that local servers are declared by localhost URL, not LAN or IP URLs
- **AND** that a local HTML file is declared with `kind:'file'`
