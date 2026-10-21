# auto-canvas Specification

## Purpose
TBD - created by archiving change auto-canvas. Update Purpose after archive.

## Requirements

### Requirement: Shared renderability table

The extension→`RendererKind` mapping SHALL live in `packages/shared` (as `RENDERER_BY_EXT`),
consumed by BOTH the client `dispatchPreview` and the server-side canvas detector. `shared`
SHALL NOT import client code. Adding a renderer extension SHALL make it canvas-eligible without
editing the detector.

#### Scenario: Client and detector agree on renderability
- **WHEN** a file extension maps to a non-`fallback` `RendererKind`
- **THEN** both `dispatchPreview` (client) and the canvas detector (server) classify it via the
  same shared `RENDERER_BY_EXT` entry
- **AND** neither package imports the other to obtain it

#### Scenario: Non-renderable extension is not a candidate
- **WHEN** a tool writes a support file (`.css`, `.json`, `.lock`, `.ts`)
- **THEN** the detector's renderability gate returns no candidate for it

### Requirement: Detect classifier is a pure shared function taking cwd

The dashboard SHALL provide `detectCanvasIntent(toolName, args, cwd) → CanvasCandidate | null`,
a pure function. It SHALL classify `write`/`edit` calls by `args.path` and SHALL NOT parse
`bash` command strings for file paths. `cwd` SHALL be supplied from server session state, never
from model-supplied input.

#### Scenario: Write of a renderable file yields a candidate
- **GIVEN** a session whose `cwd` is `/home/u/proj`
- **WHEN** the agent runs `Write` with `path = "report.md"`
- **THEN** `detectCanvasIntent` returns a DOC candidate resolving to
  `{ kind: "file", cwd: "/home/u/proj", path: "report.md" }`

#### Scenario: Bash command string is not path-parsed
- **WHEN** the agent runs `bash` with `command = "pandoc in.md -o out.pdf"`
- **THEN** `detectCanvasIntent` returns `null` (bash/skill outputs reach the canvas only via the `canvas()` declare-tool)

### Requirement: Per-turn accumulation with unconditional buffer reset

The server SHALL accumulate canvas candidates per session per turn at the same event-wiring call
site as `detectOpenSpecActivity`, mirroring its `replayingSessions` skip and `queue_state` skip.
At `agent_end` it SHALL flush via `selectCanvasTarget` and then reset the candidate buffer. The
buffer reset SHALL occur on every turn boundary — `agent_end` AND abort/termination — and SHALL
NOT be tied to the guarded OpenSpec-state clear (which is skipped on turns without OpenSpec
activity), so candidates never leak across turns.

#### Scenario: Replayed events do not drive the live canvas
- **GIVEN** a session whose events are being replayed (`replayingSessions.has(sessionId)`)
- **WHEN** a replayed `write` event passes through event-wiring
- **THEN** no canvas candidate is accumulated and no canvas opens

#### Scenario: Buffer resets on a non-OpenSpec turn
- **GIVEN** a turn that writes `report.md` (no OpenSpec activity, so the guarded OpenSpec clear is skipped)
- **WHEN** the turn ends at `agent_end`
- **THEN** the candidate buffer is reset regardless
- **AND** the next turn does not inherit stale candidates

#### Scenario: Aborted turn does not leak candidates
- **GIVEN** a turn that writes `draft.md` and is then aborted
- **WHEN** the abort/termination fires (no `agent_end` settle)
- **THEN** the candidate buffer is reset without settling
- **AND** a subsequent write-less turn does not adopt `draft.md` as its canvas

### Requirement: Target selection priority

`selectCanvasTarget(candidates)` SHALL choose by priority `DECLARE > DOC`, breaking DOC ties by
recency (newest file). Server targets arrive only as DECLARE (servers are declare-only). When a
DECLARE candidate is present it SHALL be used and all detected DOC candidates and the type
registry SHALL be ignored.

#### Scenario: Declare overrides detection
- **GIVEN** a turn that writes `a.md`, `b.svg`, and calls `canvas({ target: { kind:"file", path:"report.md" } })`
- **WHEN** `selectCanvasTarget` runs at turn end
- **THEN** the canvas target is `report.md`, ignoring `a.md` and `b.svg` and the registry

#### Scenario: No declare uses newest DOC
- **GIVEN** a turn that writes `intro.md` then `report.md`, no `canvas()` call
- **WHEN** `selectCanvasTarget` runs
- **THEN** the DOC candidate `report.md` (newest) wins

### Requirement: Detection reads write/edit paths only; other outputs need declare

Auto-detection SHALL read `args.path` from `write`/`edit` tool calls only. It SHALL NOT perform a
filesystem scan, SHALL NOT parse `bash` command strings, SHALL NOT scrape tool result text for
paths, and SHALL NOT consult `.gitignore`. Renderable outputs produced by bash- or skill-driven
tools (`nano-banana`/imagegen, `pandoc`, converters, `serve_mockup`) SHALL reach the canvas via
the `canvas()` declare-tool, not detection.

#### Scenario: Directly-written gitignored deliverable is detected
- **WHEN** a `write` call has `path = "dist/report.pdf"` and `dist/` is gitignored
- **THEN** it becomes a DOC candidate (gitignore not consulted)

#### Scenario: Concurrent sibling session is not misattributed
- **GIVEN** two sessions sharing a `cwd`
- **WHEN** session B writes `b.pdf`
- **THEN** session A (reading only A's own tool args) does not surface `b.pdf`

#### Scenario: Bash-produced file is not auto-detected
- **WHEN** a bash call runs `pandoc in.md -o out.pdf`
- **THEN** detection surfaces no candidate; the deliverable reaches the canvas only if the agent calls `canvas()`

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

### Requirement: Canvas-type registry gates DETECT only, default all-on

The dashboard SHALL define `canvasTypes: Record<RendererKind, boolean>` over the 8 non-`fallback`
kinds, defaulting every kind to `true`. Effective value SHALL be
`{ ...DEFAULT, ...global.canvasTypes, ...project.canvasTypes }` read from
`~/.pi/agent/settings.json#dashboard.canvasTypes` (global) and `<cwd>/.pi/settings.json#dashboard.canvasTypes`
(project). The registry SHALL gate DETECT candidates only; `canvas()` and manual `/view`/click
SHALL bypass it. There SHALL be no separate server toggle (servers are declare-only; declares bypass the registry).

#### Scenario: Absent config auto-canvases every renderable kind
- **GIVEN** no `canvasTypes` in either settings file
- **WHEN** the agent writes a renderable file
- **THEN** it auto-canvases (all kinds default on)

#### Scenario: Project disables a kind for detection only
- **GIVEN** project settings `{ canvasTypes: { image: false } }`
- **WHEN** the agent writes `chart.png`
- **THEN** no auto-canvas fires
- **AND** the user can still open `chart.png` manually via `/view` or a link click

#### Scenario: Declare bypasses the registry
- **GIVEN** project settings `{ canvasTypes: { image: false } }`
- **WHEN** the agent calls `canvas({ target: { kind:"file", path:"chart.png" } })`
- **THEN** the canvas opens `chart.png` despite the registry disabling image detection

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

### Requirement: Canvas chip tray floats above the composer without affecting layout

The canvas chip tray (server chip and mobile tap-to-open chip) SHALL render as a
floating overlay portaled to the top-level layer root, taking no space in the page layout. A chip appearing,
changing or disappearing SHALL NOT change the position or size of any other
element. The tray SHALL be anchored at the bottom-right, directly above the live session's
composer stack (the context strip, status, queue and composer rows, including plugin
composer-panel content), and SHALL track that stack's top edge so it never overlaps
it. A frozen (overlay-underlay) session view SHALL NOT determine the anchor. When no
live composer is mounted the tray SHALL rest at the viewport's bottom-right inset,
clear of the device safe-area inset, and SHALL never be wider than the viewport minus its inset.
The tray SHALL stack below composer popovers, dialogs and toasts. Only the chips
SHALL receive pointer input; the tray's empty area SHALL let pointer events
through to the content beneath.

#### Scenario: Chip appearing does not move the toolbar
- **GIVEN** a desktop session view with no canvas chip
- **WHEN** the session's canvas state gains a server chip
- **THEN** the header and toolbar bounding boxes are unchanged
- **AND** the chip is visible at the bottom-right above the composer

#### Scenario: Tray follows a growing composer stack
- **GIVEN** a server chip is shown above the composer stack
- **WHEN** the stack grows (multi-line draft or a queued follow-up row)
- **THEN** the chip's bottom edge stays above the stack's top edge

#### Scenario: A frozen underlay never anchors the tray
- **GIVEN** a server chip is shown for a session
- **WHEN** a route-backed overlay dialog is open over a frozen copy of that session view
- **THEN** the tray is not anchored to the frozen copy's composer stack
- **AND** the dialog paints above the tray

#### Scenario: Tray does not flash before it is positioned
- **GIVEN** a live composer stack is mounted
- **WHEN** a chip first appears
- **THEN** the tray is not visible at any position that overlaps the composer stack before its anchor has been measured

#### Scenario: Tray stays above the soft keyboard
- **GIVEN** a mobile viewport with a chip shown
- **WHEN** the soft keyboard opens and shrinks the visual viewport
- **THEN** the chip stays visible above the composer stack

#### Scenario: Composer popover paints above the tray
- **GIVEN** a server chip is shown
- **WHEN** the user opens the composer's model selector
- **THEN** the popover is painted above the chip

#### Scenario: Empty tray area does not block clicks
- **GIVEN** a chip is shown
- **WHEN** the user clicks content beneath the tray's empty area
- **THEN** the click reaches that content

#### Scenario: Mobile tap-to-open chip floats too
- **GIVEN** a mobile viewport with a pending canvas file target
- **WHEN** the tap-to-open chip is shown
- **THEN** it floats above the composer without shifting the chat layout
- **AND** tapping it still opens the target in the foreground

### Requirement: canvas() guidance steers local servers to loopback URLs

The `canvas` tool's model-facing guidance SHALL instruct the agent to declare a local server by its localhost URL (`http://localhost:<port>/…`) and never by a LAN or IP address, and to declare a local HTML file as a file target. The dashboard's loopback-only routing SHALL be unchanged.

#### Scenario: Guidance present in the tool definition
- **WHEN** the bridge registers the `canvas` tool
- **THEN** its guidelines state that local servers are declared by localhost URL, not LAN or IP URLs
- **AND** that a local HTML file is declared with `kind:'file'`
