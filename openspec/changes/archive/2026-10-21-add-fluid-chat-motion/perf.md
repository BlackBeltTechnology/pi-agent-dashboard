# perf.md — render-cost gate (design D4, task 4.3)

Workload: `[[faux:chat-motion-stream]]` (≥ 4000 chars: prose + list + fenced code), streamed at default `FAUX_TPS` (~30 s) in the docker harness, Chrome (system), headless.
Probe: `tests/e2e/chat-motion-perf.spec.ts` (`PW_PERF=1`). Motion off = `prefers-reduced-motion: reduce` (same code path as `chatMotion=false`).
Budget: tail scripting (CDP `Performance.getMetrics` `ScriptDuration` delta) motion-on ≤ 1.5× motion-off AND p95 rAF frame interval < 16.7 ms (+0.3 ms jitter).

| Run | Configuration | scripting on | scripting off | ratio | p95 frame on | p95 frame off | verdict |
|---|---|---|---|---|---|---|---|
| 1 | pacing every frame (60 Hz), whole-tail `MarkdownContent` | 19096 ms | 8477 ms | 2.25 | 33.4 ms | 16.7 ms | over budget |
| 2 | + D4 step 1: reveal cadence capped at 30 Hz (`PACE_MIN_STEP_MS = 33`) | 16208 ms | 8276 ms | 1.96 | 33.3 ms | 16.7 ms | over budget |
| 3 | + D4 step 2: parser-based block split (`lib/chat/split-markdown-blocks.ts`, completed blocks memoized) | 11440 ms | 8014 ms | 1.43 | 16.8 ms | 16.7 ms | **within budget** |

Final configuration = run 3 (steps 1 and 2 both applied, in the design's order). No scope decision needed (pacing stays).

Notes:
- Step 2 applies only while motion is on and is decided by `effectiveMotion` alone, so the DOM shape never flips mid-stream and cannot remount a node a selection is anchored in. With motion off the tail is one `MarkdownContent`, exactly as before.
- Mermaid ordinal offset (D4 caveat) is not needed: ordinals are only consumed for file previews (`mermaidSource`), never for the chat tail.
- The run-3 ratio sits near the ceiling (1.43 vs 1.5). The reduction comes from not re-parsing and re-reconciling completed blocks; the remaining overhead is the last block's re-render, the 30 Hz steps and the trailing-edge `Range` measurement.
