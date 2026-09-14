# Tasks — offload-retained-transcript-replay

Carried out of `serve-retained-remote-transcripts` (PR #663), where the retained
read landed synchronous on the main thread while the equivalent local path had
already been moved into a worker by `offload-session-events-load-to-worker`.

## 1. Measure first

- [ ] 1.1 Record the main-thread cost of `readRetainedTranscript` across the real size distribution (p50 73 KB, p90 1.1 MB, p99 3.9 MB, observed max 44.1 MB) — no optimisation lands before the number it is supposed to move exists
- [ ] 1.2 Confirm the hydration heartbeat genuinely cannot fire during the blocked window (it shares the loop), so the "false empty state" net is provably absent on this path

## 2. Worker path

- [ ] 2.1 Extend `SessionLoadRequest` to accept pre-read `entries` as an alternative to `sessionFile`, so the retained read reuses the SAME worker and the SAME `replayEntriesAsEvents` rather than a second projection
- [ ] 2.2 Assert output parity between the entries-fed and file-fed paths — the existing parity test is the model; a divergence here would render a remote session differently from the machine it came from
- [ ] 2.3 Move the store read to `fs.promises`, so a 44 MB `readFileSync` stops being a main-thread stall in its own right

## 3. Callers

- [ ] 3.1 Route the cold-hydration branch (`subscription-handler.ts`) through the pool, keeping `stopHeartbeat` correct on every exit path
- [ ] 3.2 Route `GET /api/sessions/:id/retained-transcript` through it
- [ ] 3.3 Preserve the observable contract exactly: `{entries, events, state}`, three-state `complete | incomplete | absent`, never-throws (parse included), and `absent` for a session id the store refuses

## 4. Instrumentation

- [ ] 4.1 Record a `hydrationMetrics` sample for the retained path, which currently reports nothing — "is hydration slow for remote sessions?" has no runtime answer today

## 5. Verify

- [ ] 5.1 Re-measure 1.1 and show the main-thread time moved; a change justified by a latency budget that does not move it should be reverted, not kept
- [ ] 5.2 `tests/e2e/remote-transcript-read.spec.ts` still green (behaviour unchanged)

## 6. Ship

- [ ] 6.1 `openspec archive offload-retained-transcript-replay`
