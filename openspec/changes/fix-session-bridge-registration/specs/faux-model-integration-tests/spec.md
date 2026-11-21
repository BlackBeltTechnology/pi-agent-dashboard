## MODIFIED Requirements

### Requirement: Clean-environment VM smoke

The VM QA suite SHALL include exactly one faux-backed prompt round-trip smoke test proving the prompt round-trip works on a fresh install with no API key, and exactly one further faux-backed bridge session-replacement check (#1175) that needs a real pi runtime.

- `qa/tests/10-faux-model.sh` SHALL spawn `pi` with the faux fixture and `--model faux/faux-1`, drive one happy-path prompt via the dashboard API, and assert the streamed text reaches the browser WS.
- `qa/tests/53-bridge-session-replacement.sh` SHALL spawn `pi --mode rpc` with the bridge extension and the faux fixture, send the RPC `new_session` command, and assert via `/ws` or `GET /api/sessions` that a new session id registers and the old id unregisters. It SHALL skip cleanly (`SKIP:` first line, exit 0) when `pi` is not on PATH and SHALL NOT assert rendered UI.
- Both scripts SHALL be registered in `qa/tests/run-all.sh`.
- The VM layer SHALL carry only these two faux-backed scripts (the happy-path smoke and the session-replacement check); the full scenario matrix lives in the Vitest layers.

#### Scenario: Faux prompt round-trip on a clean VM

- **WHEN** `qa/tests/10-faux-model.sh` runs on a freshly provisioned VM with no model API key
- **THEN** a faux-backed pi session connects to the dashboard
- **AND** a prompt driven via the API produces assistant text on the browser WS
- **AND** the script exits 0

#### Scenario: Session replacement registers a new session on a clean VM

- **WHEN** `qa/tests/53-bridge-session-replacement.sh` runs with `pi` on PATH and a dashboard-registered faux-backed session, and the RPC `new_session` command is sent
- **THEN** a new session id registers with the dashboard and the old id unregisters within a timeout
- **AND** the script exits 0
