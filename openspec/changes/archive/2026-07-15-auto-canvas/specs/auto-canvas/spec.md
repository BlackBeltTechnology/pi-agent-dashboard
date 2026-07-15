# auto-canvas — delta

## ADDED Requirements

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
`url` passes through as a `ViewTarget`. A `server.port` target SHALL NOT be converted to a
`ViewTarget` (the union has no server kind); it SHALL route directly to the server chip path,
bypassing `selectCanvasTarget`. A model-supplied `cwd` or traversal path, or a rejected declare,
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
to any auto-opened agent-authored file-kind document (html, svg, md, pdf opened via the
DOC-detect path without a user click), so auto-open egress does not exceed the existing manual
click-to-open flow, and it SHALL ship with auto-open rather than later. The CSP SHALL NOT apply to
`canvas()` URL or youtube declares, which render a live URL and are egress-equal to a manual URL open.

#### Scenario: Auto-opened HTML cannot beacon out
- **GIVEN** an agent-written `.html` containing `<img src="http://attacker/beacon">`
- **WHEN** the canvas auto-opens it
- **THEN** the external subresource is blocked by the preview frame CSP

#### Scenario: URL declare renders normally
- **WHEN** the agent calls `canvas({ target: { kind:"url", url:"https://youtu.be/abc" } })`
- **THEN** the URL renders without the document CSP (egress-equal to a manual URL open)
