## ADDED Requirements

### Requirement: Dropped-frame diagnostics identify forced recovery
The server diagnostics surface SHALL distinguish frames dropped under browser back-pressure from browser connections terminated to force state recovery. Counters SHALL remain bounded summaries and SHALL NOT retain an unbounded event history.

#### Scenario: Back-pressure recovery is observable
- **WHEN** a browser frame is dropped because the socket exceeds the send-buffer ceiling
- **THEN** `/api/health` SHALL increment the server-to-browser dropped-frame count
- **AND** SHALL increment a forced-reconnect attempt count once for the affected connection
- **AND** a rate-limited log entry SHALL state that reconnect/replay was forced

#### Scenario: Drop storm remains bounded
- **WHEN** many frames target the same over-cap socket before its close completes
- **THEN** the gateway SHALL request termination at most once for that socket
- **AND** SHALL not allocate one queued recovery object per dropped frame
