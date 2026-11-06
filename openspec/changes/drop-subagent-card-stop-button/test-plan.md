# Test Plan — drop-subagent-card-stop-button

Stage: design   Generated: 2026-11-06

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | subagent-stop-control: Card has no stop control of its own | EP | L1 | automated | details `{status ∈ {queued, running}, stoppable:true, agentId}` | render `AgentToolRenderer` | no `agent-stop-button`; no `agent-stop-row` |
| E2 | subagent-stop-control: No stop requested | EP | L1 | automated | details `{status:"queued"}` (older producer, no `stoppable`) | render | no `agent-stop-button`, no `agent-stop-row` (keeps today's #E2 assertion) |
| E3 | subagent-stop-control: Stop from a collapsed row | state-transition | L1 | automated | `ToolCallStep` row, claim `stop` → `true`, row collapsed by a header click | click `tool-stop-button` | row body visible (`expanded`); `onAbort` not called |
| E4 | subagent-stop-control: claim declines | EP | L1 | automated | claim `stop` ∈ {false, throws}, row collapsed | click `tool-stop-button` | row stays collapsed; existing `onAbort` path called once (today's #E6 table) |

### Error-handling

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | subagent-stop-control: Stop request refused | EP | L1 | automated | running stoppable card; fetch → 403 `{error:"operate authority required"}` | `agentStop({sessionId, toolCallId, toolDetails})` (row path) | card `agent-stop-error` contains the reason |
| X2 | subagent-stop-control: Stop not confirmed | state-transition | L1 | automated | running stoppable card; fetch → 200; fake timers | `agentStop(...)`, advance 9.9 s then 0.1 s | `agent-stop-pending` until 10 s, then `agent-stop-unconfirmed` |
| X3 | subagent-stop-control: Terminal frame clears a pending stop | state-transition | L1 | automated | as X2 | `agentStop(...)`, rerender with `status:"completed"` | no pending / unconfirmed notice |

### End-to-end

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| F4 | subagent-stop-control: Each row offers its own stop | use-case | L3 | automated | queued fan-out (harness, producer 0.6.0) | click the running row's `tool-stop-button` | its card shows "stopped by you"; former #1 starts within 3 s; no `agent-stop-button` on the page |

### Visual

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| V1 | subagent-stop-control: Card has no stop control of its own | exploratory | manual | manual-only | live gap-miner fan-out (running + queued) | look at cards in dark + light | one ■ per row, no card stop line, feedback line appears only after a stop |
