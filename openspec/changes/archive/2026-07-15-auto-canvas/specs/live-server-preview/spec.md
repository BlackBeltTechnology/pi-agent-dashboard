# live-server-preview — delta

## ADDED Requirements

### Requirement: Declared servers are dashboard-probed for loopback, never auto-detected

The dashboard SHALL NOT auto-detect agent-started servers from tool output (the announced host is
untrusted — e.g. `serve_mockup` binds `0.0.0.0` but announces `localhost`, and `npm run dev`
emits no structured signal). A server SHALL reach the canvas only via
`canvas({ target: { kind:"server", port } })` or the existing manual `LiveServerViewer`. A
declared server SHALL surface a confirm chip **without any pre-confirm fetch or probe** of the
agent-supplied port. The loopback probe of `127.0.0.1:port` SHALL happen only on chip tap (the
explicit-confirm gesture), reusing the existing allowlist-add endpoint, and SHALL NOT trust an
agent-announced host. This preserves the invariant that targets are never fetched automatically
from agent-supplied input (no auto-fetch precedes explicit confirmation).

#### Scenario: Chip surfaces without a pre-confirm probe
- **WHEN** the agent calls `canvas({ target: { kind:"server", port: 5173 } })`
- **THEN** a confirm chip surfaces with no fetch or probe of port 5173
- **AND** the dashboard probes `127.0.0.1:5173` only when the user taps the chip

#### Scenario: Announced host is never trusted
- **GIVEN** a tool announced a server at `http://localhost:5173` while actually binding `0.0.0.0`
- **WHEN** any server path runs
- **THEN** the dashboard relies on its own `127.0.0.1:5173` probe, not the announced host, and no auto-open occurs

#### Scenario: No structured-signal server is simply not surfaced
- **WHEN** the agent starts `npm run dev` (no declare, no structured signal)
- **THEN** no chip appears automatically; the user opens it via the manual `LiveServerViewer` or the agent declares it

### Requirement: Confirm chip re-validates liveness on tap and expires

The server confirm chip SHALL carry the declared server's identity and SHALL probe that
`127.0.0.1:port` is a live loopback listener **at tap time** (the first and only probe) before
opening. On **connection-refused** it SHALL immediately show a "server not running" state; on a
probe exceeding **3000ms** it SHALL show a "server not responding" state. It SHALL NOT open an
iframe in either case. The chip SHALL expire at the turn boundary or on a server-exit signal, so
a stale chip cannot open an unintended process later holding the same port.

#### Scenario: Refused connection shows 'not running' immediately
- **GIVEN** a confirm chip for a declared port whose server has exited (connection refused)
- **WHEN** the user taps it
- **THEN** the dashboard shows a "server not running" state at once, no iframe

#### Scenario: Unresponsive port times out at 3000ms
- **GIVEN** a confirm chip for a port that accepts the connection but never responds
- **WHEN** the user taps it
- **THEN** after 3000ms the dashboard shows a "server not responding" state, no iframe

#### Scenario: Chip expires at turn boundary
- **WHEN** the turn that produced the chip ends or a server-exit signal fires
- **THEN** the chip is no longer actionable
