## ADDED Requirements

### Requirement: Streaming bash and bash session env adoption SHALL be a documented feasibility spike

pi's streaming `bash_execution_update` events (0.82.0) fire **only for direct RPC bash commands correlated by request id** (`docs/rpc.md`), and the bash-tool session env vars (`PI_SESSION_ID`, `PI_SESSION_FILE`, `PI_PROVIDER`, `PI_MODEL`, `PI_REASONING_LEVEL`) are injected **only into commands run by pi's LLM-callable/factory bash tools**. The dashboard has no RPC-bash path: dashboard-initiated `!`/`!!`/slash-exec commands run through `handleBashCommand` via `pi.exec(...)` and emit the dashboard's own synthetic `bash_output` event; LLM tool bash renders via `tool_execution_*`; server-side worktreeInit hooks run as separate server child processes. None of these receive `bash_execution_update` or pi's bash-tool session env.

Therefore this change SHALL treat streaming-bash and bash-session-env adoption as a **feasibility spike**, not a committed implementation. The spike SHALL determine whether any dashboard bash path can, in fact, surface `bash_execution_update` or read the pi bash-tool session env (including whether `pi.exec` children inherit `PI_SESSION_*` from the pi process env), and SHALL record the outcome. Code SHALL land ONLY if the spike identifies a concrete applicable path; otherwise the requirement is satisfied by the recorded finding. In all cases the existing dashboard `bash_output` event contract SHALL remain unchanged.

**Spike outcome (recorded):** investigation against pi `0.83.0` + the dashboard source confirms **no applicable path** today — the dashboard issues no RPC `bash` (dashboard bash runs via `pi.exec` in `handleBashCommand` → synthetic `bash_output`; LLM bash → `tool_execution_*`), and pi injects `PI_SESSION_*` only into its own bash-tool command env (`environment-variables.md`), not into `pi.exec` children or the server-side worktreeInit bash (a separate process). No streaming/env code lands; the `bash_output` contract is unchanged. Re-evaluate if the dashboard ever adopts an RPC-bash path.

#### Scenario: Spike finds no applicable path

- **GIVEN** the dashboard issues no RPC bash and registers no pi bash tool
- **WHEN** the streaming-bash / bash-session-env feasibility spike runs
- **THEN** the outcome SHALL be recorded as "not applicable to the current architecture"
- **AND** no streaming code SHALL land
- **AND** the existing `bash_output` event contract SHALL be unchanged

#### Scenario: Spike finds an applicable path

- **GIVEN** the spike identifies a concrete dashboard bash path that surfaces `bash_execution_update` or the bash-tool session env
- **WHEN** an adoption is implemented for that path
- **THEN** it SHALL be feature-detected (present → enhanced, absent → today's behavior)
- **AND** the existing `bash_output` event contract SHALL remain the source of truth for the final rendered card
