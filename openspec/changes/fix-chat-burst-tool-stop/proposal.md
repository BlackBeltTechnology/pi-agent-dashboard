## Why

A running tool can be stopped from the session card (PROCESS subcard → `SessionActivityBar` ■), but not from its card in the chat view. Burst grouping is universal (threshold 1), so every `toolResult` row — including a lone running `bash` — renders inside `ToolBurstGroup` (only a bare `×N` group bypasses it, and `×N` never holds a running member). `ToolBurstGroup` → `BurstBodyItem` → `ToolCallStep` never receives `onAbort`/`onForceKill`, so the Stop/Force-Stop controls `ToolCallStep` implements never mount. The only call site that passes them (`ChatView.tsx` top-level `toolResult` branch) is unreachable. Additionally, with `toolGroupDefaultCollapsed` on (or on mobile) a running burst starts collapsed, so a per-row control alone would be invisible.

## What Changes

- **A — per-row stop restored:** `ChatView` threads `onAbort`/`onForceKill` into `ToolBurstGroup`; running member rows render a stop control.
- **B — header stop:** a running burst's header row renders a stop control (Stop → Force Stop → Killing) visible whether expanded or collapsed.
- **One shared stop state per burst:** header and running rows render the same `idle | aborting | killing` state, owned by `ToolBurstGroup`; it survives body collapse/re-expand.
- Stop logic extracted from `ToolCallStep` into a shared hook + presentational control (single state machine for burst and standalone rows).
- Stop controls become real focusable `<button>`s with accessible names, placed beside (not inside) the toggle button — fixes click-through-to-toggle and keyboard reach; 44 px hit area on mobile.
- Wire semantics unchanged: Stop sends `{type:"abort"}` via `handleAbort` (also clears the optimistic `pendingPrompt`, as the composer Stop already does); Force Stop sends `{type:"force_kill"}`. Both session-scoped.
- `CollapsedToolGroup` (`×N`) not touched: the semantic pass never groups running tools.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `chat-view`: adds the requirement "Running burst exposes a shared stop control" alongside the existing burst rendering requirements.

## Impact

- Client only: `packages/client/src/components/chat/{ChatView,ToolBurstGroup,ToolCallStep}.tsx`, new `ToolStopControl.tsx` (control + `useToolStopState` hook), tests under `packages/client/src/components/__tests__/`.
- No protocol, server, extension, or persistence change → no migration; rollback = revert the client commit + `npm run build` + restart.
- Stop remains session-wide: a row Stop inside a multi-member burst aborts the whole turn (all running tools), same as the session-card Stop.
- `ToolCallStep` DOM changes: stop controls move out of the header `<button>` to a sibling; testids `tool-stop-button` / `tool-force-stop-button` kept.

## Discipline Skills

- **`review-code`** — non-trivial client change; inline review before commit.
- **`react-expert` spawn** (AGENTS.md checkpoint) — ≥3 React components touched (`ToolStopControl` new, `ToolCallStep`, `ToolBurstGroup`, `ChatView`) and a hook added (`useToolStopState`).

`security-hardening`, `performance-optimization`, `observability-instrumentation` do not apply: no untrusted input, no latency budget or large-data path, no new endpoint/job. `doubt-driven-review` already ran at planning; no irreversible step.
