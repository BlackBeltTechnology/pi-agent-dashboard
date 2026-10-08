# Test Plan — stream-subagent-reasoning-and-stable-card

Stage: design   Generated: 2026-10-06

No clarifications are needed. Every Triple uses a spec-defined value: 280 chars, ≤2x, 250 ms, cleared sentinel, equal height.

L1(P) = producer repo `../pi-dashboard-subagents/extensions/__tests__/` (vitest). L1 = dashboard vitest.

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | live tail bounded | BVA | L1(P) | automated | thinking deltas totalling 0 / 1 / 279 / 280 / 281 / 1000 chars | next throttled tick | `liveTail.text.length` = min(total, 280), equal to the suffix of the streamed text, `kind:"thinking"` |
| E2 | live tail bounded | EP | L1(P) | automated | text deltas, then a thinking block in the same turn | next ticks | `kind` switches "text" → "none" → "thinking", and a tail never mixes two blocks |
| E3 | key always present | decision table | L1(P) | automated | snapshot kinds: queued, running mid-block, running idle, completed, failed, aborted, early-error | each emitted snapshot | every snapshot has a `liveTail` key; non-streaming ones equal `{kind:"none",text:""}` |
| E4 | activity no flicker | state-transition | L1(P) | automated | tool start → tool end → (no block yet) | tick after tool end | `activity` is non-empty and equals the last value ("running <tool>") |
| E5 | not stripped | EP | L1 | automated | running frame with `entries` + `liveTail` (`packages/extension/src/__tests__/subagent-frame-strip.test.ts`) | `stripSubagentEntries` | `entries` removed, `liveTail` deep-equal to the input, input not mutated |
| E6 | reducer normalizes | EP | L1 | automated | `liveTail` = valid thinking / valid text / sentinel / `{kind:"x"}` / `{text:5}` / 400-char text | fold a `tool_execution_update` | state is the valid tail, or the cleared tail for the invalid ones; text truncated to 280; no throw |
| E7 | inspector live entry | decision table | L1 | automated | entries 0 or 3 × liveTail none / thinking / text (`MinimalChatView.test.tsx`, `SubagentDetailView.test.tsx`) | render | live entry is last and labelled in-progress when the tail is non-empty; "No detail available yet" only when entries=0 and the tail is none |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | tick size flat | threshold | L1 | automated | timeline grows 10 → 100 entries with a 280-char tail present (extend `subagent-tick-growth.test.ts`) | serialized broadcast bytes at 100 ≤ 2× those at 10 | single run |
| P2 | no added tick frequency | threshold | L1(P) | automated | 100 `thinking_delta` events in a burst of < 250 ms (mirror the existing text_delta burst test in `agent.test.ts`) | emitted ticks ≤ ceil(burst/250ms)+1 | burst |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | stable card height | state-transition | L1 | automated | running details alternating activity on/off × tail on/off (`AgentToolRenderer.test.tsx`) | rerender for each tick | activity row and preview row always mounted, with the same fixed-height classes; no conditional unmount |
| F2 | stable card height | convergence | L3 | automated | faux subagent emitting tool calls + thinking (extend `tests/e2e/subagent-inspector.spec.ts`) | ticks stream for ≥ 5 s | collapsed card `boundingBox().height` is identical across every sample while running |
| F3 | resync clears card tail | state-transition | L1 | automated | card showing tail "abc"; then a `subagents:started` resync frame with the cleared tail | fold + render | card preview row is empty (reads the session map before toolDetails) |
| F4 | live preview styled | visual | — | manual-only | running subagent with streaming thinking in the dashboard | human looks | [judgment: preview reads like main-chat thinking, no jitter] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | cleared on replay | fault-injection (replay) | L1 | automated | session with 3 tail→clear blocks + terminal, stored via `memory-event-store` (`packages/server/src/__tests__/memory-event-store.test.ts`) | raw fold vs compacted fold | each clear subsumes its predecessor; both folds end with the cleared tail and identical SessionState |
| X2 | old producer | EP | L1 | automated | 0.2.6-shaped details without a `liveTail` key | fold + render card + inspector | no error; preview row empty at fixed height; inspector unchanged from today |
| X3 | malformed tail | fault-injection | L1 | automated | `liveTail: "str"` / `null` / array | fold | non-object values are ignored (previous state kept per existing merge); no throw |

## Coverage summary

- Requirements covered: 9/9 scenarios across 5 requirements
- Scenarios by class: edge 7 · perf 2 · frontend 4 · error 3
- Scenarios by level: L1 9 · L1(P) 5 · L3 1 · manual-only 1
