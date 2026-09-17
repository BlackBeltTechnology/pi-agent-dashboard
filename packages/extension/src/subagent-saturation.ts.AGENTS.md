# subagent-saturation.ts — index

Private resource-load sampler for subagent-fanout admission. Owns its sampling state so it never disturbs `process-metrics.ts` — `collectMetrics()` is a DESTRUCTIVE read (resets the event-loop histogram + CPU delta) and its sole caller is the 15 s heartbeat; reading it from admission would corrupt the very measurements that evidence the stall.

Exports `SATURATION_WINDOW_MS` (5000), `SATURATION_EXIT_RATIO` (0.8), pure `anyMetricAtOrAbove(reading, thresholds, ratio)`, pure `nextSaturationState(prev, reading, thresholds)` (enter at/above a threshold; leave only once EVERY metric is below 80 % of its threshold), and class `SaturationSampler` (own `monitorEventLoopDelay` histogram at 20 ms resolution over a fixed 5 s rolling window + own CPU baseline; `read(thresholds)` → `{saturated, reading}`; `dispose()`).

Domains are separate and stated: `eventLoopDelayMs` / `cpuPercent` are PROCESS-domain (`process.cpuUsage`, own histogram); `loadAvg1m` is MACHINE-domain (`os.loadavg`) — the observed deaths are machine saturation from many resident sessions, where a parent's own CPU can read low. A missing metric is "no signal", never saturation. Injectable clock/CPU/load/eld for tests. See change: bound-subagent-fanout-under-host-pressure.
