# DOX — packages/server/src/metrics

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `eventloop-sampler.ts` | Dedicated ELD safety-net sampler. `startEventLoopSampler({floorMs,intervalMs,onSpike,histogram?})` →… → see `eventloop-sampler.ts.AGENTS.md` |
| `eventloop-spike-metrics.ts` | Ring buffer of worst-case event-loop stalls. `createEventLoopSpikeMetrics(capacity)` →… → see `eventloop-spike-metrics.ts.AGENTS.md` |
| `hydration-metrics.ts` | Ring-buffer recorder for session-hydration timings. `createHydrationMetrics(capacity)` → `{ record(sample),… → see `hydration-metrics.ts.AGENTS.md` |
