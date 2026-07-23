# Test Plan — head-tail-truncate-subagent-event-timeline

Stage: design   Generated: 2026-07-23

All Triples resolved from the spec's concrete constants (`MAX_EVENT_DATA_SIZE=20000`,
`PROMPT_CAP=2000`, `DESC_CAP=1500`, `CONTENT_CAP=1500`, `K_HEAD=1`, `K_TAIL=4`,
`ENTRY_FLOOR=256`, `MID_FLOOR=800`, `ENTRY_FINAL=clamp(E×0.45,1500,6000)`). No clarification gaps.
"Bounded" observable = `Buffer.byteLength(JSON.stringify(stored.data)) ≤ MAX_EVENT_DATA_SIZE` (the
byte-accurate terminal proof guarantees ≤ ceiling; the TEST may stringify to assert).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | capString head+tail | BVA | L1 | automated | a string of length `maxSize+500` | `capString(s, maxSize)` | result contains `s`'s head slice AND tail slice AND a `…hidden…` marker; `result.length ≤ maxSize + markerLen` |
| E2 | capString no-op at/under cap | BVA | L1 | automated | a string of length `maxSize` | `capString(s, maxSize)` | returns `s` unchanged (no marker) |
| E3 | skill-envelope preserved | decision | L1 | automated | over-long `<skill name=".." location="..">BODY</skill>\n\nargs` | `capString` | closing `</skill>`, header, and trailing args intact; `parseSkillBlock` still parses it |
| E4 | keep first+last entries + text sentinel | EP | L1 | automated | subagent `tool_execution_update` with 30 large entries, `Buffer.byteLength>20000` | truncator `insertEvent` | stored `data.partialResult.details.entries` = [1 head, a `{kind:"text"}` sentinel whose text names the count, ≤4 tail incl the LAST entry]; NOT `{__truncated}`; bounded |
| E5 | large prompt does not starve timeline | BVA | L1 | automated | subagent event, `data.args.prompt` = 16 KB, 10 entries, over ceiling | insert | `prompt` capped ≤ `PROMPT_CAP`+marker (head+tail); entries retain first+last; bounded |
| E6 | large content text does not starve | BVA | L1 | automated | subagent event, `partialResult.content[0].text` = 16 KB | insert | `content[0].text` capped ≤ `CONTENT_CAP`+marker; entries retain first+last; bounded |
| E7 | byte-accurate bound under escape/CJK | BVA | L1 | automated | subagent event whose entry strings are 12 KB of `"`/`\`/control chars and CJK (code-unit count < ceiling, byte count ≫ ceiling) | insert | `Buffer.byteLength(JSON.stringify(stored.data)) ≤ 20000` (code-unit estimate alone would have passed a too-large payload) |
| E8 | type-scoped detection (no false positive) | decision-table | L1 | automated | over-ceiling event WITHOUT `toolName==="Agent"`/`details.agentId` but WITH an array at `data.details.entries` | insert | `data` → `{__truncated}` placeholder; the array is NOT head+tail-reduced and NOT string-capped |
| E9 | >20-entry timeline not clobbered | boundary | L1 | automated | subagent event, `entries.length=25`, over ceiling, `maxStringFieldSize>0` on the store | insert | `entries` stays an array (reduced head+tail); NEVER the string `"[array truncated]"` |
| E10 | per-ENTRY budget over many-leaf object input | EP | L1 | automated | kept `tool` entry whose `input` is an object with 10 large string leaves + large `output` | reduce to the entry budget `B` | `Buffer.byteLength(JSON.stringify(entry)) ≤ B` (entry-level bound, NOT leafCount×cap) |
| E11 | image-bearing NON-subagent event byte-detected | BVA | L1 | automated | non-subagent event with a 2 MB base64 image (a code-unit estimate would fall under ceiling) | insert | byte-accurate walk counts the image at real size → over-ceiling → `{__truncated}`; event NOT stored full-size |
| E12 | under-ceiling subagent event unchanged | EP (below boundary) | L1 | automated | subagent event serializing to 8 KB | insert | stored unchanged — no sentinel, no reduction, no cap |
| E13 | non-subagent over-ceiling unchanged | regression | L1 | automated | over-ceiling event, no subagent timeline | insert | `data` → `{__truncated, reason, eventType}` (existing behavior) |
| E14 | pathological single huge final entry | BVA | L1 | automated | timeline reducing to `K_TAIL=1` whose final entry alone is 40 KB | insert | final entry capped at `ENTRY_FLOOR` head+tail; bounded (or `{__truncated}` fallback if still over) |
| E15 | reducer does not mutate input event | invariant | L1 | automated | over-ceiling subagent event; retain a ref to the original `event.data` | insert | a NEW event returned; original `event.data.args`/`details`/`entries` byte-identical to before |
| E16 | text sentinel renders on the client path | state | L1 | automated | `SubagentState.entries` containing the `{kind:"text","⋯ N steps hidden ⋯"}` sentinel | `mapSubagentEntries` / `readSubagentDetails` | sentinel maps to a text `MinimalChatEntry`; no `error`/`(unknown entry)`; non-empty guard still adopts entries |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | size measurement is bounded (no full stringify) | bounded-cost | L1 | automated | event `data` with one 5 MB single-string field | `JSON.stringify` is NOT invoked on the oversized `data` (spy/assert) AND result bounded AND call returns < 50 ms | single call |
| P2 | shrink loop terminates | bounded-cost | L1 | automated | pathological entry: one 5 MB string leaf + 500 numeric leaves | `reduceSubagentEvent` returns within a bounded iteration count; result bytes ≤ 20000 | single call |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | base64 image in subagent event does not OOM | fault-injection | L1 | automated | subagent event with a 5 MB base64 image `{data,mimeType}` in `content[*]` | insert | image `data` head+tail-capped (or `{__truncated}` fallback); NO `JSON.stringify` on the 5 MB payload (spy); bounded |
| X2 | unreducible empty-entries falls back | fault-injection | L1 | automated | subagent event, `entries:[]`, envelope still > ceiling after all caps | insert | `data` → `{__truncated}` placeholder built without stringifying the original; bounded |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | real dashboard shows opening + "N steps hidden" + final | visual/subjective | — | manual-only | a live in-memory subagent producing >20 large-output tool steps, viewed in the dashboard subagent detail | human views the timeline | [judgment: opening steps, a "⋯ N steps hidden ⋯" line, and the final steps/result are shown — no freeze at ~3 steps] |

---

## Coverage summary

- Requirements covered: 20/20 spec scenarios + design invariants
- Scenarios by class: edge 16 · perf 2 · frontend 1 · error 2
- Scenarios by level: L1 20 · L2 0 · L3 0 · manual-only 1
- Scenarios by disposition: automated 20 · manual-only 1

## New infra needed

- none — all automated rows are L1 vitest over `memory-event-store.ts` (pure, in-process) and the
  `subagents-plugin` client mapper. The truncator is constructor-injectable (`createMemoryEventStore`),
  so tests build events and assert on the returned/stored `data` directly; no docker/e2e harness.
